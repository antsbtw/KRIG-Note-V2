/**
 * thought-view.scroll-to-source 业务实现(Phase 5 拆分)
 *
 * 跨槽跳转:Thought 卡片 anchor 点击 → 切 left slot 到 source view + 滚到目标位置。
 *
 *   source='note' → 切 active note + scrollToThoughtAnchor(pmPos)
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
    return scrollToBookSource(t.anchor.resourceId, t.anchor.locator as BookLocator, wsId);
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
  const tryScroll = (attempt: number): void => {
    const instanceId = textEditing.instanceRegistry.getFocusedInstanceId() ?? wsId;
    textEditing.api.scrollToThoughtAnchor(instanceId, locator.pmPos);
    if (attempt === 0) window.setTimeout(() => tryScroll(1), 200);
  };
  tryScroll(0);
}

async function scrollToBookSource(
  bookId: string,
  locator: BookLocator,
  wsId: string,
): Promise<void> {
  const ws = workspaceManager.get(wsId);
  if (ws && ws.slotBinding.left !== 'ebook-view') {
    workspaceManager.update(wsId, {
      slotBinding: { ...ws.slotBinding, left: 'ebook-view' },
    });
  }
  const ebookApi = requireCapabilityApi<EBookLibraryApi>('ebook-library');
  await ebookApi.open(bookId);
  // EBookView 订阅 channel 后调 host.goToPage/goToCFI(异步重试已在 EBookView 内做)
  const bus = workspaceManager.getBus(wsId);
  if (bus) {
    bus.channels.emit('thought.scroll-to-book-source', {
      bookId,
      pageNum: locator.pageNum,
      cfi: locator.cfi,
    });
  }
}
