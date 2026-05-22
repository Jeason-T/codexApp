const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const initSqlJs = require('sql.js');

const appDataRoot = path.join(process.env.APPDATA || path.resolve(__dirname, '..', '..'), 'fanqie-uploader');
const writableRoot = __dirname.includes('app.asar') ? appDataRoot : path.resolve(__dirname, '..', '..');
const databasePath = path.join(writableRoot, 'data', 'app.sqlite');

let SQL = null;
let db = null;

async function ensureDatabaseDirectory() {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
}

async function openDatabase() {
  if (db) return db;

  await ensureDatabaseDirectory();
  SQL = SQL || (await initSqlJs());

  try {
    const existing = await fs.readFile(databasePath);
    db = existing.length ? new SQL.Database(existing) : new SQL.Database();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    db = new SQL.Database();
  }

  return db;
}

async function persistDatabase() {
  if (!db) return;
  const data = db.export();
  await fs.writeFile(databasePath, Buffer.from(data));
}

function runStatement(sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.run(params);
  } finally {
    statement.free();
  }
}

async function initializeDatabase() {
  const database = await openDatabase();

  database.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      source_file TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS upload_logs (
      id TEXT PRIMARY KEY,
      chapter_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      screenshot_path TEXT,
      page_url TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(chapter_id) REFERENCES chapters(id)
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      encrypted_password TEXT,
      profile_dir TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS account_books (
      account_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      href TEXT,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(account_id, book_id),
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS upload_tasks (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      book_id TEXT,
      book_title TEXT,
      status TEXT NOT NULL,
      publish_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS upload_task_chapters (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      chapter_id TEXT,
      chapter_index INTEGER,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      screenshot_path TEXT,
      page_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES upload_tasks(id)
    );
  `);

  await persistDatabase();
  return { databasePath };
}

function rowFromStatement(statement) {
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  return rows;
}

function normalizeAccountRow(row, options = {}) {
  if (!row) return null;
  const account = {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    profileDir: row.profile_dir || '',
    status: row.status || 'unknown',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (options.includeSecret) account.encryptedPassword = row.encrypted_password || '';
  return account;
}

async function listAccounts(options = {}) {
  await initializeDatabase();
  const statement = db.prepare(`
    SELECT id, name, phone, encrypted_password, profile_dir, status, created_at, updated_at
    FROM accounts
    ORDER BY updated_at DESC, created_at DESC;
  `);
  try {
    return rowFromStatement(statement).map((row) => normalizeAccountRow(row, options));
  } finally {
    statement.free();
  }
}

async function getAccount(accountId, options = {}) {
  await initializeDatabase();
  const statement = db.prepare(`
    SELECT id, name, phone, encrypted_password, profile_dir, status, created_at, updated_at
    FROM accounts
    WHERE id = ?
    LIMIT 1;
  `);
  try {
    statement.bind([accountId]);
    return normalizeAccountRow(rowFromStatement(statement)[0], options);
  } finally {
    statement.free();
  }
}

function defaultAccountProfileDir(accountId) {
  return path.join(appDataRoot, 'accounts', accountId, 'profile');
}

async function saveAccount(account) {
  await initializeDatabase();
  const now = new Date().toISOString();
  const id = account.id || randomUUID();
  const existing = account.id ? await getAccount(account.id, { includeSecret: true }) : null;
  const next = {
    id,
    name: String(account.name || account.phone || '未命名账号').trim() || '未命名账号',
    phone: String(account.phone || '').trim(),
    encryptedPassword:
      Object.prototype.hasOwnProperty.call(account, 'encryptedPassword') ? account.encryptedPassword || '' : existing?.encryptedPassword || '',
    profileDir: account.profileDir || existing?.profileDir || defaultAccountProfileDir(id),
    status: account.status || existing?.status || '未登录',
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  runStatement(
    `
      INSERT INTO accounts (id, name, phone, encrypted_password, profile_dir, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        encrypted_password = excluded.encrypted_password,
        profile_dir = excluded.profile_dir,
        status = excluded.status,
        updated_at = excluded.updated_at;
    `,
    [next.id, next.name, next.phone, next.encryptedPassword, next.profileDir, next.status, next.createdAt, next.updatedAt]
  );
  await persistDatabase();
  return normalizeAccountRow(
    {
      id: next.id,
      name: next.name,
      phone: next.phone,
      encrypted_password: next.encryptedPassword,
      profile_dir: next.profileDir,
      status: next.status,
      created_at: next.createdAt,
      updated_at: next.updatedAt
    },
    { includeSecret: false }
  );
}

async function deleteAccount(accountId) {
  await initializeDatabase();
  const account = await getAccount(accountId, { includeSecret: true });
  if (!account) return { deleted: false, profileDir: '' };
  runStatement('DELETE FROM account_books WHERE account_id = ?;', [accountId]);
  runStatement('DELETE FROM accounts WHERE id = ?;', [accountId]);
  await persistDatabase();
  return { deleted: true, profileDir: account.profileDir || '' };
}

async function updateAccountStatus(accountId, status) {
  await initializeDatabase();
  const now = new Date().toISOString();
  runStatement('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?;', [status || 'unknown', now, accountId]);
  await persistDatabase();
}

async function saveAccountBooks(accountId, books = []) {
  await initializeDatabase();
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO account_books (account_id, book_id, title, href, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, book_id) DO UPDATE SET
      title = excluded.title,
      href = excluded.href,
      last_seen_at = excluded.last_seen_at;
  `);
  try {
    for (const book of books) {
      const bookId = String(book.id || book.href || book.title || '').trim();
      if (!bookId) continue;
      statement.run([accountId, bookId, book.title || bookId, book.href || '', now]);
    }
  } finally {
    statement.free();
  }
  await persistDatabase();
}

function validateProjectPayload(project) {
  if (!project || typeof project !== 'object') {
    throw new Error('项目数据无效。');
  }

  if (!Array.isArray(project.chapters)) {
    throw new Error('章节数据无效。');
  }

  if (!project.chapters.length) {
    throw new Error('当前没有可保存的章节。');
  }
}

async function saveProject(project) {
  validateProjectPayload(project);
  await initializeDatabase();

  const now = new Date().toISOString();
  const projectId = project.id || randomUUID();
  const projectName = (project.name || '未命名项目').trim() || '未命名项目';

  db.run('BEGIN TRANSACTION;');
  try {
    const existing = db.exec(`SELECT id FROM projects WHERE id = '${projectId.replace(/'/g, "''")}' LIMIT 1;`);

    if (existing.length) {
      runStatement('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?;', [projectName, now, projectId]);
      runStatement('DELETE FROM chapters WHERE project_id = ?;', [projectId]);
    } else {
      runStatement('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?);', [
        projectId,
        projectName,
        now,
        now
      ]);
    }

    const statement = db.prepare(`
      INSERT INTO chapters (
        id,
        project_id,
        chapter_index,
        title,
        content,
        word_count,
        source_file,
        status,
        error_message,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    try {
      for (const [index, chapter] of project.chapters.entries()) {
        const createdAt = chapter.createdAt || now;
        const updatedAt = chapter.updatedAt || now;
        statement.run([
          chapter.id || randomUUID(),
          projectId,
          Number(chapter.index || index + 1),
          chapter.title || '',
          chapter.content || '',
          Number(chapter.wordCount || 0),
          chapter.sourceFile || '',
          chapter.status || '待上传',
          chapter.errorMessage || '',
          createdAt,
          updatedAt
        ]);
      }
    } finally {
      statement.free();
    }

    db.run('COMMIT;');
    await persistDatabase();

    return {
      id: projectId,
      name: projectName,
      chapterCount: project.chapters.length,
      databasePath,
      updatedAt: now
    };
  } catch (error) {
    db.run('ROLLBACK;');
    throw error;
  }
}

async function addUploadLog(log) {
  await initializeDatabase();

  const now = new Date().toISOString();
  const id = log.id || randomUUID();

  runStatement(
    `
      INSERT INTO upload_logs (
        id,
        chapter_id,
        action,
        status,
        message,
        screenshot_path,
        page_url,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `,
    [
      id,
      log.chapterId || '',
      log.action || '',
      log.status || '',
      log.message || '',
      log.screenshotPath || '',
      log.pageUrl || '',
      now
    ]
  );

  await persistDatabase();
  return { id, createdAt: now };
}

module.exports = {
  databasePath,
  initializeDatabase,
  saveProject,
  addUploadLog,
  listAccounts,
  getAccount,
  saveAccount,
  deleteAccount,
  updateAccountStatus,
  saveAccountBooks,
  defaultAccountProfileDir
};
