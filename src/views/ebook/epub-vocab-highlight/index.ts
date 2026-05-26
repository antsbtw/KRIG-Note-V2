/**
 * EPUB Vocab Highlight — EPUB iframe 内生词高亮 + hover tooltip
 *
 * 设计:
 * - 每个 EPUB section 是独立 iframe doc(spine item),renderer 通过 onSectionLoad
 *   逐 doc 回调给 view;本模块 attachSection(doc) 给每个 doc 注入 span + 挂 mousemove。
 * - 注入式高亮:扫 doc 内 text node,命中词用 <span class="krig-epub-vocab-hl"> 包裹;
 *   不另起 overlay 层 — EPUB 内容是文字流,iframe span 跟随重排天然 robust。
 * - tooltip 复用 ../vocab-tooltip 单例(挂 parent body,fixed 坐标);
 *   iframe 内 mouseover/mouseout 拿到 anchor rect 后加上 iframeRect 偏移转 viewport 坐标。
 *
 * 关键限制:
 * - 仅扫每个 text node 内的 \\b...\\b 命中,不处理跨 text node 词组
 *   (EPUB 文字通常一段一个 text node,跨 node 词组极少见;遵循 PDF v1 同策略)
 * - 注入式修改 iframe DOM:撤销时按 marker class 反向收集 span 替换回 text node;
 *   foliate 内部 CFI / selection 基于 text node 偏移,我们的 span 会改变 text node
 *   边界 — 但 foliate 在 anchor 时按 char offset 走 TreeWalker(同 v1 PM mark 思路),
 *   注入 span 不破坏字符序列,语义不变;实测 selection/CFI/标注路径均正常。
 *   (若后续 foliate 升级后兼容性出问题,改走 SVG overlay 方案 — 不在 v1 范围)
 *
 * 词表生命周期:
 * - setVocab(entries):全 app 模块级 — 推送当前词表 + bump version,所有已 attach 的 doc
 *   依新词表重扫;旧 span 全部撤销
 * - attachSection(doc, index):renderer 触发(初始/翻章节);幂等,doc 上做 marker 防重附
 * - clearAll():view unmount / 切书时调,撤销所有 doc 的 span + 隐藏 tooltip
 *
 * tooltip 单例:复用 ../vocab-tooltip(同 PDF);PDF 与 EPUB 不会同时 hover,共享安全。
 */

import type { VocabEntry } from '@capabilities/learning/types';
import {
  showTooltip,
  scheduleHide,
  hideTooltipNow,
} from '../vocab-tooltip';

const HL_CLASS = 'krig-epub-vocab-hl';
const STYLE_MARKER = 'data-krig-epub-vocab-style';
/** doc 上 marker 字段名:记录当前应用的词表版本,版本对得上跳过重扫 */
const DOC_VERSION_FIELD = '__krigEpubVocabVersion';

interface DocMarked extends Document {
  [DOC_VERSION_FIELD]?: number;
}

// ── 模块级 vocab 状态 ─────────────────────────────────

let vocabPattern: RegExp | null = null;
/** normalized(lower,trim,多空格压成单空格)→ {definition, phonetic} */
const vocabDefs = new Map<string, string>();
const vocabPhonetics = new Map<string, string>();
/** 词表版本号 — setVocab 自增,doc 用 DOC_VERSION_FIELD 比对决定是否重扫 */
let vocabVersion = 0;
/** 已 attach 的 doc 列表(WeakSet 引用 + 单独 Set 用于遍历) */
const attachedDocs = new Set<Document>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function setVocab(entries: VocabEntry[]): void {
  vocabDefs.clear();
  vocabPhonetics.clear();
  const words: string[] = [];
  for (const e of entries) {
    const w = e.word.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!w) continue;
    vocabDefs.set(w, e.definition);
    if (e.phonetic) vocabPhonetics.set(w, e.phonetic);
    words.push(w);
  }
  vocabPattern =
    words.length === 0
      ? null
      : new RegExp(`\\b(${words.map(escapeRegex).join('|')})\\b`, 'gi');
  vocabVersion++;
  // 对所有已 attach 的 doc 立即重扫(撤销 + 重注入)
  for (const doc of attachedDocs) {
    rescanDoc(doc);
  }
}

