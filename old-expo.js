/* ************************************************************ */
/*  prayerScheduler.js  –  cron-based,  no headless burst       */
/* ************************************************************ */
import 'dotenv/config';
import cron from 'node-cron';
import Expo from 'expo-server-sdk';
import PrayTime from './prayerTime.js';
import Device_Token from './token_model.js';
import { connectDatabase } from './db_config.js';
import express from 'express';
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
import cors from 'cors';
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
})); //

const route = express.Router()
const expo = new Expo();
const PRESET = { lat: 19.0760, lng: 72.8777, tz: 'Asia/Kolkata', method: 'MWL' };

/* ---------- prayer calc (your original) ---------- */
function calcPrayerTimes(date = new Date()) {
    const calc = new PrayTime(PRESET.method);
    calc.location([PRESET.lat, PRESET.lng]);
    calc.timezone(PRESET.tz);
    calc.format('24h');
    return calc.getTimes(date);
    // const t = calc.getTimes(date);
    // return { ...t, dhuhr: '11:18' };
}

/* ---------- schedule ONE cron job per prayer per day ---------- */
async function planDay(date) {
    const times = calcPrayerTimes(date);
    const prayers = Object.entries(times).filter(([p]) => !['sunrise', 'midnight'].includes(p));
    const tokens = await Device_Token.find().lean();
    const recipients = tokens.map((t) => t.expoPushToken).filter(Expo.isExpoPushToken);

    if (!recipients.length) return;

    for (const [prayer, time] of prayers) {
        const [h, m] = time.split(':').map(Number);
        console.log(prayer, 'prayer');
        if (['sunset', 'midnight',].includes(prayer)) continue; // skip unwanted prayers
        /* ✓  CRON PATTERN – never pass Date object  */
        const pattern = `${m} ${h} * * *`; // minute hour day month weekday

        cron.schedule(pattern, async () => {
            try {
                const messages = recipients.map((tok) => ({
                    to: tok,
                    sound: 'azaan.wav',
                    priority: 'high',
                    channelId: 'prayer',
                    data: { type: `${prayer}time`, prayer: prayer.toUpperCase(), time },
                }));
                const sendResult = await expo.sendPushNotificationsAsync(messages);
                console.log(`[${new Date().toISOString()}] ${prayer} sent to ${messages.length} devices`, messages, sendResult);
            } catch (e) {
                console.log(JSON.stringify({ prayer, time, error: e.message, ts: new Date().toISOString() }) + '-------Error in Schedule------');
            }
        }, { scheduled: true, timezone: 'Asia/Kolkata' });
    }
    console.log(`[${date.toISOString().slice(0, 10)}]  ${prayers.length} prayers scheduled`);
}

/* ---------- plan today + tomorrow on start / midnight ---------- */
async function bootstrapScheduler() {
    /* midnight scheduler – plans tomorrow */
    cron.schedule('0 0 * * *', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        await planDay(tomorrow);
    }, { timezone: 'Asia/Kolkata' });

    await planDay(new Date());                      // today
    await planDay(new Date(Date.now() + 86_400_000)); // tomorrow
}

/* ---------- REST endpoints (your original) ---------- */




route.post('/expotoken', async (req, res) => {
    try {
        const { username = 'test', token } = req.body;
        if (!token) return res.status(400).json({ error: 'token missing' });
        await Device_Token.findOneAndUpdate(
            { expoPushToken: token },
            { username, expoPushToken: token },
            { upsert: true }
        );
        res.json({ ok: true });
    } catch (e) {
        res.json({ error: e.message });
    }
});

route.get('/expotoken', async (req, res) => {
    try {
        const query = req?.query || {};
        const data = await Device_Token.find(query).lean();
        res.json({ ok: true, data, count: data.length });
    } catch (e) {
        res.json({ error: e.message });
    }
});
route.get('/', (req, res) => {
    res.send('Expo-push server is running');
});

const PORT = process.env.PORT || 4000;
// app.use(route);
app.listen(PORT, async () => {
    try {
        await connectDatabase(process.env.DBURL).then(async () => {
            console.log('DB connection successful');
            await bootstrapScheduler(); // <-- schedule AFTER db is ready
            console.log(`🚀 Expo-push server on ${PORT}`)
        });
    } catch (err) {
        console.log('Database connection failed', err);
        process.exit(1);
    }
});
app.use('/.netlify/functions/api', route);

export default app;