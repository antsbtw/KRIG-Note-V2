/**
 * Folder adapter (decision 014 §3.5.3.3) — sub-phase 3a-1
 *
 * FolderInfo (sub-phase 2 folder atom) ↔ GraphFolderRecord (V2 graph IPC 契约) 字段映射 +
 * sort_order 生成 (sub-phase 2 folderCapability 未实施排序持久化)。
 *
 * 进程边界纪律 (decision 014 §3.5.3.3 + §0.2.5):
 * - 本文件在 main 进程,不可调 requireCapabilityApi (那是 renderer 路径)
 * - 不可调 window.electronAPI.folderXxx (那是 renderer → main IPC)
 * - 应当走 import { ... } from '@platform/main/folder' (同进程直调约定)
 *
 * 字段映射差异 (decision 014 §3.5.3.1):
 * - parentId (camelCase) ↔ parent_id (snake_case)
 * - createdAt ↔ created_at
 * - updatedAt 在 GraphFolderRecord 中不存在 → adapter 丢弃
 * - sort_order 在 FolderInfo 中不存在 → adapter 生成 (规则见 §3.5.3.4)
 */

import type { FolderInfo } from '@shared/ipc/note-folder-types';
import type { GraphFolderRecord } from './canvas-store';
// ⚠ main 侧同进程直调,不走 renderer capability registry
import {
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
} from '@platform/main/folder';

/** FolderInfo → GraphFolderRecord (graph IPC 契约保留 snake_case) */
function toGraphRecord(info: FolderInfo, sortOrder: number): GraphFolderRecord {
  return {
    id: info.id,
    title: info.title,
    parent_id: info.parentId,
    sort_order: sortOrder,
    created_at: info.createdAt,
  };
}

/**
 * sort_order 生成规则 (decision 014 §3.5.3.4):
 * - 按 parentId 分组
 * - 主排序键:createdAt 升序 (早创建的在前)
 * - tie-breaker:同毫秒 createdAt → id 字典序升序 (P2 稳定性约束)
 * - 序号 1..N
 *
 * 稳定性:同一组数据,不同运行 / 不同进程产生的 sort_order 结果一致
 * (ULID id 全局唯一 + 字典序确定)。
 */
function assignSortOrder(folders: FolderInfo[]): GraphFolderRecord[] {
  const byParent = new Map<string | null, FolderInfo[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  const result: GraphFolderRecord[] = [];
  for (const [, group] of byParent) {
    group.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    group.forEach((f, idx) => {
      result.push(toGraphRecord(f, idx + 1));
    });
  }
  return result;
}

export async function adapterFolderList(): Promise<GraphFolderRecord[]> {
  const list = await listFolders();
  return assignSortOrder(list);
}

/**
 * 决议 §3.5.3.3 P2 一致性约束:
 * 不用 siblings.length + 1 推算 sort_order (可能跟 list 时不一致),
 * 而是拉全量后跑同一套 assignSortOrder,取该 id 对应的 GraphFolderRecord 返回。
 *
 * sub-phase 2 createFolder 永不返 null (成功 = FolderInfo,失败 = throw);
 * 本 adapter try/catch 兜底,异常视为 null。
 */
export async function adapterFolderCreate(
  title: string,
  parentId: string | null,
): Promise<GraphFolderRecord | null> {
  try {
    const created = await createFolder(title, parentId);
    const all = await listFolders();
    const records = assignSortOrder(all);
    return records.find((r) => r.id === created.id) ?? null;
  } catch (err) {
    console.warn('[graph/folder-adapter] createFolder failed:', err);
    return null;
  }
}

export async function adapterFolderRename(id: string, title: string): Promise<void> {
  try {
    await renameFolder(id, title);
  } catch (err) {
    console.warn(`[graph/folder-adapter] renameFolder ${id} failed:`, err);
  }
}

/**
 * Path Y (sub-phase 2 deleteFolder + 5.6.bis cascade 扩展) —
 * 删 folder 递归删子 folder + 内含 note + 内含 graph-canvas。
 * cascade scope 在 5.6.bis 扩展到 graph-canvas (subjAtom.domain ∈ ['pm','graph-canvas'])。
 */
export async function adapterFolderDelete(id: string): Promise<void> {
  try {
    await deleteFolder(id);
  } catch (err) {
    console.warn(`[graph/folder-adapter] deleteFolder ${id} failed:`, err);
  }
}

export async function adapterFolderMove(
  id: string,
  newParentId: string | null,
): Promise<void> {
  try {
    await moveFolder(id, newParentId);
  } catch (err) {
    console.warn(`[graph/folder-adapter] moveFolder ${id} failed:`, err);
  }
}