function hasAnyVocab(): boolean {
  return vocabDefs.size > 0;
}

// ── 样式注入 ─────────────────────────────────

const STYLE_CSS = `
.${HL_CLASS} {
  background: rgba(245, 197, 24, 0.22);
  border-bottom: 2px dotted #f5c518;
  cursor: help;
  transition: background 0.15s;
  /* 不改 line-height / font / vertical-align — 保 inline 排版稳定 */
}
.${HL_CLASS}.is-hover {
  background: rgba(245, 197, 24, 0.38);
}
`;

function ensureStyle(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, '');
  style.textContent = STYLE_CSS;
  // 优先挂 head;无 head 退 documentElement
  (doc.head ?? doc.documentElement).appendChild(style);
}

// ── 扫描 + 注入 ─────────────────────────────────

/**
 * 扫 doc 内所有 text node,命中词包 <span>。
 *
 * 跳过的容器:script / style / 已是 vocab-hl(防嵌套)。
 * 用 TreeWalker 收集 text node 后批量替换,避免遍历期间修改 DOM 致跳节点。
 */
function scanDoc(doc: Document): void {
  if (!vocabPattern || !hasAnyVocab()) return;
  // 收集候选 text node — 不能边遍历边改 DOM
  const candidates: Text[] = [];
  const walker = doc.createTreeWalker(
    doc.body ?? doc.documentElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        // 已是 vocab-hl span 内的 textNode 跳过(防嵌套 / 重附打到自己生成的 span)
        if (parent.classList?.contains(HL_CLASS)) return NodeFilter.FILTER_REJECT;
        const data = node.nodeValue;
        if (!data || !data.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let cur: Node | null = walker.nextNode();
  while (cur) {
    candidates.push(cur as Text);
    cur = walker.nextNode();
  }

  for (const textNode of candidates) {
    wrapMatchesIn(doc, textNode);
  }
}

/**
 * 在 textNode 内找所有命中,把命中片段拆出 <span> 包裹,其它字符保留为普通 text node。
 * 操作后 textNode 自身被替换(可能被拆成多段 text node + span 序列)。
 */
function wrapMatchesIn(doc: Document, textNode: Text): void {
  const data = textNode.nodeValue;
  if (!data || !vocabPattern) return;
  vocabPattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  // 收集所有命中范围(start, end, word)— 一次性收集后再 splice,避免边改边 exec
  interface Hit {
    start: number;
    end: number;
    word: string;
  }
  const hits: Hit[] = [];
  while ((m = vocabPattern.exec(data)) !== null) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      word: m[0].toLowerCase().replace(/\s+/g, ' '),
    });
  }
  if (hits.length === 0) return;

  // 按从右到左 splitText + replace span,避免 offset 偏移
  // 拼接策略:依次拆 textNode → 中间段是命中 → 包 span;两侧保留原 text node
  const parent = textNode.parentNode;
  if (!parent) return;

  // 从左到右构建片段序列,最后整体 replaceChild
  const frag = doc.createDocumentFragment();
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) {
      frag.appendChild(doc.createTextNode(data.slice(cursor, h.start)));
    }
    const span = doc.createElement('span');
    span.className = HL_CLASS;
    span.setAttribute('data-vocab-word', h.word);
    span.textContent = data.slice(h.start, h.end);
    frag.appendChild(span);
    cursor = h.end;
  }
  if (cursor < data.length) {
    frag.appendChild(doc.createTextNode(data.slice(cursor)));
  }
  parent.replaceChild(frag, textNode);
}

/**
 * 撤销 doc 内所有已注入 span — 把 span.textContent 合回普通 text node。
 *
 * 用于词表变化重扫前,或 unmount 清理。
 * 实施细节:foliate 翻章后可能 doc 已被 detach,此时 querySelectorAll 仍可用
 * (doc 自身未销毁,只是不在视口);幂等安全。
 */
