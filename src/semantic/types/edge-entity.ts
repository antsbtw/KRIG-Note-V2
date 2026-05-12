import type { Edge } from './edge';

/**
 * V2 edge 实体壳
 * 详 docs/RefactorV2/data-model/persistence/edge-entity.md §1
 */
export interface EdgeEntity extends Edge {
  id: string;
  createdAt: number;
  updatedAt: number;
}
