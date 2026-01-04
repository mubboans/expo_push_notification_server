# 🔔 Expo Notification Setup Guide (FCM Edition)
## Custom Sound & Icon Configuration

This guide shows you how to configure custom sounds and icons for notifications in your Expo React Native app using Firebase Cloud Messaging (FCM) directly.

---

## 📱 Client-Side Setup (Expo React Native App)

### 1. Install Required Packages

```bash
npx expo install expo-notifications expo-av expo-device
```

### 2. Add Custom Sound File

1. Create an `assets/sounds` folder in your Expo project
2. Add your custom sound file (e.g., `azaan.wav` or `azaan.mp3`)
3. Supported formats: `.wav`, `.mp3`, `.m4a`

**Project structure:**
```
your-expo-app/
├── assets/
│   ├── sounds/
│   │   └── azaan.wav
│   └── icon.png
├── app.json
└── App.js
```

### 3. Configure app.json

Add notification configuration to your `app.json`:

```json
{
  "expo": {
    "name": "Your App Name",
    "slug": "your-app-slug",
    "version": "1.0.0",
    "icon": "./assets/icon.png",
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#1E88E5",
      "androidMode": "default",
      "androidCollapsedTitle": "Prayer Time"
    },
    "android": {
      "googleServicesFile": "./google-services.json",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#FFFFFF"
      },
      "package": "com.yourcompany.yourapp"
    },
    "ios": {
      "googleServicesFile": "./GoogleService-Info.plist",
      "bundleIdentifier": "com.yourcompany.yourapp",
      "supportsTablet": true
    },
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#1E88E5",
          "sounds": ["./assets/sounds/azaan.wav"]
        }
      ]
    ]
  }
}
```

> **Important:** You must add `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) from your Firebase Console to your project root.

### 4. Create Notification Icon (Android)

For Android, create a **white icon on transparent background** (96x96px):
- Use a simple, monochrome design
- Save as `notification-icon.png` in `assets/` folder
- The `color` field in app.json will tint this icon

### 5. Setup Notification Handler

Create a file `notificationHandler.js`:

```javascript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Setup notification channel for Android
export async function setupNotificationChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('prayer', {
      name: 'Prayer Notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1E88E5',
      sound: 'azaan.wav', // Custom sound file
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true, // Allow notification even in Do Not Disturb mode
    });
  }
}

// Request notification permissions and get FCM Token
export async function registerForPushNotifications() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      alert('Failed to get push notification permissions!');
      return;
    }
    
    // Get the Device Push Token (FCM for Android, APNs for iOS)
    // NOT the Expo Push Token
    token = (await Notifications.getDevicePushTokenAsync()).data;
    console.log('Device Push Token:', token);
  } else {
    alert('Must use physical device for Push Notifications');
  }

  return token;
}

// Listen for notifications when app is in foreground
export function setupNotificationListeners() {
  // Notification received while app is in foreground
  const notificationListener = Notifications.addNotificationReceivedListener(
    async (notification) => {
      console.log('Notification received:', notification);
      
      // Play custom sound
      const soundType = notification.request.content.data?.type;
      if (soundType === 'prayertime' || soundType?.includes('time')) {
        try {
          const { sound } = await Audio.Sound.createAsync(
            require('./assets/sounds/azaan.wav'),
            { shouldPlay: true, volume: 1.0 }
          );
          await sound.playAsync();
        } catch (error) {
          console.log('Error playing sound:', error);
        }
      }
    }
  );

  // Notification tapped/clicked
  const responseListener = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      console.log('Notification tapped:', response);
      // Handle navigation or other actions
    }
  );

  return { notificationListener, responseListener };
}
```

### 6. Update App.js

```javascript
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import {
  setupNotificationChannel,
  registerForPushNotifications,
} from './notificationHandler';

