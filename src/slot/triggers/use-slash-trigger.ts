/**
 * useSlashTrigger — 监听 / 输入 → 显示 SlashMenuBinding
 *
 * L4 阶段:暴露 controller,L5 view 在文本编辑场景接入。
 * 注:精确触发逻辑(光标位置 / / 字符检测)依赖具体编辑能力(text-editing 等)。
 * L4 不实施完整逻辑,仅暴露 API。
 */

export { slashMenuController } from './slash-menu-controller';
