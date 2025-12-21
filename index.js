/* ************************************************************ */
/*  Prayer Notification Scheduler - Firebase FCM Edition        */
/*  Features: Caching, Batching, Error Handling, Monitoring     */
/* ************************************************************ */
import 'dotenv/config';
import cron from 'node-cron';
import PrayTime from './prayerTime.js';
import { FCM_DEVICE_TOKEN, NotificationHistory } from './token_model.js';
import { connectDatabase } from './db_config.js';
import express from 'express';
import admin from 'firebase-admin';
import { createRequire } from 'module';
import cors from 'cors';

const require = createRequire(import.meta.url);
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
}));

const route = express.Router();

// Configuration
const PRESET = {
    lat: 19.0760,
    lng: 72.8777,
    tz: 'Asia/Kolkata',
    method: 'MWL'
};

const PRAYER_NAMES = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const BATCH_SIZE = 500; // FCM multicast limit is 500
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache structures
const cache = {
    prayerTimes: {
        today: null,
        tomorrow: null,
        lastUpdated: null
    },
    tokens: {
        data: [],
        lastUpdated: null
    },
    sentNotifications: new Set() // Track sent notifications: "2025-11-30:fajr"
};

// Monitoring stats
const stats = {
    notificationsSent: 0,
    notificationsFailed: 0,
    lastNotificationTime: null,
    errors: []
};

/* ==================== UTILITY FUNCTIONS ==================== */

/**
 * Structured logging with timestamp
 */
function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        ...data
    };

    if (level === 'ERROR') {
        // console.error(JSON.stringify(logEntry));
        stats.errors.push({ ...logEntry, time: timestamp });
        // Keep only last 100 errors
        if (stats.errors.length > 100) stats.errors.shift();
    } else {
        // console.log(JSON.stringify(logEntry));
    }
}

/**
 * Get current date string in YYYY-MM-DD format (Asia/Kolkata)
 */
function getDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: PRESET.tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

/**
 * Get current time in HH:MM format (Asia/Kolkata)
 * This ensures correct time regardless of server location (UTC, etc.)
 */
function getCurrentTime() {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: PRESET.tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(new Date());
}

/* ==================== PRAYER TIME MANAGEMENT ==================== */

/**
 * Calculate prayer times for a given date
 */
function calcPrayerTimes(date = new Date()) {
    try {
        const calc = new PrayTime(PRESET.method);
        calc.location([PRESET.lat, PRESET.lng]);
        calc.timezone(PRESET.tz);
        calc.format('24h');

        const times = calc.getTimes(date);

        // Extract only the 5 daily prayers
        const prayerTimes = {};
        PRAYER_NAMES.forEach(prayer => {
            prayerTimes[prayer] = times[prayer];
        });

        log('INFO', 'Prayer times calculated', {
            date: getDateString(date),
            times: prayerTimes
        });

        return prayerTimes;
    } catch (error) {
        log('ERROR', 'Failed to calculate prayer times', {
            error: error.message,
            date: getDateString(date)
        });
        return null;
    }
}

/**
 * Update prayer times cache
 */
function updatePrayerTimesCache() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    cache.prayerTimes.today = {
        date: getDateString(today),
        times: calcPrayerTimes(today)
    };

    cache.prayerTimes.tomorrow = {
        date: getDateString(tomorrow),
        times: calcPrayerTimes(tomorrow)
    };

    cache.prayerTimes.lastUpdated = new Date();

    log('INFO', 'Prayer times cache updated', {
        today: cache.prayerTimes.today,
        tomorrow: cache.prayerTimes.tomorrow
    });
}

/**
 * Get prayer times for a specific date
 */
function getPrayerTimes(date = new Date()) {
    const dateStr = getDateString(date);

    if (cache.prayerTimes.today?.date === dateStr) {
        return cache.prayerTimes.today.times;
    }

    if (cache.prayerTimes.tomorrow?.date === dateStr) {
        return cache.prayerTimes.tomorrow.times;
    }

    // Cache miss - calculate on the fly
    log('WARN', 'Prayer times cache miss', { date: dateStr });
    return calcPrayerTimes(date);
}

/* ==================== TOKEN MANAGEMENT ==================== */

/**
 * Fetch and cache FCM device tokens
 */
async function updateTokenCache() {
    try {
        const tokens = await FCM_DEVICE_TOKEN.find().lean();
        // Filter out any obviously invalid tokens if necessary
        const validTokens = tokens
            .filter(t => t.fcmToken && t.fcmToken.length > 0);

        cache.tokens.data = validTokens;
        cache.tokens.lastUpdated = new Date();

        log('INFO', 'Token cache updated', {
            totalTokens: tokens.length,
            validTokens: validTokens.length
        });

        return validTokens;
    } catch (error) {
        log('ERROR', 'Failed to update token cache', { error: error.message });
        return cache.tokens.data; // Return stale cache on error
    }
}

