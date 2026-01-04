import mongoose from 'mongoose';

const Device_Token_model = new mongoose.Schema({
    username: {
        type: String,
    },
    expoPushToken: {
        type: String,
        required: true,
    },
}, { timestamps: true });

const Device_Token = mongoose.model('device_token', Device_Token_model);


const FCM_model = new mongoose.Schema({
    username: {
        type: String,
    },
    fcmToken: {
        type: String,
        required: true,
    },
}, { timestamps: true });

const FCM_DEVICE_TOKEN = mongoose.model('FCM_DEVICE_TOKEN', FCM_model);

const NotificationHistorySchema = new mongoose.Schema({
    token: String,
    platform: String,
    title: String,
    body: String,
    prayer: String,
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    error: String,
    sentAt: { type: Date, default: Date.now },
    dayDate: String // YYYY-MM-DD
});

const NotificationHistory = mongoose.model('NotificationHistory', NotificationHistorySchema);

const NotificationQueueSchema = new mongoose.Schema({
    prayer: { type: String, required: true },
    dayDate: { type: String, required: true }, // YYYY-MM-DD in PRESET.tz
    scheduledAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    sentAt: { type: Date },
    lastError: { type: String }
});

// Unique index to avoid duplicate queue entries for same prayer/day
NotificationQueueSchema.index({ prayer: 1, dayDate: 1 }, { unique: true });

const NotificationQueue = mongoose.models.NotificationQueue || mongoose.model('NotificationQueue', NotificationQueueSchema);

export { Device_Token, FCM_DEVICE_TOKEN, NotificationHistory, NotificationQueue };

