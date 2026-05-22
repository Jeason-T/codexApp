const FIRST_LINE_CHAPTER_PATTERN =
  /^第[\u4e00-\u9fff0-9零〇两]{1,8}[章节回卷集部].{0,80}$/;
const ENGLISH_CHAPTER_PATTERN = /^chapter\s*\d+[\s:：\-._、]?.{0,80}$/i;

function nowIso() {
  return new Date().toISOString();
}

export function countWords(content) {
  const text = content || '';
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWordCount =
    (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return cjkCount + latinWordCount;
}

export function isChapterTitleLine(line) {
  const title = (line || '').trim();
  if (!title || title.length > 90) return false;
  return FIRST_LINE_CHAPTER_PATTERN.test(title) || ENGLISH_CHAPTER_PATTERN.test(title);
}

function normalizeText(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function titleFromFileName(fileName) {
  const title = (fileName || '未命名章节')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
  const chapterMatch = title.match(/^chapter[\s-]*([0-9]{1,8})[\s-]*(.*)$/i);
  if (chapterMatch) {
    return `第${chapterMatch[1]}章 ${chapterMatch[2] || ''}`.trim();
  }
  const numericMatch = title.match(/^([0-9]{1,8})[\s-]+(.+)$/);
  if (numericMatch) {
    return `第${numericMatch[1]}章 ${numericMatch[2]}`.trim();
  }
  return title;
}

function createChapter({ index, title, content, sourceFile, status = '待上传', errorMessage = '', remark = '' }) {
  const createdAt = nowIso();
  const normalizedContent = normalizeText(content);

  return {
    id: crypto.randomUUID(),
    index,
    title: title.trim(),
    content: normalizedContent,
    wordCount: countWords(normalizedContent),
    sourceFile,
    status,
    remark,
    errorMessage,
    createdAt,
    updatedAt: createdAt
  };
}

export function splitChapters(text, sourceFile = '未知文件') {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return [];

  const lines = normalizedText.split('\n');
  const firstLine = lines[0]?.trim() || '';
  const firstLineIsTitle = isChapterTitleLine(firstLine);

  return [
    createChapter({
      index: 1,
      title: firstLineIsTitle ? firstLine : titleFromFileName(sourceFile),
      content: firstLineIsTitle ? lines.slice(1).join('\n') : normalizedText,
      sourceFile,
      status: '待上传',
      remark: '按文件识别'
    })
  ];
}

export function splitParsedFilesIntoChapters(parsedFiles) {
  const chapters = [];
  const unrecognizedFiles = [];

  for (const parsedFile of parsedFiles || []) {
    if (!parsedFile.ok) {
      chapters.push(
        createChapter({
          index: chapters.length + 1,
          title: parsedFile.title || parsedFile.fileName || '解析失败文件',
          content: '',
          sourceFile: parsedFile.fileName || '未知文件',
          status: '需人工确认',
          errorMessage: parsedFile.errorMessage || '文件解析失败。',
          remark: parsedFile.errorMessage || '解析失败'
        })
      );
      continue;
    }

    chapters.push(...splitChapters(parsedFile.text, parsedFile.fileName));
  }

  return {
    chapters: chapters.map((chapter, index) => ({ ...chapter, index: index + 1 })),
    unrecognizedFiles
  };
}
