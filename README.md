# Lymo Browser

Lymo Browser is a simple, lightweight web browser built with Electron. It comes with a built-in ad blocker (powered by Ghostery's adblocker) and an integrated chat feature called **LymoChat**.

## Features

- Custom Electron-based browsing experience
- Built-in ad blocking
- Vertical tab panel
- Ambiance mode — chrome adapts to the active website's colors
- Download manager
- History
- Tab previews on hover
- Dark/light theme
- Custom new tab page with shortcuts
- Picture-in-Picture (PiP) support
- New tab page and overlay UI
- LymoChat — an integrated messaging panel backed by Firebase, with global chat, DMs, and groups

## Installation

Make sure you have [Node.js](https://nodejs.org/) installed, then run:

```bash
npm install
npm start
```

This will install all dependencies and launch the Lymo Browser app.

## Setting up LymoChat (Firebase)

LymoChat requires its own Firebase project to handle authentication and messaging. The public version of this repo ships with `LymoChatPublic.html`, which contains placeholder values instead of real Firebase credentials — you'll need to create your own Firebase project and plug in your own config.

### 1. Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and follow the setup steps (you can disable Google Analytics if you don't need it).
3. Once the project is created, click the **Web** icon (`</>`) to register a new web app.
4. Give the app a nickname and click **Register app**. Firebase will show you a `firebaseConfig` object with your project's credentials.
5. In the Firebase Console, enable the products LymoChat needs (e.g. **Authentication** and **Firestore/Realtime Database**) under the **Build** section, and configure the sign-in method(s) and database rules you want to use.

### 2. Configure LymoChatPublic.html

Open `LymoChatPublic.html` and find the `firebaseConfig` object:

```js
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

Replace each placeholder with the matching value from your own Firebase project's config, then save the file. LymoChat will now connect to your Firebase backend.

> **Note:** Keep your real Firebase credentials out of public repositories/commits if you plan to share your fork — treat `apiKey` and friends like the rest of your project's configuration secrets.

## License

This project is provided as-is for personal and educational use.
