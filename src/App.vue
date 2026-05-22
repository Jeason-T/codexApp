<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import FileDropZone from './components/FileDropZone.vue';
import ChapterTable from './components/ChapterTable.vue';
import ChapterPreview from './components/ChapterPreview.vue';
import UploadPanel from './components/UploadPanel.vue';
import LogPanel from './components/LogPanel.vue';
import AccountWorkbench from './components/AccountWorkbench.vue';
import { splitParsedFilesIntoChapters, countWords } from './services/chapterSplitter.js';
import { UploadQueue } from './services/uploadQueue.js';
import { cleanNovelText } from './services/textCleaner.js';
import { validateChapterDraft } from './utils/validators.js';

const STATUS = {
  ready: '待上传',
  uploading: '上传中',
  draft: '已保存草稿',
  published: '已发布',
  scheduled: '已定时',
  failed: '上传失败',
  skipped: '已跳过',
  confirm: '需人工确认'
};

function defaultScheduleStart() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const loginStatus = ref('等待检测');
const taskStatus = ref('预览模式');
const targetBook = ref('');
const appVersion = ref('');
const availableBooks = ref([]);
const loadingBooks = ref(false);
const accounts = ref([]);
const selectedAccountId = ref('');
const browserLayout = ref('auto');
const currentView = ref('chapters');
const taskConcurrency = ref(3);
const importedFiles = ref([]);
const parsedFiles = ref([]);
const parserStatus = ref('等待导入');
const currentProjectId = ref('');
const uploadQueue = ref(null);
const chapters = ref([]);
const selectedChapterId = ref('');
const logs = ref([
  { time: new Date().toLocaleTimeString(), level: 'info', message: '软件已启动。请拖入 txt、md 或 docx 稿件。' }
]);

const uploadOptions = ref({
  publishMode: 'direct',
  aiMode: 'no',
  typoMode: 'confirmIgnore',
  reviewMode: 'basic',
  speedMode: 'default',
  scheduleStart: defaultScheduleStart(),
  scheduleUnit: 'chapters',
  scheduleEveryChapters: 1,
  scheduleEveryWords: 8000,
  scheduleIntervalAmount: 1,
  scheduleIntervalUnit: 'days'
});

let loginCheckTimer = null;
let lastLoginState = '';

const selectedChapter = computed(() => chapters.value.find((chapter) => chapter.id === selectedChapterId.value) ?? null);

const chapterStats = computed(() => {
  const total = chapters.value.length;
  const ready = chapters.value.filter((chapter) => chapter.status === STATUS.ready).length;
  const draft = chapters.value.filter((chapter) => chapter.status === STATUS.draft).length;
  const published = chapters.value.filter((chapter) => chapter.status === STATUS.published).length;
  const scheduled = chapters.value.filter((chapter) => chapter.status === STATUS.scheduled).length;
  const failed = chapters.value.filter((chapter) => chapter.status === STATUS.failed).length;
  const confirm = chapters.value.filter((chapter) => chapter.status === STATUS.confirm).length;
  return { total, ready, draft, published, scheduled, failed, confirm };
});

const publishModeText = computed(() => {
  if (uploadOptions.value.publishMode === 'direct') return '直接发布';
  if (uploadOptions.value.publishMode === 'scheduled') return '定时发布';
  return '保存草稿';
});

function appendLog(level, message) {
  logs.value.unshift({ time: new Date().toLocaleTimeString(), level, message });
}

function updateUploadOptions(patch) {
  uploadOptions.value = { ...uploadOptions.value, ...patch };
}

async function loadAccounts() {
  const result = await window.fanqieApp?.listAccounts?.();
  if (!result?.ok) {
    appendLog('error', result?.message || '账号列表加载失败。');
    return;
  }
  accounts.value = result.accounts || [];
  if (!selectedAccountId.value && accounts.value.length) selectedAccountId.value = accounts.value[0].id;
}

async function createAccount(payload) {
  const result = await window.fanqieApp?.createAccount?.(payload);
  if (!result?.ok) {
    appendLog('error', result?.message || '账号创建失败。');
    return;
  }
  await loadAccounts();
  selectedAccountId.value = result.account?.id || selectedAccountId.value;
  appendLog('info', `账号已添加：${result.account?.name || ''}`);
}

