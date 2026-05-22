import { reactive } from 'vue';

export const chapterStore = reactive({
  chapters: [],
  selectedChapterId: '',
  importedFiles: []
});
