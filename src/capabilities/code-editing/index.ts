/**
 * code-editing capability — CodeMirror 6 单点屏障
 *
 * **本 capability 是 V2 唯一允许 import @codemirror/* 和 @lezer/* 的位置**
 * (对齐 canvas-rendering 的 Three.js 单点屏障模式,charter § 1.3 npm 屏障)。
 *
 * 其他位置(view / driver / 其他 capability / shell / workspace / slot)0 import
 * @codemirror/* / @lezer/*,通过 `requireCapabilityApi<CodeEditingApi>('code-editing')`
 * 拿 Host 组件 + registerLanguage / getLanguages API。
 *
 * ── 下游消费者(规划)──
 *
 * - drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidFullscreenPanel
 *   (Phase 2 切换;mermaid 全屏首个客户)
 * - 未来 inline code-block 走 Path 1(本 capability 落地后再起独立 PR)
 * - 未来其他需要"代码编辑器"的全屏 / 内嵌业务
 *
 * ── 设计文档 ──
 *
 * docs/tasks/cm6-elk-capability-refactor.md §Task A
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { CodeEditingApi } from './types';
import { CodeHost } from './host/CodeHost';
import {
  registerLanguage,
  getLanguage,
  getLanguages,
} from './languages/registry';
import { registerBuiltinLanguages } from './register-builtin';
import { ensureLanguageLoaded, isLanguageLoaded, tokenizeSync } from './tokenize';

export type {
  CodeEditingApi,
  CodeEditingHostProps,
  CodeEditingHandle,
  LanguageItem,
  TokenSpan,
} from './types';

// 模块级 export(对齐 shape-library / canvas-rendering 双导出模式 — driver/slot
// 内部可直 import 兜底;view 侧仍走 requireCapabilityApi)
export { CodeHost };
export { registerLanguage, getLanguage, getLanguages };
export { ensureLanguageLoaded, isLanguageLoaded, tokenizeSync };

// ── side-effect:注册 6 个内置语言(对齐 shape-library bootstrap 模式)──
registerBuiltinLanguages();

// ── 自我诊断 ──
console.info(
  `[code-editing] alive | languages: ${getLanguages().length}`,
);

// ── Registry 注册 ──
capabilityRegistry.register({
  id: 'code-editing',
  api: {
    Host: CodeHost,
    registerLanguage,
    getLanguages,
    getLanguage,
    ensureLanguageLoaded,
    isLanguageLoaded,
    tokenizeSync,
  } satisfies CodeEditingApi,
});
