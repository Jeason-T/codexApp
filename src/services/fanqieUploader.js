const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { fanqieSelectors } = require('./fanqieSelectors.js');
const logger = require('./logger.js');

const FANQIE_DASHBOARD_URL = 'https://fanqienovel.com/writer/zone/';
const BOOK_MANAGE_URL = 'https://fanqienovel.com/main/writer/book-manage';
const DEFAULT_PROFILE_DIR = path.join(
  process.env.APPDATA || path.resolve(__dirname, '..', '..', 'electron'),
  'fanqie-uploader',
  'browserProfile'
);
const DEFAULT_SCREENSHOT_DIR = path.join(logger.logsDir, 'screenshots');

const SPEED_DELAYS = {
  default: { action: [650, 1200], typing: [500, 900] },
  fast: { action: [260, 650], typing: [180, 420] },
  turbo: { action: [80, 220], typing: [50, 140] }
};

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function findInstalledBrowser() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  return candidates.find((candidate) => candidate && fsSync.existsSync(candidate)) || '';
}

function tidyTitleText(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseChapterTitle(title) {
  const trimmed = tidyTitleText(title);
  const chinese = trimmed.match(/^第\s*([0-9一二三四五六七八九十百千万零〇两]{1,8})\s*[章节回卷集部]?\s*(.*)$/);
  const english = trimmed.match(/^chapter[\s_-]*([0-9]{1,8})[\s_-]*(.*)$/i);
  const numeric = trimmed.match(/^([0-9]{1,8})[\s_-]+(.+)$/);
  const match = chinese || english || numeric;
  if (!match) return { chapterNumber: '', titleText: trimmed || '未命名章节' };
  return { chapterNumber: match[1], titleText: tidyTitleText(match[2]) || `第${match[1]}章` };
}

function parseChapterTitleForFanqie(title) {
  const trimmed = tidyTitleText(title);
  const chinese = trimmed.match(/^\u7b2c\s*([0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\u4e24]{1,8})\s*[\u7ae0\u8282\u56de\u5377\u96c6\u90e8]?\s*(.*)$/);
  const english = trimmed.match(/^chapter[\s_-]*([0-9]{1,8})[\s_-]*(.*)$/i);
  const numeric = trimmed.match(/^([0-9]{1,8})[\s_-]+(.+)$/);
  const match = chinese || english || numeric;
  if (!match) return { chapterNumber: '', titleText: trimmed || '\u672a\u547d\u540d\u7ae0\u8282' };
  return { chapterNumber: match[1], titleText: tidyTitleText(match[2]) || `\u7b2c${match[1]}\u7ae0` };
}

function normalizeFanqieChapterTitle(titleText) {
  const title = tidyTitleText(titleText);
  const cjkLength = (title.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjkLength >= 5 || title.length >= 5) return title;
  if (title.includes('\u5bb6\u5c5e')) return `${title}\u8bb0\u5f55`;
  if (title.includes('\u95f4')) return `${title}\u8bb0\u5f55`;
  return `${title}\u4e8b\u4ef6`;
}

function formatDateTimeForInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

class FanqieUploader {
  constructor(options = {}) {
    this.userDataDir = options.userDataDir || DEFAULT_PROFILE_DIR;
    this.screenshotDir = options.screenshotDir || DEFAULT_SCREENSHOT_DIR;
    this.accountId = options.accountId || 'default';
    this.credentials = options.credentials || null;
    this.headless = Boolean(options.headless);
    this.context = null;
    this.page = null;
    this.chapterManageUrl = '';
    this.speedMode = 'default';
  }

  setSpeedMode(speedMode = 'default') {
    this.speedMode = SPEED_DELAYS[speedMode] ? speedMode : 'default';
  }

  async speedDelay(kind = 'action') {
    const range = SPEED_DELAYS[this.speedMode]?.[kind] || SPEED_DELAYS.default.action;
    const page = await this.getActivePage();
    await page.waitForTimeout(randomBetween(range[0], range[1]));
  }

  async launchBrowser() {
    await fs.mkdir(this.userDataDir, { recursive: true });
    await fs.mkdir(this.screenshotDir, { recursive: true });
    if (this.context) return this.getActivePage();

    const bundledExecutable = chromium.executablePath();
    const executablePath = fsSync.existsSync(bundledExecutable) ? bundledExecutable : findInstalledBrowser();
    if (!executablePath) throw new Error('未找到可用浏览器。请先运行 npx playwright install chromium，或安装 Chrome / Edge。');

    await logger.info('启动 Playwright 持久化浏览器', { userDataDir: this.userDataDir, executablePath });
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless: this.headless,
      executablePath,
      viewport: { width: 1366, height: 860 },
      ignoreHTTPSErrors: false,
      args: ['--disable-popup-blocking', '--disable-notifications', '--no-first-run', '--no-default-browser-check']
    });
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this.context.on('page', (page) => {
      this.page = page;
    });
    return this.page;
  }

  async getActivePage() {
    if (!this.context) return this.launchBrowser();
    if (this.page && !this.page.isClosed()) return this.page;
    const pages = this.context.pages().filter((page) => !page.isClosed());
    this.page = pages[pages.length - 1] || (await this.context.newPage());
    return this.page;
  }

  async getBodyText(timeout = 3000) {
    const page = await this.getActivePage();
    return page.locator('body').innerText({ timeout }).catch(() => '');
  }

  async hasBodyText(pattern, timeout = 1000) {
    const page = await this.getActivePage();
    return page
      .waitForFunction(
        ({ source, flags }) => new RegExp(source, flags).test(document.body?.innerText || ''),
        { source: pattern.source, flags: pattern.flags },
        { timeout }
      )
      .then(() => true)
      .catch(() => false);
  }

  async clickLocator(locator, timeout = 5000) {
    const count = await locator.count().catch(() => 0);
    if (!count) return false;
    for (let index = count - 1; index >= 0; index -= 1) {
      const target = locator.nth(index);
      if (!(await target.isVisible({ timeout: 1000 }).catch(() => false))) continue;
      const disabled = await target
        .evaluate((el) => {
          const className = String(el.className || '');
          return el.disabled === true || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(className);
        })
        .catch(() => false);
      if (disabled) continue;
      try {
        await target.click({ timeout });
        return true;
      } catch {
        const box = await target.boundingBox().catch(() => null);
        if (!box) continue;
        const page = await this.getActivePage();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
      }
    }
    return false;
  }

  async clickFirstCandidate(candidates, actionName, options = {}) {
    const page = await this.getActivePage();
    for (const candidate of candidates.filter(Boolean)) {
      if (await this.clickLocator(candidate, options.timeout || 8000)) {
        await page.waitForTimeout(options.afterDelay || 400);
        return true;
      }
    }
    if (options.optional) return false;
    throw new Error(`${actionName}失败：没有找到可点击控件。请确认浏览器停在目标作品页面。`);
  }

  async clickDialogPrimary(actionName, options = {}) {
    const page = await this.getActivePage();
    const text = options.text || fanqieSelectors.fallbackTexts.confirm;
    return this.clickFirstCandidate(
      [
        page.locator('.arco-modal:visible button').filter({ hasText: text }),
        page.locator('.semi-modal:visible button').filter({ hasText: text }),
        page.locator('.byte-modal:visible button').filter({ hasText: text }),
        page.locator('.ant-modal:visible button').filter({ hasText: text }),
        page.locator('.el-dialog:visible button').filter({ hasText: text }),
        page.locator('[role="dialog"]:visible button').filter({ hasText: text }),
        page.locator('.arco-modal:visible .arco-btn-primary'),
        page.locator('.semi-modal:visible .semi-button-primary'),
        page.locator('[role="dialog"]:visible button'),
        page.getByRole('button', { name: text }),
        page.locator('button, [role="button"], a, .btn').filter({ hasText: text })
      ],
      actionName,
      { timeout: options.timeout || 8000, optional: options.optional }
    );
  }

  async clickVisibleButtonByText(texts, actionName = 'click visible button', options = {}) {
    const page = await this.getActivePage();
    const normalizedTexts = texts.map((item) => String(item || '').replace(/\s+/g, '')).filter(Boolean);
    const deadline = Date.now() + (options.timeout || 8000);
    while (Date.now() < deadline) {
      const target = await page.evaluate((buttonTexts) => {
        const normalize = (text) => String(text || '').replace(/\s+/g, '');
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        };
        const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"], body'))
          .filter((el) => visible(el) || el === document.body);
        const scope = dialogs[dialogs.length - 1] || document.body;
        const controls = Array.from(scope.querySelectorAll('button, [role="button"], .arco-btn, .semi-button, .byte-btn, .ant-btn, .el-button, .btn'))
          .filter(visible)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const text = normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
            const className = String(el.className || '');
            const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(className);
            return { el, text, rect, disabled };
          })
          .filter((item) => item.text && !item.disabled);
        const exact = controls.find((item) => buttonTexts.includes(item.text));
        const partial = controls.find((item) => buttonTexts.some((text) => item.text.includes(text) || text.includes(item.text)));
        const picked = exact || partial;
        if (!picked) return null;
        return {
          x: picked.rect.left + picked.rect.width / 2,
          y: picked.rect.top + picked.rect.height / 2,
          text: picked.text
        };
      }, normalizedTexts).catch(() => null);

      if (target?.x && target?.y) {
        await page.mouse.click(target.x, target.y);
        await page.waitForTimeout(options.afterDelay || 600);
        await logger.info(actionName, { ok: true, text: target.text });
        return true;
      }
      await page.waitForTimeout(300);
    }
    if (options.optional) return false;
    throw new Error(`${actionName} failed: no visible matching button.`);
  }

  async fillFirstCandidate(candidates, value, actionName, options = {}) {
    const page = await this.getActivePage();
    for (const candidate of candidates.filter(Boolean)) {
      try {
        const locator = candidate.first ? candidate.first() : candidate;
        if ((await locator.count().catch(() => 0)) === 0) continue;
        await locator.fill(value, { timeout: options.timeout || 8000 });
        return true;
      } catch {
        try {
          const locator = candidate.first ? candidate.first() : candidate;
          await locator.click({ timeout: options.timeout || 8000 });
          await page.keyboard.press('Control+A').catch(() => {});
          await page.keyboard.insertText(value);
          return true;
        } catch {
          // Try next input.
        }
      }
    }
    if (options.optional) return false;
    throw new Error(`${actionName}失败：没有找到可输入控件。`);
  }

  async openDashboard() {
    const page = await this.launchBrowser();
    await logger.info('打开番茄作家后台', { url: FANQIE_DASHBOARD_URL });
    await page.goto(FANQIE_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return { url: page.url(), message: '已打开番茄作家后台。请手动登录，软件不会保存账号密码。' };
  }

  async checkLoginStatus() {
    const page = await this.getActivePage();
    const url = page.url();
    if (/login|passport|sso/i.test(url)) {
      await logger.warn('登录状态无效或需要手动登录', { url });
      return false;
    }
    if (!url.includes('fanqienovel.com')) {
      await logger.warn('浏览器不在番茄作家后台页面', { url });
      return false;
    }
    const bodyText = await this.getBodyText(5000);
    const hasWorkspaceWords = /作品|工作台|章节|创作|收益|草稿|发布|书籍|目录|正文|存草稿|下一步/.test(bodyText);
    const hasLoginWords = /立即登录|登录后|扫码登录|手机号登录|验证码登录|请输入验证码|获取验证码/.test(bodyText);
    const loggedIn = hasWorkspaceWords && !hasLoginWords;
    await logger.info('检查登录状态', { loggedIn, url });
    return loggedIn;
  }

  async waitForManualLogin(timeout = 10 * 60 * 1000) {
    const page = await this.launchBrowser();
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (await this.checkLoginStatus()) return true;
      await page.waitForTimeout(2000);
    }
    return false;
  }

  async detectManualVerification() {
    const bodyText = await this.getBodyText(3000).catch(() => '');
    return /验证码|安全验证|拖动|滑块|扫码|二维码|人脸|设备验证|verify|captcha/i.test(bodyText);
  }

  async tryAutoLogin() {
    if (!this.credentials?.phone || !this.credentials?.password) return false;
    const page = await this.launchBrowser();
    await logger.info('尝试使用已保存账号信息自动登录', { accountId: this.accountId, phone: this.credentials.phone });
    if (!/login|passport|sso/i.test(page.url())) {
      await page.goto(FANQIE_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    await page.waitForTimeout(1500);

    const filledPhone = await this.fillFirstCandidate(
      [
        page.locator('input[type="tel"]'),
        page.locator('input[name*="phone" i], input[name*="mobile" i], input[name*="account" i]'),
        page.locator('input[placeholder*="手机号"], input[placeholder*="手机"], input[placeholder*="账号"]')
      ],
      this.credentials.phone,
      'fill login phone',
      { timeout: 2500, optional: true }
    );
    const filledPassword = await this.fillFirstCandidate(
      [
        page.locator('input[type="password"]'),
        page.locator('input[name*="password" i], input[placeholder*="密码"]')
      ],
      this.credentials.password,
      'fill login password',
      { timeout: 2500, optional: true }
    );
    if (!filledPhone && !filledPassword) return false;

    await this.clickVisibleButtonByText(['登录', '立即登录', '提交', '下一步'], 'submit login form', { timeout: 5000, optional: true });
    await page.waitForTimeout(3000);
    if (await this.detectManualVerification()) {
      const error = new Error('登录需要验证码、滑块、扫码或设备安全验证，请在内置浏览器中人工完成后继续。');
      error.code = 'MANUAL_VERIFICATION_REQUIRED';
      throw error;
    }
    return this.checkLoginStatus();
  }

  async openBookManagePage(bookNameOrId) {
    if (!bookNameOrId) throw new Error('请选择目标作品后再上传。');
    const page = await this.getActivePage();
    await logger.info('选择目标作品', { bookNameOrId });
    if (!page.url().includes('/main/writer/book-manage')) {
      await page.goto(BOOK_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForTimeout(2500);
    const chapterManageHref = await page.evaluate((name) => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/chapter-manage/"]'));
      const matched = anchors.find((anchor) => {
        try {
          const decoded = decodeURIComponent(anchor.href);
          return decoded.includes(name) || anchor.href.includes(name);
        } catch {
          return anchor.href.includes(name);
        }
      });
      return matched?.href || '';
    }, bookNameOrId);
    if (chapterManageHref) {
      await page.goto(chapterManageHref, { waitUntil: 'domcontentloaded', timeout: 60000 });
      this.chapterManageUrl = page.url();
      return;
    }
    await this.clickFirstCandidate(
      [
        page.locator('div, section, li, article').filter({ hasText: bookNameOrId }).locator('a, button, [role="button"]').filter({ hasText: /章节管理/ }),
        page.locator('a[href*="/chapter-manage/"]').filter({ hasText: /章节管理/ }),
        page.getByText(bookNameOrId, { exact: false })
      ],
      '选择目标作品',
      { timeout: 15000 }
    );
  }

  async openChapterManagePage() {
    const page = await this.getActivePage();
    if (/\/chapter-manage\//.test(page.url())) {
      this.chapterManageUrl = page.url();
      return;
    }
    await this.clickFirstCandidate(
      [
        fanqieSelectors.chapterManageButton ? page.locator(fanqieSelectors.chapterManageButton) : null,
        page.getByRole('button', { name: fanqieSelectors.fallbackTexts.chapterManage }),
        page.getByText(fanqieSelectors.fallbackTexts.chapterManage),
        page.locator('a, button, [role="button"], li, div').filter({ hasText: fanqieSelectors.fallbackTexts.chapterManage })
      ],
      '打开章节管理页',
      { timeout: 10000, optional: true }
    );
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    if (/\/chapter-manage\//.test(page.url())) this.chapterManageUrl = page.url();
  }

  async listBooks() {
    const page = await this.getActivePage();
    const currentBook = await page.evaluate(() => {
      const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
      const url = location.href;
      const writerMatch = url.match(/\/main\/writer\/([^/]+)/);
      const headerText = normalize(
        Array.from(document.querySelectorAll('header, .header, [class*="header"], [class*="book"], body'))
          .map((el) => normalize(el.innerText || el.textContent))
          .find((text) => text && /第一卷|第.+卷|默认|上次提交|正文|存草稿|下一步/.test(text)) || ''
      );
      const title = normalize(headerText.split(/\s+/)[0] || '').replace(/第一卷.*$/, '').replace(/第.+卷.*$/, '');
      return /fanqienovel\.com/.test(url) && title ? { id: writerMatch?.[1] || '', title, href: url, current: true } : null;
    }).catch(() => null);
    if (!page.url().includes('/main/writer/book-manage')) {
      await page.goto(BOOK_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForTimeout(2500);
    const books = await page.evaluate(() => {
      const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const anchors = Array.from(document.querySelectorAll('a[href*="/chapter-manage/"]')).filter(visible);
      const byHref = anchors.map((anchor) => {
        const href = anchor.href;
        let decoded = href;
        try {
          decoded = decodeURIComponent(href);
        } catch {}
        const id = (href.match(/chapter-manage\/([^&/?#]+)/) || [])[1] || '';
        const titleFromUrl = normalize((decoded.match(/chapter-manage\/[^&]+&([^?]+)/) || [])[1] || '');
        const cardText = normalize(anchor.closest('tr, article, li, .arco-card, div')?.innerText || anchor.innerText);
        const titleFromDom =
          normalize(anchor.getAttribute('title')) ||
          normalize(anchor.querySelector('img')?.getAttribute('alt')) ||
          cardText
            .split(/\s+/)
            .map((part) => part.trim())
            .find((part) => part && !/^(章节|管理|编辑|数据|草稿|作品|书籍|查看|进入|删除|新建|已发布|未发布|\d+)$/.test(part));
        const title = titleFromUrl || titleFromDom;
        return title ? { id, title, href } : null;
      }).filter(Boolean);
      const seen = new Set();
      return byHref.filter((book) => {
        const key = book.href || `${book.id}:${book.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    if (!currentBook) return books;
    const exists = books.some((book) => book.title === currentBook.title || book.id === currentBook.id);
    return exists ? books : [currentBook, ...books];
  }

  async rememberChapterManagePage() {
    const page = await this.getActivePage();
    if (/\/chapter-manage\//.test(page.url())) {
      this.chapterManageUrl = page.url();
      return true;
    }
    return false;
  }

  async gotoChapterManagePageIfKnown() {
    const page = await this.getActivePage();
    if (this.chapterManageUrl && page.url() !== this.chapterManageUrl) {
      await page.goto(this.chapterManageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return true;
    }
    return /\/chapter-manage\//.test(page.url());
  }

  async getNewChapterHref() {
    const page = await this.getActivePage();
    return page.locator(fanqieSelectors.newChapterLink).last().getAttribute('href').catch(() => '');
  }

  async openFreshChapterPage() {
    const page = await this.getActivePage();
    await this.rememberChapterManagePage();
    let href = await this.getNewChapterHref();
    if (!href && this.chapterManageUrl) {
      await this.gotoChapterManagePageIfKnown();
      href = await this.getNewChapterHref();
    }
    if (!href && /\/publish\//.test(page.url())) {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await this.rememberChapterManagePage();
      href = await this.getNewChapterHref();
    }
    if (!href) {
      await this.openChapterManagePage();
      href = await this.getNewChapterHref();
    }
    if (!href) throw new Error('没有找到“新建章节”入口。请在浏览器中进入目标作品的章节管理页后再继续。');
    const nextUrl = new URL(href, page.url()).toString();
    await logger.info('打开全新的章节编辑页', { nextUrl });
    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator(fanqieSelectors.titleInput || 'input.serial-editor-input-hint-area').first().waitFor({ state: 'visible', timeout: 30000 });
  }

  async createNewChapter(options = {}) {
    const forceNew = options.forceNew !== false;
    const page = await this.getActivePage();
    await logger.info('创建新章节', { forceNew });
    if (forceNew || !/\/publish\//.test(page.url())) {
      await this.openFreshChapterPage();
      return;
    }
    await page.locator(fanqieSelectors.titleInput || 'input.serial-editor-input-hint-area').first().waitFor({ state: 'visible', timeout: 15000 });
  }

  async fillChapterTitle(title) {
    const page = await this.getActivePage();
    if (!title?.trim()) throw new Error('章节标题为空。请先在章节预览里补上标题。');
    const { chapterNumber, titleText: parsedTitleText } = parseChapterTitleForFanqie(title);
    const titleText = normalizeFanqieChapterTitle(parsedTitleText);
    const textareaTitleText = chapterNumber ? `第${chapterNumber}章 ${titleText}` : titleText;
    await logger.info('填写章节标题', { title, chapterNumber, titleText, textareaTitleText });
    if (chapterNumber && fanqieSelectors.chapterNumberInput) {
      await this.fillFirstCandidate([page.locator(fanqieSelectors.chapterNumberInput)], chapterNumber, '填写章节序号', { timeout: 15000, optional: true });
    }
    const titleInput = page.locator(fanqieSelectors.titleInput).first();
    if ((await titleInput.count().catch(() => 0)) > 0) {
      const tagName = await titleInput.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
      const valueToFill = tagName === 'textarea' ? textareaTitleText : titleText;
      await titleInput.click({ timeout: 8000 });
      await titleInput.fill(valueToFill, { timeout: 15000 });
      if (!(await titleInput.inputValue().catch(() => ''))) {
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(valueToFill);
      }
      return;
    }
    await this.fillFirstCandidate(
      [
        page.getByPlaceholder(fanqieSelectors.fallbackPlaceholders.title),
        page.getByLabel(fanqieSelectors.fallbackPlaceholders.title),
        page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"]'),
        page.locator('input:not([type="hidden"])')
      ],
      titleText,
      '填写章节标题',
      { timeout: 15000 }
    );
  }

  async fillChapterContent(content) {
    const page = await this.getActivePage();
    if (!content?.trim()) throw new Error('章节正文为空。');
    await logger.info('填写章节正文', { length: content.length });
    const editor = page.locator(fanqieSelectors.contentEditor).first();
    if ((await editor.count().catch(() => 0)) > 0) {
      await editor.click({ timeout: 15000 });
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(content);
      return;
    }
    await this.fillFirstCandidate(
      [
        page.getByPlaceholder(fanqieSelectors.fallbackPlaceholders.content),
        page.getByLabel(fanqieSelectors.fallbackPlaceholders.content),
        page.locator('textarea[placeholder*="正文"], textarea[placeholder*="内容"]'),
        page.locator('[contenteditable="true"]'),
        page.locator('.ProseMirror, .ql-editor, .CodeMirror textarea'),
        page.locator('textarea')
      ],
      content,
      '填写章节正文',
      { timeout: 15000 }
    );
  }

  async saveDraft() {
    const page = await this.getActivePage();
    await logger.info('点击保存草稿');
    await this.clickFirstCandidate(
      [
        fanqieSelectors.saveDraftButton ? page.locator(fanqieSelectors.saveDraftButton) : null,
        page.getByRole('button', { name: fanqieSelectors.fallbackTexts.saveDraft }),
        page.getByText(fanqieSelectors.fallbackTexts.saveDraft),
        page.locator('button, [role="button"], a, .btn').filter({ hasText: fanqieSelectors.fallbackTexts.saveDraft })
      ],
      '保存草稿',
      { timeout: 15000 }
    );
    const saved = await this.hasBodyText(/已保存|保存成功|草稿保存成功|保存至云端/, 20000);
    if (!saved) throw new Error('已点击“存草稿”，但没有检测到保存成功提示。');
    await logger.info('保存草稿完成');
  }

  async clickNextStep(actionName = '点击下一步', options = {}) {
    const page = await this.getActivePage();
    const clickedByText = await this.clickVisibleButtonByText(
      ['\u4e0b\u4e00\u6b65', '\u7ee7\u7eed', '\u63d0\u4ea4', '\u786e\u5b9a'],
      actionName,
      { timeout: 1200, optional: true }
    );
    if (clickedByText) return true;
    return this.clickFirstCandidate(
      [
        page.getByRole('button', { name: fanqieSelectors.fallbackTexts.nextStep }),
        page.locator('button, [role="button"], a, .btn').filter({ hasText: fanqieSelectors.fallbackTexts.nextStep })
      ],
      actionName,
      { timeout: options.timeout || 15000, optional: options.optional }
    );
  }

  async clickEditorPublishNext() {
    const page = await this.getActivePage();
    const deadline = Date.now() + 25000;
    let editorNext = null;
    while (Date.now() < deadline) {
      editorNext = await page.evaluate(() => {
      const normalize = (text) => String(text || '').replace(/\s+/g, '');
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const button = Array.from(document.querySelectorAll('button.publish-button, button, [role="button"]'))
        .filter(visible)
        .map((el) => {
          const className = String(el.className || '');
          return {
            el,
            text: normalize(el.innerText || el.textContent),
            className,
            disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(className),
            rect: el.getBoundingClientRect()
          };
        })
        .filter((item) => item.text.includes('\u4e0b\u4e00\u6b65') && !item.disabled && !/guide-card/.test(item.className))
        .sort((a, b) => a.rect.top - b.rect.top || b.rect.left - a.rect.left)[0];
      if (!button) return null;
      return { x: button.rect.left + button.rect.width / 2, y: button.rect.top + button.rect.height / 2, text: button.text, className: button.className };
      }).catch(() => null);
      if (editorNext?.x && editorNext?.y) break;
      await page.waitForTimeout(500);
    }
    if (!editorNext?.x || !editorNext?.y) return false;
    await page.mouse.click(editorNext.x, editorNext.y);
    await logger.info('点击编辑器右上角下一步', { editorNext });
    await page.waitForTimeout(1000);
    return true;
  }

  async clickPublishEntry() {
    const page = await this.getActivePage();
    await logger.info('进入发布流程');
    await this.clickFirstCandidate(
      [
        fanqieSelectors.publishButton ? page.locator(fanqieSelectors.publishButton) : null,
        page.getByRole('button', { name: fanqieSelectors.fallbackTexts.publish }),
        page.locator('button, [role="button"], a, .btn').filter({ hasText: fanqieSelectors.fallbackTexts.publish })
      ],
      '进入发布流程',
      { timeout: 15000 }
    );
  }

  async handleTypoCheck(options = {}) {
    const page = await this.getActivePage();
    await page.waitForTimeout(800);
    if (!(await this.hasBodyText(fanqieSelectors.fallbackTexts.typoDialog, 1200))) return false;
    const mode = options.typoMode || 'confirmIgnore';
    await logger.info('处理错别字检测提示', { mode });
    if (mode === 'manual') throw new Error('页面进入错别字处理，请用户在浏览器中手动选择后再继续。');
    if (mode === 'cancelReplaceAll' || mode === 'cancelIgnoreAll') {
      await this.clickDialogPrimary('取消错别字提交', { text: fanqieSelectors.fallbackTexts.cancel, optional: true });
      await page.waitForTimeout(800);
      const correctionPattern = mode === 'cancelReplaceAll' ? fanqieSelectors.fallbackTexts.replaceAll : fanqieSelectors.fallbackTexts.ignoreAll;
      await this.clickFirstCandidate(
        [
          page.getByRole('button', { name: correctionPattern }),
          page.locator('button, [role="button"], a, .btn').filter({ hasText: correctionPattern })
        ],
        mode === 'cancelReplaceAll' ? '替换全部错字' : '忽略全部错字',
        { timeout: 10000, optional: mode === 'cancelIgnoreAll' }
      );
      await page.waitForTimeout(800);
      await this.clickNextStep('重新提交错别字检测', { optional: true });
      if (mode === 'cancelIgnoreAll' && (await this.hasBodyText(fanqieSelectors.fallbackTexts.typoDialog, 3000))) {
        await this.confirmTypoSubmit();
      }
      return true;
    }
    await this.confirmTypoSubmit();
    return true;
  }

  async confirmTypoSubmit() {
    const page = await this.getActivePage();
    await logger.info('确认忽略错别字并提交');
    await this.clickDialogPrimary('确认忽略错别字并提交', { text: /提交|确定|确认|继续/, timeout: 10000 });
    await page.waitForTimeout(1000);
  }

  async selectReviewCheck(reviewMode = 'basic') {
    const page = await this.getActivePage();
    const bodyText = await this.getBodyText(1500);
    if (!/基础检测|全面检测|检测方式|基础审核|全面审核/.test(bodyText)) return false;
    const wantsFull = reviewMode === 'full' || reviewMode === 'fullAutoBasic';
    if (wantsFull) {
      const clickedFull = await this.clickFirstCandidate(
        [
          page.getByRole('button', { name: fanqieSelectors.fallbackTexts.fullCheck }),
          page.getByText(fanqieSelectors.fallbackTexts.fullCheck),
          page.locator('button, [role="button"], label, .arco-radio, .arco-card').filter({ hasText: fanqieSelectors.fallbackTexts.fullCheck })
        ],
        '选择全面检测',
        { timeout: 4000, optional: true }
      );
      const unavailable = await this.hasBodyText(fanqieSelectors.fallbackTexts.fullCheckUnavailable, 1200);
      if (clickedFull && !unavailable) {
        await logger.info('已选择全面检测');
        return true;
      }
      await logger.warn('全面检测不可用或次数不足，自动切换基础检测');
    }
    const clickedBasic = await this.clickFirstCandidate(
      [
        page.getByRole('button', { name: fanqieSelectors.fallbackTexts.basicCheck }),
        page.getByText(fanqieSelectors.fallbackTexts.basicCheck),
        page.locator('button, [role="button"], label, .arco-radio, .arco-card').filter({ hasText: fanqieSelectors.fallbackTexts.basicCheck })
      ],
      '选择基础检测',
      { timeout: 5000, optional: true }
    );
    await logger.info('已选择基础检测或保留页面默认检测');
    return clickedBasic;
  }



async setAiDeclaration(aiMode = 'no') {
  if (aiMode === 'skip') {
    await logger.info('skip AI declaration');
    return false;
  }

  const page = await this.getActivePage();
  const bodyText = await this.getBodyText(1500);
  const aiRowHint = '\u662f\u5426\u4f7f\u7528AI';
  if (!String(bodyText || '').replace(/\s+/g, '').includes(aiRowHint)) return false;

  const wantedText = aiMode === 'yes' ? '\u662f' : '\u5426';
  const wantedValue = aiMode === 'yes' ? '1' : '2';

  const getAiDialogSnapshot = async () => page.evaluate(({ wantedText, wantedValue }) => {
    const rowHint = '\u662f\u5426\u4f7f\u7528AI';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"], body'))
      .filter((el) => (visible(el) || el === document.body) && normalize(el.innerText || el.textContent).includes(rowHint));
    const scope = dialogs[dialogs.length - 1] || document.body;
    const scopeRect = scope.getBoundingClientRect();
    const rowInfo = Array.from(scope.querySelectorAll('div, section, li, label, p'))
      .filter(visible)
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text.includes(rowHint) && item.text.includes('\u662f') && item.text.includes('\u5426'))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (!rowInfo) return { ready: false, reason: 'row-not-found' };
    const rowRect = rowInfo.rect;
    const y = rowRect.top + rowRect.height / 2;
    const radioRoots = Array.from(scope.querySelectorAll('label, [role="radio"], .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, input[type="radio"]'))
      .filter(visible)
      .map((el) => {
        const input = el.matches?.('input[type="radio"]') ? el : el.querySelector?.('input[type="radio"]');
        const wrapper = input?.closest?.('label, .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, [role="radio"]') || el;
        const text = normalize(wrapper.innerText || wrapper.textContent || input?.getAttribute('aria-label') || input?.value || '');
        const rect = wrapper.getBoundingClientRect();
        const mask = wrapper.querySelector?.('.arco-radio-mask, .arco-radio-mask-wrapper, .semi-radio-inner, .byte-radio-inner, .ant-radio, [class*="radio-inner"], [class*="radio-mask"]') || wrapper;
        const maskRect = mask.getBoundingClientRect();
        const nearRow = Math.abs((rect.top + rect.height / 2) - y) < 120;
        const selected = Boolean(
          input?.checked ||
          input?.getAttribute('aria-checked') === 'true' ||
          wrapper.getAttribute('aria-checked') === 'true' ||
          /checked|selected|active|is-checked|is-selected|radio-checked/i.test(String(wrapper.className || '') + String(wrapper.outerHTML || '').slice(0, 300))
        );
        return {
          text,
          value: input?.value || input?.getAttribute('value') || '',
          selected,
          disabled: input?.disabled === true || wrapper.getAttribute('aria-disabled') === 'true' || /disabled/i.test(String(wrapper.className || '')),
          nearRow,
          x: maskRect.left + maskRect.width / 2,
          y: maskRect.top + maskRect.height / 2,
          w: maskRect.width,
          h: maskRect.height
        };
      })
      .filter((item) => item.nearRow && item.w > 0 && item.h > 0);
    const target =
      radioRoots.find((item) => item.value === wantedValue) ||
      radioRoots.find((item) => item.text === wantedText) ||
      radioRoots.find((item) => item.text.length <= 8 && item.text.includes(wantedText));
    return {
      ready: Boolean(target && !target.disabled),
      selected: Boolean(target?.selected),
      target: target ? { x: Math.round(target.x), y: Math.round(target.y), text: target.text, value: target.value, disabled: target.disabled } : null,
      scope: { x: Math.round(scopeRect.left), y: Math.round(scopeRect.top), w: Math.round(scopeRect.width), h: Math.round(scopeRect.height) },
      row: { x: Math.round(rowRect.left), y: Math.round(rowRect.top), w: Math.round(rowRect.width), h: Math.round(rowRect.height) },
      count: radioRoots.length
    };
  }, { wantedText, wantedValue }).catch((error) => ({ ready: false, reason: String(error) }));

  const waitForAiDialogStable = async () => {
    const startedAt = Date.now();
    let previous = null;
    let stableHits = 0;
    while (Date.now() - startedAt < 6500) {
      const snapshot = await getAiDialogSnapshot();
      if (snapshot.selected) {
        await logger.info('AI declaration already selected before click', { aiMode, snapshot });
        return snapshot;
      }
      const stable =
        snapshot.ready &&
        previous?.ready &&
        snapshot.target &&
        previous.target &&
        Math.abs(snapshot.target.x - previous.target.x) <= 2 &&
        Math.abs(snapshot.target.y - previous.target.y) <= 2 &&
        Math.abs(snapshot.row.x - previous.row.x) <= 2 &&
        Math.abs(snapshot.row.y - previous.row.y) <= 2;
      stableHits = stable ? stableHits + 1 : 0;
      if (stableHits >= 2 && Date.now() - startedAt >= 1200) {
        await logger.info('AI declaration dialog stable', { aiMode, snapshot });
        return snapshot;
      }
      previous = snapshot;
      await page.waitForTimeout(300);
    }
    const last = await getAiDialogSnapshot();
    await logger.warn('AI declaration dialog did not fully stabilize, using last snapshot', { aiMode, last });
    return last;
  };

  await waitForAiDialogStable();

  const findAiPoint = async () => page.evaluate(({ wantedText, wantedValue, aiMode }) => {
    const rowHint = '\u662f\u5426\u4f7f\u7528AI';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rectPoint = (el, via) => {
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, via };
    };

    const containers = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, [role="dialog"], body'))
      .filter((el) => visible(el) || el === document.body)
      .filter((el) => normalize(el.innerText || el.textContent).includes(rowHint));
    const scope = containers[containers.length - 1] || document.body;

    const rowCandidates = Array.from(scope.querySelectorAll('div, section, li, label, p'))
      .filter((el) => visible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, text: normalize(el.innerText || el.textContent), area: rect.width * rect.height };
      })
      .filter((item) => item.text.includes(rowHint) && item.text.includes('\u662f') && item.text.includes('\u5426'))
      .sort((a, b) => a.area - b.area);
    const row = rowCandidates[0]?.el || scope;

    const radioInputs = Array.from(row.querySelectorAll('input[type="radio"]'));
    const input = radioInputs.find((item) => item.value === wantedValue) || radioInputs.find((item) => normalize(item.closest('label')?.innerText || item.parentElement?.innerText).includes(wantedText));
    if (input) {
      const radio = input.closest('.arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, label') || input;
      const mask = radio.querySelector('.arco-radio-mask, .arco-radio-mask-wrapper, .semi-radio-inner, .byte-radio-inner, .ant-radio, [class*="radio"]') || radio;
      const point = rectPoint(mask, 'radio-input');
      if (point) return point;
    }

    const textNodes = Array.from(row.querySelectorAll('label, span, div, [role="radio"], .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper'))
      .filter((el) => visible(el));
    const exact = textNodes.find((el) => normalize(el.innerText || el.textContent) === wantedText);
    if (exact) {
      exact.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = exact.getBoundingClientRect();
      return { x: Math.max(rect.left - 22, 0), y: rect.top + rect.height / 2, via: 'text-offset' };
    }

    const label = Array.from(scope.querySelectorAll('label, span, div, p'))
      .filter((el) => visible(el))
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text.includes(rowHint))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (label) {
      const y = label.rect.top + label.rect.height / 2;
      const x = (aiMode === 'yes') ? label.rect.right + 42 : label.rect.right + 124;
      return { x, y, via: 'label-offset' };
    }
    return null;
  }, { wantedText, wantedValue, aiMode });

  const verifySelected = async () => page.evaluate(({ wantedText, wantedValue }) => {
    const rowHint = '\u662f\u5426\u4f7f\u7528AI';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 0 && rect.height >= 0;
    };
    const selectedClassPattern = /checked|selected|active|is-checked|is-selected|radio-checked/i;
    const roots = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"], body'))
      .filter((el) => (visible(el) || el === document.body) && normalize(el.innerText || el.textContent).includes(rowHint));
    const scope = roots[roots.length - 1] || document.body;

    const radioText = (input) => {
      const wrapper = input.closest('label, .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, [role="radio"]') || input.parentElement || input;
      return normalize(
        wrapper.innerText ||
        wrapper.textContent ||
        input.getAttribute('aria-label') ||
        input.getAttribute('value') ||
        ''
      );
    };
    const radioWrapper = (input) =>
      input.closest('label, .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, [role="radio"]') ||
      input.parentElement ||
      input;
    const radioSelected = (input) => {
      const wrapper = radioWrapper(input);
      const classText = [
        input.className,
        wrapper?.className,
        wrapper?.parentElement?.className,
        wrapper?.outerHTML?.slice(0, 400)
      ].map((item) => String(item || '')).join(' ');
      return Boolean(
        input.checked ||
        input.getAttribute('aria-checked') === 'true' ||
        wrapper?.getAttribute('aria-checked') === 'true' ||
        selectedClassPattern.test(classText)
      );
    };

    const allInputs = Array.from(scope.querySelectorAll('input[type="radio"]'));
    const matchedInputs = allInputs.filter((input) => {
      const text = radioText(input);
      return (
        input.value === wantedValue ||
        input.getAttribute('value') === wantedValue ||
        text === wantedText ||
        (text.length <= 8 && text.includes(wantedText))
      );
    });
    if (matchedInputs.some((input) => radioSelected(input))) return true;

    const selectedRadioLike = Array.from(
      scope.querySelectorAll('.arco-radio-checked, .semi-radio-checked, .byte-radio-checked, .ant-radio-wrapper-checked, [aria-checked="true"], [class*="checked"], [class*="selected"]')
    ).filter(visible);
    if (selectedRadioLike.some((el) => {
      const text = normalize(el.innerText || el.textContent || el.closest('label')?.innerText || '');
      const input = el.querySelector?.('input[type="radio"]') || el.closest?.('label')?.querySelector?.('input[type="radio"]');
      return input?.value === wantedValue || text === wantedText || (text.length <= 8 && text.includes(wantedText));
    })) {
      return true;
    }

    return false;
  }, { wantedText, wantedValue });

  const clickPoint = async (point) => {
    if (!point?.x || !point?.y) return false;
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(500);
    return true;
  };

  const findAiClickPoints = async () => page.evaluate(({ wantedText }) => {
    const rowHint = '\u662f\u5426\u4f7f\u7528AI';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"], body'))
      .filter((el) => (visible(el) || el === document.body) && normalize(el.innerText || el.textContent).includes(rowHint));
    const scope = dialogs[dialogs.length - 1] || document.body;
    const rowInfo = Array.from(scope.querySelectorAll('div, section, li, label, p'))
      .filter(visible)
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text.includes(rowHint) && item.text.includes('\u662f') && item.text.includes('\u5426'))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (!rowInfo) return [];
    const row = rowInfo.el;
    const rowRect = rowInfo.rect;
    const y = rowRect.top + rowRect.height / 2;

    const points = [];
    const pushPoint = (x, yValue, via) => {
      if (Number.isFinite(x) && Number.isFinite(yValue)) points.push({ x, y: yValue, via });
    };

    const radios = Array.from(scope.querySelectorAll('label, [role="radio"], .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, input[type="radio"]'))
      .filter(visible)
      .map((el) => {
        const input = el.matches?.('input[type="radio"]') ? el : el.querySelector?.('input[type="radio"]');
        const wrapper = input?.closest?.('label, .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, [role="radio"]') || el;
        const text = normalize(wrapper.innerText || wrapper.textContent || input?.getAttribute('aria-label') || input?.value || '');
        const rect = wrapper.getBoundingClientRect();
        const mask = wrapper.querySelector?.('.arco-radio-mask, .arco-radio-mask-wrapper, .semi-radio-inner, .byte-radio-inner, .ant-radio, [class*="radio-inner"], [class*="radio-mask"]') || wrapper;
        const maskRect = mask.getBoundingClientRect();
        const nearRow = Math.abs((rect.top + rect.height / 2) - y) < 110;
        return { text, rect, maskRect, nearRow };
      })
      .filter((item) => item.nearRow && item.maskRect.width > 0 && item.maskRect.height > 0);
    const targetRadio = radios.find((item) => item.text === wantedText || (item.text.length <= 8 && item.text.includes(wantedText)));
    if (targetRadio) {
      pushPoint(targetRadio.maskRect.left + targetRadio.maskRect.width / 2, targetRadio.maskRect.top + targetRadio.maskRect.height / 2, 'radio-mask');
      pushPoint(targetRadio.rect.left + targetRadio.rect.width / 2, targetRadio.rect.top + targetRadio.rect.height / 2, 'radio-wrapper');
    }

    const textNodes = Array.from(scope.querySelectorAll('label, span, div, p'))
      .filter(visible)
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text === wantedText && Math.abs((item.rect.top + item.rect.height / 2) - y) < 110);
    const textNode = textNodes.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (textNode) {
      pushPoint(textNode.rect.left + textNode.rect.width / 2, textNode.rect.top + textNode.rect.height / 2, 'text-center');
      pushPoint(textNode.rect.left - 18, textNode.rect.top + textNode.rect.height / 2, 'text-left-circle');
    }

    const rowLeft = rowRect.left;
    if (wantedText === '\u662f') {
      pushPoint(rowLeft + 150, y, 'row-offset-yes-circle');
      pushPoint(rowLeft + 185, y, 'row-offset-yes-text');
    } else {
      pushPoint(rowLeft + 245, y, 'row-offset-no-circle');
      pushPoint(rowLeft + 280, y, 'row-offset-no-text');
    }

    return points.filter((point) => point.x > 0 && point.y > 0 && point.x < window.innerWidth && point.y < window.innerHeight);
  }, { wantedText }).catch(() => []);

  const findPreciseAiPoint = async () => page.evaluate(({ wantedText, wantedValue }) => {
    const rowHint = '\u662f\u5426\u4f7f\u7528AI';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"], body'))
      .filter((el) => (visible(el) || el === document.body) && normalize(el.innerText || el.textContent).includes(rowHint));
    const scope = dialogs[dialogs.length - 1] || document.body;
    const rows = Array.from(scope.querySelectorAll('div, section, li, label, p'))
      .filter(visible)
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text.includes(rowHint) && item.text.includes('\u662f') && item.text.includes('\u5426'))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    const row = rows[0]?.el || scope;

    const radioRoots = Array.from(scope.querySelectorAll(
      'label, [role="radio"], .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, input[type="radio"]'
    ));
    const options = radioRoots
      .filter(visible)
      .map((el) => {
        const input = el.matches?.('input[type="radio"]') ? el : el.querySelector?.('input[type="radio"]');
        const wrapper = input?.closest?.('label, .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, [role="radio"]') || el;
        const text = normalize(
          wrapper.innerText ||
          wrapper.textContent ||
          input?.getAttribute('aria-label') ||
          input?.value ||
          ''
        );
        const rect = el.getBoundingClientRect();
        const mask =
          wrapper.querySelector?.('.arco-radio-mask, .arco-radio-mask-wrapper, .semi-radio-inner, .byte-radio-inner, .ant-radio, [class*="radio-inner"], [class*="radio-mask"]') ||
          wrapper;
        const maskRect = mask.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const nearRow = Math.abs((rect.top + rect.height / 2) - (rowRect.top + rowRect.height / 2)) < 120;
        return { text, value: input?.value || input?.getAttribute('value') || '', rect, maskRect, nearRow };
      })
      .filter((item) => item.maskRect.width > 0 && item.maskRect.height > 0 && (item.nearRow || item.text === wantedText || item.value === wantedValue));
    const matched =
      options.find((item) => item.nearRow && item.value === wantedValue) ||
      options.find((item) => item.nearRow && item.text === wantedText) ||
      options.find((item) => item.nearRow && item.text.length <= 8 && item.text.includes(wantedText)) ||
      options.find((item) => item.value === wantedValue) ||
      options.find((item) => item.text === wantedText) ||
      options.find((item) => item.text.length <= 8 && item.text.includes(wantedText));
    if (matched) {
      return {
        x: matched.maskRect.left + matched.maskRect.width / 2,
        y: matched.maskRect.top + matched.maskRect.height / 2,
        via: 'precise-radio',
        text: matched.text,
        value: matched.value
      };
    }
    const label = rows[0];
    if (!label) return null;
    const y = label.rect.top + label.rect.height / 2;
    const x = wantedText === '\u662f' ? label.rect.right + 42 : label.rect.right + 118;
    return { x, y, via: 'precise-offset' };
  }, { wantedText, wantedValue }).catch(() => null);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const clickPoints = await findAiClickPoints();
    for (const clickCandidate of clickPoints.slice(0, 8)) {
      await clickPoint(clickCandidate);
      if (await verifySelected()) {
        await logger.info(aiMode === 'yes' ? 'selected AI yes' : 'selected AI no', { clickCandidate, attempt });
        return true;
      }
    }

    const precisePoint = await findPreciseAiPoint();
    if (precisePoint) {
      await clickPoint(precisePoint);
      await page.waitForTimeout(350);
    }
    if (await verifySelected()) {
      await logger.info(aiMode === 'yes' ? 'selected AI yes' : 'selected AI no', { precisePoint, attempt });
      return true;
    }
    await logger.warn('AI declaration precise click did not stick, retrying', { aiMode, wantedText, wantedValue, precisePoint, attempt });
  }

  let point = await findAiPoint();
  await logger.info('AI declaration target point', { aiMode, wantedText, wantedValue, point });
  if (point) await clickPoint(point);
  if (await verifySelected()) {
    await logger.info(aiMode === 'yes' ? 'selected AI yes' : 'selected AI no');
    return true;
  }

  const domFallback = await page.evaluate(({ wantedText, wantedValue }) => {
    const rowHint = '\u662f\u5426\u4f7f\u7528AI';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const scope = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, [role="dialog"], body'))
      .filter((el) => normalize(el.innerText || el.textContent).includes(rowHint))
      .pop() || document.body;
    const row = Array.from(scope.querySelectorAll('div, section, li, label, p'))
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), area: (() => { const r = el.getBoundingClientRect(); return r.width * r.height; })() }))
      .filter((item) => item.text.includes(rowHint) && item.text.includes('\u662f') && item.text.includes('\u5426'))
      .sort((a, b) => a.area - b.area)[0]?.el || scope;
    const rowRect = row.getBoundingClientRect();
    const inputs = Array.from(scope.querySelectorAll('input[type="radio"]'));
    const scoredInputs = inputs.map((item) => {
      const wrapper = item.closest('label, .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, [role="radio"]') || item.parentElement || item;
      const rect = wrapper.getBoundingClientRect();
      const text = normalize(wrapper.innerText || wrapper.textContent || item.getAttribute('aria-label') || item.value || '');
      const nearRow = Math.abs((rect.top + rect.height / 2) - (rowRect.top + rowRect.height / 2)) < 120;
      return { item, text, nearRow };
    });
    const input =
      scoredInputs.find(({ item, nearRow }) => nearRow && item.value === wantedValue)?.item ||
      scoredInputs.find(({ text, nearRow }) => nearRow && (text === wantedText || (text.length <= 8 && text.includes(wantedText))))?.item ||
      scoredInputs.find(({ item }) => item.value === wantedValue)?.item ||
      scoredInputs.find(({ text }) => text === wantedText || (text.length <= 8 && text.includes(wantedText)))?.item;
    if (!input) return { ok: false, reason: 'input-not-found' };
    const label = input.closest('label, .arco-radio, .semi-radio, .byte-radio, .ant-radio-wrapper, [role="radio"]') || input;
    const mask = label.querySelector?.('.arco-radio-mask, .arco-radio-mask-wrapper, .semi-radio-inner, .byte-radio-inner, .ant-radio, [class*="radio-inner"], [class*="radio-mask"]');
    for (const target of [mask, label, input].filter(Boolean)) {
      try {
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        if (typeof target.click === 'function') target.click();
      } catch {}
    }
    try {
      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}
    return { ok: true, checked: input.checked, className: String((input.closest('label, .arco-radio') || input).className || '') };
  }, { wantedText, wantedValue });

  await page.waitForTimeout(500);
  const verified = await verifySelected();
  await logger.info('AI declaration fallback result', { aiMode, wantedText, wantedValue, domFallback, verified });
  return verified;
}

  async handlePublishPrompts(mode = 'direct') {
  const page = await this.getActivePage();

  for (let index = 0; index < 8; index += 1) {
    await page.waitForTimeout(600);

    const dialogInfo = await page.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      };

      const dialogs = Array.from(
        document.querySelectorAll(
          '.arco-modal, .arco-popconfirm, [role="dialog"], .semi-modal, .byte-modal, .ant-modal, .el-dialog'
        )
      ).filter(visible);

      const dialog = dialogs[dialogs.length - 1];

      if (!dialog) {
        return { hasDialog: false, text: '' };
      }

      return {
        hasDialog: true,
        text: String(dialog.innerText || '').slice(0, 500)
      };
    });

    if (!dialogInfo.hasDialog) return true;

    const isRelevant =
      /错别字|错字|未修改|是否确定提交|确认发布|确认提交|确定发布|确定提交|发布提示|提交提示|审核/.test(
        dialogInfo.text
      );

    if (!isRelevant) return true;

    await logger.info('检测到真实弹窗，尝试确认', {
      mode,
      index: index + 1,
      dialogText: dialogInfo.text.slice(0, 200)
    });

    const clicked = await this.clickDialogPrimary(
      mode === 'scheduled' ? '确认定时发布提示' : '确认发布提示',
      {
        text: /确定提交|确认提交|继续提交|仍然提交|确认发布|确定发布|确认|确定|提交|继续/,
        timeout: 8000,
        optional: true
      }
    );

    if (!clicked) {
      const screenshotPath = await this.takeScreenshot('prompt_stuck', 'publish_prompt').catch(() => '');
      await logger.warn('检测到真实弹窗，但没有找到确认按钮，需要人工处理', {
        mode,
        screenshotPath,
        dialogText: dialogInfo.text.slice(0, 300)
      });
      return false;
    }
  }

  return true;
}

  
async isPublishSettingsPage() {
    const page = await this.getActivePage();
    return page.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const normalize = (text) => String(text || '').replace(/\s+/g, '');
      const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]')).filter(visible);
      return dialogs.some((dialog) => {
        const text = normalize(dialog.innerText || dialog.textContent);
        return text.includes('\u53d1\u5e03\u8bbe\u7f6e') && text.includes('\u662f\u5426\u4f7f\u7528AI') && text.includes('\u786e\u8ba4\u53d1\u5e03');
      });
    }).catch(() => false);
  }

  
async advancePublishWizard(options = {}, targetMode = 'direct') {
    if (await this.isPublishSettingsPage()) return true;
    if (!(await this.clickEditorPublishNext())) {
      await this.clickPublishEntry();
    }
    for (let step = 0; step < 14; step += 1) {
      if (await this.isPublishSettingsPage()) return true;

      await this.handlePublishPrompts(targetMode);
      if (await this.isPublishSettingsPage()) return true;

      if (await this.handleTypoCheck(options)) continue;

      if (await this.selectReviewCheck(options.reviewMode || 'basic')) {
        await this.clickNextStep('review check next step', { optional: true, timeout: 8000 });
        continue;
      }

      const bodyText = await this.getBodyText(1500);
      if (String(bodyText || '').replace(/\s+/g, '').includes('\u662f\u5426\u4f7f\u7528AI')) {
        const aiClicked = await this.setAiDeclaration(options.aiMode || 'no');
        if (!aiClicked) {
          const screenshotPath = await this.takeScreenshot('ai_select_failed', 'ai_select_failed').catch(() => '');
          throw new Error('AI declaration option was not selected; stopped before clicking next. Screenshot: ' + screenshotPath);
        }
        if (await this.isPublishSettingsPage()) return true;
        await this.clickNextStep('AI declaration next step', { optional: true, timeout: 8000 });
        continue;
      }

      const clickedNext = await this.clickNextStep('publish wizard next step', { optional: true, timeout: 8000 });
      if (!clickedNext) {
        await this.handlePublishPrompts(targetMode);
        if (await this.isPublishSettingsPage()) return true;
        break;
      }
    }
    return this.isPublishSettingsPage();
  }

  async runSubmitChecks(options = {}, targetMode = 'direct') {
    const reached = await this.advancePublishWizard(options, targetMode);
    if (!reached) {
      throw new Error('未能进入发布设置页。请检查是否卡在 AI 声明、错字检测或平台提示弹窗。');
    }
  }


async preparePublishSettings(options = {}, mode = 'direct') {
  await this.runSubmitChecks(options, mode);

  const bodyText = await this.getBodyText(1500);
  if (String(bodyText || '').replace(/\s+/g, '').includes('\u662f\u5426\u4f7f\u7528AI')) {
    const aiClicked = await this.setAiDeclaration(options.aiMode || 'no');
    if (!aiClicked) {
      const screenshotPath = await this.takeScreenshot('ai_select_failed', 'ai_select_failed').catch(() => '');
      throw new Error('AI declaration option was not selected; stopped publishing. Screenshot: ' + screenshotPath);
    }
  }
}

  async waitForPublishSuccess(mode) {
  const page = await this.getActivePage();

  const successPattern =
    mode === 'scheduled'
      ? /定时成功|预约成功|已定时|发布成功|提交成功|审核中|已提交|发布设置成功|提交审核成功|已提交审核|待审核|操作成功/
      : /发布成功|已发布|提交成功|审核中|已提交|发布设置成功|提交审核成功|已提交审核|待审核|章节发布成功|操作成功/;

  const errorPattern =
    /发布失败|提交失败|审核失败|保存失败|网络异常|系统异常|请稍后再试|不能为空|未选择|请选择|敏感词|违规|错误/;

  const busyPattern =
    /发布中|提交中|检测中|审核中|请稍候|加载中|处理中/;

  const deadline = Date.now() + 45000;
  let lastBodyText = '';

  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);

    // 如果最后还有确认弹窗，继续处理
    await this.handlePublishPrompts(mode);

    const bodyText = await this.getBodyText(2000);
    lastBodyText = bodyText;

    if (successPattern.test(bodyText)) {
      await logger.info('检测到发布成功或提交审核状态', {
        mode,
        matched: bodyText.match(successPattern)?.[0] || '',
        bodyText: bodyText.slice(0, 300)
      });
      return true;
    }

    if (errorPattern.test(bodyText)) {
      await logger.warn('发布后检测到疑似错误提示', {
        mode,
        matched: bodyText.match(errorPattern)?.[0] || '',
        bodyText: bodyText.slice(0, 500)
      });
    }

    if (busyPattern.test(bodyText)) {
      await logger.info('发布流程仍在处理中，继续等待', {
        mode,
        matched: bodyText.match(busyPattern)?.[0] || ''
      });
      continue;
    }
  }

  const state = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    };

    const text = (el) =>
      String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, '');

    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], .arco-btn, .byte-btn, .semi-button, .ant-btn, .el-button, .btn')
    )
      .filter(visible)
      .map((el) => ({
        text: text(el),
        className: String(el.className || '').slice(0, 120)
      }))
      .filter((item) => item.text)
      .slice(-40);

    const dialogs = Array.from(
      document.querySelectorAll('.arco-modal, .arco-popconfirm, [role="dialog"], .semi-modal, .byte-modal, .ant-modal, .el-dialog')
    )
      .filter(visible)
      .map((el) => text(el).slice(0, 300));

    const messages = Array.from(
      document.querySelectorAll('.arco-message, .arco-notification, .semi-toast, .semi-notification, .ant-message, .el-message')
    )
      .filter(visible)
      .map((el) => text(el).slice(0, 300));

    return {
      url: location.href,
      title: document.title,
      buttons,
      dialogs,
      messages,
      bodyText: text(document.body).slice(0, 1000)
    };
  });

  await logger.warn('发布后未检测到成功提示，输出当前页面状态', {
    mode,
    state,
    lastBodyText: lastBodyText.slice(0, 1000)
  });

  const screenshotPath = await this.takeScreenshot('publish_success_missing', 'publish_success_missing').catch(() => '');

  throw new Error(
    mode === 'scheduled'
      ? `未检测到定时发布成功提示。截图：${screenshotPath}`
      : `未检测到发布成功提示。截图：${screenshotPath}`
  );
}

async confirmPublish(actionName = '确认发布') {
  const page = await this.getActivePage();

  await page.waitForTimeout(1000);

  const directClicked = await this.clickVisibleButtonByText(
    [
      '\u786e\u8ba4\u53d1\u5e03',
      '\u63d0\u4ea4\u53d1\u5e03',
      '\u63d0\u4ea4\u5ba1\u6838',
      '\u786e\u5b9a\u53d1\u5e03',
      '\u53d1\u5e03\u7ae0\u8282',
      '\u786e\u8ba4',
      '\u786e\u5b9a',
      '\u63d0\u4ea4'
    ],
    actionName,
    { timeout: 2500, optional: true, afterDelay: 1000 }
  );

  if (directClicked) return true;

  const clicked = await this.clickFirstCandidate(
    [
      page.getByRole('button', {
        name: /确认发布|提交发布|提交审核|确定发布|发布章节/
      }),
      page.locator('button, [role="button"], .arco-btn, .byte-btn, .semi-button, .ant-btn, .el-button, .btn').filter({
        hasText: /确认发布|提交发布|提交审核|确定发布|发布章节/
      }),
      page.locator('button, [role="button"], .arco-btn, .byte-btn, .semi-button, .ant-btn, .el-button, .btn').filter({
        hasText: /^发布$|^确认$|^确定$|^提交$/
      })
    ],
    actionName,
    {
      timeout: 12000,
      optional: true
    }
  );

  if (clicked) {
    await page.waitForTimeout(1000);
    return true;
  }

  const buttons = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };

    return Array.from(document.querySelectorAll('button, [role="button"], .arco-btn, .btn'))
      .filter(visible)
      .map((el) => ({
        text: String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ''),
        className: String(el.className || '').slice(0, 100)
      }))
      .filter((item) => item.text)
      .slice(-30);
  });

  await logger.warn('确认发布按钮定位失败，当前页面可见按钮如下', { buttons });

  const screenshotPath = await this.takeScreenshot('confirm_publish_missing', 'confirm_publish_missing').catch(() => '');
  throw new Error(`确认发布失败：没有找到最终发布按钮。截图：${screenshotPath}`);
}

  async publishNow(options = {}) {
    const page = await this.getActivePage();
    await logger.info('准备立即发布');
    await this.preparePublishSettings(options, 'direct');
    await page.waitForTimeout(800);
    await this.clickFirstCandidate(
      [
        page.getByRole('button', { name: fanqieSelectors.fallbackTexts.directPublish }),
        page.getByText(fanqieSelectors.fallbackTexts.directPublish),
        page.locator('button, [role="button"], label, .arco-radio').filter({ hasText: fanqieSelectors.fallbackTexts.directPublish })
      ],
      '选择立即发布',
      { timeout: 5000, optional: true }
    );
await this.confirmPublish('确认发布');
await page.waitForTimeout(1500);
await this.handlePublishPrompts('direct');
await this.waitForPublishSuccess('direct');
    await logger.info('章节发布完成');
  }

  
async enableScheduledPublishSwitch() {
  const page = await this.getActivePage();
  if (!(await this.isPublishSettingsPage())) {
    const screenshotPath = await this.takeScreenshot('schedule_settings_missing', 'schedule_settings_missing').catch(() => '');
    throw new Error(`当前不在发布设置弹窗，停止打开定时发布开关。截图：${screenshotPath}`);
  }
  const targetPoint = await page.evaluate(() => {
    const timedText = '\u5b9a\u65f6\u53d1\u5e03';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rows = Array.from(document.querySelectorAll('div, section, li, label'))
      .filter((el) => visible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, text: normalize(el.innerText || el.textContent), area: rect.width * rect.height };
      })
      .filter((item) => item.text.includes(timedText))
      .sort((a, b) => a.area - b.area);
    const row = rows.find((item) => item.text.includes('\u5173\u95ed\u5b9a\u65f6') || item.text.length < 80)?.el || rows[0]?.el;
    const switchEl =
      row?.querySelector('[role="switch"], .arco-switch, .semi-switch, .byte-switch, .ant-switch') ||
      row?.querySelector('input[type="checkbox"]');
    if (!switchEl || !visible(switchEl)) {
      const label = rows[0];
      const labelRect = label?.el.getBoundingClientRect();
      const labelY = labelRect ? labelRect.top + labelRect.height / 2 : 0;
      const globalSwitch = Array.from(document.querySelectorAll('[role="switch"], .arco-switch, .semi-switch, .byte-switch, .ant-switch, input[type="checkbox"]'))
        .filter((el) => visible(el))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { el, rect, distance: labelY ? Math.abs(rect.top + rect.height / 2 - labelY) : rect.top };
        })
        .sort((a, b) => a.distance - b.distance)[0];
      if (!globalSwitch) return null;
      const checked =
        globalSwitch.el.getAttribute('aria-checked') === 'true' ||
        globalSwitch.el.className?.toString?.().includes('checked') ||
        globalSwitch.el.checked === true;
      if (checked) return { alreadyOn: true };
      return { x: globalSwitch.rect.left + globalSwitch.rect.width / 2, y: globalSwitch.rect.top + globalSwitch.rect.height / 2 };
    }
    const checked =
      switchEl.getAttribute('aria-checked') === 'true' ||
      switchEl.className?.toString?.().includes('checked') ||
      switchEl.checked === true;
    if (checked) return { alreadyOn: true };
    switchEl.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = switchEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  if (targetPoint?.x && targetPoint?.y) {
    await page.mouse.move(targetPoint.x, targetPoint.y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
  }

  if (!targetPoint) {
    const fallbackPoint = await page.evaluate(() => {
      const timedText = '\u5b9a\u65f6\u53d1\u5e03';
      const normalize = (text) => String(text || '').replace(/\s+/g, '');
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]'))
        .filter((el) => visible(el) && normalize(el.innerText || el.textContent).includes('\u53d1\u5e03\u8bbe\u7f6e'));
      const scope = dialogs[dialogs.length - 1];
      if (!scope) return null;
      const label = Array.from(scope.querySelectorAll('div, section, li, label, span'))
        .filter(visible)
        .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
        .filter((item) => item.text.includes(timedText))
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      if (!label) return null;
      const y = label ? label.rect.top + label.rect.height / 2 : 0;
      const switches = Array.from(scope.querySelectorAll('[role="switch"], .arco-switch, .semi-switch, .byte-switch, .ant-switch, input[type="checkbox"]'))
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const checked = el.getAttribute('aria-checked') === 'true' || String(el.className || '').includes('checked') || el.checked === true;
          return { rect, checked, distance: y ? Math.abs(rect.top + rect.height / 2 - y) : rect.top };
        })
        .sort((a, b) => a.distance - b.distance);
      const switchItem = switches.find((item) => item.distance < 80) || switches[0];
      if (switchItem?.checked) return { alreadyOn: true };
      if (switchItem) return { x: switchItem.rect.left + switchItem.rect.width / 2, y: switchItem.rect.top + switchItem.rect.height / 2, via: 'nearest-switch' };
      if (label) return { x: label.rect.right + 62, y, via: 'label-offset' };
      return null;
    }).catch(() => null);

    if (fallbackPoint?.x && fallbackPoint?.y) {
      await page.mouse.click(fallbackPoint.x, fallbackPoint.y);
      await logger.info('定时发布开关兜底点击', { point: fallbackPoint });
    } else if (!fallbackPoint?.alreadyOn) {
      const screenshotPath = await this.takeScreenshot('schedule_switch_missing', 'schedule_switch_missing').catch(() => '');
      throw new Error(`没有找到定时发布开关。截图：${screenshotPath}`);
    }
  }
  await page.waitForTimeout(1000);
}

  
async ensureScheduledPublishSwitchOn() {
  const page = await this.getActivePage();
  if (!(await this.isPublishSettingsPage())) {
    const screenshotPath = await this.takeScreenshot('schedule_settings_missing', 'schedule_settings_missing').catch(() => '');
    throw new Error(`当前不在发布设置弹窗，不能点击定时发布开关。截图：${screenshotPath}`);
  }

  const findSwitchPoint = async () => page.evaluate(() => {
    const timedText = '\u5b9a\u65f6\u53d1\u5e03';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]'))
      .filter((el) => visible(el) && normalize(el.innerText || el.textContent).includes('\u53d1\u5e03\u8bbe\u7f6e'));
    const scope = dialogs[dialogs.length - 1];
    if (!scope) return null;
    const label = Array.from(scope.querySelectorAll('div, section, li, label, span'))
      .filter(visible)
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text.includes(timedText))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (!label) return null;
    const y = label.rect.top + label.rect.height / 2;
    const switches = Array.from(scope.querySelectorAll('[role="switch"], .arco-switch, .semi-switch, .byte-switch, .ant-switch, input[type="checkbox"]'))
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const checked = el.getAttribute('aria-checked') === 'true' || /checked|open|active/i.test(String(el.className || '')) || el.checked === true;
        return { rect, checked, distance: Math.abs(rect.top + rect.height / 2 - y) };
      })
      .sort((a, b) => a.distance - b.distance);
    const switchItem = switches.find((item) => item.distance < 80) || switches[0];
    if (switchItem?.checked) return { alreadyOn: true };
    if (switchItem) return { x: switchItem.rect.left + switchItem.rect.width / 2, y: switchItem.rect.top + switchItem.rect.height / 2, via: 'switch' };
    return { x: label.rect.right + 64, y, via: 'label-offset' };
  }).catch(() => null);

  const isOn = async () => page.evaluate(() => {
    const timedText = '\u5b9a\u65f6\u53d1\u5e03';
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]'))
      .filter((el) => visible(el) && normalize(el.innerText || el.textContent).includes('\u53d1\u5e03\u8bbe\u7f6e'));
    const scope = dialogs[dialogs.length - 1];
    if (!scope) return false;
    const label = Array.from(scope.querySelectorAll('div, section, li, label, span'))
      .filter(visible)
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text.includes(timedText))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (!label) return false;
    const y = label.rect.top + label.rect.height / 2;
    const switches = Array.from(scope.querySelectorAll('[role="switch"], .arco-switch, .semi-switch, .byte-switch, .ant-switch, input[type="checkbox"]'))
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const checked = el.getAttribute('aria-checked') === 'true' || /checked|open|active/i.test(String(el.className || '')) || el.checked === true;
        return { checked, distance: Math.abs(rect.top + rect.height / 2 - y) };
      })
      .sort((a, b) => a.distance - b.distance);
    return Boolean((switches.find((item) => item.distance < 80) || switches[0])?.checked);
  }).catch(() => false);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await isOn()) {
      await logger.info('定时发布开关已开启');
      return true;
    }
    const point = await findSwitchPoint();
    if (point?.alreadyOn) return true;
    if (!point?.x || !point?.y) break;
    await page.mouse.click(point.x, point.y);
    await logger.info('点击定时发布开关', { attempt: attempt + 1, point });
    await page.waitForTimeout(800);
    if (await isOn()) return true;
  }

  const screenshotPath = await this.takeScreenshot('schedule_switch_missing', 'schedule_switch_missing').catch(() => '');
  throw new Error(`没有成功打开定时发布开关。截图：${screenshotPath}`);
}

async fillScheduleTime(formattedTime) {
  const page = await this.getActivePage();
  if (!(await this.isPublishSettingsPage())) return false;
  const parts = String(formattedTime).match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  const fillModalInputs = async () => {
    if (!parts) return false;
    const inputs = await page.evaluate(() => {
      const normalize = (text) => String(text || '').replace(/\s+/g, '');
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 10;
      };
      const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]'))
        .filter((el) => visible(el) && normalize(el.innerText || el.textContent).includes('\u5b9a\u65f6\u53d1\u5e03'));
      const scope = dialogs[dialogs.length - 1];
      if (!scope) return [];
      return Array.from(scope.querySelectorAll('input:not([type="hidden"])'))
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const placeholder = el.getAttribute('placeholder') || '';
          const value = el.value || '';
          const score =
            (/(\u65e5\u671f|\u65f6\u95f4|\u53d1\u5e03|\u9009\u62e9)/.test(placeholder) ? 10 : 0) +
            (rect.top > window.innerHeight * 0.45 ? 4 : 0) +
            (value ? 1 : 0);
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, placeholder, value, score };
        })
        .sort((a, b) => b.score - a.score || a.y - b.y)
        .slice(0, 4);
    }).catch(() => []);

    if (!inputs.length) return false;

    if (inputs.length === 1 || /(\u65e5\u671f.*\u65f6\u95f4|\u53d1\u5e03|\u9009\u62e9)/.test(inputs[0].placeholder)) {
      await page.mouse.click(inputs[0].x, inputs[0].y);
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.insertText(formattedTime);
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }

    await page.mouse.click(inputs[0].x, inputs[0].y);
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.insertText(parts[1]);
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(300);
    await page.mouse.click(inputs[1].x, inputs[1].y);
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.insertText(parts[2]);
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(500);
    return true;
  };

  const modalFilled = await fillModalInputs();
  const fillVisibleInput = async (keyword, value) => {
    const point = await page.evaluate((text) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, '');
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 10;
      };
      const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]'))
        .filter((el) => visible(el) && normalize(el.innerText || el.textContent).includes('\u5b9a\u65f6\u53d1\u5e03'));
      const scope = dialogs[dialogs.length - 1];
      if (!scope) return null;
      const input = Array.from(scope.querySelectorAll('input:not([type="hidden"]), textarea')).find((el) => {
        const placeholder = el.getAttribute('placeholder') || '';
        return visible(el) && placeholder.includes(text);
      });
      if (!input) return null;
      const rect = input.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, keyword);
    if (!point) return false;
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.insertText(value);
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(400);
    return true;
  };

  if (parts) {
    const dateFilled = await fillVisibleInput('\u65e5\u671f', parts[1]);
    const timeFilled = await fillVisibleInput('\u65f6\u95f4', parts[2]);
    if (dateFilled || timeFilled) {
      await logger.info('已尝试填写可见定时发布时间控件', { dateFilled, timeFilled, formattedTime });
    }
  }

  const forced = await page.evaluate(({ datePart, timePart, fullValue }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '');
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 10;
    };
    const setNativeValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]'))
      .filter((el) => visible(el) && normalize(el.innerText || el.textContent).includes('\u5b9a\u65f6\u53d1\u5e03'));
    const scope = dialogs[dialogs.length - 1];
    if (!scope) return { ok: false, reason: 'modal-not-found' };
    const inputs = Array.from(scope.querySelectorAll('input:not([type="hidden"]), textarea')).filter(visible);
    if (!inputs.length) return { ok: false, reason: 'input-not-found' };
    const dateInput = inputs.find((el) => /(\u65e5\u671f|date)/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
    const timeInput = inputs.find((el) => /(\u65f6\u95f4|time)/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
    if (dateInput) setNativeValue(dateInput, datePart);
    if (timeInput) setNativeValue(timeInput, timePart);
    if (!dateInput && !timeInput) setNativeValue(inputs[0], fullValue);
    return {
      ok: true,
      values: inputs.map((el) => ({ placeholder: el.placeholder || '', value: el.value || '' }))
    };
  }, { datePart: parts?.[1] || '', timePart: parts?.[2] || '', fullValue: formattedTime }).catch((error) => ({ ok: false, reason: String(error) }));

  if (forced.ok) {
    await logger.info('强制写入定时发布时间控件', forced);
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(500);
    return true;
  }

  if (modalFilled) return true;

  const filledBySelector = await this.fillFirstCandidate(
    [
      fanqieSelectors.scheduleInput ? page.locator(fanqieSelectors.scheduleInput) : null,
      page.getByPlaceholder(fanqieSelectors.fallbackPlaceholders.schedule),
      page.locator('input[type="datetime-local"], .arco-picker input')
    ],
    formattedTime,
    'fill scheduled publish time',
    { timeout: 5000, optional: true }
  );
  if (filledBySelector) return true;

  const point = await page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '');
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 10;
    };
    const dialogs = Array.from(document.querySelectorAll('.arco-modal, .semi-modal, .byte-modal, .ant-modal, .el-dialog, [role="dialog"]'))
      .filter((el) => visible(el) && normalize(el.innerText || el.textContent).includes('\u5b9a\u65f6\u53d1\u5e03'));
    const scope = dialogs[dialogs.length - 1];
    if (!scope) return null;
    const inputs = Array.from(scope.querySelectorAll('input:not([type="hidden"]), textarea'))
      .filter(visible)
      .map((el) => ({ el, rect: el.getBoundingClientRect(), placeholder: el.getAttribute('placeholder') || '' }))
      .sort((a, b) => b.rect.top - a.rect.top);
    const candidate =
      inputs.find((item) => new RegExp('\\u65f6\\u95f4|\\u65e5\\u671f|\\u53d1\\u5e03|\\u9009\\u62e9').test(item.placeholder)) ||
      inputs.find((item) => item.rect.top > window.innerHeight * 0.45);
    if (!candidate) return null;
    return { x: candidate.rect.left + candidate.rect.width / 2, y: candidate.rect.top + candidate.rect.height / 2 };
  });
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.insertText(formattedTime);
  return true;
}

  async schedulePublish(scheduledAt, options = {}) {
    const page = await this.getActivePage();
    const formattedTime = formatDateTimeForInput(scheduledAt);
    if (!formattedTime) throw new Error('定时发布时间无效，请检查上传设置。');
    await logger.info('准备定时发布', { scheduledAt: formattedTime });
    await this.preparePublishSettings(options, 'scheduled');
    await page.waitForTimeout(800);
    await this.clickFirstCandidate(
      [
        page.getByRole('button', { name: fanqieSelectors.fallbackTexts.scheduledPublish }),
        page.getByText(fanqieSelectors.fallbackTexts.scheduledPublish),
        page.locator('button, [role="button"], label, .arco-radio, .arco-tabs-header-title').filter({ hasText: fanqieSelectors.fallbackTexts.scheduledPublish })
      ],
      '选择定时发布',
      { timeout: 1200, optional: true }
    );
    await logger.info('准备打开定时发布开关');
    await this.ensureScheduledPublishSwitchOn();
    await logger.info('准备填写定时发布时间', { scheduledAt: formattedTime });
    if (!(await this.fillScheduleTime(formattedTime))) {
      const screenshotPath = await this.takeScreenshot('schedule_time_missing', 'schedule_time_missing').catch(() => '');
      throw new Error(`定时开关已尝试打开，但没有找到发布时间输入框。截图：${screenshotPath}`);
    }
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(800);
    await this.confirmPublish('确认定时发布');
    await this.handlePublishPrompts('scheduled');
    await this.waitForPublishSuccess('scheduled');
    await logger.info('章节定时发布完成', { scheduledAt: formattedTime });
  }

  
async uploadOneChapter(chapter, options = {}) {
    this.setSpeedMode(options.speedMode || 'default');
    if (!(await this.checkLoginStatus())) {
      const autoLoggedIn = await this.tryAutoLogin().catch((error) => {
        if (error?.code === 'MANUAL_VERIFICATION_REQUIRED') throw error;
        return false;
      });
      if (!autoLoggedIn) {
        await logger.warn('\u767b\u5f55\u5931\u6548\uff0c\u6682\u505c\u4e0a\u4f20');
        const error = new Error('\u767b\u5f55\u72b6\u6001\u65e0\u6548\uff0c\u8bf7\u5728\u5185\u7f6e\u6d4f\u89c8\u5668\u4e2d\u624b\u52a8\u767b\u5f55\u540e\u518d\u7ee7\u7eed\u3002');
        error.code = 'LOGIN_REQUIRED';
        throw error;
      }
    }

    const publishMode = options.publishMode || 'draft';
    try {
      await logger.info('\u5f00\u59cb\u5904\u7406\u7ae0\u8282', {
        chapterId: chapter.id,
        index: chapter.index,
        title: chapter.title,
        publishMode,
        speedMode: this.speedMode,
        scheduledAt: chapter.scheduledAt || options.scheduledAt || ''
      });

      if (options.bookNameOrId) {
        if (this.chapterManageUrl) await this.gotoChapterManagePageIfKnown();
        else {
          await this.openBookManagePage(options.bookNameOrId);
          await this.openChapterManagePage();
        }
      } else {
        await logger.info('\u672a\u586b\u5199\u76ee\u6807\u4f5c\u54c1\uff0c\u4f7f\u7528\u5f53\u524d\u6d4f\u89c8\u5668\u9875\u9762\u8fdb\u884c\u4e0a\u4f20');
        await this.rememberChapterManagePage();
      }

      // Always open a fresh new-chapter page for each item; otherwise later chapters can overwrite an existing editor.
      await this.createNewChapter({ forceNew: true });
      await this.speedDelay('action');
      await this.fillChapterTitle(chapter.title);
      await this.speedDelay('typing');
      await this.fillChapterContent(chapter.content);
      await this.speedDelay('typing');

      if (publishMode === 'draft') {
        await this.saveDraft();
        return { ok: true, status: '\u5df2\u4fdd\u5b58\u8349\u7a3f', message: '\u7ae0\u8282\u5df2\u4fdd\u5b58\u8349\u7a3f\uff1a' + chapter.title, pageUrl: this.page?.url() || '' };
      }

      const publishOptions = {
        aiMode: options.aiMode || 'no',
        typoMode: options.typoMode || 'confirmIgnore',
        reviewMode: options.reviewMode || 'basic'
      };

      if (publishMode === 'direct') {
        await this.publishNow(publishOptions);
        return { ok: true, status: '\u5df2\u53d1\u5e03', message: '\u7ae0\u8282\u5df2\u63d0\u4ea4\u53d1\u5e03\uff1a' + chapter.title, pageUrl: this.page?.url() || '' };
      }

      if (publishMode === 'scheduled') {
        await this.schedulePublish(chapter.scheduledAt || options.scheduledAt, publishOptions);
        return { ok: true, status: '\u5df2\u5b9a\u65f6', message: '\u7ae0\u8282\u5df2\u5b9a\u65f6\u53d1\u5e03\uff1a' + chapter.title, pageUrl: this.page?.url() || '' };
      }

      throw new Error('\u672a\u77e5\u4e0a\u4f20\u65b9\u5f0f\uff1a' + publishMode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const screenshotPath = await this.takeScreenshot(chapter, 'upload_failed').catch(() => '');
      await logger.error('\u7ae0\u8282\u5904\u7406\u5931\u8d25', { chapterId: chapter.id, title: chapter.title, message, screenshotPath });
      return { ok: false, message, screenshotPath, pageUrl: this.page?.url() || '' };
    }
  }

  async takeScreenshot(chapterId = 'manual', reason = 'screenshot') {
    const page = await this.launchBrowser();
    const chapter = typeof chapterId === 'object' && chapterId ? chapterId : { index: chapterId, title: reason || 'screenshot' };
    const safeReason = String(reason).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 80);
    const safeTitle = String(chapter.title || safeReason)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 40);
    const fileName = `${chapter.index || 'manual'}_${safeTitle}_${Date.now()}.png`;
    const screenshotPath = path.join(this.screenshotDir, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await logger.info('保存页面截图', { screenshotPath });
    return screenshotPath;
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
  }
}

module.exports = {
  FanqieUploader,
  FANQIE_DASHBOARD_URL,
  DEFAULT_PROFILE_DIR,
  DEFAULT_SCREENSHOT_DIR,
  parseChapterTitle,
  findInstalledBrowser,
  formatDateTimeForInput
};
