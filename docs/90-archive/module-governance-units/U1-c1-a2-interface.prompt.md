# 执行 Prompt · U1-c1（轻量）· 建 A2 命令注入接口 + 试水

> 复制给新对话执行。自包含。**本任务只建接口 + 试 1 个命令，不批量改 40 个命令。**

## 任务

在 KRIG-Note-V2 里，为 command 系统建立一个「按窗口注入 wsId」的注册器 `registerWsCommand`
（抽象 A2），并用**一个命令**试水验证。这是「全局单例 workspaceManager → 依赖注入」治理的一步。
**只建机制 + 试 1 个，不要碰其余 39 个命令**（那批留后续多窗口阶段批量做）。

## 背景（一句话）

现在命令 handler 里用 `workspaceManager.getActiveId()` 拿 wsId。目标是让 handler 从「注册时闭包
捕获的 wsId」拿，而不是抓全局。前置 U1-a 已建 `useWsId()` + `WorkspaceIdContext`
（`src/workspace/workspace-context/ws-id-context.ts`）。

## 现状（已核实，别改这些）

- `src/slot/command-registry/command-handler.ts`：`CommandHandler = (...args: unknown[]) => unknown`
- `command-registry.ts`：`register(id, handler)` / `execute(id, ...args)`
- **execute 有 80 个调用点，register 有 ~40 个** —— **本任务都不动它们**。

## 精确步骤

### 1. 建 A2 接口（新文件）
新建 `src/slot/command-registry/register-ws-command.ts`：
```ts
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
```
> 说明：这样 `execute(id, ...args)` 调用点**完全不用改**——ctx 由注册器内部闭包注入，业务 args
> 原样透传给 handler 的第 2+ 参数。

### 2. 试水一个命令（只改这一个）
挑 `src/views/note/note-commands.ts` 里的 **`note-view.create-note`**（约 L102）作试点：
- 现状类似：`commandRegistry.register('note-view.create-note', (folderId) => { const wsId = workspaceManager.getActiveId(); ... })`
- 改成用 `registerWsCommand`：
  ```ts
  registerWsCommand('note-view.create-note', () => workspaceManager.getActiveId(), (ctx, folderId) => {
    const wsId = ctx.wsId;   // 不再 getActiveId
    ...原逻辑用 wsId...
  });
  ```
- **注意**：getter 现在**暂时仍用 `workspaceManager.getActiveId()`**（单窗口下这是对的；多窗口阶段
  会把 getter 换成本窗口 Context 源）。本任务的价值是**让 handler 内部不再直接抓 getActiveId，改从
  ctx.wsId 拿** —— 注入点收敛到注册器一处。

## 严格边界（不要做）

- ❌ 不改 `CommandHandler` 类型 / `execute` / `register` 本身。
- ❌ 不动 80 个 execute 调用点。
- ❌ **只改 create-note 这 1 个命令**，其余 39 个命令一律不碰。
- ❌ 不碰 c2 陷阱（ai-sync/keymap/link-click/context-menu）。

## 验收（自检 + 报告）

1. tsc/build 通过。
2. `register-ws-command.ts` 存在，`registerWsCommand` + `CommandContext` 导出。
3. `note-view.create-note` 走 registerWsCommand，handler 内不再直接 `workspaceManager.getActiveId()`
   （改从 ctx.wsId）；getter 里可暂用 getActiveId。
4. `git diff --stat` 只含：新文件 + note-commands.ts。
5. 创建笔记功能冒烟正常。
6. 报告：改了哪些文件、验收结果。

## 完成后

回报「U1-c1 完成」+ diff 摘要。不要迁移其余命令。
