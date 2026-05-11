/**
 * SubstanceRegistry — 全系统共享的 substance 资源注册表(L5-G2)
 *
 * V1 直迁:src/plugins/graph/library/substances/registry.ts(63 行).
 * V2 改动:
 * - import 路径改 ../types
 * - 拆 bootstrap 到独立文件(substances/bootstrap.ts)— G2-8=B 模式
 *
 * v1 只管"内置 substance"的注册 / 查询;用户自创 substance 在 v1.5+ 接 note-store
 * (每个一篇 note,见 Library.md §7.2).
 */

import type { SubstanceDef, SubstancePack } from '../types';

class SubstanceRegistryImpl {
  private byId = new Map<string, SubstanceDef>();

  register(def: SubstanceDef): void {
    if (this.byId.has(def.id)) {
      console.warn(`[SubstanceRegistry] duplicate id ignored: ${def.id}`);
      return;
    }
    this.byId.set(def.id, def);
  }

  registerPack(pack: SubstancePack): void {
    for (const def of pack.substances) this.register(def);
  }

  get(id: string): SubstanceDef | null {
    return this.byId.get(id) ?? null;
  }

  list(): SubstanceDef[] {
    return Array.from(this.byId.values());
  }

  listByCategory(category: string): SubstanceDef[] {
    return this.list().filter((s) => s.category === category);
  }

  _resetForTest(): void {
    this.byId.clear();
  }
}

export const SubstanceRegistry = new SubstanceRegistryImpl();
