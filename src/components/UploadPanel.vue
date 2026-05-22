<script setup>
const props = defineProps({
  chapterCount: {
    type: Number,
    default: 0
  },
  options: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['action', 'update-options']);

function updateOption(key, value) {
  emit('update-options', { [key]: value });
}

function updateNumberOption(key, value) {
  const number = Number(value);
  emit('update-options', { [key]: Number.isFinite(number) ? number : 0 });
}
</script>

<template>
  <section class="action-panel">
    <div class="upload-settings">
      <label>
        <span>上传方式</span>
        <select :value="props.options.publishMode" @change="updateOption('publishMode', $event.target.value)">
          <option value="draft">只保存草稿</option>
          <option value="direct">直接发布</option>
          <option value="scheduled">定时发布</option>
        </select>
      </label>

      <label>
        <span>错字提示</span>
        <select :value="props.options.typoMode" @change="updateOption('typoMode', $event.target.value)">
          <option value="confirmIgnore">确认提交，忽略错字</option>
          <option value="cancelIgnoreAll">取消后忽略全部</option>
          <option value="cancelReplaceAll">取消后替换全部</option>
          <option value="manual">停下手动处理</option>
        </select>
      </label>

      <label>
        <span>检测方式</span>
        <select :value="props.options.reviewMode" @change="updateOption('reviewMode', $event.target.value)">
          <option value="basic">基础检测</option>
          <option value="fullAutoBasic">全面检测，不足则基础</option>
          <option value="full">全面检测</option>
        </select>
      </label>

      <label>
        <span>AI 声明</span>
        <select :value="props.options.aiMode" @change="updateOption('aiMode', $event.target.value)">
          <option value="no">未使用 AI</option>
          <option value="yes">使用 AI</option>
          <option value="skip">页面手动选择</option>
        </select>
      </label>

      <label>
        <span>上传速度</span>
        <select :value="props.options.speedMode" @change="updateOption('speedMode', $event.target.value)">
          <option value="default">默认：更稳，章节间隔 3-7 秒</option>
          <option value="fast">快速：接近熟练人工，间隔 1.2-2.6 秒</option>
          <option value="turbo">极速：测试用，间隔 0.25-0.9 秒</option>
        </select>
      </label>

      <label v-if="props.options.publishMode === 'scheduled'">
        <span>起始时间</span>
        <input
          type="datetime-local"
          :value="props.options.scheduleStart"
          @input="updateOption('scheduleStart', $event.target.value)"
        />
      </label>

      <label v-if="props.options.publishMode === 'scheduled'">
        <span>定时规则</span>
        <select :value="props.options.scheduleUnit" @change="updateOption('scheduleUnit', $event.target.value)">
          <option value="chapters">每 N 章向后延</option>
          <option value="words">每 N 字向后延</option>
        </select>
      </label>

      <label v-if="props.options.publishMode === 'scheduled' && props.options.scheduleUnit === 'chapters'">
        <span>每几章</span>
        <input
          min="1"
          type="number"
          :value="props.options.scheduleEveryChapters"
          @input="updateNumberOption('scheduleEveryChapters', $event.target.value)"
        />
      </label>

      <label v-if="props.options.publishMode === 'scheduled' && props.options.scheduleUnit === 'words'">
        <span>每多少字</span>
        <input
          min="1"
          step="500"
          type="number"
          :value="props.options.scheduleEveryWords"
          @input="updateNumberOption('scheduleEveryWords', $event.target.value)"
        />
      </label>

      <label v-if="props.options.publishMode === 'scheduled'">
        <span>延后数值</span>
        <input
          min="1"
          type="number"
          :value="props.options.scheduleIntervalAmount"
          @input="updateNumberOption('scheduleIntervalAmount', $event.target.value)"
        />
      </label>

      <label v-if="props.options.publishMode === 'scheduled'">
        <span>延后单位</span>
        <select :value="props.options.scheduleIntervalUnit" @change="updateOption('scheduleIntervalUnit', $event.target.value)">
          <option value="days">天</option>
          <option value="minutes">分钟</option>
        </select>
      </label>
    </div>

    <div class="action-buttons primary-actions">
      <button class="primary-button" type="button" @click="emit('action', 'batchUpload')">批量执行上传</button>
      <button type="button" @click="emit('action', 'pause')">暂停</button>
      <button type="button" @click="emit('action', 'resume')">继续</button>
      <button type="button" @click="emit('action', 'skip')">跳过当前章节</button>
    </div>

    <details class="advanced-actions">
      <summary>更多操作</summary>
      <div class="action-buttons secondary-actions">
        <button type="button" @click="emit('action', 'resplit')">重新识别章节</button>
        <button type="button" @click="emit('action', 'sortAsc')">章节正序</button>
        <button type="button" @click="emit('action', 'sortDesc')">章节倒序</button>
        <button type="button" @click="emit('action', 'moveUp')">选中上移</button>
        <button type="button" @click="emit('action', 'moveDown')">选中下移</button>
        <button type="button" @click="emit('action', 'cleanCurrent')">删除当前空行</button>
        <button type="button" @click="emit('action', 'cleanAll')">删除全部空行</button>
        <button type="button" @click="emit('action', 'validate')">上传前校验</button>
        <button type="button" @click="emit('action', 'save')">保存项目</button>
        <button type="button" @click="emit('action', 'testUpload')">测试上传选中章</button>
        <button type="button" @click="emit('action', 'exportLog')">导出日志</button>
      </div>
    </details>
  </section>
</template>
