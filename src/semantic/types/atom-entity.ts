import type { Atom, AtomDomain } from './atom';

/**
 * V2 atom 实体壳
 * 详 docs/RefactorV2/data-model/persistence/atom-entity.md §1
 */
export interface AtomEntity<D extends AtomDomain = AtomDomain> {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  payload: Atom<D>;
}
