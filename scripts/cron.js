// #!/usr/bin/env node
// import 'dotenv/config';
// import PrayTime from '../prayerTime.js';
// import { FCM_DEVICE_TOKEN, NotificationHistory } from '../token_model.js';
// import { connectDatabase } from '../db_config.js';
// import admin from 'firebase-admin';
// import { createRequire } from 'module';
// import fs from 'fs';
// import path from 'path';

// const require = createRequire(import.meta.url);

// // Load Firebase service account JSON from env or file
// let serviceAccount;
// const saPath = path.resolve(process.cwd(), 'serviceAccountKey.json');

// if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
//   try {
//     serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
//   } catch (err) {
//     console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err.message);
//     process.exit(1);
//   }
// } else if (fs.existsSync(saPath)) {
//   serviceAccount = require(saPath);
// } else {
//   console.error('serviceAccountKey.json not found and FIREBASE_SERVICE_ACCOUNT_JSON not provided.');
//   process.exit(1);
// }

// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount)
//   });
// }

// const PRESET = { lat: 19.0760, lng: 72.8777, tz: 'Asia/Kolkata', method: 'MWL' };
// const PRAYER_NAMES = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
// const BATCH_SIZE = 500;
// const WINDOW_MINUTES = 5; // send if now is within [prayer_time, prayer_time + WINDOW_MINUTES)

// // helpers
// function getDateString(date = new Date()) {
//   return new Intl.DateTimeFormat('en-CA', { timeZone: PRESET.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
// }
// function getNowInTZ() {
//   // returns Date object representing current time in PRESET.tz
//   return new Date(new Date().toLocaleString('en-US', { timeZone: PRESET.tz }));
// }
// function parseHHMMtoDateInTZ(hhmm, date = new Date()) {
//   const [hour, minute] = hhmm.split(':').map(Number);
//   const d = new Date(new Date().toLocaleString('en-US', { timeZone: PRESET.tz }));
//   d.setHours(hour, minute, 0, 0);
//   return d;
// }
// function calcPrayerTimes(date = new Date()) {
//   const calc = new PrayTime(PRESET.method);
//   calc.location([PRESET.lat, PRESET.lng]);
//   calc.timezone(PRESET.tz);
//   calc.format('24h');
//   const times = calc.getTimes(date);
//   const prayerTimes = {};
//   PRAYER_NAMES.forEach(p => { prayerTimes[p] = times[p]; });
//   return prayerTimes;
// }
// async function getAllTokens() {
//   const tokens = await FCM_DEVICE_TOKEN.find().lean();
//   return tokens.filter(t => t && t.fcmToken);
// }
// async function sendFCMBatch(tokenDocs, prayer, time) {
//   const title = `${prayer.charAt(0).toUpperCase() + prayer.slice(1)} Prayer Time`;
//   const body = `It's time for ${prayer} prayer at ${time}`;
//   const tokens = tokenDocs.map(t => t.fcmToken);
//   const messageBase = {
//     notification: { title, body },
//     android: { notification: { channelId: 'prayer', sound: 'azaan', priority: 'high', defaultSound: false }, priority: 'high' },
//     apns: { payload: { aps: { alert: { title, body }, sound: 'azaan.wav', badge: 1, contentAvailable: true } } },
//     data: { type: `${prayer}time`, prayer: prayer.toUpperCase(), time: time, sound: 'azaan.wav' }
//   };

//   const chunks = [];
//   for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
//     chunks.push({ tokens: tokens.slice(i, i + BATCH_SIZE), docs: tokenDocs.slice(i, i + BATCH_SIZE) });
//   }
//   const summary = { success: 0, failed: 0, errors: [] };

//   for (const chunk of chunks) {
//     try {
//       const message = { ...messageBase, tokens: chunk.tokens };
//       const bres = await admin.messaging().sendEachForMulticast(message);
//       summary.success += bres.successCount;
//       summary.failed += bres.failureCount;

