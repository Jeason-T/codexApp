<script setup>
const props = defineProps({
  logs: {
    type: Array,
    default: () => []
  }
});
</script>

<template>
  <section class="log-panel">
    <div class="log-row" v-for="log in props.logs" :key="`${log.time}-${log.message}`">
      <time>{{ log.time }}</time>
      <span :class="['log-level', log.level]">{{ log.level }}</span>
      <p>{{ log.message }}</p>
    </div>
  </section>
</template>
