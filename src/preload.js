const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = /^(pin|dock|drop|clipboard):/;

function check(channel) {
  if (!ALLOWED.test(channel)) throw new Error(`Channel not allowed: ${channel}`);
}

contextBridge.exposeInMainWorld('pf', {
  send: (channel, ...args) => {
    check(channel);
    ipcRenderer.send(channel, ...args);
  },
  invoke: (channel, ...args) => {
    check(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, fn) => {
    check(channel);
    ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