//       const historyRecords = [];
//       bres.responses.forEach((resp, idx) => {
//         const tokenDoc = chunk.docs[idx];
//         const status = resp.success ? 'sent' : 'failed';
//         const error = resp.success ? null : (resp.error?.message || 'Unknown error');
//         historyRecords.push({ token: tokenDoc.fcmToken, platform: tokenDoc.platform || 'unknown', title, body, prayer, status, error, sentAt: new Date(), dayDate: getDateString(new Date()) });
//         if (!resp.success) {
//           summary.errors.push({ token: tokenDoc.fcmToken, error });
//           if (resp.error?.code === 'messaging/registration-token-not-registered') {
//             FCM_DEVICE_TOKEN.deleteOne({ fcmToken: tokenDoc.fcmToken }).catch(console.error);
//           }
//         }
//       });
//       if (historyRecords.length) await NotificationHistory.insertMany(historyRecords);
//     } catch (err) {
//       console.error('Batch send error:', err.message);
//       summary.failed += chunk.tokens.length;
//       const failedRecords = chunk.docs.map(doc => ({ token: doc.fcmToken, platform: doc.platform || 'unknown', title, body, prayer, status: 'failed', error: err.message, sentAt: new Date(), dayDate: getDateString(new Date()) }));
//       if (failedRecords.length) await NotificationHistory.insertMany(failedRecords).catch(console.error);
//     }
//   }
//   return summary;
// }

// async function main() {
//   try {
//     if (!process.env.DBURL) { console.error('Missing DBURL env var.'); process.exit(1); }
//     await connectDatabase(process.env.DBURL);
//     console.log('DB connected');

//     const today = new Date();
//     const prayerTimes = calcPrayerTimes(today);
//     const now = getNowInTZ();

//     console.log('Local time (Asia/Kolkata):', now.toTimeString().slice(0,5));

//     for (const [prayer, time] of Object.entries(prayerTimes)) {
//       if (!time) continue;
//       const prayerDate = parseHHMMtoDateInTZ(time, today);
//       const windowEnd = new Date(prayerDate.getTime() + WINDOW_MINUTES * 60 * 1000);

//       if (now >= prayerDate && now < windowEnd) {
//         // dedupe by checking if any sent history exists for this prayer and dayDate
//         const dayDate = getDateString(today);
//         const already = await NotificationHistory.findOne({ prayer: prayer, dayDate: dayDate, status: 'sent' }).lean();
//         if (already) {
//           console.log(`Already sent ${prayer} for ${dayDate}, skipping.`);
//           continue;
//         }

//         console.log(`Sending ${prayer} notifications (time ${time}) — window matched.`);
//         const tokenDocs = await getAllTokens();
//         if (tokenDocs.length === 0) { console.log('No tokens to send.'); continue; }

//         const result = await sendFCMBatch(tokenDocs, prayer, time);
//         console.log(`Completed ${prayer}: success=${result.success} failed=${result.failed}`);
//       } else {
//         // not in window
//         // console.log(`${prayer} not in window: now=${now.toTimeString().slice(0,5)} prayer=${time}`);
//       }
//     }

//     console.log('Cron run complete');
//     process.exit(0);
//   } catch (err) {
//     console.error('Cron script failed:', err);
//     process.exit(1);
//   }
// }

// main();



/**
 * scripts/cron.js
 *
 * - Schedules future prayer notifications by creating NotificationQueue entries (for today & tomorrow).
 * - Sends due notifications (scheduledAt <= now + WINDOW_MINUTES), marks queue entries sent/failed.
 * - Keeps history in NotificationHistory (existing model).
 *
 * Requirements:
 * - DBURL secret (GitHub Actions) or env locally
 * - FIREBASE_SERVICE_ACCOUNT_JSON secret (preferred)
 *
 * Run every 5 minutes from GitHub Actions.
 */

import 'dotenv/config';
import PrayTime from '../prayerTime.js';
import { FCM_DEVICE_TOKEN, NotificationHistory, NotificationQueue } from '../token_model.js';
import { connectDatabase } from '../db_config.js';

import admin from 'firebase-admin';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

// ---------- Config ----------
const PRESET = { lat: 19.0760, lng: 72.8777, tz: 'Asia/Kolkata', method: 'MWL' };
const PRAYER_NAMES = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const BATCH_SIZE = 500;
const WINDOW_MINUTES = 5; // process queue items scheduled within this window
const QUEUE_CLEANUP_DAYS = 3; // remove older queue items after this many days

