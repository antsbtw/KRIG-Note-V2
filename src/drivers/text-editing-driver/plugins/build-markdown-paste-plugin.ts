/**
 * markdown-paste plugin — 粘贴 markdown 文字自动变成块
 *
 * V1 有智能粘贴(docs/10-business-design/note/Paste-Module-Design.md),V2 重构时没迁
 * (v1-note-migration-audit.md §7「粘贴外部 markdown ❌」)。本插件只补 markdown 这一条:
 * 剪贴板是纯文字、且看起来像 markdown → 走 markdownToProseMirror 转成真正的块。
 *
 * 什么时候**不**接管(返回 false,走原来的行为):
 * - 按着 Shift 粘贴(Cmd+Shift+V)→ PM 自己按纯文字粘(它也是看 Shift)
 * - 剪贴板有图片 → paste-media / PM 默认
 * - html 不是纯文字外壳:带 data-pm-slice(KRIG 内部复制)或有任何结构/格式标签
 *   (Word / Notion / 网页的富文本)→ PM 默认按 parseDOM 解析
 * - 光标在代码类块里(codeBlock / mathBlock 等 spec.code)→ 原样粘
 * - 文字不像 markdown → PM 默认(每行一段)
 * - 标题块:title-guard 装在本插件之前,先拦下(只取第一行)
 *
 * 转换是 async(md-to-pm 里图片要走 mediaStore)。等结果期间用户可能继续打字、挪光标:
 * - 粘贴那一刻的选区登记进 plugin state,随每个 tr 映射 → 结果回来**插在粘贴的地方**,
 *   不追着光标跑
 * - 用户在等待期间挪过光标 → 插完把光标还给用户(映射到新 doc),不抢回来
 * - 插入是一个 tr → Cmd+Z 一步撤回
 * - 新块的 id 由 auto-block-id-plugin 的 appendTransaction 补(与 PM 默认粘贴同一条路);
 *   Host 发 onChange 时序列化的是 apply 之后的 state,已含 id,dissect 不会撞 id=null
 *
 * 转换失败 → console.error(main 的 page-console-tap 落盘,scripts/logs.mjs 可查)
 * + 按纯文字插入原文,不丢内容。
 */

import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { markdownToProseMirror } from '@capabilities/text-editing/converters/md-to-pm';

export const markdownPasteKey = new PluginKey<PendingMap>('text-editing-driver:markdown-paste');

/** 等转换结果的粘贴:id → 粘贴那一刻的选区(随 tr 映射) */
type PendingMap = ReadonlyMap<number, { from: number; to: number }>;
type PendingMeta = { add: { id: number; from: number; to: number } } | { remove: number };

/** 剪贴板 html 里出现这些 → 是富文本(Word / Notion / 网页),交给 PM parseDOM */
const RICH_HTML_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'code',
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'a[href]', 'img', 'hr', 'input', 'math', 'svg',
  'video', 'audio', 'iframe',
].join(',');

/**
 * html 只是纯文字的外壳?(编辑器 / 终端 / 部分网页只给 div/span/p/br + 样式)
 * 空 html 也算(剪贴板只有 text/plain)。
 */
export function isPlainTextShell(html: string): boolean {
  if (!html.trim()) return true;
  if (html.includes('data-pm-slice')) return false; // KRIG / PM 编辑器内部复制
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.querySelector(RICH_HTML_SELECTOR) === null;
}

/** 一行就能断定是 markdown 的块标记 */
const STRONG_LINE = [
  /^#{1,6}\s+\S/, //                 # 标题
  /^\s*[-*+]\s+\[[ xX]\]\s/, //      - [x] 任务
  /^\s*(```|~~~)/, //                代码围栏
  /^\s*\|.*\|\s*$/, //               | 表格 |
  /^\s*[-*+]\s+\S/, //               - 列表
  /^\s*\d{1,9}[.)]\s+\S/, //         1. 有序
  /^>\s?\S/, //                      > 引用
  /^\s*(-{3,}|\*{3,}|_{3,})\s*$/, // ---
];

/**
 * 行内标记:粗体 / 链接 / 行内代码 / 删除线。
 * 单个 `*斜*` 不作为触发条件 —— `2*3*4` 这类普通文字误判代价比漏判大。
 */
const INLINE_MARK = [/\*\*[^*\n]+\*\*/, /\[[^\]\n]+\]\([^)\s]+\)/, /`[^`\n]+`/, /~~[^~\n]+~~/];

export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => STRONG_LINE.some((re) => re.test(l)))) return true;
  return INLINE_MARK.some((re) => re.test(text));
}

