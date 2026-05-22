function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs = 2000, maxMs = 5000) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

const DELAY_RANGES = {
  default: [3000, 7000],
  fast: [1200, 2600],
  turbo: [250, 900]
};

function getStatusAfterSuccess(result, context) {
  if (result?.status) return result.status;
  if (context.publishMode === 'direct') return '已发布';
  if (context.publishMode === 'scheduled') return '已定时';
  return '已保存草稿';
}

export class UploadQueue {
  constructor(options = {}) {
    this.uploadChapter = options.uploadChapter;
    this.onChapterStatus = options.onChapterStatus || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onDone = options.onDone || (() => {});
    this.delayRange = options.delayRange || DELAY_RANGES.default;
    this.status = 'idle';
    this.currentChapterId = '';
    this.pauseRequested = false;
    this.skipRequested = false;
    this.stopRequested = false;
  }

  setSpeedMode(speedMode = 'default') {
    this.delayRange = DELAY_RANGES[speedMode] || DELAY_RANGES.default;
  }

  pause() {
    this.pauseRequested = true;
    this.status = 'paused';
    this.onLog('warn', '用户暂停上传队列。');
  }

  resume() {
    this.pauseRequested = false;
    if (this.status === 'paused') this.status = 'running';
    this.onLog('info', '用户继续上传队列。');
  }

  skipCurrent() {
    this.skipRequested = true;
    this.onLog('warn', '已请求跳过当前章节。');
  }

  stop() {
    this.stopRequested = true;
  }

  async waitIfPaused() {
    while (this.pauseRequested && !this.stopRequested) {
      await delay(500);
    }
  }

  async uploadWithRetry(chapter, context) {
    let lastResult = null;
    const actionName =
      context.publishMode === 'direct' ? '发布章节' : context.publishMode === 'scheduled' ? '定时发布章节' : '保存草稿';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (this.skipRequested) {
        return { ok: false, skipped: true, message: '用户跳过当前章节。' };
      }

      this.onLog('info', `开始${actionName}：${chapter.title}${attempt > 1 ? '（重试）' : ''}`);
      lastResult = await this.uploadChapter(chapter, context);

      if (lastResult?.ok) return lastResult;

      if (attempt < 2) {
        this.onLog('warn', `章节处理失败，准备重试一次：${chapter.title}`);
        await delay(1200);
      }
    }

    return lastResult || { ok: false, message: '上传失败。' };
  }

  async run(chapters, context = {}) {
    if (this.status === 'running') {
      throw new Error('上传队列正在运行。');
    }

    this.setSpeedMode(context.speedMode || 'default');

    const candidates = chapters.filter((chapter) => ['待上传', '上传失败'].includes(chapter.status));
    const report = { success: 0, failed: 0, skipped: 0, total: candidates.length };

    this.status = 'running';
    this.stopRequested = false;
    this.pauseRequested = false;
    this.skipRequested = false;
    this.onLog('info', `批量任务开始，共 ${candidates.length} 章。速度：${context.speedMode || 'default'}。`);

    for (const chapter of candidates) {
      if (this.stopRequested) break;

      await this.waitIfPaused();
      this.currentChapterId = chapter.id;

      if (this.skipRequested) {
        this.onChapterStatus(chapter, { status: '已跳过', remark: '用户跳过', errorMessage: '' });
        report.skipped += 1;
        this.skipRequested = false;
        continue;
      }

      this.onChapterStatus(chapter, { status: '上传中', remark: '', errorMessage: '' });
      const result = await this.uploadWithRetry(chapter, context);

      if (result?.skipped) {
        this.onChapterStatus(chapter, { status: '已跳过', remark: '用户跳过', errorMessage: '' });
        report.skipped += 1;
      } else if (result?.ok) {
        this.onChapterStatus(chapter, {
          status: getStatusAfterSuccess(result, context),
          remark: result?.message || '处理成功',
          errorMessage: ''
        });
        report.success += 1;
      } else {
        this.onChapterStatus(chapter, {
          status: '上传失败',
          remark: '处理失败',
          errorMessage: result?.message || '上传失败。'
        });
        report.failed += 1;
      }

      this.skipRequested = false;
      if (!this.stopRequested) {
        await delay(randomDelay(this.delayRange[0], this.delayRange[1]));
      }
    }

    this.currentChapterId = '';
    this.status = 'idle';
    this.onLog('info', `批量任务完成：成功 ${report.success}，失败 ${report.failed}，跳过 ${report.skipped}。`);
    this.onDone(report);
    return report;
  }
}