// ---------- Firebase init ----------
let serviceAccount;
const saPath = path.resolve(process.cwd(), 'serviceAccountKey.json');

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
        console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err.message);
        process.exit(1);
    }
} else if (fs.existsSync(saPath)) {
    serviceAccount = require(saPath);
} else {
    console.error('serviceAccountKey.json not found and FIREBASE_SERVICE_ACCOUNT_JSON not provided.');
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

// ---------- Helpers ----------
function getDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: PRESET.tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function getNowInTZ() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: PRESET.tz }));
}

function parseHHMMtoDateInTZ(hhmm, date = new Date()) {
    const [hour, minute] = hhmm.split(':').map(Number);
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: PRESET.tz }));
    d.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    d.setHours(hour, minute, 0, 0);
    return d;
}

function calcPrayerTimes(date = new Date()) {
    const calc = new PrayTime(PRESET.method);
    calc.location([PRESET.lat, PRESET.lng]);
    calc.timezone(PRESET.tz);
    calc.format('24h');
    const times = calc.getTimes(date);
    const prayerTimes = {};
    PRAYER_NAMES.forEach(p => { prayerTimes[p] = times[p]; });
    return prayerTimes;
}

// ---------- DB token helpers ----------
async function getAllTokens() {
    const tokens = await FCM_DEVICE_TOKEN.find().lean();
    return tokens.filter(t => t && t.fcmToken);
}

// ---------- FCM send (batched) ----------
async function sendFCMBatch(tokenDocs, prayer, time) {
    const title = `${prayer.charAt(0).toUpperCase() + prayer.slice(1)} Prayer Time`;
    const body = `It's time for ${prayer} prayer at ${time}`;
    const tokens = tokenDocs.map(t => t.fcmToken);

    const messageBase = {
        notification: { title, body },
        android: { notification: { channelId: 'prayer', sound: 'azaan', priority: 'high', defaultSound: false }, priority: 'high' },
        apns: { payload: { aps: { alert: { title, body }, sound: 'azaan.wav', badge: 1, contentAvailable: true } } },
        data: { type: `${prayer}time`, prayer: prayer.toUpperCase(), time: time, sound: 'azaan.wav' }
    };

    const chunks = [];
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        chunks.push({ tokens: tokens.slice(i, i + BATCH_SIZE), docs: tokenDocs.slice(i, i + BATCH_SIZE) });
    }

    const summary = { success: 0, failed: 0, errors: [] };

    for (const chunk of chunks) {
        try {
            const message = { ...messageBase, tokens: chunk.tokens };
            const resp = await admin.messaging().sendEachForMulticast(message);

            summary.success += resp.successCount;
            summary.failed += resp.failureCount;

            const historyRecords = [];
            resp.responses.forEach((r, idx) => {
                const tokenDoc = chunk.docs[idx];
                const status = r.success ? 'sent' : 'failed';
                const error = r.success ? null : (r.error?.message || 'Unknown error');

                historyRecords.push({
                    token: tokenDoc.fcmToken,
                    platform: tokenDoc.platform || 'unknown',
                    title, body, prayer, status, error,
                    sentAt: new Date(),
                    dayDate: getDateString(new Date())
                });

                if (!r.success) {
                    summary.errors.push({ token: tokenDoc.fcmToken, error });
                    if (r.error?.code === 'messaging/registration-token-not-registered') {
                        FCM_DEVICE_TOKEN.deleteOne({ fcmToken: tokenDoc.fcmToken }).catch(console.error);
                    }
                }
            });

            if (historyRecords.length) await NotificationHistory.insertMany(historyRecords);
        } catch (err) {
            console.error('Batch send error:', err.message);
            summary.failed += chunk.tokens.length;

            const failedRecords = chunk.docs.map(doc => ({
                token: doc.fcmToken,
                platform: doc.platform || 'unknown',
                title, body, prayer,
                status: 'failed',
                error: err.message,
                sentAt: new Date(),
                dayDate: getDateString(new Date())
            }));
            if (failedRecords.length) await NotificationHistory.insertMany(failedRecords).catch(console.error);
        }
    }

    return summary;
}

// ---------- Queue functions ----------

/**
 * Create queue entries for a given date (today or tomorrow)
 * Only creates entries for times in the future (scheduledAt > now)
 * and only if a queue entry for that prayer/day doesn't already exist.
 */
