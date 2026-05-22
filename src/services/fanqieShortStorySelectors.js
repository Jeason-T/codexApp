const fanqieShortStorySelectors = {
  loginCheck: '',
  shortStoryListItem: '',
  shortStoryManageButton: '',
  createShortStoryButton: '',
  newShortStoryLink: 'a[href*="/publish/"][href*="enter_from=newstory"]',
  titleInput: 'input.serial-editor-input-hint-area',
  contentEditor: '.serial-editor-container .ProseMirror',
  saveDraftButton: 'button.auto-editor-save-btn',
  publishButton: 'button.publish-button',
  confirmPublishButton: '',
  scheduleInput: '',
  aiOptionContainer: '',
  successToast: '',
  errorToast: '',
  fallbackTexts: {
    shortStoryManage: /短故事|短篇故事|短篇|故事管理|我的短篇|作品管理|创作/,
    createShortStory: /新建短故事|创建短故事|写短故事|写新故事|新建短篇|创建短篇|写故事|新建|创建/,
    saveDraft: /存草稿|保存草稿|保存为草稿|存为草稿|保存/,
    publish: /发布|下一步|立即发布|确认发布|提交发布/,
    nextStep: /下一步|继续|提交|确定/,
    directPublish: /立即发布|直接发布|现在发布|发布/,
    scheduledPublish: /定时发布|定时|预约发布|预约/,
    confirm: /确认|确定|提交|发布|继续|我知道了|知道了|同意/,
    cancel: /取消|返回|去修改|关闭/,
    typoDialog: /错别字|错字|未修改|是否确定提交|纠错|校对/,
    typoConfirm: /确定提交|确认提交|继续提交|仍然提交|确认|确定/,
    ignoreAll: /忽略全部|全部忽略|一键忽略|跳过全部/,
    replaceAll: /替换全部|全部替换|一键替换/,
    basicCheck: /基础检测|基础校验|普通检测|基础审核/,
    fullCheck: /全面检测|深度检测|高级检测|全面审核|深度审核/,
    fullCheckUnavailable: /次数已用完|次数不足|今日已用完|暂无次数|不可用|用完/,
    aiYes: /AI|人工智能|AI辅助|使用AI|含AI|AI生成/,
    aiNo: /非AI|未使用AI|不使用AI|无AI|原创|纯原创|纯手写/,
    publishPrompt: /发布提示|提交提示|确认发布|确认提交|是否确认|是否提交|确定发布|确定提交|审核|短故事发布|确认短故事发布|确认发布设置|发布确认|确定要发布吗|是否发布/,
    tagInput: /添加标签|添加话题|输入标签|标签|话题/,
    categorySelect: /选择分类|选择类型|分类|类型|故事分类|短故事分类/,
    coverUpload: /上传封面|添加封面|封面/,
    storyDescription: /故事简介|简介|故事描述|描述/,
    submitReview: /提交审核|提交审核|送审|申请审核/,
    editStory: /编辑|修改|编辑短故事/,
    deleteStory: /删除|删除短故事|下架/,
    storyList: /我的短故事|短故事列表|已发布|草稿箱|已下架/
  },
  fallbackPlaceholders: {
    title: /请输入标题|故事标题|标题|短故事标题/,
    content: /请输入正文|正文|内容|写你的故事/,
    schedule: /发布时间|定时发布时间|选择时间|日期|时间|预约时间/,
    tags: /添加标签|输入标签|搜索标签/,
    description: /请输入简介|故事简介|简介/
  }
};

module.exports = {
  fanqieShortStorySelectors
};