/**
 * Get cached tokens or fetch if stale
 */
async function getTokens() {
    const now = Date.now();
    const cacheAge = cache.tokens.lastUpdated
        ? now - cache.tokens.lastUpdated.getTime()
        : Infinity;

    if (cacheAge > TOKEN_CACHE_TTL || cache.tokens.data.length === 0) {
        return await updateTokenCache();
    }

    return cache.tokens.data;
}

/* ==================== NOTIFICATION MANAGEMENT ==================== */

/**
 * Send FCM notifications in batches and log history
 */
async function sendFCMBatch(tokenDocs, prayer, time) {
    // Prepare the message payload
    const title = `${prayer.charAt(0).toUpperCase() + prayer.slice(1)} Prayer Time`;
    const body = `It's time for ${prayer} prayer at ${time}`;

    // Extract just the token strings for sending
    const tokens = tokenDocs.map(t => t.fcmToken);

    // Construct the message for multicast
    const messageBase = {
        notification: {
            title: title,
            body: body,
        },
        android: {
            notification: {
                channelId: 'prayer',
                sound: 'azaan', // Android resource name (no extension)
                priority: 'high',
                defaultSound: false,
            },
            priority: 'high',
        },
        apns: {
            payload: {
                aps: {
                    alert: {
                        title: title,
                        body: body,
                    },
                    sound: 'azaan.wav', // iOS filename (with extension)
                    badge: 1,
                    contentAvailable: true,
                }
            }
        },
        data: {
            type: `${prayer}time`,
            prayer: prayer.toUpperCase(),
            time: time,
            sound: 'azaan.wav'
        }
    };

    const chunks = [];
    // We need to chunk both the token strings and the original docs to keep track of who is who
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        chunks.push({
            tokens: tokens.slice(i, i + BATCH_SIZE),
            docs: tokenDocs.slice(i, i + BATCH_SIZE)
        });
    }

    const results = {
        success: 0,
        failed: 0,
        errors: []
    };

    for (const chunk of chunks) {
        try {
            const message = {
                ...messageBase,
                tokens: chunk.tokens
            };

            const batchResponse = await admin.messaging().sendEachForMulticast(message);

            results.success += batchResponse.successCount;
            results.failed += batchResponse.failureCount;

            // Prepare history records
            const historyRecords = [];

            batchResponse.responses.forEach((resp, idx) => {
                const tokenDoc = chunk.docs[idx];
                const status = resp.success ? 'sent' : 'failed';
                const error = resp.success ? null : (resp.error?.message || 'Unknown error');

                historyRecords.push({
                    token: tokenDoc.fcmToken,
                    platform: tokenDoc.platform || 'unknown',
                    title: title,
                    body: body,
                    prayer: prayer,
                    status: status,
                    error: error,
                    sentAt: new Date()
                });

                if (!resp.success) {
                    results.errors.push({
                        token: tokenDoc.fcmToken,
                        error: error
                    });

                    // Handle invalid tokens
                    if (resp.error?.code === 'messaging/registration-token-not-registered') {
                        log('WARN', 'Invalid token detected, removing', { token: tokenDoc.fcmToken });
                        FCM_DEVICE_TOKEN.deleteOne({ fcmToken: tokenDoc.fcmToken }).catch(console.error);
                    }
                }
            });

            // Bulk insert history records
            if (historyRecords.length > 0) {
                await NotificationHistory.insertMany(historyRecords);
            }

        } catch (error) {
            results.failed += chunk.tokens.length;
            log('ERROR', 'Batch send failed', {
                prayer,
                batchSize: chunk.tokens.length,
                error: error.message
            });

            // Log failure for entire batch in history
            const failedRecords = chunk.docs.map(doc => ({
                token: doc.fcmToken,
                platform: doc.platform || 'unknown',
                title: title,
                body: body,
                prayer: prayer,
                status: 'failed',
                error: error.message,
                sentAt: new Date()
            }));
            await NotificationHistory.insertMany(failedRecords);
        }
    }

    return results;
}



/* ==================== SCHEDULER SETUP ==================== */

// Store active cron jobs for the day so we can clear them at midnight
let currentDayJobs = [];

/**
 * Schedule specific cron jobs for today's prayers
 */
