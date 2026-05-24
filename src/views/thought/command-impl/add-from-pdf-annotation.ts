/**
 * thought-view.add-from-pdf-annotation 业务实现
 *
 * PDF 标注(rect / underline)创建后非全屏路径:
 *   pdfAnn.create 已落 thought atom + book anchor → 调用方拿 thoughtId 调本命令
 *   → 开右槽 ThoughtView + emit 'thought.activate' → ThoughtView 高亮新卡片
 *     + ThoughtCard 内编辑器 focus(走 ThoughtPanel 既有 activeId 逻辑)
 *
 * 与 add-from-note 的差异:thought atom + anchor 已由 pdfAnn.create 一次建好,
 * 本命令只负责 UI 召唤;add-from-note 是 preCreatePlaceholder + resolveLocator
 * + updateAnchor 三步,因为 PM 内 anchor 类型需要根据 selection 拓扑动态识别。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { ThoughtAnchor } from '@capabilities/thought/types';
import { thoughtCap } from './shared';

export async function addFromPdfAnnotation(thoughtId: string): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const bus = workspaceManager.getBus(wsId);
  if (!bus) return;

  // 拿 anchor 一起带上(对齐 add-from-note emit shape — 虽然 ThoughtView
  // 当前只消费 thoughtId,带上 anchor 让后续扩展不破协议)
  const t = await thoughtCap().getThought(thoughtId);
  const anchor: ThoughtAnchor | undefined = t?.anchor ?? undefined;

  bus.slot.openRight('thought-view');
  bus.channels.emit('thought.activate', {
    thoughtId,
    anchor,
    emittedAt: Date.now(),
  });
}
