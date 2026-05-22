<script setup>
const props = defineProps({
  chapter: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['update', 'delete']);

function updateField(field, value) {
  emit('update', { [field]: value });
}
</script>

<template>
  <section class="panel preview-card">
    <div class="panel-heading">
      <h2>正文预览</h2>
      <button class="danger-button" type="button" :disabled="!props.chapter" @click="emit('delete')">
        删除当前章节
      </button>
    </div>

    <template v-if="props.chapter">
      <label class="field-block">
        <span>标题</span>
        <input
          :value="props.chapter.title"
          type="text"
          @input="updateField('title', $event.target.value)"
        />
      </label>
      <label class="field-block grow">
        <span>正文</span>
        <textarea
          :value="props.chapter.content"
          @input="updateField('content', $event.target.value)"
        />
      </label>
    </template>

    <p v-else class="empty-hint">请选择一个章节。</p>
  </section>
</template>
