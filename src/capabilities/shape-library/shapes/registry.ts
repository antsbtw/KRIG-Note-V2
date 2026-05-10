/**
 * ShapeRegistry — 全系统共享的 shape 资源注册表(L5-G2)
 *
 * V1 直迁:src/plugins/graph/library/shapes/registry.ts(66 行)
 * 改动:
 * - import 路径改 ../types(V2 同 capability 内)
 * - 拆 bootstrap 到独立文件(shapes/bootstrap.ts;V1 嵌在类里)— G2-8=B side-effect
 *   import 触发,这里类内不再放 bootstrap 函数
 */

import type { ShapeDef, ShapeCategory, ShapePack } from '../types';

class ShapeRegistryImpl {
  private byId = new Map<string, ShapeDef>();

  register(def: ShapeDef): void {
    if (this.byId.has(def.id)) {
      console.warn(`[ShapeRegistry] duplicate id ignored: ${def.id}`);
      return;
    }
    this.byId.set(def.id, def);
  }

  registerPack(pack: ShapePack): void {
    for (const def of pack.shapes) this.register(def);
  }

  get(id: string): ShapeDef | null {
    return this.byId.get(id) ?? null;
  }

  list(): ShapeDef[] {
    return Array.from(this.byId.values());
  }

  listByCategory(category: ShapeCategory): ShapeDef[] {
    return this.list().filter((s) => s.category === category);
  }

  /** 仅供测试:重置 registry */
  _resetForTest(): void {
    this.byId.clear();
  }
}

export const ShapeRegistry = new ShapeRegistryImpl();
