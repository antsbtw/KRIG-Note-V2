/**
 * thought-view.scroll-to-source 业务实现(Phase 5 拆分)
 *
 * 跨槽跳转:Thought 卡片 anchor 点击 → 切 left slot 到 source view + 滚到目标位置。
 *
 *   source='note' → 切 active note + scrollToThoughtAnchor(blockId, offset?)
 *                   (L7 升级 decision 026 §10.1:blockId 取代 pmPos,根治编辑漂移)
 *   source='book' → ebookCap.open(bookId) + emit 'thought.scroll-to-book-source'
 *                   → EBookView 订阅 → host.goToPage/goToCFI
 *   source='graph'/'canvas':本期预留(Phase 6+ 接入)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { NoteLocator, BookLocator } from '@capabilities/thought/types';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import { thoughtCap } from './shared';

export async function scrollToSource(thoughtId: string): Promise<void> {
  const t = await thoughtCap().getThought(thoughtId);
  if (!t || !t.anchor) return;
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;

  if (t.anchor.source === 'note') {
    return scrollToNoteSource(t.anchor.resourceId, t.anchor.locator as NoteLocator, wsId);
  }
  if (t.anchor.source === 'book') {
    return scrollToBookSource(
      t.anchor.resourceId,
      t.anchor.locator as BookLocator,
      wsId,
      thoughtId,
    );
  }
}

async function scrollToNoteSource(
  noteId: string,
  locator: NoteLocator,
  wsId: string,
): Promise<void> {
  const ws = workspaceManager.get(wsId);
  const noteState = ws?.pluginStates['note'] as { activeNoteId?: string } | undefined;
  if (noteState?.activeNoteId !== noteId) {
    commandRegistry.execute('note-view.set-active', noteId);
  }
  const ws2 = workspaceManager.get(wsId);
  if (ws2 && ws2.slotBinding.left !== 'note-view') {
    workspaceManager.update(wsId, {
      slotBinding: { ...ws2.slotBinding, left: 'note-view' },
    });
  }
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  // driver instance 异步 mount,200ms 重试兜底
  // L7 升级:locator 字面 blockId + offset?;driver scrollToThoughtAnchor 字面按
  // blockId 在当前 doc 字面找 block(漂移后字面仍能精确定位,decision 026 §10.1 拍板根治)
  const tryScroll = (attempt: number): void => {
    const instanceId = textEditing.instanceRegistry.getFocusedInstanceId() ?? wsId;
    textEditing.api.scrollToThoughtAnchor(instanceId, locator.blockId, locator.offset);
    if (attempt === 0) window.setTimeout(() => tryScroll(1), 200);
  };
  tryScroll(0);
}

async function scrollToBookSource(
  bookId: string,
  locator: BookLocator,
  wsId: string,
  thoughtId: string,
): Promise<void> {
  const ws = workspaceManager.get(wsId);
  if (ws && ws.slotBinding.left !== 'ebook-view') {
    workspaceManager.update(wsId, {
      slotBinding: { ...ws.slotBinding, left: 'ebook-view' },
    });
  }
  // 仅当目标书 ≠ 当前活动书 时才 open(避免无谓 reload —
  // open 会触发 EBookView.onBookOpened → host.loadFromInfo →
  // FixedPageContent 重 mount → containerRef 短暂 null →
  // scrollToPage BAILED + restore 把页拉回 last position)
  const ebookApi = requireCapabilityApi<EBookLibraryApi>('ebook-library');
  const ebookState = ws?.pluginStates['ebook-view'] as
    | { activeBookId?: string | null }
    | undefined;
  if (ebookState?.activeBookId !== bookId) {
    await ebookApi.open(bookId);
  }
  // EBookView 订阅 channel 后多次重试 goToPage(幂等),
  // 直至 containerRef ready 后某一次成功
  const bus = workspaceManager.getBus(wsId);
  if (bus) {
    bus.channels.emit('thought.scroll-to-book-source', {
      bookId,
      pageNum: locator.pageNum,
      cfi: locator.cfi,
      thoughtId,
    });
  }
}
