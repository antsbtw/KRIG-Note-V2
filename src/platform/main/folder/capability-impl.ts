/**
 * folder capability — main 端实施 (decision 012 §3.4 §4.3 方案 A)
 *
 * 边界:
 * - main 进程独占,直接 import @storage (合规:capability 层调 storage)
 * - renderer 通过 IPC 桥接到本文件 (src/capabilities/folder/index.ts 薄包装)
 *
 * 实施要点 (decision 012 §3.1 §3.3):
 * - atom domain = 'folder',payload = FolderPayload { title: string }
 * - folder 嵌套用 user:krig:inFolder 边表达 (不存 parentId 字段)
 * - 一个 folder 最多一条 outgoing inFolder 边 (cardinality 一对一,根级无边)
 * - moveFolder = transaction(删旧 inFolder + 加新 inFolder)
 * - deleteFolder = storage.deleteAtom (sub-phase 1 storage 已应用层级联删除关联 edges)
 */

import { storage } from '@storage/index';
import type { StorageTransaction } from '@storage/index';
import type { AtomEntity, FolderPayload } from '@semantic/types';
import type { FolderInfo } from '@shared/ipc/note-folder-types';
import type { FolderViewType } from '@capabilities/folder/types';

const FOLDER_DOMAIN = 'folder';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';
const FOLDER_FOR_VIEW_PREDICATE = 'user:krig:folderForView';

function viewMarkerFor(viewType: FolderViewType): string {
  return `__view__/${viewType}`;
}

