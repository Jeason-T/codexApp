const cjkPunctuation = '\u3002\uff0c\uff01\uff1f\uff1b\uff1a\u3001\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b';

export function cleanNovelText(text) {
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
        .replace(new RegExp(`([\\u4e00-\\u9fff])\\s+([\\u4e00-\\u9fff${cjkPunctuation}])`, 'g'), '$1$2')
        .replace(new RegExp(`([${cjkPunctuation}])\\s+([\\u4e00-\\u9fff])`, 'g'), '$1$2')
    )
    .filter(Boolean)
    .join('\n')
    .trim();
}
