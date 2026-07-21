const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the startup splash window -- signals main.js once its draw-in/
// fill/fade-out animation has finished, so the (already-loading) main window
// can be shown and the splash torn down.
contextBridge.exposeInMainWorld('splash', {
  done: () => ipcRenderer.send('splash:done')
});
