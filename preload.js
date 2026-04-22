const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  getState: () => ipcRenderer.invoke('browser:get-state'),
  createTab: (initialInput) => ipcRenderer.invoke('browser:new-tab', initialInput),
  switchTab: (tabId) => ipcRenderer.invoke('browser:switch-tab', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('browser:close-tab', tabId),
  navigate: (input) => ipcRenderer.invoke('browser:navigate', input),
  goBack: () => ipcRenderer.invoke('browser:back'),
  goForward: () => ipcRenderer.invoke('browser:forward'),
  reload: () => ipcRenderer.invoke('browser:reload'),
  minimizeWindow: () => ipcRenderer.invoke('browser:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('browser:window-maximize'),
  closeWindow: () => ipcRenderer.invoke('browser:window-close'),
  setChromeHeight: (height) => ipcRenderer.send('browser:set-chrome-height', height),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser:state', listener);

    return () => {
      ipcRenderer.removeListener('browser:state', listener);
    };
  },
});
