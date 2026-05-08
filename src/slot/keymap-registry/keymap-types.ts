/**
 * Keymap binding 类型(W4.1)
 *
 * view 通过 ViewDefinition.keymap 字段声明全局快捷键。
 * 见 docs/RefactorV2/audit/wave4-design/W4.1-keymap-registrar.md。
 */

/** enabledWhen 枚举值(数组语义 AND)*/
export type KeymapCondition =
  /** window.getSelection 非空且非 collapsed */
  | 'has-text-selection'
  /** 事件 target 在 [data-view-id="<viewId>"] 子树内 */
  | 'in-view-area'
  /** 事件 target 不是 <input> / <textarea> / [contenteditable] */
  | 'not-in-input';

export interface KeymapBinding {
  /**
   * key 表达式 — 简化版:
   * - 'mod+k'        → Cmd+K (mac) / Ctrl+K (win/linux)
   * - 'mod+['        → Cmd+[ / Ctrl+[
   * - 'mod+shift+k'  → Cmd+Shift+K
   *
   * 修饰键固定顺序:mod, shift, alt(其他不支持)。key 部分 case-insensitive,
   * registry 内部统一小写存储。
   */
  key: string;
  /** commandRegistry 命令 ID(string 引用,charter § 1.2 注册原则)*/
  command: string;
  /**
   * 触发前置条件(可选,数组语义 AND)— 全部满足才触发,否则放行让事件冒泡
   *
   * 复杂条件加新枚举值(扩展 listener),不允许 command handler 内再做声明式条件检查——
   * 否则注册原则退化为"注册 + 命令里写硬编码"(W4.1 设计文档 § 3.1)。
   *
   * 示例(NoteView Cmd+K):
   *   enabledWhen: ['has-text-selection', 'in-view-area']
   */
  enabledWhen?: KeymapCondition[];
}
