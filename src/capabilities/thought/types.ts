/**
 * thought capability — 对外类型(横切思考层)
 *
 * view 通过 requireCapabilityApi<ThoughtCapabilityApi>('thought') 取 api;
 * driver/slot 内部消费可直 import 模块级 export(对齐 W5 严格态 A 边界 — 与 note / folder 同模式)。
 */

import type {
  ThoughtInfo,
  ThoughtAnchor,
  ThoughtSource,
  ThoughtType,
  NoteLocator,
  BookLocator,
  GraphLocator,
  CanvasLocator,
} from '@shared/ipc/thought-types';

export type {
  ThoughtInfo,
  ThoughtAnchor,
  ThoughtSource,
  ThoughtType,
  NoteLocator,
  BookLocator,
  GraphLocator,
  CanvasLocator,
};

export interface ThoughtCapabilityApi {
  /** #1 单步原子:建 atom;若 info.anchor != null 同事务内建 thoughtOf 边 */
  createThought(
    info: Omit<ThoughtInfo, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ThoughtInfo>;
  /** #2 全量(Thought View 主舞台用) */
  listThoughts(): Promise<ThoughtInfo[]>;
  /** #3 按 source 资源过滤(NoteView/EBookView 右槽用) */
  listThoughtsBySource(source: ThoughtSource, resourceId: string): Promise<ThoughtInfo[]>;
  /** #4 单条查询 */
  getThought(id: string): Promise<ThoughtInfo | null>;
  /** #5 改 payload 字段(doc/type/resolved/pinned/thumbnail/serviceId)*/
  updateThought(
    id: string,
    updates: Partial<
      Pick<
        ThoughtInfo,
        'doc' | 'type' | 'resolved' | 'pinned' | 'thumbnail' | 'serviceId'
      >
    >,
  ): Promise<ThoughtInfo | null>;
  /** #6 级联删 atom + 所有 thoughtOf/inFolder 边 */
  deleteThought(id: string): Promise<void>;
  /** #7 NavSide Thought tab 拖拽到 folder */
  moveThoughtToFolder(thoughtId: string, folderId: string | null): Promise<void>;
  /**
   * #8 改/解 anchor(Note 撤销 mark / 显式 unanchor 等);
   * anchor=null 显式解依附(v0.5 §8.3 dangling-anchor → unanchored 状态转换)。
   */
  updateThoughtAnchor(thoughtId: string, anchor: ThoughtAnchor | null): Promise<void>;
  /** 订阅 thought 列表变更(IPC 广播);返 unsubscribe */
  onListChanged(callback: (list: ThoughtInfo[]) => void): () => void;
}
