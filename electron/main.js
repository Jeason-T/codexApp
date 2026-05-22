const { app, BrowserWindow, BrowserView, ipcMain, safeStorage, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { parseFiles } = require('../src/services/fileParser.js');
const {
  initializeDatabase,
  saveProject,
  addUploadLog,
  listAccounts,
  getAccount,
  saveAccount,
  deleteAccount,
  updateAccountStatus,
  saveAccountBooks
} = require('../src/services/database.js');
const { AccountUploaderManager } = require('../src/services/accountUploaderManager.js');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;
let accountUploaderManager = null;
const accountViews = new Map();
const FANQIE_DASHBOARD_URL = 'https://fanqienovel.com/writer/zone/';
const EMPTY_VIEW_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };

function getAccountPartition(accountId) {
  return `persist:fanqie-account-${accountId}`;
}

function encryptPassword(password) {
  if (!password) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(String(password), 'utf8').toString('base64');
  }
  return safeStorage.encryptString(String(password)).toString('base64');
}

function decryptPassword(encrypted) {
  if (!encrypted) return '';
  const buffer = Buffer.from(String(encrypted), 'base64');
  if (!safeStorage.isEncryptionAvailable()) return buffer.toString('utf8');
  return safeStorage.decryptString(buffer);
}

function getManager() {
  if (!accountUploaderManager) {
    accountUploaderManager = new AccountUploaderManager({
      getAccount,
      decryptPassword,
      updateAccountStatus,
      getSessionCookies: async (accountId) => {
        const browserSession = session.fromPartition(getAccountPartition(accountId));
        return browserSession.cookies.get({});
      }
    });
  }
  return accountUploaderManager;
}

function serializeAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    name: account.name,
    phone: account.phone || '',
    profileDir: account.profileDir || '',
    status: account.status || 'unknown',
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1180,
    minHeight: 760,
    title: '番茄章节批量上传助手',
    backgroundColor: '#eef2f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return mainWindow;
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return mainWindow;
}

