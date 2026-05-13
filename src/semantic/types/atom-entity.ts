import type { Atom, AtomDomain } from './atom';

/**
 * V2 atom 实体壳
 * 详 docs/RefactorV2/data-model/persistence/atom-entity.md §1
 *
 * hasBeenReferenced (decision 014 §3.7 引入,sub-phase 3a-1):
 * - 单向 flag,DEFAULT false,被第 2+ 条 hasContent 边引用时置 true (永不复位)
 * - optional 字段,sub-phase 1 旧数据无此字段 — normalizer 用 `?? false` 兜底
 * - 适用所有 atom,但目前只有 pm 会被多引用 (sub-phase 3a-1 单引用约束下恒 false)
 */
export interface AtomEntity<D extends AtomDomain = AtomDomain> {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  payload: Atom<D>;
  hasBeenReferenced?: boolean;
}
