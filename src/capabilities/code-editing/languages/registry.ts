/**
 * 语言注册中心(模块单例)
 *
 * 业务方启动期通过 `requireCapabilityApi('code-editing').registerLanguage(...)`
 * 注册新语言;Phase 1 内置 6 个(见 register-builtin.ts):
 * mermaid + JavaScript + TypeScript + Python + JSON + Markdown
 */

import type { LanguageItem } from '../types';

const registry: Map<string, LanguageItem> = new Map();

export function registerLanguage(item: LanguageItem): void {
  if (registry.has(item.id)) {
    console.warn(`[code-editing] language '${item.id}' already registered, overwriting`);
  }
  registry.set(item.id, item);
}

export function getLanguage(id: string): LanguageItem | undefined {
  return registry.get(id);
}

export function getLanguages(): LanguageItem[] {
  return Array.from(registry.values());
}