async function deleteAccount(accountId) {
  if (!accountId) return;
  const target = accounts.value.find((account) => account.id === accountId);
  const result = await window.fanqieApp?.deleteAccount?.(accountId);
  if (!result?.ok) {
    appendLog('error', result?.message || '账号删除失败。');
    return;
  }
  selectedAccountId.value = '';
  await loadAccounts();
  appendLog('warn', `账号已删除：${target?.name || accountId}`);
}

function selectAccount(accountId) {
  selectedAccountId.value = accountId;
}

function selectedAccountName() {
  return accounts.value.find((account) => account.id === selectedAccountId.value)?.name || '未选择账号';
}

async function updateTaskConcurrency(value) {
  taskConcurrency.value = Math.min(12, Math.max(1, Number(value) || 3));
  await window.fanqieApp?.setTaskConcurrency?.(taskConcurrency.value);
}

function renumberChapters(nextChapters) {
  const now = new Date().toISOString();
  return nextChapters.map((chapter, index) => ({ ...chapter, index: index + 1, updatedAt: now }));
}

function chineseNumberToArabic(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digitMap = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const unitMap = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of String(value || '')) {
    if (Object.prototype.hasOwnProperty.call(digitMap, char)) {
      number = digitMap[char];
      continue;
    }
    const unit = unitMap[char];
    if (!unit) continue;
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  return total + section + number;
}

function extractChapterOrder(chapter) {
  const text = `${chapter.title || ''} ${chapter.sourceFile || ''}`;
  const match =
    text.match(/第\s*([0-9一二两三四五六七八九十百千万零〇]{1,8})\s*[章节回卷集部]?/) ||
    text.match(/chapter\s*([0-9]{1,8})/i) ||
    text.match(/(?:^|[_\-\s])([0-9]{1,8})(?:[_\-\s]|$)/);
  return match ? chineseNumberToArabic(match[1]) : Number.MAX_SAFE_INTEGER;
}

function titleFromFileName(fileName) {
  const plain = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const english = plain.match(/^chapter[\s-]*([0-9]{1,8})[\s-]*(.*)$/i);
  if (english) return `第${english[1]}章 ${english[2] || ''}`.trim();
  const numeric = plain.match(/^([0-9]{1,8})[\s-]+(.+)$/);
  if (numeric) return `第${numeric[1]}章 ${numeric[2]}`.trim();
  return plain;
}

function resolveChapterTitle(chapter) {
  const title = String(chapter.title || '').trim();
  if (title) return title;
  const fromFile = titleFromFileName(chapter.sourceFile);
  if (fromFile) return fromFile;
  const firstLine = String(chapter.content || '').split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine?.slice(0, 40) || '';
}

function applyChapterSplit(files) {
  const cleanedFiles = (files || []).map((file) => ({ ...file, text: file.ok ? cleanNovelText(file.text) : file.text }));
  const splitResult = splitParsedFilesIntoChapters(cleanedFiles);
  chapters.value = splitResult.chapters.map((chapter) => ({
    ...chapter,
    title: resolveChapterTitle(chapter),
    status: chapter.status || STATUS.ready
  }));
  selectedChapterId.value = chapters.value[0]?.id ?? '';
  appendLog('info', `章节识别完成：按“一文件一章”生成 ${chapters.value.length} 章。`);
}

async function handleFilesDropped(files) {
  importedFiles.value = files.map((file) => ({ ...file, status: '解析中' }));
  parserStatus.value = '解析中';
  const filePaths = files.map((file) => file.path).filter(Boolean);
  if (!filePaths.length) {
    parserStatus.value = '解析失败';
    importedFiles.value = files.map((file) => ({ ...file, status: '无法获取文件路径' }));
    appendLog('error', '无法获取拖拽文件路径，请确认当前在 Electron 桌面窗口中运行。');
    return;
  }

  try {
    const result = await window.fanqieApp?.parseFiles?.(filePaths);
    if (!result?.ok) throw new Error(result?.message || '文件解析失败');
    parsedFiles.value = (result.files || []).map((file) => ({ ...file, text: file.ok ? cleanNovelText(file.text) : file.text }));
    importedFiles.value = files.map((file) => {
      const parsed = parsedFiles.value.find((item) => item.filePath === file.path);
      return { ...file, status: parsed?.ok ? '解析成功，已删除空行' : parsed?.errorMessage || '解析失败' };
    });
    const okCount = parsedFiles.value.filter((file) => file.ok).length;
    parserStatus.value = `已解析 ${okCount}/${parsedFiles.value.length} 个文件`;
    appendLog('info', `文件解析完成：成功 ${okCount} 个，失败 ${parsedFiles.value.length - okCount} 个。`);
    applyChapterSplit(parsedFiles.value);
  } catch (error) {
    parserStatus.value = '解析失败';
    importedFiles.value = files.map((file) => ({ ...file, status: '解析失败' }));
    appendLog('error', error instanceof Error ? error.message : String(error));
  }
}

