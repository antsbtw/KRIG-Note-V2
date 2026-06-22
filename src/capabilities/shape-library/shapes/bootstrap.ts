/// <reference types="vite/client" />
/**
 * Shape bootstrap(L5-G2)— import.meta.glob 扫所有 shape JSON 注册到 ShapeRegistry
 *
 * V1 嵌在 ShapeRegistryImpl.bootstrap() 方法里(plugins/graph/library/shapes/registry.ts);
 * V2 拆出独立文件,index.ts 顶层 side-effect 直调 — 对齐 V2 ebook / learning 模式.
 *
 * L5-G6c 阶段 A:旧 22 个测试脚手架 def 已清空;目录扫描保留(无代码加载 —
 * 丢 JSON 进 definitions/ 即注册)。空库时 warn(fail loud,不静默兜底),
 * 画板照常加载 + Picker 空,阶段 C 才填首批 shape.
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
  let registered = 0;
  for (const path in modules) {
    const def = modules[path].default;
    if (!def || !def.id) {
      console.warn(`[shape-library] skipped malformed shape JSON: ${path}`);
      continue;
    }
    ShapeRegistry.register(def);
    registered++;
  }
  // 空库 fail loud(L5-G6c 阶段 A 末态:库已清空,正常现象,但显式 warn 不静默)
  if (registered === 0) {
    console.warn(
      '[shape-library] bootstrap: 0 shapes registered (空库)。'
        + 'L5-G6c 阶段 A 已清空旧 def,阶段 C 填首批;Picker 暂空属预期,非 bug。',
    );
  }
  bootstrapped = true;
}
