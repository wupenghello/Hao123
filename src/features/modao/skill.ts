export const MODAO_SKILL_NAME = 'modao.prototype-reader'

export const MODAO_SKILL_SUMMARY =
  '读取公开墨刀原型链接，提取项目、目标页面、页面树、可见文案与按钮文本，辅助理解需求、拆开发任务、写验收点。'

export const MODAO_SKILL_PROMPT = [
  '墨刀原型读取：当用户问项目迭代、当前迭代原型、给出 modao.cc/proto 链接、禅道详情中包含墨刀链接，或问题明显在问原型/交互/页面文案时，优先调用 modao.read。',
  '工具能拿到公开 preview metadata、页面树、目标 screen、同级页面，以及本地无登录 headless 渲染后的可见文字；它不使用用户浏览器登录态。',
  '回答时先说明读取到的项目和页面，再基于 rendered.currentCanvasText / rendered.visibleText / buttonTexts 总结，不要声称看到了像素级布局。',
  '涉及精确视觉、间距、颜色、截图细节时，要说明需要截图或导出设计稿；工具结果有 rendered.error 时要如实提示动态渲染受限。',
].join('\n')
