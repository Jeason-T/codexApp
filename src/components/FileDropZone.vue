<script setup>
const props = defineProps({
  files: {
    type: Array,
    default: () => []
  },
  parserStatus: {
    type: String,
    default: '等待导入'
  }
});

const emit = defineEmits(['files-dropped']);

function toFileSummaries(fileList) {
  return Array.from(fileList).map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type || '未知类型',
    path: window.fanqieApp?.getPathForFile?.(file) || file.path || '',
    status: '等待解析'
  }));
}

function handleDrop(event) {
  event.preventDefault();
  emit('files-dropped', toFileSummaries(event.dataTransfer.files));
}

function handleDragOver(event) {
  event.preventDefault();
}

function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <section class="panel">
    <div class="panel-heading">
      <h2>文件导入</h2>
      <span>{{ props.parserStatus }}</span>
    </div>
    <div class="drop-zone" @drop="handleDrop" @dragover="handleDragOver">
      <strong>拖入稿件文件</strong>
      <p>支持 docx、txt、md。doc 老格式会提示先另存为 docx。</p>
      <small>支持格式：.docx / .txt / .md</small>
    </div>
    <div class="file-list" v-if="props.files.length">
      <div class="file-row" v-for="file in props.files" :key="file.path || file.name">
        <span>{{ file.name }}</span>
        <small>{{ formatSize(file.size) }} · {{ file.status || '等待解析' }}</small>
      </div>
    </div>
    <p class="empty-hint" v-else>尚未导入文件。</p>
  </section>
</template>
