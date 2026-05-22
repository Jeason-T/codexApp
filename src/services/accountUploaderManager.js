const path = require('node:path');
const { FanqieUploader, DEFAULT_SCREENSHOT_DIR } = require('./fanqieUploader.js');

class AccountUploaderManager {
  constructor(options = {}) {
    this.getAccount = options.getAccount;
    this.decryptPassword = options.decryptPassword || (() => '');
    this.getSessionCookies = options.getSessionCookies || (async () => []);
    this.updateAccountStatus = options.updateAccountStatus || (async () => {});
    this.uploaders = new Map();
    this.accountLocks = new Map();
    this.concurrency = 3;
  }

  setConcurrency(value) {
    const next = Number(value);
    this.concurrency = Math.min(12, Math.max(1, Number.isFinite(next) ? next : 3));
    return this.concurrency;
  }

  async resolveAccount(accountId) {
    if (!accountId) throw new Error('请先选择一个账号。');
    const account = await this.getAccount(accountId, { includeSecret: true });
    if (!account) throw new Error('账号不存在，请刷新账号列表后重试。');
    return account;
  }

  async getUploader(accountId) {
    const account = await this.resolveAccount(accountId);
    const cached = this.uploaders.get(account.id);
    if (cached) return cached;
    const password = account.encryptedPassword ? this.decryptPassword(account.encryptedPassword) : '';
    const uploader = new FanqieUploader({
      accountId: account.id,
      userDataDir: account.profileDir,
      screenshotDir: path.join(DEFAULT_SCREENSHOT_DIR, account.id),
      credentials: {
        phone: account.phone || '',
        password
      },
      headless: true
    });
    this.uploaders.set(account.id, uploader);
    return uploader;
  }

  async syncCookiesToUploader(accountId) {
    const cookies = await this.getSessionCookies(accountId).catch(() => []);
    if (!cookies.length) return;
    const uploader = await this.getUploader(accountId);
    const page = await uploader.launchBrowser();
    const normalized = cookies
      .filter((cookie) => /fanqienovel\.com|bytedance|toutiao/i.test(cookie.domain || cookie.url || ''))
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        expires: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : -1,
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? cookie.sameSite : 'Lax'
      }));
    if (normalized.length) await page.context().addCookies(normalized).catch(() => {});
  }

  async openDashboard(accountId) {
    await this.syncCookiesToUploader(accountId);
    return this.getUploader(accountId).then((uploader) => uploader.openDashboard());
  }

  async checkLoginStatus(accountId) {
    await this.syncCookiesToUploader(accountId);
    const loggedIn = await this.getUploader(accountId).then((uploader) => uploader.checkLoginStatus());
    await this.updateAccountStatus(accountId, loggedIn ? '已登录' : '需登录').catch(() => {});
    return loggedIn;
  }

  async listBooks(accountId) {
    await this.syncCookiesToUploader(accountId);
    return this.getUploader(accountId).then((uploader) => uploader.listBooks());
  }

  async uploadOneChapter(accountId, chapter, options = {}) {
    await this.syncCookiesToUploader(accountId);
    const previous = this.accountLocks.get(accountId) || Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      try {
        await this.updateAccountStatus(accountId, '上传中').catch(() => {});
        const uploader = await this.getUploader(accountId);
        const result = await uploader.uploadOneChapter(chapter, options);
        await this.updateAccountStatus(accountId, result?.ok ? '已登录' : '需处理').catch(() => {});
        return result;
      } catch (error) {
        const manual = ['MANUAL_VERIFICATION_REQUIRED', 'LOGIN_REQUIRED'].includes(error?.code);
        await this.updateAccountStatus(accountId, manual ? '需人工验证' : '上传异常').catch(() => {});
        return {
          ok: false,
          needsManualVerification: manual,
          code: error?.code || '',
          message: error instanceof Error ? error.message : String(error)
        };
      }
    });
    this.accountLocks.set(accountId, run);
    return run;
  }

  async close(accountId) {
    if (accountId) {
      const uploader = this.uploaders.get(accountId);
      await uploader?.close?.().catch(() => {});
      this.uploaders.delete(accountId);
      return;
    }
    await Promise.all(Array.from(this.uploaders.values()).map((uploader) => uploader.close().catch(() => {})));
    this.uploaders.clear();
  }
}

module.exports = {
  AccountUploaderManager
};
