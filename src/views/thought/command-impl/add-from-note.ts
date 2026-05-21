/**
 * thought-view.add-from-note 业务实现(Phase 5 拆分)
 *
 * 三态 anchor 识别:
 *   1) 有 inline 选区且单 block 内部分文字 → inline mark
 *   2) 光标在 image 等 node 上 → node attr
 *   3) 其他 textblock → block frame
 *
 * 流程见 thought-view-port.md v0.5 §5.5。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { ThoughtAnchor, NoteLocator } from '@capabilities/thought/types';
import { thoughtCap, preCreatePlaceholder } from './shared';

const NODE_ANCHOR_TYPES = new Set(['image']);

interface SelectionProbe {
  $from: {
    depth: number;
    before: (d: number) => number;
    node: (d: number) => { type: { name: string } };
  };
}

/** 从 instanceRegistry 拿 view selection(driver 不暴露此 API 时的 unsafe cast 兜底)*/
function probeSelection(
  textEditing: TextEditingApi,
  instanceId: string,
): SelectionProbe | null {
  const inst = textEditing.instanceRegistry as unknown as {
    get?: (id: string) => { view: { state: { selection: SelectionProbe } } } | undefined;
  };
  const got = inst.get?.(instanceId);
  return got?.view.state.selection ?? null;
}

export async function addThoughtFromNote(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  const noteState = ws.pluginStates['note'] as { activeNoteId?: string } | undefined;
  const noteId = noteState?.activeNoteId;
  if (!noteId) return;

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  // 优先从 context menu 抓拍的 pmInstanceId(右键场景:focus 已转向菜单,
  // getFocusedInstanceId 此时返 null);否则用当前 focused(floating toolbar
  // / keymap 等触发场景)。
  const instanceId =
    contextMenuController.getState().context.pmInstanceId ??
    textEditing.instanceRegistry.getFocusedInstanceId();
  if (!instanceId) return;

  const thoughtId = await preCreatePlaceholder('thought');
  if (!thoughtId) return;

  const locator = await resolveLocator(textEditing, instanceId, thoughtId);
  if (!locator) {
    await thoughtCap().deleteThought(thoughtId);
    return;
  }

  const anchor: ThoughtAnchor = { source: 'note', resourceId: noteId, locator };
  await thoughtCap().updateThoughtAnchor(thoughtId, anchor);

  const bus = workspaceManager.getBus(wsId);
  if (bus) {
    bus.slot.openRight('thought-view');
    bus.channels.emit('thought.activate', { thoughtId, anchor, emittedAt: Date.now() });
  }
}

async function resolveLocator(
  textEditing: TextEditingApi,
  instanceId: string,
  thoughtId: string,
): Promise<NoteLocator | null> {
  const driverApi = textEditing.api;

  // 路径 1:inline mark(选区非空且单 block 内)
  // L7 升级:driver 字面返 { blockId, offset, preview };NoteLocator 字面直接用
  const inline = driverApi.addThoughtMark(instanceId, thoughtId, 'thought');
  if (inline) {
    return { blockId: inline.blockId, offset: inline.offset, preview: inline.preview };
  }

  // 路径 2/3:走 selection 拓扑识别 node / block
  const sel = probeSelection(textEditing, instanceId);
  if (!sel) return null;
  const { $from } = sel;

  // 路径 2:image 节点(整 node 锚点,无 offset)
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d);
    if (NODE_ANCHOR_TYPES.has(n.type.name)) {
      const blockPos = $from.before(d);
      const r = driverApi.addThoughtNodeAttr(instanceId, blockPos, thoughtId);
      if (!r) return null;
      return { blockId: r.blockId, preview: r.preview };
    }
  }

  // 路径 3:top-level block frame(整 block 锚点,无 offset)
  const topDepth = Math.min($from.depth, 1);
  if (topDepth < 1) return null;
  const blockPos = $from.before(topDepth);
  const r = driverApi.addThoughtBlockFrame(instanceId, blockPos, thoughtId);
  if (!r) return null;
  return { blockId: r.blockId, preview: r.preview };
}