function ensureAccountView(accountId) {
  if (!mainWindow) throw new Error('主窗口尚未就绪。');
  const existing = accountViews.get(accountId);
  if (existing) return existing;
  const view = new BrowserView({
    webPreferences: {
      partition: getAccountPartition(accountId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  accountViews.set(accountId, view);
  mainWindow.addBrowserView(view);
  view.setBounds(EMPTY_VIEW_BOUNDS);
  view.setAutoResize({ width: false, height: false });
  return view;
}

function setVisibleAccountViews(visibleAccountIds = []) {
  if (!mainWindow) return;
  const visible = new Set(visibleAccountIds);
  for (const [accountId, view] of accountViews.entries()) {
    if (!visible.has(accountId)) view.setBounds(EMPTY_VIEW_BOUNDS);
  }
}

app.whenReady().then(async () => {
  await initializeDatabase();

  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('accounts:list', async () => {
    try {
      return { ok: true, accounts: (await listAccounts()).map(serializeAccount) };
    } catch (error) {
      return { ok: false, accounts: [], message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('accounts:create', async (_event, payload = {}) => {
    try {
      const account = await saveAccount({
        name: payload.name,
        phone: payload.phone,
        encryptedPassword: encryptPassword(payload.password || '')
      });
      return { ok: true, account: serializeAccount(account) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('accounts:update', async (_event, payload = {}) => {
    try {
      const patch = {
        id: payload.id,
        name: payload.name,
        phone: payload.phone,
        status: payload.status
      };
      if (Object.prototype.hasOwnProperty.call(payload, 'password')) {
        patch.encryptedPassword = encryptPassword(payload.password || '');
      }
      const account = await saveAccount(patch);
      await getManager().close(payload.id).catch(() => {});
      return { ok: true, account: serializeAccount(account) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('accounts:delete', async (_event, accountId) => {
    try {
      const result = await deleteAccount(accountId);
      await getManager().close(accountId).catch(() => {});
      const view = accountViews.get(accountId);
      if (view && mainWindow) mainWindow.removeBrowserView(view);
      accountViews.delete(accountId);
      if (result.profileDir) await fs.rm(path.dirname(result.profileDir), { recursive: true, force: true }).catch(() => {});
      return { ok: true, deleted: result.deleted };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('accounts:open-browser', async (_event, payload = {}) => {
    try {
      const accountId = payload.accountId;
      await getAccount(accountId);
      const view = ensureAccountView(accountId);
      if (payload.bounds) view.setBounds(payload.bounds);
      if (!view.webContents.getURL()) await view.webContents.loadURL(FANQIE_DASHBOARD_URL);
      return { ok: true, url: view.webContents.getURL() };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('accounts:set-browser-bounds', async (_event, payload = {}) => {
    try {
      setVisibleAccountViews(payload.visibleAccountIds || []);
      for (const item of payload.items || []) {
        const view = ensureAccountView(item.accountId);
        view.setBounds({
          x: Math.max(0, Math.round(item.bounds.x || 0)),
          y: Math.max(0, Math.round(item.bounds.y || 0)),
          width: Math.max(0, Math.round(item.bounds.width || 0)),
          height: Math.max(0, Math.round(item.bounds.height || 0))
        });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('accounts:check-login', async (_event, accountId) => {
    try {
      return { ok: true, loggedIn: await getManager().checkLoginStatus(accountId) };
    } catch (error) {
      return { ok: false, loggedIn: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('accounts:list-books', async (_event, accountId) => {
    try {
      const books = await getManager().listBooks(accountId);
      await saveAccountBooks(accountId, books).catch(() => {});
      return { ok: true, books };
    } catch (error) {
      return { ok: false, books: [], message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('fanqie:open-dashboard', async (_event, payload = {}) => {
    try {
      const accountId = typeof payload === 'string' ? payload : payload.accountId;
      const result = await getManager().openDashboard(accountId);
      return {
        ok: true,
        ...result
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('fanqie:check-login', async (_event, accountId) => {
    try {
      return {
        ok: true,
        loggedIn: await getManager().checkLoginStatus(accountId)
      };
    } catch (error) {
      return {
        ok: false,
        loggedIn: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('fanqie:list-books', async (_event, accountId) => {
    try {
      const books = await getManager().listBooks(accountId);
      await saveAccountBooks(accountId, books).catch(() => {});
      return {
        ok: true,
        books
      };
    } catch (error) {
      return {
        ok: false,
        books: [],
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('files:parse', async (_event, filePaths) => {
    try {
      return {
        ok: true,
        files: await parseFiles(filePaths)
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        files: []
      };
    }
  });

  ipcMain.handle('project:save', async (_event, project) => {
    try {
      const savedProject = await saveProject(project);
      return {
        ok: true,
        project: savedProject
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('fanqie:upload-chapter', async (_event, payload) => {
    try {
      const accountId = payload.accountId;
      const result = await getManager().uploadOneChapter(accountId, payload.chapter, {
        bookNameOrId: payload.bookNameOrId,
        publishMode: payload.publishMode || 'draft',
        aiMode: payload.aiMode || 'no',
        typoMode: payload.typoMode || 'confirmIgnore',
        reviewMode: payload.reviewMode || 'basic',
        speedMode: payload.speedMode || 'default',
        scheduledAt: payload.chapter?.scheduledAt || payload.scheduledAt || ''
      });
      await addUploadLog({
        chapterId: payload.chapter?.id,
        action: payload.publishMode || 'draft',
        status: result.ok ? 'success' : 'failed',
        message: result.message,
        screenshotPath: result.screenshotPath || '',
        pageUrl: result.pageUrl || ''
      }).catch(() => {});
      return result;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('tasks:set-concurrency', async (_event, value) => ({ ok: true, concurrency: getManager().setConcurrency(value) }));
  ipcMain.handle('tasks:start', async () => ({ ok: true, message: '前端队列已负责启动任务。' }));
  ipcMain.handle('tasks:pause-account', async (_event, accountId) => {
    await updateAccountStatus(accountId, '已暂停').catch(() => {});
    return { ok: true };
  });
  ipcMain.handle('tasks:resume-account', async (_event, accountId) => {
    await updateAccountStatus(accountId, '已登录').catch(() => {});
    return { ok: true };
  });
  ipcMain.handle('tasks:stop-account', async (_event, accountId) => {
    await getManager().close(accountId).catch(() => {});
    await updateAccountStatus(accountId, '已停止').catch(() => {});
    return { ok: true };
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (accountUploaderManager) {
    await accountUploaderManager.close().catch(() => {});
  }
});