/** 失败兜底:与 PM 默认纯文字粘贴同形 —— 每个非空行一段 */
function plainParagraphs(state: EditorState, text: string): PMNode[] {
  const { paragraph } = state.schema.nodes;
  return text
    .split(/(?:\r\n?|\n)+/)
    .filter((l) => l.length > 0)
    .map((l) => paragraph.create(null, state.schema.text(l)));
}

/**
 * 把块插到粘贴时的位置。
 * - 只有一段 → 当行内文字并进当前段(带粗/斜/链接)
 * - 其他 → 闭合的块切片:光标在空段落里就替换掉它,在段中就从光标处拆开、块插中间
 */
function insertBlocks(view: EditorView, pasteId: number, nodes: PMNode[]): void {
  const { state } = view;
  const range = markdownPasteKey.getState(state)?.get(pasteId);
  if (!range) return;

  const userSel = state.selection;
  const userMoved = userSel.from !== range.from || userSel.to !== range.to;
  const tr = state.tr.setMeta(markdownPasteKey, { remove: pasteId } satisfies PendingMeta);
  tr.setSelection(TextSelection.between(tr.doc.resolve(range.from), tr.doc.resolve(range.to)));

  const frag = Fragment.fromArray(nodes);
  const inline = nodes.length === 1 && nodes[0].type.name === 'paragraph';
  tr.replaceSelection(inline ? new Slice(frag, 1, 1) : new Slice(frag, 0, 0));

  if (userMoved) tr.setSelection(userSel.map(tr.doc, tr.mapping));
  else tr.scrollIntoView();
  tr.setMeta('paste', true);
  tr.setMeta('uiEvent', 'paste');
  view.dispatch(tr);
}

async function convertAndInsert(view: EditorView, pasteId: number, text: string): Promise<void> {
  let nodes: PMNode[];
  try {
    const json = await markdownToProseMirror(text);
    if (view.isDestroyed) return;
    nodes = json.map((n) => view.state.schema.nodeFromJSON(n));
    if (nodes.length === 0) throw new Error('转换结果为空');
  } catch (err) {
    if (view.isDestroyed) return;
    console.error('[markdown-paste] markdown 转块失败,按纯文字粘贴原文:', err);
    nodes = plainParagraphs(view.state, text);
  }
  insertBlocks(view, pasteId, nodes);
}

export function buildMarkdownPastePlugin(): Plugin {
  let shiftHeld = false;
  let seq = 0;

  return new Plugin<PendingMap>({
    key: markdownPasteKey,

    state: {
      init: () => new Map(),
      apply(tr, prev) {
        const meta = tr.getMeta(markdownPasteKey) as PendingMeta | undefined;
        if (!meta && (!tr.docChanged || prev.size === 0)) return prev;
        const next = new Map<number, { from: number; to: number }>();
        // 两端都往里缩:等待期间用户在粘贴点打的字落在区间外,不会被插入时替换掉
        for (const [id, r] of prev) {
          const from = tr.mapping.map(r.from, r.from === r.to ? -1 : 1);
          const to = Math.max(from, tr.mapping.map(r.to, -1));
          next.set(id, { from, to });
        }
        if (meta && 'add' in meta) next.set(meta.add.id, { from: meta.add.from, to: meta.add.to });
        if (meta && 'remove' in meta) next.delete(meta.remove);
        return next;
      },
    },

    props: {
      // 与 PM 内部同法记 Shift:ClipboardEvent 本身没有 shiftKey
      handleDOMEvents: {
        keydown(_view, e) {
          shiftHeld = e.keyCode === 16 || e.shiftKey;
          return false;
        },
        keyup(_view, e) {
          if (e.keyCode === 16) shiftHeld = false;
          return false;
        },
        blur() {
          shiftHeld = false;
          return false;
        },
      },

      handlePaste(view, event) {
        const cd = event.clipboardData;
        if (!cd || shiftHeld) return false;
        if (Array.from(cd.items ?? []).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
          return false;
        }
        if (!isPlainTextShell(cd.getData('text/html') || '')) return false;
        const { selection } = view.state;
        if (selection.$from.parent.type.spec.code) return false;
        const text = cd.getData('text/plain');
        if (!text || !looksLikeMarkdown(text)) return false;

        const pasteId = ++seq;
        view.dispatch(
          view.state.tr
            .setMeta(markdownPasteKey, {
              add: { id: pasteId, from: selection.from, to: selection.to },
            } satisfies PendingMeta)
            .setMeta('addToHistory', false)
            .setMeta('skipOnChange', true),
        );
        void convertAndInsert(view, pasteId, text);
        return true;
      },
    },
  });
}