export default function App() {

  useEffect(() => {
    // Setup notification channel (Android)
    setupNotificationChannel();

    // Register for push notifications
    registerForPushNotifications().then(token => {
      if (token) {
        // Send token to your server
        sendTokenToServer(token);
      }
    });
  }, []);

  async function sendTokenToServer(token) {
    try {
      const response = await fetch('http://your-server.com/pushfcmtoken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: Platform.OS,
          token: token,
        }),
      });
      const result = await response.json();
      console.log('Token registered:', result);
    } catch (error) {
      console.error('Error registering token:', error);
    }
  }

  return (
    // Your app components
  );
}
```

---

## 🔧 Server-Side Updates

The server now expects **FCM Tokens** and sends notifications via Firebase Admin SDK.

### For Prayer Time Notifications (Server Logic)

The server automatically constructs the payload:

```javascript
const message = {
    token: userToken,
    notification: {
        title: 'Fajr Prayer Time',
        body: "It's time for Fajr prayer",
    },
    android: {
        notification: {
            channelId: 'prayer',
            sound: 'azaan', // No extension for Android
            priority: 'high',
        }
    },
    apns: {
        payload: {
            aps: {
                sound: 'azaan.wav', // Extension required for iOS
            }
        }
    }
};
```

### For Test Notifications

```javascript
const message = {
  to: token,
  sound: 'azaan.wav',
  title: '🔔 Test Notification',
  body: `This is a test notification sent at ${currentTime}`,
  priority: 'high',
  channelId: 'prayer',
  badge: 1,
  data: {
    type: 'test',
    timestamp: now.toISOString(),
    time: currentTime,
    sound: 'azaan.wav',
  },
};
```

---

## 🎵 Playing Sound in All App States

### Method 1: Using Notification Handler (Recommended)

The `Notifications.setNotificationHandler` in `notificationHandler.js` handles all states:
- ✅ **Foreground** - App is open and visible
- ✅ **Background** - App is running but not visible
- ✅ **Killed** - App is completely closed

### Method 2: Background Task (iOS)

For iOS, you may need to configure background modes:

**app.json:**
```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": [
          "audio",
          "remote-notification"
        ]
      }
    }
  }
}
```

### Method 3: Native Sound (Android)

For Android, the notification channel's `sound` property handles it:

```javascript
await Notifications.setNotificationChannelAsync('prayer', {
  name: 'Prayer Notifications',
  sound: 'azaan.wav', // This plays even when app is killed
  importance: Notifications.AndroidImportance.MAX,
});
```

---

## 📋 Complete Checklist

### Client-Side (Expo App)
- [ ] Install `expo-notifications` and `expo-av`
- [ ] Add `azaan.wav` to `assets/sounds/`
- [ ] Create notification icon (96x96px, white on transparent)
- [ ] Update `app.json` with notification config
- [ ] Create `notificationHandler.js`
- [ ] Update `App.js` with notification setup
- [ ] Setup Android notification channel
- [ ] Test in all app states (foreground, background, killed)

### Server-Side
- [ ] Update notification payload to include `sound: 'azaan.wav'`
- [ ] Add `badge` property for iOS
- [ ] Include sound info in `data` object
- [ ] Test with `/test-notification` endpoint

---

## 🧪 Testing

### Test Notification from Server

Use the new `/test-notification` endpoint which accepts an FCM token:

```bash
curl -X POST http://localhost:4000/test-notification \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_FCM_DEVICE_TOKEN"
  }'
```

### Test in Different States

1. **Foreground**: App open → Should show alert + play sound
2. **Background**: App minimized → Should show notification + play sound
3. **Killed**: App closed → Should show notification + play sound

---

## 🐛 Troubleshooting

### Invalid Token Error
- Ensure you are using `Notifications.getDevicePushTokenAsync()` and **NOT** `getExpoPushTokenAsync()`.
- Ensure you have added `google-services.json` to your project.

### Sound Not Playing

1. **Check file format**: Use `.wav` or `.mp3`
2. **Check file location**: Must be in `assets/sounds/`
3. **Rebuild app**: Run `npx expo prebuild --clean` after adding sounds
4. **Android channel**: Verify channel is created with correct sound name (without extension in some contexts, but `expo-notifications` usually handles this).

### Icon Not Showing

1. **Android**: Use white icon on transparent background
2. **Size**: 96x96px for notification icon
3. **Rebuild**: Run `npx expo prebuild --clean`
4. **Check app.json**: Verify paths are correct

### Sound Plays on iOS but not Android

- Ensure notification channel is set up with sound
- Check that sound file is in the correct format
- Verify `bypassDnd` is set to `true` if needed

---

## 📚 Additional Resources

- [Expo Notifications Docs](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo Push Notifications Guide](https://docs.expo.dev/push-notifications/overview/)
- [Android Notification Channels](https://developer.android.com/develop/ui/views/notifications/channels)
- [iOS Notification Sounds](https://developer.apple.com/documentation/usernotifications/unnotificationsound)

---

## 💡 Pro Tips

1. **Sound Duration**: Keep notification sounds under 30 seconds
2. **File Size**: Compress audio files to reduce app size
3. **Testing**: Use EAS Build for testing on real devices
4. **Permissions**: Request permissions at appropriate time, not on app launch
5. **Channels**: Create separate channels for different notification types
