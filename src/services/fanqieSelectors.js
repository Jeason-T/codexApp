const fanqieSelectors = {
  loginCheck: '',
  bookListItem: '',
  chapterManageButton: '',
  createChapterButton: '',
  newChapterLink: 'a[href*="/publish/"][href*="enter_from=newchapter"]',
  chapterNumberInput: '.serial-editor-title-left input',
  titleInput: 'textarea[placeholder*="请输入标题"], textarea.serial-textarea, input.serial-editor-input-hint-area, input[placeholder*="请输入标题"]',
  contentEditor: '.serial-editor-container .ProseMirror',
  saveDraftButton: 'button.auto-editor-save-btn',
  publishButton: 'button.publish-button',
  confirmPublishButton: '',
  scheduleInput: '',
  aiOptionContainer: '',
  successToast: '',
  errorToast: '',
  fallbackTexts: {
    chapterManage: /章节管理|管理章节|章节列表|章节/,
    createChapter: /新建章节|创建章节|新增章节|添加章节|新建|创建/,
    saveDraft: /存草稿|保存草稿|保存为草稿|存为草稿|保存/,
    publish: /下一步|发布|立即发布|确认发布|提交发布/,
    nextStep: /下一步|继续|提交|确定/,
    directPublish: /立即发布|直接发布|现在发布/,
    scheduledPublish: /定时发布|定时|预约发布|预约/,
    confirm: /确认|确定|提交|发布|继续|我知道了|知道了|同意/,
    cancel: /取消|返回|去修改|关闭/,
    typoDialog: /错别字|错字|未修改|是否确定提交|纠错|校对/,
    typoConfirm: /提交|确定提交|确认提交|继续提交|仍然提交|确认|确定/,
    ignoreAll: /忽略全部|全部忽略|一键忽略|跳过全部/,
    replaceAll: /替换全部|全部替换|一键替换/,
    basicCheck: /基础检测|基础校验|普通检测|基础审核/,
    fullCheck: /全面检测|深度检测|高级检测|全面审核|深度审核/,
    fullCheckUnavailable: /次数已用完|次数不足|今日已用完|暂无次数|不可用|用完/,
    aiYes: /使用AI|AI辅助|AI生成|是|使用/,
    aiNo: /不使用AI|非AI|未使用AI|无AI|否|原创|纯原创|纯手写/,
    publishPrompt: /发布提示|提交提示|确认发布|确认提交|是否确认|是否提交|确定发布|确定提交|审核|章节发布|发布确认|是否发布/,
    success: /保存成功|已保存|发布成功|提交成功|已提交|审核中|定时成功|预约成功|已定时|发布设置成功/
  },
  fallbackPlaceholders: {
    title: /请输入标题|章节标题|标题/,
    content: /请输入正文|正文|内容/,
    schedule: /发布时间|定时发布时间|选择时间|日期|时间|预约时间/
  }
};

module.exports = {
  fanqieSelectors
};