function selectChapter(id) {
  selectedChapterId.value = id;
}

function updateSelectedChapter(patch) {
  if (!selectedChapter.value) return;
  const nextPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'content')) {
    nextPatch.content = cleanNovelText(nextPatch.content);
    nextPatch.wordCount = countWords(nextPatch.content);
  }
  Object.assign(selectedChapter.value, nextPatch, { updatedAt: new Date().toISOString() });
}

function deleteSelectedChapter() {
  if (!selectedChapter.value) return;
  const deletedTitle = selectedChapter.value.title;
  chapters.value = renumberChapters(chapters.value.filter((chapter) => chapter.id !== selectedChapter.value.id));
  selectedChapterId.value = chapters.value[0]?.id ?? '';
  appendLog('warn', `已删除章节：${deletedTitle}`);
}

function moveSelectedChapter(direction) {
  if (!selectedChapter.value) {
    appendLog('warn', '请先选择一个章节。');
    return;
  }
  const currentIndex = chapters.value.findIndex((chapter) => chapter.id === selectedChapterId.value);
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= chapters.value.length) {
    appendLog('warn', direction < 0 ? '当前章节已经在最前面。' : '当前章节已经在最后面。');
    return;
  }
  const nextChapters = [...chapters.value];
  const [chapter] = nextChapters.splice(currentIndex, 1);
  nextChapters.splice(nextIndex, 0, chapter);
  chapters.value = renumberChapters(nextChapters);
  appendLog('info', `已移动章节：${chapter.title}`);
}

function sortChapters(direction = 'asc') {
  if (!chapters.value.length) {
    appendLog('warn', '当前没有可排序章节。');
    return;
  }
  const multiplier = direction === 'desc' ? -1 : 1;
  chapters.value = renumberChapters(
    [...chapters.value].sort((a, b) => {
      const orderA = extractChapterOrder(a);
      const orderB = extractChapterOrder(b);
      if (orderA !== orderB) return (orderA - orderB) * multiplier;
      return a.index - b.index;
    })
  );
  selectedChapterId.value = chapters.value[0]?.id ?? selectedChapterId.value;
  appendLog('info', direction === 'desc' ? '已按章节号倒序排序。' : '已按章节号正序排序。');
}

async function openDashboard() {
  const result = await window.fanqieApp?.openDashboard?.();
  if (result?.ok) {
    loginStatus.value = '检查中';
    appendLog('info', result.message ?? '已打开番茄作家后台。');
    startLoginMonitor();
    window.setTimeout(() => checkLoginStatus({ silent: false }), 1200);
    return;
  }
  appendLog('error', result?.message ?? '浏览器接口暂不可用。');
}

function startLoginMonitor() {
  if (loginCheckTimer) return;
  loginCheckTimer = window.setInterval(() => checkLoginStatus({ silent: true }), 5000);
}

function stopLoginMonitor() {
  if (!loginCheckTimer) return;
  window.clearInterval(loginCheckTimer);
  loginCheckTimer = null;
}

async function checkLoginStatus(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) loginStatus.value = '检查中';
  const result = await window.fanqieApp?.checkLoginStatus?.();
  if (result?.ok && result.loggedIn) {
    loginStatus.value = '已登录';
    if (!silent || lastLoginState !== 'loggedIn') appendLog('info', '番茄后台登录状态正常。');
    lastLoginState = 'loggedIn';
    return true;
  }
  loginStatus.value = '需手动登录';
  if (!silent || lastLoginState !== 'manual') appendLog('warn', result?.message || '尚未检测到有效登录，请在浏览器中手动登录。');
  lastLoginState = 'manual';
  return false;
}

async function refreshBooks() {
  loadingBooks.value = true;
  appendLog('info', '正在拉取当前账号作品列表。');
  try {
    const result = await window.fanqieApp?.listBooks?.();
    if (!result?.ok) throw new Error(result?.message || '拉取作品列表失败。');
    availableBooks.value = result.books || [];
    if (!targetBook.value && availableBooks.value.length) {
      targetBook.value = availableBooks.value[0].title || availableBooks.value[0].id || '';
    }
    appendLog('info', `作品列表已更新，共 ${availableBooks.value.length} 本。`);
  } catch (error) {
    appendLog('error', error instanceof Error ? error.message : String(error));
  } finally {
    loadingBooks.value = false;
  }
}

