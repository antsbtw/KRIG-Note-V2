/**
 * build-code-syntax-highlight-plugin — codeBlock inline 语法高亮(Phase 2)
 *
 * 设计:
 * - 全局 PM Plugin,扫 doc 所有 codeBlock 节点;filter language 在 capability 已注册
 *   且 !== 'mermaid'(mermaid 走自己的 NodeView preview,不参与本 plugin)
 * - 走 `requireCapabilityApi('code-editing').tokenizeSync(lang, text)` 拿 token list,
 *   产 `Decoration.inline(from, to, { class: 'krig-code-syntax-token--<tag>' })`
 * - 首次遇到某 lang 未 load:跳过本次(无高亮渲染),触发 ensureLanguageLoaded;
 *   resolve 后通过模块级 listener 让所有活跃 PM view dispatch meta 重算
 *
 * 装载位置:editor-view-builder.ts plugins 链(opt-out 模式,canvas-text-node 关)。
 *
 * 性能:
 * - state apply 内 docChanged 触发全 doc 重算 — token build 在 LanguageSupport 路径
 *   是 O(n) Lezer parse;500 行 codeBlock 实测 < 5ms
 * - 没有跨 transaction 的增量优化(Phase 2 不做);若实际卡顿再上 mapping diff
 *
 * 兼容点:
 * - vocab-highlight plugin 同期注册,各自走独立 Decoration 通道,不冲突
 * - PM `code: true` 节点不应用 inline marks,但 Decoration.inline 走 view 层独立 span
 *   包裹,不被 schema 拦截
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi } from '@capabilities/code-editing/types';

export const codeSyntaxHighlightPluginKey =
  new PluginKey<CodeSyntaxHighlightState>('codeSyntaxHighlight');

interface CodeSyntaxHighlightState {
  decos: DecorationSet;
}

// ─── 触发重算的回调表(语言异步 load 完成后 fire)──────────
//
// 模块级 listener 集合:某个 lang 首次 ensureLanguageLoaded resolve 后,
// 通过 fireLanguageReady(lang) 通知所有活跃 PM view 重新 dispatch 一次,
// 触发本 plugin 的 state apply 重算(此时 tokenizeSync 已能返回 token)。

type ReadyListener = (language: string) => void;
const readyListeners: Set<ReadyListener> = new Set();
const loadingLangs: Set<string> = new Set();

function fireLanguageReady(language: string): void {
  readyListeners.forEach((l) => l(language));
}

/** plugin view 内挂监听器,plugin destroy 时摘 — 见 plugin view 工厂 */
function addReadyListener(l: ReadyListener): () => void {
  readyListeners.add(l);
  return () => {
    readyListeners.delete(l);
  };
}

/** 触发某 language 异步预热(已 loading 或已 loaded 都直接跳出) */
function kickoffLoad(api: CodeEditingApi, language: string): void {
  if (loadingLangs.has(language)) return;
  if (api.isLanguageLoaded(language)) return;
  loadingLangs.add(language);
  void api.ensureLanguageLoaded(language).finally(() => {
    loadingLangs.delete(language);
    if (api.isLanguageLoaded(language)) fireLanguageReady(language);
  });
}

// ─── Decorations 构建 ────────────────────────────────────

function buildDecorations(doc: PMNode, api: CodeEditingApi): DecorationSet {
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    const lang = node.attrs.language as string;
    if (!lang) return;            // plain text 不高亮
    if (lang === 'mermaid') return; // mermaid 自管 preview,不参与本 plugin

    if (!api.isLanguageLoaded(lang)) {
      // 异步预热;resolve 后 fireLanguageReady → plugin view 监听者 dispatch
      kickoffLoad(api, lang);
      return;
    }

    const source = node.textContent;
    if (!source) return;

    const tokens = api.tokenizeSync(lang, source);
    if (tokens.length === 0) return;

    // codeBlock 内文本节点起点 = pos + 1(node 自身 open tag 占 1)
    const contentStart = pos + 1;
    for (const t of tokens) {
      decos.push(
        Decoration.inline(contentStart + t.from, contentStart + t.to, {
          class: `krig-code-syntax-token--${t.tag}`,
        }),
      );
    }
  });

  return decos.length > 0
    ? DecorationSet.create(doc, decos)
    : DecorationSet.empty;
}

// ─── Plugin ──────────────────────────────────────────────

export function buildCodeSyntaxHighlightPlugin(): Plugin {
  // 在 plugin 内部 closure 拿 capability api(模块加载时即可,plugin build 阶段已注册过)
  const api = requireCapabilityApi<CodeEditingApi>('code-editing');

  return new Plugin<CodeSyntaxHighlightState>({
    key: codeSyntaxHighlightPluginKey,

    state: {
      init(_config, instance): CodeSyntaxHighlightState {
        return { decos: buildDecorations(instance.doc, api) };
      },

      apply(tr, value, _oldState, newState): CodeSyntaxHighlightState {
        // language ready meta:某个 lang 异步 load 完成后,fireLanguageReady 通过
        // plugin view 监听器把 meta 塞进 tr,这里检测到后强制重算
        const readyMeta = tr.getMeta(codeSyntaxHighlightPluginKey) as
          | { kind: 'language-ready' }
          | undefined;
        if (readyMeta) {
          return { decos: buildDecorations(newState.doc, api) };
        }
        if (tr.docChanged) {
          return { decos: buildDecorations(newState.doc, api) };
        }
        return value;
      },
    },

    props: {
      decorations(state) {
        return codeSyntaxHighlightPluginKey.getState(state)?.decos;
      },
    },

    view(editorView) {
      // 监听异步 lang load 完成 — resolve 后 dispatch meta 触发重算
      const detach = addReadyListener(() => {
        if (editorView.isDestroyed) return;
        const tr = editorView.state.tr.setMeta(codeSyntaxHighlightPluginKey, {
          kind: 'language-ready',
        });
        editorView.dispatch(tr);
      });
      return {
        destroy() {
          detach();
        },
      };
    },
  });
}