function atomToFolderInfo(
  atom: AtomEntity<'folder'>,
  parentId: string | null,
): FolderInfo {
  const payload = atom.payload.payload;
  return {
    id: atom.id,
    title: payload.title ?? '',
    parentId,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
}

async function getParentIdForFolder(folderId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomId: folderId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  return obj.kind === 'atom' ? obj.atomId : null;
}

export async function createFolder(
  title: string,
  parentFolderId: string | null,
  viewType: FolderViewType,
): Promise<FolderInfo> {
  const payload: FolderPayload = { title };
  const viewMarker = viewMarkerFor(viewType);
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'folder'>({
      payload: { domain: FOLDER_DOMAIN, payload },
    });
    // decision 021 §4.1: folderForView 边表达 view 归属
    // LiteralValue 字面三字段 { kind, type, value } 缺一不可 (决议 §0.7 第 15 次教训)
    await tx.putEdge({
      predicate: FOLDER_FOR_VIEW_PREDICATE,
      subject: { kind: 'atom', atomId: atom.id },
      object: { kind: 'literal', type: 'string', value: viewMarker },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    if (parentFolderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: parentFolderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
    return atomToFolderInfo(atom, parentFolderId);
  });
}

export async function listFolders(viewType: FolderViewType): Promise<FolderInfo[]> {
  // decision 021 §4.1: 应用层 filter folderForView 边的 object literal value
  // EdgeFilter 字面不支持 objectLiteralValue (§0.4 #8),只能拉全 predicate 后应用层 filter
  const viewMarker = viewMarkerFor(viewType);
  const allViewEdges = await storage.listEdges({
    predicate: FOLDER_FOR_VIEW_PREDICATE,
  });
  const folderIdsInView = new Set(
    allViewEdges
      .filter(
        (e) =>
          e.object.kind === 'literal' &&
          e.object.type === 'string' &&
          e.object.value === viewMarker,
      )
      .map((e) => e.subject.atomId),
  );

  const atoms = (await storage.listAtoms({ domain: FOLDER_DOMAIN })) as AtomEntity<'folder'>[];
  const inViewAtoms = atoms.filter((a) => folderIdsInView.has(a.id));

  // 一次性查所有 inFolder 边,按 subject 索引 (语义不变,沿决议 012)
  const edges = await storage.listEdges({ predicate: IN_FOLDER_PREDICATE });
  const parentBySubject = new Map<string, string>();
  for (const e of edges) {
    if (e.object.kind === 'atom') {
      parentBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }
  return inViewAtoms.map((a) => atomToFolderInfo(a, parentBySubject.get(a.id) ?? null));
}

export async function getFolder(id: string): Promise<FolderInfo | null> {
  const atom = await storage.getAtom<'folder'>(id);
  if (!atom) return null;
  // 防御:确认是 folder domain (storage 不强制按 domain 过滤 getAtom)
  if (atom.payload.domain !== FOLDER_DOMAIN) return null;
  const parentId = await getParentIdForFolder(id);
  return atomToFolderInfo(atom, parentId);
}

export async function renameFolder(id: string, newTitle: string): Promise<FolderInfo> {
  const existing = await storage.getAtom<'folder'>(id);
  if (!existing) throw new Error(`Folder ${id} not found`);
  if (existing.payload.domain !== FOLDER_DOMAIN) {
    throw new Error(`Atom ${id} is not a folder (domain=${existing.payload.domain})`);
  }
  const updated = await storage.putAtom<'folder'>({
    id,
    payload: { domain: FOLDER_DOMAIN, payload: { title: newTitle } },
  });
  const parentId = await getParentIdForFolder(id);
  return atomToFolderInfo(updated, parentId);
}

export async function moveFolder(
  folderId: string,
  newParentFolderId: string | null,
): Promise<void> {
  await storage.transaction(async (tx) => {
    // 删旧 inFolder 边 (subject=folderId 的全部 inFolder 边,正常只有 0 或 1 条)
    const oldEdges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      subjectAtomId: folderId,
    });
    for (const e of oldEdges) {
      await tx.deleteEdge(e.id);
    }
    if (newParentFolderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: folderId },
        object: { kind: 'atom', atomId: newParentFolderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
  });
}

/**
 * 删 folder + 递归子 folder + 内含笔记 (Path Y 契约,对齐 macOS Finder)
 *
 * 业务契约变更 (decision 012 设计师批复 Path Y):
 * V1/V2 现状: 删 folder = 删 folder + 子 folder; 笔记移到根级
 * Path Y    : 删 folder = 删 folder + 子 folder + 内含笔记 (一棵子树全删)
 *
 * 实施:用 storage.transaction 包整段,任何子操作失败则整棵子树回滚。
 *
 * ⚠ 风险登记:误删 folder = 丢笔记。配套保护 (删除前弹窗 + 回收站) 留 sub-phase 3+
 *   单独 decision (decision 012 §8 Q7)。
 */
/**
 * Path Y cascade (decision 012 Path Y + decision 014 §3.5.3 graph-canvas 加入白名单).
 *
 * sub-phase 3a-1 (decision 014 §6.2.6 + §3.5.3.3) 把 cascade scope 从仅 'pm' 扩展到
 * ['pm', 'graph-canvas'] — 实现"删 folder 递归删子 folder + 内含 note + 内含 graph-canvas"。
 *
 * 未来 sub-phase 3b ebook 接入时,白名单可继续扩展到 ['pm', 'graph-canvas', 'ebook']。
 *
 * 字段命名 deletedNotes → deletedResources 反映 scope 扩展;
 * 无 caller 真实消费 deletedNotes 字段名 (grep 仅声明位置)。
 */
/**
 * Q7 弱保护 dry-run 计数 (decision 021 §5.5 + §10.B-3).
 *
 * 事务内 BFS collectFolderSubtree + collectResourcesInFolders 同模式(decision 020 §7.5),
 * 仅计数不删除. UI 调用本 API 后,resources > 0 || folders > 0 时弹框确认.
 *
 * folders 字段返"子 folder 数"(不含 self),resources 字段返"含 self 在内的所有 folder 内含资源数".
 */
export async function previewDeleteFolder(
  id: string,
): Promise<{ folders: number; resources: number }> {
  return storage.transaction(async (tx) => {
    const allFolderIds = await collectFolderSubtree(tx, id);
    const allResourceIds = await collectResourcesInFolders(tx, allFolderIds);
    return {
      // allFolderIds 含 self,UI 文案"包含 N 个子文件夹"减 self
      folders: Math.max(0, allFolderIds.length - 1),
      resources: allResourceIds.length,
    };
  });
}

export async function deleteFolder(id: string): Promise<{
  deletedFolders: number;
  deletedResources: number;
  cascadedEdges: number;
}> {
  return storage.transaction(async (tx) => {
    // 1. 递归收集所有 descendants (含 self)
    const allFolderIds = await collectFolderSubtree(tx, id);

    // 2. 收集所有 inFolder 这些 folder 的资源 (pm note + graph-canvas + future 扩展)
    const allResourceIds = await collectResourcesInFolders(tx, allFolderIds);

    // 3. 一并删除 (storage.deleteAtom 应用层 cascade 自动删关联 edges)
    let cascadedEdges = 0;
    for (const resourceId of allResourceIds) {
      const res = await tx.deleteAtom(resourceId);
      cascadedEdges += res.cascadedEdges;
    }
    for (const folderId of allFolderIds) {
      const res = await tx.deleteAtom(folderId);
      cascadedEdges += res.cascadedEdges;
    }

    return {
      deletedFolders: allFolderIds.length,
      deletedResources: allResourceIds.length,
      cascadedEdges,
    };
  });
}

/** BFS 收集 descendant folder ids (含 self) */
async function collectFolderSubtree(
  tx: StorageTransaction,
  rootFolderId: string,
): Promise<string[]> {
  const result: string[] = [rootFolderId];
  const queue: string[] = [rootFolderId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    // 查所有 inFolder current 且 subject 是 folder atom 的边
    // 注:tx 不暴露 listEdges,走外部 storage.listEdges (同事务 db connection)
    const childEdges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      objectAtomId: current,
    });
    for (const e of childEdges) {
      if (e.subject.kind !== 'atom') continue;
      const childAtom = await tx.getAtom(e.subject.atomId);
      if (childAtom?.payload.domain === FOLDER_DOMAIN) {
        result.push(e.subject.atomId);
        queue.push(e.subject.atomId);
      }
    }
  }
  return result;
}

/**
 * 收集 folder ids 集合中所有内含资源 (pm note + graph-canvas + future 扩展)。
 *
 * Path Y cascade 白名单 (decision 014 §3.5.3 + 5.6.bis 扩展):
 * - 'pm' — sub-phase 2 note
 * - 'graph-canvas' — sub-phase 3a-1 画板
 * - 未来 sub-phase 3b ebook 接入时可扩展加 'ebook'
 *
 * 字面约束 (主对话批 A):本函数只扩展 cascade scope,不改 deleteFolder 对外语义
 * (仍是 Path Y "删 folder + 所有 descendants + 所有内含资源")。
 */
const CASCADE_RESOURCE_DOMAINS = new Set(['pm', 'graph-canvas']);

async function collectResourcesInFolders(
  tx: StorageTransaction,
  folderIds: string[],
): Promise<string[]> {
  const resourceIds: string[] = [];
  for (const folderId of folderIds) {
    const edges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      objectAtomId: folderId,
    });
    for (const e of edges) {
      if (e.subject.kind !== 'atom') continue;
      const subjAtom = await tx.getAtom(e.subject.atomId);
      const domain = subjAtom?.payload.domain ?? '';
      if (CASCADE_RESOURCE_DOMAINS.has(domain)) {
        resourceIds.push(e.subject.atomId);
      }
    }
  }
  return resourceIds;
}