function clearDoc(doc: Document): void {
  const spans = doc.querySelectorAll<HTMLElement>(`.${HL_CLASS}`);
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    parent.replaceChild(doc.createTextNode(span.textContent ?? ''), span);
    // 把相邻 text node 合并(可选,不合并也不影响功能;留待 EPUB CFI 不出问题就不动)
  }
  // 合并相邻 text node — 减少 fragmentation,foliate selection 路径更稳
  if (doc.body) doc.body.normalize();
}

function rescanDoc(doc: Document): void {
  const d = doc as DocMarked;
  if (d[DOC_VERSION_FIELD] === vocabVersion) return;
  clearDoc(doc);
  if (hasAnyVocab()) {
    ensureStyle(doc);
    scanDoc(doc);
  }
  d[DOC_VERSION_FIELD] = vocabVersion;
}

// ── Hover 监听(逐 doc 挂)─────────────────────────────────

const LISTENERS_FIELD = '__krigEpubVocabListenersAttached';

interface DocListenersMarked extends Document {
  [LISTENERS_FIELD]?: boolean;
}

function attachHoverListeners(doc: Document): void {
  const d = doc as DocListenersMarked;
  if (d[LISTENERS_FIELD]) return;
  d[LISTENERS_FIELD] = true;

  let hovered: HTMLElement | null = null;
  // 用 mouseover 委托(EPUB 内 span pointer-events 默认 auto,可直接收事件)
  doc.addEventListener('mouseover', (e) => {
    const target = e.target as HTMLElement | null;
    const hl = target?.closest?.(`.${HL_CLASS}`) as HTMLElement | null;
    if (hl === hovered) return;
    if (hovered) {
      hovered.classList.remove('is-hover');
    }
    hovered = hl;
    if (!hl) {
      scheduleHide();
      return;
    }
    hl.classList.add('is-hover');
    const word = hl.getAttribute('data-vocab-word');
    if (!word) return;
    const def = vocabDefs.get(word);
    if (!def) return;
    // iframe 内 BCR → viewport 坐标(parent fixed 单例 tooltip 用)
    const rect = hl.getBoundingClientRect();
    const iframeEl = doc.defaultView?.frameElement as HTMLElement | null;
    const iframeRect = iframeEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const viewportRect = new DOMRect(
      rect.left + iframeRect.left,
      rect.top + iframeRect.top,
      rect.width,
      rect.height,
    );
    showTooltip(
      { word, definition: def, phonetic: vocabPhonetics.get(word) },
      viewportRect,
    );
  });
  doc.addEventListener('mouseout', (e) => {
    const target = e.target as HTMLElement | null;
    const hl = target?.closest?.(`.${HL_CLASS}`);
    if (!hl) return;
    // mouseout 触发后 mouseover 会跟上 — 若新 target 不是 vocab-hl,
    // 上面 mouseover 委托会调 scheduleHide;这里 idempotent 做一次保险
    if (hovered === hl) {
      (hovered as HTMLElement).classList.remove('is-hover');
      hovered = null;
      scheduleHide();
    }
  });
}

// ── 对外 API ─────────────────────────────────

/**
 * Renderer 触发 onSectionLoad 时调用 — 给 iframe doc 挂 vocab 高亮 + hover。
 * 幂等:同一 doc 多次调安全;首次调注入 + 挂监听,后续调仅按需 rescan(版本对得上跳过)。
 */
export function attachSection(doc: Document): void {
  attachedDocs.add(doc);
  attachHoverListeners(doc);
  rescanDoc(doc);
}

/**
 * View unmount / 切书时调:撤销所有 doc 的 span + 清 attached 集 + 隐藏 tooltip。
 * 不解 hover listener — doc 被 foliate detach 时 listener 一并 GC(同
 * setupSelectionListener 的 __ebookListenersAttached 模式)。
 */
export function clearAll(): void {
  for (const doc of attachedDocs) {
    clearDoc(doc);
    const d = doc as DocMarked;
    delete d[DOC_VERSION_FIELD];
  }
  attachedDocs.clear();
  hideTooltipNow();
}
