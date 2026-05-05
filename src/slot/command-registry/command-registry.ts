/**
 * CommandRegistry — 命令注册中心
 *
 * 字符串引用机制:菜单项 / Toolbar / 等通过 `command: 'xxx.yyy'` 字符串
 * 引用,实际 handler 在此注册。
 *
 * V1 commandRegistry.ts 38 行空骨架 → V2 真实实施
 */

import type { CommandHandler } from './command-handler';

class CommandRegistry {
  private commands: Map<string, CommandHandler> = new Map();

  /** 注册命令 */
  register(id: string, handler: CommandHandler): void {
    if (this.commands.has(id)) {
      console.warn(`[L4] CommandRegistry: command '${id}' already registered, overwriting`);
    }
    this.commands.set(id, handler);
  }

  /** 取消注册 */
  unregister(id: string): void {
    this.commands.delete(id);
  }

  /** 是否已注册 */
  has(id: string): boolean {
    return this.commands.has(id);
  }

  /** 获取命令 handler */
  get(id: string): CommandHandler | undefined {
    return this.commands.get(id);
  }

  /** 执行命令(字符串引用)*/
  execute(id: string, ...args: unknown[]): unknown {
    const handler = this.commands.get(id);
    if (!handler) {
      console.warn(`[L4] CommandRegistry: command '${id}' not registered`);
      return undefined;
    }
    return handler(...args);
  }

  /** 命令数量(诊断用)*/
  get count(): number {
    return this.commands.size;
  }
}

/** 全局单例 */
export const commandRegistry = new CommandRegistry();
