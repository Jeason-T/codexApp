const fs = require('node:fs/promises');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const mammoth = require('mammoth');
const chardet = require('chardet');
const iconv = require('iconv-lite');

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.docx']);
const CJK_PUNCTUATION = '\u3002\uff0c\uff01\uff1f\uff1b\uff1a\u3001\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b';

function cleanNovelText(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/[\u3000\t]+/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .trim()
        .replace(new RegExp(`([\\u4e00-\\u9fff])\\s+([\\u4e00-\\u9fff${CJK_PUNCTUATION}])`, 'g'), '$1$2')
        .replace(new RegExp(`([${CJK_PUNCTUATION}])\\s+([\\u4e00-\\u9fff])`, 'g'), '$1$2')
    )
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeLineEndings(text) {
  return cleanNovelText(text);
}

function countWords(content) {
  const text = content || '';
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWordCount =
    (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return cjkCount + latinWordCount;
}

function normalizeEncodingName(detectedEncoding) {
  const normalized = (detectedEncoding || 'utf-8').toLowerCase().replace(/_/g, '-');
  if (['utf-8', 'utf8', 'ascii'].includes(normalized)) return 'utf8';
  if (['gb18030', 'gbk', 'gb2312', 'big5'].includes(normalized)) return normalized;
  return 'utf8';
}

function detectTextEncoding(buffer) {
  if (isUtf8(buffer)) return 'utf8';
  const encoding = normalizeEncodingName(chardet.detect(buffer));
  return encoding === 'utf8' ? 'gb18030' : encoding;
}

function stripMarkdownLightly(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1');
}

async function parseTxtLikeFile(filePath, shouldStripMarkdown) {
  const buffer = await fs.readFile(filePath);
  const encoding = detectTextEncoding(buffer);
  const rawText = iconv.decode(buffer, encoding);
  const text = shouldStripMarkdown ? stripMarkdownLightly(rawText) : rawText;
  return { text: normalizeLineEndings(text), encoding };
}

async function parseDocxFile(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return normalizeLineEndings(result.value || '');
}

async function parseFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  if (extension === '.doc') {
    throw new Error('暂不支持 doc，请先另存为 docx。');
  }

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`暂不支持 ${extension || '未知'} 文件，请导入 docx、txt 或 md。`);
  }

  let text = '';
  let encoding = '';

  if (extension === '.docx') {
    text = await parseDocxFile(filePath);
    encoding = 'docx';
  } else {
    const parsed = await parseTxtLikeFile(filePath, extension === '.md');
    text = parsed.text;
    encoding = parsed.encoding;
  }

  if (!text.trim()) {
    throw new Error('文件内容为空。');
  }

  return {
    ok: true,
    filePath,
    fileName,
    extension,
    title: fileName.replace(/\.[^.]+$/, ''),
    text,
    wordCount: countWords(text),
    encoding,
    errorMessage: ''
  };
}

async function parseFileSafely(filePath) {
  try {
    return await parseFile(filePath);
  } catch (error) {
    return {
      ok: false,
      filePath,
      fileName: path.basename(filePath || ''),
      extension: path.extname(filePath || '').toLowerCase(),
      title: path.basename(filePath || '').replace(/\.[^.]+$/, ''),
      text: '',
      wordCount: 0,
      encoding: '',
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

async function parseFiles(filePaths) {
  if (!Array.isArray(filePaths)) {
    throw new Error('文件路径参数无效。');
  }
  return Promise.all(filePaths.map((filePath) => parseFileSafely(filePath)));
}

module.exports = {
  parseFile,
  parseFiles,
  normalizeEncodingName,
  detectTextEncoding,
  stripMarkdownLightly,
  countWords
};
