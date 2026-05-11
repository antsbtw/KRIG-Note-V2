/// <reference types="vite/client" />
/**
 * Shape bootstrap(L5-G2)— import.meta.glob 扫所有 shape JSON 注册到 ShapeRegistry
 *
 * V1 嵌在 ShapeRegistryImpl.bootstrap() 方法里(plugins/graph/library/shapes/registry.ts);
 * V2 拆出独立文件,index.ts 顶层 side-effect 直调 — 对齐 V2 ebook / learning 模式.
 *
 * 重复调用幂等(已 bootstrap 直接返回).
 */

import type { ShapeDef } from '../types';
import { ShapeRegistry } from './registry';

let bootstrapped = false;

export function bootstrapShapes(): void {
  if (bootstrapped) return;
  const modules = import.meta.glob<{ default: ShapeDef }>(
    './definitions/**/*.json',
    { eager: true },
  );
  for (const path in modules) {
    const def = modules[path].default;
    if (!def || !def.id) {
      console.warn(`[shape-library] skipped malformed shape JSON: ${path}`);
      continue;
    }
    ShapeRegistry.register(def);
  }
  bootstrapped = true;
}
