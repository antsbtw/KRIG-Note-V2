/**
 * ThoughtView 命令注册(对齐 views/note/note-commands.ts 签名:register(id, handler))
 *
 * 业务命令(Phase 2):
 *   create-thought / set-active / delete-active / delete-by-tree-id
 *   create-folder / change-type / toggle-resolve / toggle-pinned
 *
 * Phase 3 增:add-from-note(跨 view 调,Note ⌘⇧M)
 * Phase 4 增:add-from-book(跨 view 调,ebook 高亮)
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  ThoughtCapabilityApi,
  ThoughtType,
  ThoughtAnchor,
  NoteLocator,
} from '@capabilities/thought/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { setActiveThought, setFolderExpanded, getThoughtWsState } from './data-model';
import { decodeTreeId } from './tree-builder';

function thoughtCap(): ThoughtCapabilityApi {
  return requireCapabilityApi<ThoughtCapabilityApi>('thought');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

function emptyDoc(): NoteDocEnvelope {
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
}

function ensureThoughtViewActive(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding.left === 'thought-view') return;
  workspaceManager.update(wsId, {
    slotBinding: { ...ws.slotBinding, left: 'thought-view' },
  });
}

function nextAvailableFolderName(base: string, existingTitles: string[]): string {
  const taken = new Set(existingTitles);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function registerThoughtCommands(): void {
  // ── thought CRUD ──

  commandRegistry.register('thought-view.create-thought', (folderId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const fid = typeof folderId === 'string' && folderId ? folderId : null;
    void (async () => {
      const t = await thoughtCap().createThought({
        type: 'thought',
        resolved: false,
        pinned: false,
        doc: emptyDoc(),
        folderId: fid,
        anchor: null,
      });
      setActiveThought(wsId, t.id);
      if (fid) setFolderExpanded(wsId, fid, true);
      ensureThoughtViewActive(wsId);
    })();
  });

  commandRegistry.register('thought-view.set-active', (thoughtId: unknown) => {
    if (typeof thoughtId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    setActiveThought(wsId, thoughtId);
    ensureThoughtViewActive(wsId);
  });

  commandRegistry.register('thought-view.delete-active', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const id = getThoughtWsState(ws).activeThoughtId;
    if (!id) return;
    void (async () => {
      await thoughtCap().deleteThought(id);
      setActiveThought(wsId, null);
    })();
  });

  commandRegistry.register('thought-view.delete-by-tree-id', (treeId: unknown) => {
    if (typeof treeId !== 'string') return;
    const decoded = decodeTreeId(treeId);
    void (async () => {
      if (decoded.type === 'thought') {
        await thoughtCap().deleteThought(decoded.id);
      } else {
        await folderCap().deleteFolder(decoded.id);
      }
    })();
  });

  // ── folder ──

  commandRegistry.register('thought-view.create-folder', (parentId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const pid = typeof parentId === 'string' && parentId ? parentId : null;
    void (async () => {
      const all = await folderCap().listFolders('thought');
      const siblings = all.filter((f) => f.parentId === pid);
      const title = nextAvailableFolderName('新建文件夹', siblings.map((s) => s.title));
      await folderCap().createFolder(title, pid, 'thought');
      if (pid) setFolderExpanded(wsId, pid, true);
    })();
  });

  // ── thought 状态切换 ──

  /** arg = { id, type } */
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

  // ── Note 侧集成:⌘⇧M / 💭 floating toolbar(thought-view-port.md v0.5 §5.5/§5.8)──

  /**
   * 从 Note 当前选区/光标位置创建 thought + anchor(三态自动识别):
   *   1) 有 inline 选区且单 block 内部分文字 → 路径 1 inline mark
   *   2) 光标在 image 等 node 上 → 路径 3 node attr
   *   3) 光标在 paragraph/heading 等 textblock 内(无选区或覆盖整段)→ 路径 2 block frame
   *
   * 流程:
   *   a) 拿当前 NoteView active noteId + driver focused instance
   *   b) 调 driver api 加 mark/frame/node attr,返 { pos, text }
   *   c) thoughtCapability.createThought(单步原子 + thoughtOf 边)
   *   d) bus.slot.openRight('thought-view',{thoughtId}) 开右槽
   *   e) channels.emit thought.activate 通知 ThoughtView 激活该卡片
   *
   * 失败(无 selection / 无 anchor 节点 / 无 noteId)静默返回,不报错。
   */
  commandRegistry.register('thought-view.add-from-note', () => {
    void addThoughtFromNote();
  });

  /**
   * 跳到 thought 的 source(从 ThoughtCard 点击 anchor 信息 → Note 内滚到对应位置 + 高亮)。
   * Phase 3 仅支持 source='note'(NoteView 必须已 active 且 noteId 匹配 — 不匹配则切 active note)。
   */
  commandRegistry.register('thought-view.scroll-to-source', (thoughtId: unknown) => {
    if (typeof thoughtId !== 'string') return;
    void (async () => {
      const t = await thoughtCap().getThought(thoughtId);
      if (!t || !t.anchor || t.anchor.source !== 'note') return;
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return;
      // 切 active note 到 anchor.resourceId(可能本来就是)
      const ws = workspaceManager.get(wsId);
      const noteState = ws?.pluginStates['note'] as { activeNoteId?: string } | undefined;
      if (noteState?.activeNoteId !== t.anchor.resourceId) {
        commandRegistry.execute('note-view.set-active', t.anchor.resourceId);
      }
      // 让 NoteView 在 left slot 显示(用 bus.slot 把 NoteView 设为 left;
      // V2 NoteView 默认就在 left,这里仅保证状态;ThoughtView 留 right)
      const ws2 = workspaceManager.get(wsId);
      if (ws2 && ws2.slotBinding.left !== 'note-view') {
        workspaceManager.update(wsId, {
          slotBinding: { ...ws2.slotBinding, left: 'note-view' },
        });
      }
      // 等 NoteView host mount 完成(异步切 activeNoteId 后 driver instance 还没就绪)
      const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
      const tryScroll = (attempt: number): void => {
        const instanceId = textEditing.instanceRegistry.getFocusedInstanceId() ?? wsId;
        const locator = t.anchor!.locator as NoteLocator;
        textEditing.api.scrollToThoughtAnchor(instanceId, locator.pmPos);
        // 简单兜底:首次可能 instance 还没 ready,200ms 重试一次
        if (attempt === 0) {
          window.setTimeout(() => tryScroll(1), 200);
        }
      };
      tryScroll(0);
    })();
  });
}

