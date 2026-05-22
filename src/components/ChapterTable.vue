<script setup>
const props = defineProps({
  chapters: {
    type: Array,
    default: () => []
  },
  selectedId: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['select']);
</script>

<template>
  <section class="panel chapter-table-panel">
    <div class="panel-heading">
      <h2>章节列表</h2>
      <span>{{ props.chapters.length }} 章</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>序号</th>
            <th>章节标题</th>
            <th>字数</th>
            <th>来源文件</th>
            <th>当前状态</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="chapter in props.chapters"
            :key="chapter.id"
            :class="{ selected: chapter.id === props.selectedId }"
            @click="emit('select', chapter.id)"
          >
            <td>{{ chapter.index }}</td>
            <td>{{ chapter.title }}</td>
            <td>{{ chapter.wordCount }}</td>
            <td>{{ chapter.sourceFile }}</td>
            <td><span class="state-tag">{{ chapter.status }}</span></td>
            <td>{{ chapter.remark || '-' }}</td>
          </tr>
          <tr v-if="!props.chapters.length">
            <td colspan="6" class="empty-cell">暂无章节。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