async function createQueueForDate(date = new Date()) {
    const prayerTimes = calcPrayerTimes(date);
    const dayDate = getDateString(date);
    const now = getNowInTZ();

    for (const [prayer, time] of Object.entries(prayerTimes)) {
        if (!time) continue;

        const scheduledAt = parseHHMMtoDateInTZ(time, date);

        // If scheduledAt is in past relative to PRESET.tz, skip
        if (scheduledAt <= now) continue;

        try {
            // Create unique queue item if not exists
            await NotificationQueue.updateOne(
                { prayer, dayDate },
                { $setOnInsert: { prayer, dayDate, scheduledAt, status: 'pending', attempts: 0, createdAt: new Date() } },
                { upsert: true }
            );
        } catch (err) {
            // ignore duplicate key error or other errors
            if (err.code && err.code === 11000) {
                // duplicate - fine
            } else {
                console.error('Failed to create queue item:', err.message);
            }
        }
    }
}

/**
 * Process due queue items: those scheduledAt <= now + WINDOW_MINUTES
 */
async function processDueQueue() {
    const now = getNowInTZ();
    const windowEnd = new Date(now.getTime() + WINDOW_MINUTES * 60 * 1000);

    // Find pending items within the window
    const dueItems = await NotificationQueue.find({
        status: 'pending',
        scheduledAt: { $lte: windowEnd }
    }).sort({ scheduledAt: 1 }).lean();

    if (dueItems.length === 0) {
        console.log('No due queue items to process.');
        return;
    }

    console.log(`Processing ${dueItems.length} due queue item(s)`);

    for (const item of dueItems) {
        try {
            // Dedupe check: ensure not already sent in NotificationHistory
            const already = await NotificationHistory.findOne({ prayer: item.prayer, dayDate: item.dayDate, status: 'sent' }).lean();
            if (already) {
                console.log(`Queue ${item.prayer} ${item.dayDate} already sent; marking queue as sent.`);
                await NotificationQueue.updateOne({ _id: item._id }, { $set: { status: 'sent', sentAt: new Date() } });
                continue;
            }

            // Fetch tokens and send
            const tokenDocs = await getAllTokens();
            if (tokenDocs.length === 0) {
                console.log('No tokens available — skipping send but leaving queue pending.');
                continue; // leave pending so next run can try
            }

            console.log(`Sending queued ${item.prayer} for ${item.dayDate} to ${tokenDocs.length} tokens.`);
            const sendResult = await sendFCMBatch(tokenDocs, item.prayer, item.scheduledAt.toTimeString().slice(0, 5));

            // Mark queue item as sent (or failed) and update attempts
            const update = { attempts: (item.attempts || 0) + 1 };
            if (sendResult.success > 0) {
                update.status = 'sent';
                update.sentAt = new Date();
                update.lastError = null;
            } else {
                update.status = 'failed';
                update.lastError = (sendResult.errors && sendResult.errors[0]?.error) || 'unknown';
            }

            await NotificationQueue.updateOne({ _id: item._id }, { $set: update });
            console.log(`Queue ${item.prayer} processed: success=${sendResult.success} failed=${sendResult.failed}`);
        } catch (err) {
            console.error('Failed processing queue item', item.prayer, err.message);
            await NotificationQueue.updateOne({ _id: item._id }, { $inc: { attempts: 1 }, $set: { lastError: err.message } });
        }
    }
}

/**
 * Cleanup old queue items older than QUEUE_CLEANUP_DAYS
 */
async function cleanupOldQueue() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - QUEUE_CLEANUP_DAYS);
    await NotificationQueue.deleteMany({ createdAt: { $lt: cutoff } }).catch(console.error);
}

// ---------- Main ----------
async function main() {
    try {
        if (!process.env.DBURL) {
            console.error('Missing DBURL env var.');
            process.exit(1);
        }
        await connectDatabase(process.env.DBURL);
        console.log('DB connected');

        const now = getNowInTZ();
        console.log('Local time (Asia/Kolkata):', now.toTimeString().slice(0, 5));

        // 1) Create queue entries for today and tomorrow (future prayer times)
        await createQueueForDate(now);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        await createQueueForDate(tomorrow);

        // 2) Process due queue items (within WINDOW_MINUTES)
        await processDueQueue();

        // 3) Cleanup old queue entries
        await cleanupOldQueue();

        console.log('Cron run complete');
        process.exit(0);
    } catch (err) {
        console.error('Cron script failed:', err);
        process.exit(1);
    }
}

main();