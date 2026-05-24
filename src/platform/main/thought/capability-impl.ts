/**
 * thought capability — main 端实施(thought-view-port.md v0.5 §5.2)
 *
 * 边界:
 * - main 进程独占,直接 import @storage(合规:capability 层调 storage)
 * - renderer 通过 IPC 桥接到本文件(src/capabilities/thought/index.ts 薄包装)
 * - view ↔ capability:ThoughtInfo.doc = NoteDocEnvelope 信封
 * - capability 内部 ↔ storage:裸 PmPayload(thought 的 doc 字段)
 *
 * 数据模型(v0.5 §4.3):
 * - atom domain = 'thought',payload = ThoughtPayload(type/resolved/pinned/color?/serviceId?/thumbnail?/doc)
 * - thought → source(note/book/graph/canvas)用 user:krig:thoughtOf 边表达,attrs.source + attrs.locator JSON 承载锚点
 * - thought → folder(NavSide Thought tab)用 user:krig:inFolder 边表达(与 note/folder 同款)
 * - 一个 thought 最多一条 outgoing thoughtOf 边(anchor null = 无边 = unanchored)
 * - 一个 thought 最多一条 outgoing inFolder 边
 *
 * 单步原子约定(v0.2/v0.5 §5.3 #1 收口):createThought 一次事务建 atom + 视 info.anchor 建边。
 */

import { storage } from '@storage/index';
import type { AtomEntity, PmPayload } from '@semantic/types';
import type {
  ThoughtInfo,
  ThoughtAnchor,
  ThoughtSource,
} from '@shared/ipc/thought-types';
import { wrapThoughtDoc, unwrapThoughtDoc, emptyThoughtDoc } from './envelope';

const THOUGHT_DOMAIN = 'thought';
const THOUGHT_OF_PREDICATE = 'user:krig:thoughtOf';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';

// ── 内部:atom + 边 → ThoughtInfo 拼装 ──

function atomToThoughtInfo(
  atom: AtomEntity<'thought'>,
  anchor: ThoughtAnchor | null,
  folderId: string | null,
): ThoughtInfo {
  const p = atom.payload.payload;
  return {
    id: atom.id,
    type: p.type,
    resolved: p.resolved,
    pinned: p.pinned,
    serviceId: p.serviceId,
    thumbnail: p.thumbnail,
    doc: wrapThoughtDoc(p.doc),
    folderId,
    anchor,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
}

async function getAnchorForThought(thoughtId: string): Promise<ThoughtAnchor | null> {
  const edges = await storage.listEdges({
    predicate: THOUGHT_OF_PREDICATE,
    subjectAtomId: thoughtId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const e = edges[0];
  if (e.object.kind !== 'atom') return null;
  const source = e.attrs.source;
  const locator = e.attrs.locator;
  // 防御:attrs 缺字段(理论不应发生 — create 路径必填)
  if (source !== 'note' && source !== 'book' && source !== 'graph' && source !== 'canvas') {
    return null;
  }
  if (!locator || typeof locator !== 'object') return null;
  return {
    source,
    resourceId: e.object.atomId,
    locator,
  } as ThoughtAnchor;
}

async function getFolderIdForThought(thoughtId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomId: thoughtId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  return obj.kind === 'atom' ? obj.atomId : null;
}

// ── 公开 API ──

export async function createThought(
  info: Omit<ThoughtInfo, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ThoughtInfo> {
  const pmDoc: PmPayload = info.doc
    ? unwrapThoughtDoc(info.doc)
    : unwrapThoughtDoc(emptyThoughtDoc());

  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'thought'>({
      payload: {
        domain: THOUGHT_DOMAIN,
        payload: {
          type: info.type,
          resolved: info.resolved,
          pinned: info.pinned,
          serviceId: info.serviceId,
          thumbnail: info.thumbnail,
          doc: pmDoc,
        },
      },
    });
    const now = Date.now();
    // 视 anchor 建 thoughtOf 边(单步原子 — §5.3 #1 收口)
    if (info.anchor !== null) {
      await tx.putEdge({
        predicate: THOUGHT_OF_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: info.anchor.resourceId },
        attrs: {
          createdBy: 'user-default',
          createdAt: now,
          source: info.anchor.source,
          locator: info.anchor.locator,
        },
      });
    }
    // 视 folderId 建 inFolder 边
    if (info.folderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: info.folderId },
        attrs: { createdBy: 'user-default', createdAt: now },
      });
    }
    return atomToThoughtInfo(atom, info.anchor, info.folderId);
  });
}

