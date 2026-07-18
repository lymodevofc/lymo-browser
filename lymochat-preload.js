const { contextBridge, ipcRenderer } = require('electron');

// LymoChat has no other preload (it's a sandboxed third-party-style page),
// this is only for telling the toolbar "a new DM/group message arrived" so
// it can light up the notification dot on the chat button.
contextBridge.exposeInMainWorld('lymoNotify', {
  newMessage: () => ipcRenderer.send('lymochat:new-message')
});