function markValidationIssues() {
  let blocked = 0;
  chapters.value = chapters.value.map((chapter) => {
    const title = resolveChapterTitle(chapter);
    const content = cleanNovelText(chapter.content);
    const nextChapter = { ...chapter, title, content, wordCount: countWords(content) };
    const issues = validateChapterDraft(nextChapter, chapters.value);
    if (issues.includes('标题为空') || issues.includes('正文为空')) {
      blocked += 1;
      return { ...nextChapter, status: STATUS.failed, remark: '上传前校验失败', errorMessage: issues.join('；'), updatedAt: new Date().toISOString() };
    }
    if (issues.length && nextChapter.status === STATUS.ready) {
      return { ...nextChapter, status: STATUS.confirm, remark: issues.join('；'), errorMessage: issues.join('；'), updatedAt: new Date().toISOString() };
    }
    return nextChapter;
  });
  if (blocked) appendLog('error', `${blocked} 章标题或正文为空，已拦截上传。`);
}

function cleanCurrentChapter() {
  if (!selectedChapter.value) {
    appendLog('warn', '请先选择一个章节。');
    return;
  }
  const content = cleanNovelText(selectedChapter.value.content);
  Object.assign(selectedChapter.value, { content, wordCount: countWords(content), updatedAt: new Date().toISOString() });
  appendLog('info', `已删除当前章节空行：${selectedChapter.value.title}`);
}

function cleanAllChapters() {
  chapters.value = chapters.value.map((chapter) => {
    const content = cleanNovelText(chapter.content);
    return { ...chapter, content, wordCount: countWords(content), updatedAt: new Date().toISOString() };
  });
  appendLog('info', `已删除全部章节空行，共 ${chapters.value.length} 章。`);
}

function buildSchedulePlan(sourceChapters) {
  if (uploadOptions.value.publishMode !== 'scheduled') {
    return sourceChapters.map((chapter) => {
      chapter.scheduledAt = '';
      return chapter;
    });
  }
  const base = new Date(uploadOptions.value.scheduleStart);
  if (Number.isNaN(base.getTime())) throw new Error('定时起始时间无效。');
  const intervalAmount = Math.max(1, Number(uploadOptions.value.scheduleIntervalAmount || 1));
  const intervalMs = uploadOptions.value.scheduleIntervalUnit === 'minutes' ? intervalAmount * 60 * 1000 : intervalAmount * 24 * 60 * 60 * 1000;
  const everyChapters = Math.max(1, Number(uploadOptions.value.scheduleEveryChapters || 1));
  const everyWords = Math.max(1, Number(uploadOptions.value.scheduleEveryWords || 8000));
  let wordsBefore = 0;
  return sourceChapters.map((chapter, index) => {
    const slot = uploadOptions.value.scheduleUnit === 'words' ? Math.floor(wordsBefore / everyWords) : Math.floor(index / everyChapters);
    wordsBefore += Number(chapter.wordCount || 0);
    chapter.scheduledAt = new Date(base.getTime() + slot * intervalMs).toISOString();
    return chapter;
  });
}

function buildUploadContext() {
  return {
    bookNameOrId: targetBook.value.trim(),
    publishMode: uploadOptions.value.publishMode,
    aiMode: uploadOptions.value.aiMode,
    typoMode: uploadOptions.value.typoMode,
    reviewMode: uploadOptions.value.reviewMode,
    speedMode: uploadOptions.value.speedMode
  };
}

function updateChapterStatus(chapter, patch) {
  Object.assign(chapter, patch, { updatedAt: new Date().toISOString() });
}

function toPlainChapter(chapter) {
  const content = cleanNovelText(chapter.content);
  return {
    id: chapter.id,
    index: chapter.index,
    title: resolveChapterTitle(chapter),
    content,
    wordCount: countWords(content),
    sourceFile: chapter.sourceFile,
    status: chapter.status,
    remark: chapter.remark || '',
    errorMessage: chapter.errorMessage || '',
    scheduledAt: chapter.scheduledAt || '',
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt
  };
}

