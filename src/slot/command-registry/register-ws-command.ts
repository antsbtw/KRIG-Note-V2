import { commandRegistry } from './command-registry';

/** 命令上下文：注入给 handler 的窗口级信息 */
export interface CommandContext {
  wsId: string;
}

/**
 * 注册一个「需要 wsId」的命令。wsId 由注册时提供的 getter 闭包捕获
 * （多窗口下每窗口各注册一遍，getter 返回本窗口 wsId）。
 * handler 首参为 ctx，其后为原业务参数。
 */
export function registerWsCommand(
  id: string,
  getWsId: () => string | null,
  handler: (ctx: CommandContext, ...args: unknown[]) => unknown,
): void {
  commandRegistry.register(id, (...args: unknown[]) => {
    const wsId = getWsId();
    if (!wsId) {
      console.warn(`[ws-command] '${id}' skipped: no wsId`);
      return;
    }
    return handler({ wsId }, ...args);
  });
}
