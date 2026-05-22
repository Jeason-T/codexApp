const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('fanqieApp', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openDashboard: (payload) => ipcRenderer.invoke('fanqie:open-dashboard', payload),
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  createAccount: (payload) => ipcRenderer.invoke('accounts:create', payload),
  updateAccount: (payload) => ipcRenderer.invoke('accounts:update', payload),
  deleteAccount: (accountId) => ipcRenderer.invoke('accounts:delete', accountId),
  openAccountBrowser: (payload) => ipcRenderer.invoke('accounts:open-browser', payload),
  setAccountBrowserBounds: (payload) => ipcRenderer.invoke('accounts:set-browser-bounds', payload),
  checkAccountLogin: (accountId) => ipcRenderer.invoke('accounts:check-login', accountId),
  listAccountBooks: (accountId) => ipcRenderer.invoke('accounts:list-books', accountId),
  setTaskConcurrency: (value) => ipcRenderer.invoke('tasks:set-concurrency', value),
  pauseAccountTask: (accountId) => ipcRenderer.invoke('tasks:pause-account', accountId),
  resumeAccountTask: (accountId) => ipcRenderer.invoke('tasks:resume-account', accountId),
  stopAccountTask: (accountId) => ipcRenderer.invoke('tasks:stop-account', accountId),
  getPathForFile: (file) => {
    if (webUtils?.getPathForFile) {
      return webUtils.getPathForFile(file);
    }
    return file?.path ?? '';
  },
  parseFiles: (filePaths) => ipcRenderer.invoke('files:parse', filePaths),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  checkLoginStatus: (accountId) => ipcRenderer.invoke('fanqie:check-login', accountId),
  listBooks: (accountId) => ipcRenderer.invoke('fanqie:list-books', accountId),
  uploadChapter: (payload) => ipcRenderer.invoke('fanqie:upload-chapter', payload),
  testUploadChapter: (payload) => ipcRenderer.invoke('fanqie:upload-chapter', payload)
});