export async function listThoughts(): Promise<ThoughtInfo[]> {
  const atoms = (await storage.listAtoms({ domain: THOUGHT_DOMAIN })) as AtomEntity<'thought'>[];
  if (atoms.length === 0) return [];

  // 一次性查所有 thoughtOf + inFolder 边,按 subject 索引
  const thoughtOfEdges = await storage.listEdges({ predicate: THOUGHT_OF_PREDICATE });
  const anchorBySubject = new Map<string, ThoughtAnchor>();
  for (const e of thoughtOfEdges) {
    if (e.object.kind !== 'atom') continue;
    const source = e.attrs.source;
    const locator = e.attrs.locator;
    if (
      (source === 'note' || source === 'book' || source === 'graph' || source === 'canvas') &&
      locator &&
      typeof locator === 'object'
    ) {
      anchorBySubject.set(e.subject.atomId, {
        source,
        resourceId: e.object.atomId,
        locator,
      } as ThoughtAnchor);
    }
  }
  const folderEdges = await storage.listEdges({ predicate: IN_FOLDER_PREDICATE });
  const folderBySubject = new Map<string, string>();
  for (const e of folderEdges) {
    if (e.object.kind === 'atom') {
      folderBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }
  return atoms.map((a) =>
    atomToThoughtInfo(
      a,
      anchorBySubject.get(a.id) ?? null,
      folderBySubject.get(a.id) ?? null,
    ),
  );
}

export async function listThoughtsBySource(
  source: ThoughtSource,
  resourceId: string,
): Promise<ThoughtInfo[]> {
  // 走 thoughtOf 边,过 object=resourceId + attrs.source=source
  const edges = await storage.listEdges({
    predicate: THOUGHT_OF_PREDICATE,
    objectAtomId: resourceId,
  });
  const thoughtIds: string[] = [];
  for (const e of edges) {
    if (e.attrs.source === source && e.subject.kind === 'atom') {
      thoughtIds.push(e.subject.atomId);
    }
  }
  if (thoughtIds.length === 0) return [];
  const results: ThoughtInfo[] = [];
  for (const id of thoughtIds) {
    const info = await getThought(id);
    if (info) results.push(info);
  }
  return results;
}

export async function getThought(id: string): Promise<ThoughtInfo | null> {
  const atom = await storage.getAtom<'thought'>(id);
  if (!atom) return null;
  if (atom.payload.domain !== THOUGHT_DOMAIN) return null;
  const [anchor, folderId] = await Promise.all([
    getAnchorForThought(id),
    getFolderIdForThought(id),
  ]);
  return atomToThoughtInfo(atom, anchor, folderId);
}

export async function updateThought(
  id: string,
  updates: Partial<
    Pick<
      ThoughtInfo,
      'doc' | 'type' | 'resolved' | 'pinned' | 'thumbnail' | 'serviceId'
    >
  >,
): Promise<ThoughtInfo | null> {
  const existing = await storage.getAtom<'thought'>(id);
  if (!existing) return null;
  if (existing.payload.domain !== THOUGHT_DOMAIN) return null;
  const cur = existing.payload.payload;
  const nextDoc: PmPayload = updates.doc ? unwrapThoughtDoc(updates.doc) : cur.doc;
  const atom = await storage.putAtom<'thought'>({
    id,
    payload: {
      domain: THOUGHT_DOMAIN,
      payload: {
        type: updates.type ?? cur.type,
        resolved: updates.resolved ?? cur.resolved,
        pinned: updates.pinned ?? cur.pinned,
        serviceId: 'serviceId' in updates ? updates.serviceId : cur.serviceId,
        thumbnail: 'thumbnail' in updates ? updates.thumbnail : cur.thumbnail,
        doc: nextDoc,
      },
    },
  });
  const [anchor, folderId] = await Promise.all([
    getAnchorForThought(id),
    getFolderIdForThought(id),
  ]);
  return atomToThoughtInfo(atom, anchor, folderId);
}

export async function deleteThought(id: string): Promise<void> {
  // storage.deleteAtom 应用层级联删 atom + 所有相关边(thoughtOf + inFolder 都是
  // subject=该 atom,会被级联删)
  await storage.deleteAtom(id);
}

export async function moveThoughtToFolder(
  thoughtId: string,
  newFolderId: string | null,
): Promise<void> {
  await storage.transaction(async (tx) => {
    const oldEdges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      subjectAtomId: thoughtId,
    });
    for (const e of oldEdges) {
      await tx.deleteEdge(e.id);
    }
    if (newFolderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: thoughtId },
        object: { kind: 'atom', atomId: newFolderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
  });
}

/**
 * 改/解 anchor — 改 source/resourceId/locator 都走这个 API。
 * anchor=null 显式解依附(dangling-anchor → unanchored,v0.5 §8.3 两态)。
 */
export async function updateThoughtAnchor(
  thoughtId: string,
  anchor: ThoughtAnchor | null,
): Promise<void> {
  await storage.transaction(async (tx) => {
    // 删旧 thoughtOf 边(0 或 1 条 — cardinality 一对一)
    const oldEdges = await storage.listEdges({
      predicate: THOUGHT_OF_PREDICATE,
      subjectAtomId: thoughtId,
    });
    for (const e of oldEdges) {
      await tx.deleteEdge(e.id);
    }
    if (anchor !== null) {
      await tx.putEdge({
        predicate: THOUGHT_OF_PREDICATE,
        subject: { kind: 'atom', atomId: thoughtId },
        object: { kind: 'atom', atomId: anchor.resourceId },
        attrs: {
          createdBy: 'user-default',
          createdAt: Date.now(),
          source: anchor.source,
          locator: anchor.locator,
        },
      });
    }
  });
}