function scheduleTodayPrayers() {
    // 1. Clear existing jobs from yesterday/previous run
    currentDayJobs.forEach(job => job.stop());
    currentDayJobs = [];

    const now = new Date();
    const dateStr = getDateString(now);

    // Get prayer times
    const prayerTimes = getPrayerTimes(now);

    if (!prayerTimes) {
        log('WARN', 'Could not fetch prayer times for scheduling', { date: dateStr });
        return;
    }

    log('INFO', 'Scheduling prayers for today', { date: dateStr, times: prayerTimes });

    // 2. Schedule a job for each prayer
    Object.entries(prayerTimes).forEach(([prayer, time]) => {
        const [hour, minute] = time.split(':');

        // Check if time is in the past
        const prayerDate = new Date();
        // We need to be careful with timezone here. 
        // The server might be in UTC, but 'time' is in Asia/Kolkata.
        // Simple comparison:
        // Get current time in Asia/Kolkata
        const nowInTZ = new Date(new Date().toLocaleString('en-US', { timeZone: PRESET.tz }));
        const pDate = new Date(nowInTZ);
        pDate.setHours(parseInt(hour), parseInt(minute), 0, 0);

        // If it's passed, don't schedule.
        if (pDate <= nowInTZ) {
            // log('DEBUG', 'Skipping past prayer', { prayer, time });
            return;
        }

        // Schedule the specific cron task
        // Format: "minute hour * * *"
        // Note: node-cron uses server time by default, but we can pass timezone!
        const cronExpression = `${parseInt(minute)} ${parseInt(hour)} * * *`;

        const job = cron.schedule(cronExpression, async () => {
            log('INFO', 'Scheduled prayer task triggered', { prayer, time });

            // Double check tokens are fresh.
            const tokenDocs = await getTokens();

            if (tokenDocs.length === 0) {
                log('WARN', 'No tokens available for notification', { prayer });
                return;
            }

            const results = await sendFCMBatch(tokenDocs, prayer, time);

            // Update stats
            stats.notificationsSent += results.success;
            stats.notificationsFailed += results.failed;
            stats.lastNotificationTime = new Date();

            // Log completion
            log('INFO', 'Scheduled notification cycle completed', {
                prayer,
                time,
                success: results.success,
                failed: results.failed
            });

        }, {
            timezone: PRESET.tz
        });

        currentDayJobs.push(job);
        log('INFO', 'Scheduled notification', { prayer, time, expression: cronExpression });
    });

    log('INFO', `Scheduled ${currentDayJobs.length} notifications for rest of the day`);
}

/**
 * Initialize the prayer notification scheduler
 */
/**
 * Initialize the prayer notification scheduler
 */
/**
 * Initialize the prayer notification scheduler
 */
async function initializeScheduler() {
    log('INFO', 'Initializing prayer notification scheduler');

    // Update caches immediately on start
    updatePrayerTimesCache();
    await updateTokenCache();

    // 1. Schedule notifications for TODAY immediately 
    // (Handles server restart in middle of day)
    scheduleTodayPrayers();

    // 2. MASTER CRON: Runs at Midnight (00:00) 
    // Responsible for maintenance and scheduling tomorrow's tasks
    cron.schedule('0 0 * * *', async () => {
        log('INFO', 'Midnight Master Job triggered');

        // Refresh Prayer Times Cache
        updatePrayerTimesCache();

        // Cleanup Sent Notifications History
        cache.sentNotifications.clear();
        log('INFO', 'Sent notifications cache cleared');

        // Schedule timings for the new day
        scheduleTodayPrayers();

    }, {
        timezone: PRESET.tz
    });

    // 3. Token Cache Refresh (Runs every 5 minutes)
    cron.schedule('*/5 * * * *', async () => {
        await updateTokenCache();
    }, {
        timezone: PRESET.tz
    });

    log('INFO', 'Prayer notification scheduler initialized', {
        prayers: PRAYER_NAMES,
        timezone: PRESET.tz,
        type: 'Dynamic Daily Scheduling'
    });
}

/* ==================== REST API ENDPOINTS ==================== */

