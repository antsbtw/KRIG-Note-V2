/// <reference types="vite/client" />
/**
 * Substance bootstrap(L5-G2)— import.meta.glob 扫所有 substance JSON
 * 注册到 SubstanceRegistry.
 *
 * V1 嵌在 SubstanceRegistryImpl.bootstrap() 方法里;V2 拆出独立文件.
 *
 * 重复调用幂等.
 */

import type { SubstanceDef } from '../types';
import { SubstanceRegistry } from './registry';

let bootstrapped = false;

export function bootstrapSubstances(): void {
  if (bootstrapped) return;
  const modules = import.meta.glob<{ default: SubstanceDef }>(
    './definitions/**/*.json',
    { eager: true },
  );
  for (const path in modules) {
    const def = modules[path].default;
    if (!def || !def.id) {
      console.warn(`[shape-library] skipped malformed substance JSON: ${path}`);
      continue;
    }
    SubstanceRegistry.register(def);
  }
  bootstrapped = true;
}
