# Prayer Notification Server

Production-ready prayer notification system using Expo Push Notifications with intelligent caching, batching, and monitoring.

## Features

✨ **Smart Caching**
- Prayer times cached for today and tomorrow
- Device tokens cached with 5-minute TTL
- Automatic cache refresh at midnight

⚡ **Efficient Scheduling**
- 5 static cron jobs (one per prayer)
- Checks cached prayer times every minute
- Sends notifications only once per prayer per day

📦 **Notification Batching**
- Handles large user bases (100 notifications per batch)
- Respects Expo's rate limits
- Tracks success/failure rates

🛡️ **Production Ready**
- Comprehensive error handling
- Structured JSON logging
- Health monitoring endpoint
- Graceful shutdown handling

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update `.env` with your MongoDB connection string:
```env
DBURL=mongodb://your-mongodb-url
PORT=4000
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

### Register Device Token
```bash
POST /.netlify/functions/api/expotoken
Content-Type: application/json

{
  "username": "user123",
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

### Get All Tokens
```bash
GET /.netlify/functions/api/expotoken
```

### Get Prayer Times
```bash
GET /.netlify/functions/api/prayer-times?date=2025-11-30
```

### Health Check
```bash
GET /.netlify/functions/api/health
```

Returns:
- Server uptime
- Cache status (prayer times, tokens)
- Notification statistics
- Recent errors

## How It Works

### Prayer Time Caching
```
┌─────────────────────────────────────────┐
│  Server Start                           │
│  ├─ Calculate today's prayer times      │
│  └─ Calculate tomorrow's prayer times   │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  Midnight (00:00)                       │
│  ├─ Refresh prayer times cache          │
│  └─ Clean up sent notifications         │
└─────────────────────────────────────────┘
```

### Notification Flow
```
┌─────────────────────────────────────────┐
│  Every Minute                           │
│  ├─ Check current time                  │
│  ├─ Compare with cached prayer times    │
│  └─ Send if match (once per day)        │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  Notification Sending                   │
│  ├─ Get cached tokens                   │
│  ├─ Batch into groups of 100            │
│  ├─ Send via Expo                       │
│  └─ Log results                         │
└─────────────────────────────────────────┘
```

## Prayer Times

The system sends notifications for 5 daily prayers:
- **Fajr** - Dawn prayer
- **Dhuhr** - Noon prayer
- **Asr** - Afternoon prayer
- **Maghrib** - Sunset prayer
- **Isha** - Night prayer

Prayer times are calculated using the **Muslim World League (MWL)** method for:
- **Location**: Mumbai, India (19.0760°N, 72.8777°E)
- **Timezone**: Asia/Kolkata

To change location or calculation method, update the `PRESET` constant in `index.js`.

## Monitoring

### View Logs
All logs are in structured JSON format:
```json
{
  "timestamp": "2025-11-30T10:15:00.000Z",
  "level": "INFO",
  "message": "Prayer notification sent",
  "prayer": "fajr",
  "time": "05:30",
  "success": 150,
  "failed": 0
}
```

### Health Check Response
```json
{
  "status": "healthy",
  "uptime": 3600,
  "cache": {
    "prayerTimes": {
      "today": "2025-11-30",
      "tomorrow": "2025-12-01"
    },
    "tokens": {
      "count": 150
    },
    "sentToday": ["2025-11-30:fajr", "2025-11-30:dhuhr"]
  },
  "stats": {
    "notificationsSent": 300,
    "notificationsFailed": 2
  }
}
```

## Troubleshooting

### Notifications not sending
1. Check health endpoint: `GET /.netlify/functions/api/health`
2. Verify tokens are registered
3. Check server logs for errors
4. Ensure prayer times are cached

### Invalid tokens
The server automatically filters invalid Expo push tokens. Check logs for validation errors.

### Time zone issues
Ensure `PRESET.tz` matches your location's timezone. All cron jobs use this timezone.

## License

MIT
