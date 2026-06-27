/**
 * code-editing capability — 对外类型(Phase 1A)
 *
 * 单点屏障核心:**本 capability 是 V2 唯一允许 import @codemirror/* 和
 * @lezer/* 的位置**。其他 view / driver / capability 通过
 * `requireCapabilityApi<CodeEditingApi>('code-editing')` 拿 Host + 语言注册 API。
 *
 * 设计对齐参考:capabilities/canvas-rendering/types.ts(命令式 Handle + Host props 模式)
 * 详见 docs/tasks/cm6-elk-capability-refactor.md §Task A。
 *
 * **本文件 0 import @codemirror/***(types.ts 只暴露与 SDK 无关的契约,
 * 实际 SDK 类型在 host/CodeHost.tsx 内消费;LanguageItem.loader 返回值
 * 用 `unknown` 让消费方无需 import SDK 类型)。
 */

import type { ComponentType } from 'react';

// ─────────────────────────────────────────────────────────
// Host
// ─────────────────────────────────────────────────────────

export interface CodeEditingHostProps {
  /** 初始种子内容 — mount 后变化不重建 editor,改 doc 走 setValue 命令 */
  initialValue: string;
  /** 已注册语言 id;undefined = 纯文本 */
  language?: string;
  /** 主题(Phase 1 仅 dark 实现,light 留接口) */
  theme?: 'dark' | 'light';
  /** 用户输入触发;父级负责防抖 */
  onChange?: (value: string) => void;
  /** mount 完成后回调,父级拿 imperative API */
  onMount?: (handle: CodeEditingHandle) => void;
  /** 只读模式;默认 false */
  readOnly?: boolean;
  /** 扩展配置(可选,默认全开) */
  features?: {
    lineNumbers?: boolean;
    tabIndent?: boolean;
    defaultKeymap?: boolean;
    lineWrap?: boolean;
  };
}

export interface CodeEditingHandle {
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
}

// ─────────────────────────────────────────────────────────
// Language 注册(业务方可贡献新语言;Phase 1 内置 6 个)
// ─────────────────────────────────────────────────────────

/**
 * loader 返回的实际类型是 CodeMirror 6 的 `LanguageSupport`
 * 或 `StreamLanguage<unknown>`;types.ts 不 import @codemirror/* 故用 unknown 抽象。
 *
 * Host 内部把 loader 结果直接塞入 CM6 extensions 数组,运行时由 CM6 校验。
 */
export interface LanguageItem {
  id: string;
  label: string;
  loader: () => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────
// Tokenize API(供 inline syntax highlight plugin 消费)
// ─────────────────────────────────────────────────────────

/**
 * 一段 source 切出的语法 token;driver 拿到后转 PM Decoration.inline。
 *
 * tag 归一为 8 类字符串:keyword / comment / string / number / operator /
 * variableName / attributeName / punctuation(对齐 capability/theme-dark.ts 配色)。
 */
export interface TokenSpan {
  from: number;
  to: number;
  tag: string;
}

// ─────────────────────────────────────────────────────────
// Registry API(view 通过 requireCapabilityApi 拿)
// ─────────────────────────────────────────────────────────

export interface CodeEditingApi {
  Host: ComponentType<CodeEditingHostProps>;
  registerLanguage(item: LanguageItem): void;
  getLanguages(): LanguageItem[];
  getLanguage(id: string): LanguageItem | undefined;
  /** 异步预热语言 loader(plugin init / lang 切换时调) */
  ensureLanguageLoaded(language: string): Promise<void>;
  /** 同步查询是否已加载(plugin state apply 内决定走同步还是异步路径) */
  isLanguageLoaded(language: string): boolean;
  /** 同步 tokenize — language 必须已 loaded;未 loaded 返回空数组 */
  tokenizeSync(language: string, source: string): TokenSpan[];
}
