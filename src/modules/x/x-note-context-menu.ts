/**
 * ⭐ X 挂进 note 右键菜单的两项:「𝕏 发到 X」「𝕏 发布为 X 文章」(2026-10-26)
 *
 * ⚠️ 原来这两项写死在 note 的 context-menu-content.ts 里,9-29 删 X 业务时命令删了、菜单项留着 →
 *   点了静默无反应。现在由 X 自己挂(菜单项 + 命令同在 X 目录),删 X 菜单项跟着走。
 *   守卫:tests/modules/menu-command-registered.test.ts(菜单命令必须有人注册)。
 *
 * ⚠️ 发推正在重建(交接 docs/10-business-design/x/HANDOFF-posting-control.prompt.md):
 *   发推本身将登记成 X 的能力(界面 / AI 走同一个 execute),这里的命令只负责把 note 的内容交过去。
 *   重建完成前点了明说「正在重建」,不静默。
 */
import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { registerWsCommand } from '@slot/command-registry/register-ws-command';

const NOTE_VIEW = 'note-view';
const REBUILDING = '发推正在重建,暂时还不能用(9-29 删 X 代码时删掉了,还没重建)。';

export function registerXNoteContextMenu(): void {
  contextMenuRegistry.register([
    { id: 'note-view.send-to-x', label: '𝕏 发到 X', command: 'x-view.send-to-x', view: NOTE_VIEW, group: 'thought', order: 192 },
    { id: 'note-view.publish-x-article', label: '𝕏 发布为 X 文章', command: 'x-view.publish-article', view: NOTE_VIEW, group: 'thought', order: 193 },
  ]);
}

export function registerXNoteCommands(wsId: string): void {
  registerWsCommand('x-view.send-to-x', () => wsId, () => {
    console.warn('[x-post] 发到 X:发推正在重建,命令只提示');
    window.alert(REBUILDING);
  });
  registerWsCommand('x-view.publish-article', () => wsId, () => {
    console.warn('[x-post] 发布为 X 文章:发推正在重建,命令只提示');
    window.alert(REBUILDING);
  });
}