route.post('/pushfcmtoken', async (req, res) => {
    try {
        const { platform = 'none', token } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'token missing' });
        }
        await FCM_DEVICE_TOKEN.findOneAndUpdate(
            { fcmToken: token },
            { platform, fcmToken: token },
            { upsert: true }
        );

        // Invalidate token cache to pick up new token immediately on next refresh
        cache.tokens.lastUpdated = null;

        log('INFO', 'FCM Token registered', { platform, token });
        res.status(200).json({ ok: true, message: 'FCM Token registered successfully' })
    } catch (error) {
        log('ERROR', 'Failed to register token', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

route.get('/fcmtoken', async (req, res) => {
    try {
        const query = req?.query || {};
        const data = await FCM_DEVICE_TOKEN.find(query).lean();
        res.json({ ok: true, data, count: data.length });
    } catch (error) {
        log('ERROR', 'Failed to fetch tokens', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

route.get('/history', async (req, res) => {
    try {
        const { limit = 100, status } = req.query;
        const query = {};
        if (status) query.status = status;

        const history = await NotificationHistory.find(query)
            .sort({ sentAt: -1 })
            .limit(parseInt(limit));

        res.json({ ok: true, count: history.length, data: history });
    } catch (error) {
        log('ERROR', 'Failed to fetch history', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

route.post('/test-notification', async (req, res) => {
    try {
        const { token } = req.body;

        // Validate token
        if (!token) {
            return res.status(400).json({
                ok: false,
                error: 'Device token is required'
            });
        }

        // Get current time (Asia/Kolkata)
        const currentTime = new Intl.DateTimeFormat('en-US', {
            timeZone: PRESET.tz,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        }).format(new Date());

        const title = '🔔 Test Notification';
        const body = `This is a test notification sent at ${currentTime}`;

        const message = {
            token: token,
            notification: {
                title: title,
                body: body,
            },
            android: {
                notification: {
                    channelId: 'prayer',
                    sound: 'azaan',
                    priority: 'high',
                    defaultSound: false,
                },
                priority: 'high',
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: title,
                            body: body,
                        },
                        sound: 'azaan.wav',
                        badge: 1,
                        contentAvailable: true,
                    }
                }
            },
            data: {
                type: 'test',
                timestamp: new Date().toISOString(),
                time: currentTime,
                sound: 'azaan.wav'
            }
        };

        // Send notification
        log('INFO', 'Sending test notification', { token, time: currentTime });

        const response = await admin.messaging().send(message);

        // Log to history
        await NotificationHistory.create({
            token,
            platform: 'test',
            title,
            body,
            prayer: 'TEST',
            status: 'sent',
            sentAt: new Date()
        });

        log('INFO', 'Test notification sent successfully', {
            token,
            messageId: response,
            time: currentTime
        });

        res.json({
            ok: true,
            message: 'Test notification sent successfully',
            sentAt: currentTime,
            timestamp: new Date().toISOString(),
            messageId: response
        });

    } catch (error) {
        log('ERROR', 'Failed to send test notification', {
            error: error.message,
            stack: error.stack
        });

        // Log failure
        if (req.body.token) {
            await NotificationHistory.create({
                token: req.body.token,
                platform: 'test',
                title: '🔔 Test Notification',
                body: 'Test failed',
                prayer: 'TEST',
                status: 'failed',
                error: error.message,
                sentAt: new Date()
            });
        }

        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

route.get('/health', (req, res) => {
    const now = Date.now();
    const cacheAge = cache.prayerTimes.lastUpdated
        ? now - cache.prayerTimes.lastUpdated.getTime()
        : null;

    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        serverTime: new Date().toLocaleString('en-US', { timeZone: PRESET.tz }),
        cache: {
            prayerTimes: {
                today: cache.prayerTimes.today?.date,
                tomorrow: cache.prayerTimes.tomorrow?.date,
                ageMs: cacheAge
            },
            tokens: {
                count: cache.tokens.data.length,
                lastUpdated: cache.tokens.lastUpdated
            },
            sentToday: Array.from(cache.sentNotifications)
        },
        stats: {
            notificationsSent: stats.notificationsSent,
            notificationsFailed: stats.notificationsFailed,
            lastNotificationTime: stats.lastNotificationTime,
            recentErrors: stats.errors.slice(-10)
        }
    });
});

route.get('/prayer-times', (req, res) => {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const times = getPrayerTimes(date);

    res.json({
        ok: true,
        date: getDateString(date),
        times,
        timezone: PRESET.tz
    });
});

route.get('/', (req, res) => {
    res.json({
        message: 'Prayer Notification Server (FCM)',
        status: 'running',
        version: '3.1.0',
        endpoints: {
            health: '/health',
            prayerTimes: '/prayer-times',
            registerToken: 'POST /pushfcmtoken',
            listTokens: 'GET /fcmtoken',
            testNotification: 'POST /test-notification'
        }
    });
});

/* ==================== SERVER INITIALIZATION ==================== */

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
    try {
        await connectDatabase(process.env.DBURL);
        log('INFO', 'Database connection successful');

        await initializeScheduler();

        log('INFO', 'Server started', {
            port: PORT,
            timezone: PRESET.tz,
            location: { lat: PRESET.lat, lng: PRESET.lng }
        });

        console.log(`🚀 Prayer Notification Server running on port ${PORT}`);
    } catch (err) {
        log('ERROR', 'Server initialization failed', {
            error: err.message,
            stack: err.stack
        });
        process.exit(1);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('INFO', 'SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('INFO', 'SIGINT received, shutting down gracefully');
    process.exit(0);
});

app.use('/', route);
// app.use('/.netlify/functions/api', route);

export default app;