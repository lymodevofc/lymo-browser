const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the tiny always-on-top new-message popup window.
contextBridge.exposeInMainWorld('lymoPopup', {
  onShow: (cb) => ipcRenderer.on('notif:show', (_e, payload) => cb(payload)),
  clicked: () => ipcRenderer.send('notif:clicked'),
  restartClicked: () => ipcRenderer.send('update:restart-click')
});
