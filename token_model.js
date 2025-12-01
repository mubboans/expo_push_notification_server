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
    sentAt: { type: Date, default: Date.now }
});

const NotificationHistory = mongoose.model('NotificationHistory', NotificationHistorySchema);

export { Device_Token, FCM_DEVICE_TOKEN, NotificationHistory };