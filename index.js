import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import Expo from 'expo-server-sdk';
import { connectDatabase } from "./db_config.js";

import PrayTime  from "./prayerTime.js";
import Device_Token from './token_model.js';

const app = express();
app.use(cors());
app.use(bodyParser.json());
const expo = new Expo();

/* ---------- utils ---------- */
const PRESET = { lat: 19.0760, lng: 72.8777, tz: 'Asia/Kolkata', method: 'MWL' };

function calcPrayerTimes(date = new Date()) {
    const calc = new PrayTime(PRESET.method);
    calc.location([PRESET.lat, PRESET.lng]);
    calc.timezone(PRESET.tz);
    calc.format('24h');
    let times = calc.getTimes(date);          // {fajr:'05:13', ...}
    return times= {
        ...times,
        dhuhr: "10:45"
    }
}

/* ---------- daily scheduler ---------- */
let lastScheduled = null;              // YYYY-MM-DD

async function scheduleTodaysPrayers() {
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // '2025-09-19'
    if (lastScheduled === todayIST) return;          // already done today
    const times = calcPrayerTimes(new Date());
    const tokens = await Device_Token.find().lean().cursor(); // stream
    const batch = [];                           // reusable buffer

    for await (const doc of tokens) {
        const tk = doc.expoPushToken;
        if (!Expo.isExpoPushToken(tk)) continue;

        for (const [p, t] of Object.entries(times)) {
            console.log(p, t, 'check the prayer time');
            if (['sunrise', 'midnight'].includes(p)) {
                continue; // Skip to the next iteration of the for loop
            }
            const [h, m] = t.split(':').map(Number);
            const fire = new Date();
            fire.setHours(h, m, 5, 0);
            const ttlSec = Math.max(0, Math.floor((fire - Date.now()) / 1000));
            if (ttlSec <= 0) continue; // Prayer already past

            batch.push({
                to: tk,
                data: { type: p + 'time', prayer: p.toUpperCase(), time: t },
                priority: 'high',
                channelId: 'prayer',
                ttl: ttlSec,
            });
        }
    }


    if (!batch.length) { lastScheduled = todayIST; return; }

    /* ---- single HTTP call ---- */
    await expo.sendPushNotificationsAsync(batch);
    lastScheduled = todayIST;
    console.log(`[PRAYER] queued ${batch.length} silent pushes for ${todayIST}`);
}

/* ---------- retry wrapper ---------- */
async function robustSchedule() {
    try { await scheduleTodaysPrayers(); }
    catch (e) {
        console.error('[PRAYER] sched fail, retry in 30s', e.message);
        setTimeout(robustSchedule, 30_000);
    }
}

/* ---------- IST midnight alignment ---------- */
function msToNextISTMidnight() {
    const now = new Date();
    const tomorrow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    tomorrow.setHours(24, 0, 5, 0);          // 00:00:05 IST
    return tomorrow - now;
}
setTimeout(() => {
    robustSchedule();
    setInterval(robustSchedule, 86_400_000); // 24h
}, msToNextISTMidnight());

/* ---------- REST – unchanged ---------- */
app.post('/api/expotoken', async (req, res) => {
    try {
        const { username = 'test', token } = req.body;
        if (!token) return res.status(400).json({ error: 'token missing' });
        await Device_Token.findOneAndUpdate(
            { expoPushToken: token },
            { username, expoPushToken: token },
            { upsert: true }
        );
        res.json({ ok: true });
    } catch (e) { res.json({ error: e.message }); }
});

/* ---------- boot ---------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
    await connectDatabase(process.env.DBURL).then(async () => {
        console.log('MongoDB connected');
        await robustSchedule();        // in-case we restarted during the day
        console.log(`🚀 Expo-push server on ${PORT}`);
    }).catch((err) => {
        console.error('MongoDB connection error:', err);
        process.exit(1); // Exit the application if the database connection fails
    });   
});