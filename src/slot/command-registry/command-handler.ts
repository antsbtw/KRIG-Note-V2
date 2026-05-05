/**
 * CommandHandler 类型
 *
 * 命令字符串引用机制(charter § 1.2 注册原则):
 * - 菜单项 / Toolbar 项 / 等通过 `command: 'note.toggle-toc'` 字符串引用
 * - CommandRegistry 通过 register(id, handler) 注册实际函数
 * - 触发时 commandRegistry.execute(id, ...args) 调用
 */

export type CommandHandler = (...args: unknown[]) => unknown;