async function uploadChapterViaMain(chapter, context) {
  await checkLoginStatus({ silent: true });
  return window.fanqieApp?.uploadChapter?.({ ...context, chapter: toPlainChapter(chapter) });
}

async function runBatchUpload() {
  if (!chapters.value.length) {
    appendLog('warn', '当前没有可上传章节。');
    return;
  }
  if (!targetBook.value.trim()) {
    appendLog('warn', '未填写目标作品，将使用当前浏览器页面。请先在番茄后台手动进入目标作品的章节管理页。');
  }
  markValidationIssues();
  uploadQueue.value =
    uploadQueue.value ||
    new UploadQueue({
      uploadChapter: uploadChapterViaMain,
      onChapterStatus: updateChapterStatus,
      onLog: appendLog,
      onDone: () => {
        taskStatus.value = '预览模式';
      }
    });
  taskStatus.value = `批量${publishModeText.value}`;
  try {
    const plannedChapters = buildSchedulePlan(chapters.value);
    await uploadQueue.value.run(plannedChapters, buildUploadContext());
  } catch (error) {
    taskStatus.value = '预览模式';
    appendLog('error', error instanceof Error ? error.message : String(error));
  }
}

async function testUploadSelectedChapter() {
  if (!selectedChapter.value) {
    appendLog('warn', '请先选择要测试上传的章节。');
    return;
  }
  selectedChapter.value.title = resolveChapterTitle(selectedChapter.value);
  selectedChapter.value.content = cleanNovelText(selectedChapter.value.content);
  const issues = validateChapterDraft(selectedChapter.value, chapters.value);
  if (issues.includes('标题为空') || issues.includes('正文为空')) {
    Object.assign(selectedChapter.value, { status: STATUS.failed, remark: '上传前校验失败', errorMessage: issues.join('；') });
    appendLog('error', `当前章节校验失败：${issues.join('；')}`);
    return;
  }

  const [plannedChapter] = buildSchedulePlan([selectedChapter.value]);
  selectedChapter.value.status = STATUS.uploading;
  taskStatus.value = `测试${publishModeText.value}`;
  appendLog('info', `开始测试${publishModeText.value}：${selectedChapter.value.title}`);
  try {
    const result = await window.fanqieApp?.uploadChapter?.({ ...buildUploadContext(), chapter: toPlainChapter(plannedChapter) });
    await checkLoginStatus({ silent: true });
    if (result?.ok) {
      Object.assign(selectedChapter.value, {
        status:
          result.status ||
          (uploadOptions.value.publishMode === 'direct' ? STATUS.published : uploadOptions.value.publishMode === 'scheduled' ? STATUS.scheduled : STATUS.draft),
        errorMessage: '',
        remark: result.message || '测试成功',
        updatedAt: new Date().toISOString()
      });
      appendLog('info', result.message || '测试上传成功。');
      return;
    }
    Object.assign(selectedChapter.value, {
      status: STATUS.failed,
      errorMessage: result?.message || '测试上传失败。',
      remark: '测试上传失败',
      updatedAt: new Date().toISOString()
    });
    appendLog('error', `${result?.message || '测试上传失败。'}${result?.screenshotPath ? ` 截图：${result.screenshotPath}` : ''}`);
  } catch (error) {
    Object.assign(selectedChapter.value, {
      status: STATUS.failed,
      errorMessage: error instanceof Error ? error.message : String(error),
      remark: '测试上传异常',
      updatedAt: new Date().toISOString()
    });
    appendLog('error', error instanceof Error ? error.message : String(error));
  } finally {
    taskStatus.value = '预览模式';
  }
}

async function saveCurrentProject() {
  try {
    const projectName = targetBook.value.trim() || importedFiles.value[0]?.name?.replace(/\.[^.]+$/, '') || '未命名项目';
    const result = await window.fanqieApp?.saveProject?.({ id: currentProjectId.value, name: projectName, chapters: chapters.value.map(toPlainChapter) });
    if (!result?.ok) throw new Error(result?.message || '保存项目失败。');
    currentProjectId.value = result.project.id;
    appendLog('info', `项目已保存：${result.project.name}，共 ${result.project.chapterCount} 章。`);
  } catch (error) {
    appendLog('error', error instanceof Error ? error.message : String(error));
  }
}

