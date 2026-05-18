/**
 * ThoughtView 命令注册(V1 形态对齐,Phase 5 fix:删 folder 命令族)
 *
 * 命令集:
 *   delete-thought       :删指定 id(ThoughtCard 🗑 调)
 *   change-type          :改类型({id, type})
 *   toggle-resolve       :切换 resolved
 *   toggle-pinned        :切换 pinned(V1 同款,UI 暂未暴露)
 *   add-from-note        :Note ⌘⇧M / 💭 floating(实现 command-impl/)
 *   ask-ai-from-note     :Note 🤖(实现 command-impl/)
 *   scroll-to-source     :ThoughtCard ↗ 跳源(实现 command-impl/)
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { ThoughtType } from '@capabilities/thought/types';
import { thoughtCap } from './command-impl/shared';
import { addThoughtFromNote } from './command-impl/add-from-note';
import { askAiFromNote } from './command-impl/ask-ai';
import { scrollToSource } from './command-impl/scroll-to-source';

export function registerThoughtCommands(): void {
  commandRegistry.register('thought-view.delete-thought', (id: unknown) => {
    if (typeof id !== 'string') return;
    void thoughtCap().deleteThought(id);
  });

  commandRegistry.register('thought-view.change-type', (arg: unknown) => {
    if (!arg || typeof arg !== 'object') return;
    const { id, type } = arg as { id?: unknown; type?: unknown };
    if (typeof id !== 'string' || typeof type !== 'string') return;
    void thoughtCap().updateThought(id, { type: type as ThoughtType });
  });

  commandRegistry.register('thought-view.toggle-resolve', (id: unknown) => {
    if (typeof id !== 'string') return;
    void (async () => {
      const cur = await thoughtCap().getThought(id);
      if (!cur) return;
      await thoughtCap().updateThought(id, { resolved: !cur.resolved });
    })();
  });

  commandRegistry.register('thought-view.toggle-pinned', (id: unknown) => {
    if (typeof id !== 'string') return;
    void (async () => {
      const cur = await thoughtCap().getThought(id);
      if (!cur) return;
      await thoughtCap().updateThought(id, { pinned: !cur.pinned });
    })();
  });

  // 跨 view 命令(Note 侧 ⌘⇧M / 💭 / 🤖 / ThoughtCard 跳源)
  commandRegistry.register('thought-view.add-from-note', () => {
    void addThoughtFromNote();
  });

  commandRegistry.register('thought-view.ask-ai-from-note', () => {
    void askAiFromNote();
  });

  commandRegistry.register('thought-view.scroll-to-source', (thoughtId: unknown) => {
    if (typeof thoughtId !== 'string') return;
    void scrollToSource(thoughtId);
  });

  /**
   * 右键菜单 "删除Thought" 命令 — 从 contextMenuController 拿当前点击位置
   * 的 thoughtId(由 use-context-menu-trigger DOM 检测填入 context.thoughtId)。
   * 删 thought atom 后 capability onListChanged 广播 → Note 侧 note-bridge
   * 检测到 thought 消失 → 调 driver removeThoughtAnchor 清 mark/frame/node attr。
   */
  commandRegistry.register('thought-view.delete-thought-at-cursor', () => {
    const id = contextMenuController.getState().context.thoughtId;
    if (typeof id !== 'string') return;
    void thoughtCap().deleteThought(id);
  });
}
