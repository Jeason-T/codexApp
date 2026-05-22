const AI_NOTICE_KEYWORDS = [
  '下一章写什么',
  '未来走势',
  '伏笔整理',
  '节奏审计',
  '创作说明',
  '本章总结',
  '以下是改写版本',
  '你可以继续',
  '如果你愿意',
  '作为AI',
  'AI助手'
];

export function validateChapterDraft(chapter, allChapters = []) {
  const issues = [];
  const title = chapter?.title?.trim() || '';
  const content = chapter?.content?.trim() || '';

  if (!title) issues.push('标题为空');
  if (!content) issues.push('正文为空');
  if (content && content.length < 100) issues.push('正文字数过少');
  if (title && allChapters.filter((item) => item.title?.trim() === title).length > 1) issues.push('标题重复');
  if (/[锟�]{2,}|閿熸枻鎷|濡傛灉|绔犺妭|姝ｆ枃/.test(content)) issues.push('内容疑似乱码');
  if (/\n{3,}/.test(content)) issues.push('内容存在大量连续空行');
  if (AI_NOTICE_KEYWORDS.some((keyword) => content.includes(keyword))) {
    issues.push('包含疑似 AI 创作说明，需人工确认');
  }

  return issues;
}