const NODE_ANCHOR_TYPES = new Set(['image']);

async function addThoughtFromNote(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  // active noteId(NoteView 持久化在 pluginStates.note.activeNoteId)
  const noteState = ws.pluginStates['note'] as { activeNoteId?: string } | undefined;
  const noteId = noteState?.activeNoteId;
  if (!noteId) return;

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const instanceId = textEditing.instanceRegistry.getFocusedInstanceId();
  if (!instanceId) return;

  // 走 driver api 直接拿 view/state 决定 anchor 类型
  const driverApi = textEditing.api;
  // V2 driver api 是 method 集合,instance 通过 instanceRegistry 间接拿;
  // 但 add-from-note 需要 inspect selection 拓扑决定走哪条 anchor 路径,
  // 这部分逻辑放 driver 不合适(driver 不知道 thought 业务),只能在命令端拿 view 检查。
  // 我们暂用 getActiveBlockType + addThoughtMark 失败回退方式:
  //   1) 先尝试 addThoughtMark(选区非空且单 block 内) → 失败则:
  //   2) 拿 active block,检查 type:image → addThoughtNodeAttr;其它 textblock → addThoughtBlockFrame
  const thoughtId = await preCreatePlaceholder(noteId);
  if (!thoughtId) return;

  const inlineResult = driverApi.addThoughtMark(instanceId, thoughtId, 'thought');
  let locator: NoteLocator | null = null;
  if (inlineResult) {
    locator = { pmPos: inlineResult.pos, anchorType: 'inline', text: inlineResult.text };
  } else {
    // 找 active block:V2 没 selection-info 直查 api,先按 activeBlockType + handle pos 兜底
    const activeBlock = driverApi.getActiveBlockType(instanceId);
    // active block 是 image / mathBlock 等 node → 尝试 nodeAttr(driver 自己已校验 thoughtId 字段)
    // 否则 textblock → blockFrame
    // 但我们没 blockPos:V2 没暴露 "current block pos" 给业务命令。
    // 解决:直接走 selection 解析,从 instanceRegistry 拿 view 内部状态。
    const inst = textEditing.instanceRegistry as unknown as {
      get?: (id: string) => { view: { state: { selection: { from: number; $from: { depth: number; before: (d: number) => number; node: (d: number) => { type: { name: string } } } } } } } | undefined;
    };
    const got = inst.get?.(instanceId);
    if (!got) {
      // 回滚 placeholder
      await thoughtCap().deleteThought(thoughtId);
      return;
    }
    const $from = got.view.state.selection.$from;
    let blockPos = -1;
    let isNode = false;
    for (let d = $from.depth; d >= 0; d--) {
      const n = $from.node(d);
      if (NODE_ANCHOR_TYPES.has(n.type.name)) {
        blockPos = $from.before(d);
        isNode = true;
        break;
      }
    }
    if (blockPos === -1) {
      // 用 top-level block (depth=1)
      const topDepth = Math.min($from.depth, 1);
      blockPos = topDepth >= 1 ? $from.before(topDepth) : -1;
    }
    if (blockPos === -1) {
      await thoughtCap().deleteThought(thoughtId);
      return;
    }

    const result = isNode
      ? driverApi.addThoughtNodeAttr(instanceId, blockPos, thoughtId)
      : driverApi.addThoughtBlockFrame(instanceId, blockPos, thoughtId);
    if (!result) {
      await thoughtCap().deleteThought(thoughtId);
      return;
    }
    locator = {
      pmPos: result.pos,
      anchorType: isNode ? 'node' : 'block',
      text: result.text,
    };
    void activeBlock; // 已用 selection 走通,不再依赖 activeBlock
  }

  // 把 anchor 落到 atom(thoughtCreate 用 placeholder 没 anchor,这里 updateAnchor 补)
  const anchor: ThoughtAnchor = {
    source: 'note',
    resourceId: noteId,
    locator: locator!,
  };
  await thoughtCap().updateThoughtAnchor(thoughtId, anchor);

  // 同步 NoteView title(从 anchor.text 派生 — Phase 2 textarea 会读 anchor.text 兜底)
  // Phase 3 不动 doc,卡片标题靠 tree-builder.deriveThoughtTitle 自动兜底 anchor.text

  // 开右槽 + 激活该卡片
  const bus = workspaceManager.getBus(wsId);
  if (bus) {
    bus.slot.openRight('thought-view');
    bus.channels.emit('thought.activate', { thoughtId, anchor });
  }
}

/** 先建一个 placeholder thought(unanchored,后续 updateAnchor 补) — 用 anchor=null 单步原子建 atom 拿 id */
async function preCreatePlaceholder(noteId: string): Promise<string | null> {
  void noteId; // anchor.noteId 在 updateAnchor 时塞,这里不用
  const emptyDoc: NoteDocEnvelope = {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
  try {
    const t = await thoughtCap().createThought({
      type: 'thought',
      resolved: false,
      pinned: false,
      doc: emptyDoc,
      folderId: null,
      anchor: null, // placeholder,马上 updateAnchor 补
    });
    return t.id;
  } catch (e) {
    console.warn('[thought-view] preCreatePlaceholder failed:', e);
    return null;
  }
}
