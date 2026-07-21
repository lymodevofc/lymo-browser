const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the one-time first-launch onboarding walkthrough window.
contextBridge.exposeInMainWorld('welcome', {
  done: () => ipcRenderer.send('onboarding:done')
});
