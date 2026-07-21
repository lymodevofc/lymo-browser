const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the small in-window download start/complete toast.
contextBridge.exposeInMainWorld('downloadToast', {
  onShow: (cb) => ipcRenderer.on('download-toast:show', (_e, payload) => cb(payload))
});