function exportLogs() {
  const text = logs.value.map((log) => `[${log.time}] [${log.level.toUpperCase()}] ${log.message}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `fanqie-upload-log-${Date.now()}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function handleAction(action) {
  if (action === 'resplit') {
    if (!parsedFiles.value.length) appendLog('warn', '请先导入并解析文件，再重新识别章节。');
    else applyChapterSplit(parsedFiles.value);
    return;
  }
  if (action === 'cleanCurrent') return cleanCurrentChapter();
  if (action === 'cleanAll') return cleanAllChapters();
  if (action === 'sortAsc') return sortChapters('asc');
  if (action === 'sortDesc') return sortChapters('desc');
  if (action === 'moveUp') return moveSelectedChapter(-1);
  if (action === 'moveDown') return moveSelectedChapter(1);
  if (action === 'validate') {
    markValidationIssues();
    appendLog('info', '上传前校验完成。');
    return;
  }
  if (action === 'save') return saveCurrentProject();
  if (action === 'testUpload') return testUploadSelectedChapter();
  if (action === 'batchUpload') return runBatchUpload();
  if (action === 'pause') {
    uploadQueue.value?.pause();
    taskStatus.value = '已暂停';
    return;
  }
  if (action === 'resume') {
    uploadQueue.value?.resume();
    taskStatus.value = uploadQueue.value?.status === 'running' ? '批量上传中' : '预览模式';
    return;
  }
  if (action === 'skip') {
    const current = chapters.value.find((chapter) => chapter.id === uploadQueue.value?.currentChapterId);
    if (current) updateChapterStatus(current, { status: STATUS.skipped, remark: '用户跳过', errorMessage: '' });
    uploadQueue.value?.skipCurrent();
    return;
  }
  if (action === 'exportLog') return exportLogs();
}

onMounted(() => {
  window.fanqieApp?.getVersion?.().then((version) => {
    appVersion.value = version || '';
  }).catch(() => {});
  startLoginMonitor();
  window.setTimeout(() => checkLoginStatus({ silent: true }), 800);
});

onBeforeUnmount(() => {
  stopLoginMonitor();
});
</script>

<template>
  <div class="app-shell">
    <header class="top-bar">
      <div class="brand">
        <strong>番茄章节批量上传助手</strong>
        <small v-if="appVersion">v{{ appVersion }}</small>
        <span>本地上传工作台</span>
      </div>

      <div class="status-group">
        <button :class="['status-pill', loginStatus === '已登录' ? 'ok' : '']" type="button" @click="checkLoginStatus">
          登录：{{ loginStatus }}
        </button>
        <button class="primary-button" type="button" @click="openDashboard">打开番茄后台</button>
        <label class="book-field">
          <span>目标作品</span>
          <select v-if="availableBooks.length" v-model="targetBook">
            <option value="">使用当前浏览器页面</option>
            <option v-for="book in availableBooks" :key="book.href || book.id || book.title" :value="book.title">
              {{ book.title }}
            </option>
          </select>
          <input v-else v-model="targetBook" type="text" placeholder="可留空，使用当前浏览器页面" />
        </label>
        <button type="button" @click="refreshBooks" :disabled="loadingBooks">{{ loadingBooks ? '拉取中' : '拉取作品' }}</button>
        <span class="status-pill accent">方式：{{ publishModeText }}</span>
        <span class="status-pill accent">任务：{{ taskStatus }}</span>
      </div>
    </header>

    <section class="summary-bar">
      <span>章节 {{ chapterStats.total }}</span>
      <span>待上传 {{ chapterStats.ready }}</span>
      <span>草稿 {{ chapterStats.draft }}</span>
      <span>已发布 {{ chapterStats.published }}</span>
      <span>已定时 {{ chapterStats.scheduled }}</span>
      <span>失败 {{ chapterStats.failed }}</span>
      <span>需确认 {{ chapterStats.confirm }}</span>
    </section>

    <main class="workspace">
      <aside class="left-panel">
        <FileDropZone :files="importedFiles" :parser-status="parserStatus" @files-dropped="handleFilesDropped" />
      </aside>

      <section class="chapter-panel">
        <ChapterTable :chapters="chapters" :selected-id="selectedChapterId" @select="selectChapter" />
      </section>

      <aside class="preview-panel">
        <ChapterPreview :chapter="selectedChapter" @update="updateSelectedChapter" @delete="deleteSelectedChapter" />
      </aside>
    </main>

    <footer class="bottom-panel">
      <UploadPanel :chapter-count="chapters.length" :options="uploadOptions" @action="handleAction" @update-options="updateUploadOptions" />
      <LogPanel :logs="logs" />
    </footer>
  </div>
</template>
