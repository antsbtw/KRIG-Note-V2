/**
 * ⭐ X 挂进 note 右键菜单的两项:「𝕏 发到 X」「𝕏 发布为 X 文章」(2026-10-26)
 *
 * ⚠️ 原来这两项写死在 note 的 context-menu-content.ts 里,9-29 删 X 业务时命令删了、菜单项留着 →
 *   点了静默无反应。现在由 X 自己挂(菜单项 + 命令同在 X 目录),删 X 菜单项跟着走。
 *   守卫:tests/modules/menu-command-registered.test.ts(菜单命令必须有人注册)。
 *
 * ⭐ 发推是 X 的能力(x-capabilities-post.ts,界面 / AI 走同一个 execute);这里的命令只负责打开预览窗、把 note 那段内容交过去。
 *   第①期只显示(发法建议 + X 上的样子),发布 / 定时第②③⑦期接。
 */
import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { registerWsCommand } from '@slot/command-registry/register-ws-command';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { openPostPreview } from './x-post-preview';

const NOTE_VIEW = 'note-view';

/** 右键那一刻的 note 编辑器(快照优先,没有就取有焦点的) */
function noteInstanceId(): string | null {
  const fromMenu = contextMenuController.getState().context.custom.pmInstanceId;
  if (typeof fromMenu === 'string') return fromMenu;
  return requireCapabilityApi<TextEditingApi>('text-editing').instanceRegistry.getFocusedInstanceId();
}

function openFromNote(wsId: string, form?: 'article'): void {
  const id = noteInstanceId();
  if (!id) {
    console.warn('[x-post] 发到 X:找不到 note 编辑器');
    window.alert('找不到要发的 note —— 先点一下 note 里的内容,再右键「𝕏 发到 X」');
    return;
  }
  openPostPreview(wsId, id, form);
}

export function registerXNoteContextMenu(): void {
  contextMenuRegistry.register([
    { id: 'note-view.send-to-x', label: '𝕏 发到 X', command: 'x-view.send-to-x', view: NOTE_VIEW, group: 'thought', order: 192 },
    { id: 'note-view.publish-x-article', label: '𝕏 发布为 X 文章', command: 'x-view.publish-article', view: NOTE_VIEW, group: 'thought', order: 193 },
  ]);
}

export function registerXNoteCommands(wsId: string): void {
  registerWsCommand('x-view.send-to-x', () => wsId, (ctx) => { openFromNote(ctx.wsId); });
  /** X 文章:同一个预览窗,先显示文章那种 */
  registerWsCommand('x-view.publish-article', () => wsId, (ctx) => { openFromNote(ctx.wsId, 'article'); });
}
