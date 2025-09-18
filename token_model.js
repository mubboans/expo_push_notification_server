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

export default Device_Token;