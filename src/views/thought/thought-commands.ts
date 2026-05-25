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
import { getCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ThoughtType, BookLocator } from '@capabilities/thought/types';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import { THOUGHT_TYPE_META } from '@shared/ipc/thought-types';
import { thoughtCap } from './command-impl/shared';
import { addThoughtFromNote } from './command-impl/add-from-note';
import { addFromPdfAnnotation } from './command-impl/add-from-pdf-annotation';
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
    const newType = type as ThoughtType;
    void (async () => {
      // 双写(handoff 颜色同步 follow-up A):改 thought.type 时,若该 thought 关联
      // 到 book reading-thought-block(anchor.source='book'),同步改 BookAnchor.color
      // → PDF 标注层颜色随之变,两边视觉一致。
      await thoughtCap().updateThought(id, { type: newType });
      const t = await thoughtCap().getThought(id);
      if (t?.anchor?.source === 'book') {
        // ebook-library 是可选依赖(thought-view install list 不含它 —
        // thought 是横切层,不强绑 ebook);软取 + 缺失静默跳过。
        const lib = getCapabilityApi<EBookLibraryApi>('ebook-library');
        if (lib) {
          const loc = t.anchor.locator as BookLocator;
          const color = THOUGHT_TYPE_META[newType].color;
          await lib.updateReadingThoughtBlockColor(
            t.anchor.resourceId,
            loc.createdAt,
            color,
          );
        }
      }
    })();
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

  /**
   * EBook 侧 PDF 标注创建后召唤右槽 ThoughtView + 高亮新 thought 卡片。
   * pdfAnn.create 已完成 thought atom + anchor 落库,本命令只负责 UI 召唤。
   */
  commandRegistry.register('thought-view.add-from-pdf-annotation', (arg: unknown) => {
    if (typeof arg !== 'string') return;
    void addFromPdfAnnotation(arg);
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
   * 的 thoughtId(由 thought capability 注册的 contextInfoProvider DOM 检测填入
   * context.custom.thoughtId)。
   * 删 thought atom 后 capability onListChanged 广播 → Note 侧 note-bridge
   * 检测到 thought 消失 → 调 driver removeThoughtAnchor 清 mark/frame/node attr。
   */
  commandRegistry.register('thought-view.delete-thought-at-cursor', () => {
    const id = contextMenuController.getState().context.custom.thoughtId;
    if (typeof id !== 'string') return;
    void thoughtCap().deleteThought(id);
  });
}
