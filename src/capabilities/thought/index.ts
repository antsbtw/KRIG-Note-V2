/**
 * thought capability — renderer 端薄包装(横切思考层)
 *
 * 实施位置:src/platform/main/thought/(capability-impl + handlers)
 * 本文件:把 window.electronAPI.thoughtXxx 扁平驼峰 alias 成业务名(createThought / listThoughts / ...)
 *
 * 边界(thought-view-port.md v0.5 §7.1):
 * - view 业务路径走 requireCapabilityApi<ThoughtCapabilityApi>('thought')(W5 严格态 A 硬约束)
 * - W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import,
 *   跟 note / folder / ebook-library 同模式)
 *
 * 横切定位(charter §1.4 line 196):同一能力对所有 install 它的 view 完全一致;
 * 所有 view(note/ebook/graph/canvas)通过 install 'thought' 获得相同 API。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  ThoughtCapabilityApi,
  ThoughtInfo,
  ThoughtAnchor,
  ThoughtSource,
} from './types';

export type {
  ThoughtCapabilityApi,
  ThoughtInfo,
  ThoughtAnchor,
  ThoughtSource,
  ThoughtType,
  NoteLocator,
  BookLocator,
  GraphLocator,
  CanvasLocator,
} from './types';

async function createThought(
  info: Omit<ThoughtInfo, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ThoughtInfo> {
  return window.electronAPI.thoughtCreate(info);
}

async function listThoughts(): Promise<ThoughtInfo[]> {
  return window.electronAPI.thoughtList();
}

async function listThoughtsBySource(
  source: ThoughtSource,
  resourceId: string,
): Promise<ThoughtInfo[]> {
  return window.electronAPI.thoughtListBySource(source, resourceId);
}

async function getThought(id: string): Promise<ThoughtInfo | null> {
  return window.electronAPI.thoughtGet(id);
}

async function updateThought(
  id: string,
  updates: Partial<
    Pick<
      ThoughtInfo,
      'doc' | 'type' | 'resolved' | 'pinned' | 'color' | 'thumbnail' | 'serviceId'
    >
  >,
): Promise<ThoughtInfo | null> {
  return window.electronAPI.thoughtUpdate(id, updates);
}

async function deleteThought(id: string): Promise<void> {
  return window.electronAPI.thoughtDelete(id);
}

async function moveThoughtToFolder(
  thoughtId: string,
  folderId: string | null,
): Promise<void> {
  return window.electronAPI.thoughtMoveToFolder(thoughtId, folderId);
}

async function updateThoughtAnchor(
  thoughtId: string,
  anchor: ThoughtAnchor | null,
): Promise<void> {
  return window.electronAPI.thoughtUpdateAnchor(thoughtId, anchor);
}

function onListChanged(callback: (list: ThoughtInfo[]) => void): () => void {
  return window.electronAPI.onThoughtListChanged(callback);
}

export const thoughtCapability: ThoughtCapabilityApi = {
  createThought,
  listThoughts,
  listThoughtsBySource,
  getThought,
  updateThought,
  deleteThought,
  moveThoughtToFolder,
  updateThoughtAnchor,
  onListChanged,
};

// W5 严格态:Registry 注册 — view 通过 requireCapabilityApi<ThoughtCapabilityApi>('thought')
capabilityRegistry.register({
  id: 'thought',
  api: thoughtCapability,
});
