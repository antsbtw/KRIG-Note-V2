/**
 * PDF Vocab Highlight — PDF textLayer 内生词高亮 + hover tooltip
 *
 * 设计:
 * - 独立 overlay div 作为 page-wrapper 的 sibling(textLayer 之后,annotation 之前)
 * - 扫 textLayer span,逐 span 用 Range + getClientRects 算每个命中词的可视 rect
 * - 不修改 textLayer DOM(避免破坏 pdfjs 字距 / scaleX / 选区路径)
 * - hover:Document body 单例 tooltip(同 V1 vocab-highlight-plugin),浮于一切之上
 *
 * 关键限制(v1):
 * - 仅高亮**单词**(vocab.word 不含空格);"give up" 等词组跨 span 复杂度高,留 followup
 * - tooltip 仅显释义 + 🔊;TTS 走 learning.tts ArrayBuffer → Blob URL
 *
 * 调用契约:
 * - setVocab(entries):learning capability 推送 vocab 列表时调
 *   → 更新模块级 vocabSet + vocabDefs;清掉所有已存在的高亮(等下次 scan 重渲)
 * - ensureLayer(pageWrapper):在 page-wrapper 内确保 vocab-hl-layer div 存在并返回
 * - scanPage(textLayer, hlLayer, scale):扫该页 textLayer,重渲所有命中 rect 到 hl-layer
 * - clearAll():卸载场景(切书/unmount)清掉所有高亮 + 隐藏 tooltip
 *
 * tooltip 单例规则:全 app 共一个 tooltipEl 挂在 body,fixed 定位;
 * 任意时刻最多一个 vocab hover 状态。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { LearningApi, VocabEntry } from '@capabilities/learning/types';

const HL_LAYER_CLASS = 'krig-pdf-vocab-hl-layer';
const HL_CLASS = 'krig-pdf-vocab-hl';
const TOOLTIP_CLASS = 'krig-pdf-vocab-tooltip';

// ── 模块级 vocab 状态 ─────────────────────────────────

// 单词集(无空格)— span 内扫描快路径
const vocabSet = new Set<string>();
// 词组集(含空格)— 跨 span 拼接扫描慢路径
const phraseSet = new Set<string>();
// normalized → 原 word(查 def / phonetic / 显 tooltip)
const vocabDefs = new Map<string, string>();
const vocabPhonetics = new Map<string, string>();
let vocabPattern: RegExp | null = null;   // 单词 pattern
let phrasePattern: RegExp | null = null;  // 词组 pattern

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function setVocab(entries: VocabEntry[]): void {
  vocabSet.clear();
  phraseSet.clear();
  vocabDefs.clear();
  vocabPhonetics.clear();
  for (const e of entries) {
    // normalize:小写 + trim + 多空格压成单空格(用户存 "give  up" 也能匹配 PDF 拼接的 "give up")
    const w = e.word.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!w) continue;
    if (w.includes(' ')) {
      phraseSet.add(w);
    } else {
      vocabSet.add(w);
    }
    vocabDefs.set(w, e.definition);
    if (e.phonetic) vocabPhonetics.set(w, e.phonetic);
  }
  vocabPattern =
    vocabSet.size === 0
      ? null
      : new RegExp(
          `\\b(${Array.from(vocabSet).map(escapeRegex).join('|')})\\b`,
          'gi',
        );
  phrasePattern =
    phraseSet.size === 0
      ? null
      : new RegExp(
          `\\b(${Array.from(phraseSet).map(escapeRegex).join('|')})\\b`,
          'gi',
        );
}

/** 给 hover 监听用:全集 = 单词 + 词组,共用同套 defs/phonetics */
function hasAnyVocab(): boolean {
  return vocabSet.size > 0 || phraseSet.size > 0;
}

// ── HL layer + 扫描 ─────────────────────────────────

/**
 * 在 page-wrapper 内确保 vocab-hl-layer 存在,返回 DOM 引用。
 * idempotent — 已存在则直接返回,不重建。
 */
export function ensureLayer(pageWrapper: HTMLElement): HTMLElement {
  let layer = pageWrapper.querySelector<HTMLElement>(`.${HL_LAYER_CLASS}`);
  if (!layer) {
    layer = document.createElement('div');
    layer.className = HL_LAYER_CLASS;
    pageWrapper.appendChild(layer);
  }
  return layer;
}

/**
 * 扫指定 page 的 textLayer,把命中词 / 词组的 rect 渲染到 hl-layer。
 *
 * 两阶段:
 *  Phase 1 — 单词扫(span 内):每 span 跑 vocabPattern,命中 createRange + getClientRects
 *  Phase 2 — 词组扫(跨 span):拼接 fullText + spanIndex 映射,phrasePattern 命中后反查
 *            起止 span+offset,createRange 横跨多 span,getClientRects 拿 rect 列表
 *            — **仅 rects.length === 1 才画**(v1 跨行不高亮决议)
 *
 * scale 不参与计算:textLayer span 的 BCR 已含 scale,hl-layer 是 sibling 共享 page-wrapper
 * 坐标系,相对定位天然 scale-aware。
 */
export function scanPage(
  textLayer: HTMLElement,
  hlLayer: HTMLElement,
): void {
  // 1. 清旧高亮
  hlLayer.innerHTML = '';

  if (!hasAnyVocab()) return;

  // 2. 收集 span + textNode(后两阶段共享)
  // pdfjs 4.x textLayer 内每个 text item 是 <span>,可能套层 <span>;
  // querySelectorAll('span') 全收,findTextNode 找叶子 text node。
  // 过滤无文字 span。
  const allSpans = textLayer.querySelectorAll('span');
  const layerBounds = hlLayer.getBoundingClientRect();
  interface SpanRec {
    textNode: Text;
    str: string; // textNode.data,Phase 2 拼接用
  }
  const records: SpanRec[] = [];
  for (const span of allSpans) {
    if (!span.textContent) continue;
    const textNode = findTextNode(span);
    if (!textNode) continue;
    records.push({ textNode, str: textNode.data });
  }

  // ── Phase 1:单词扫(span 内,fast path)──
  if (vocabPattern) {
    for (const rec of records) {
      vocabPattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = vocabPattern.exec(rec.str)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        const word = m[0].toLowerCase();
        const range = document.createRange();
        try {
          range.setStart(rec.textNode, start);
          range.setEnd(rec.textNode, end);
        } catch {
          continue;
        }
        for (const r of range.getClientRects()) {
          if (r.width === 0 || r.height === 0) continue;
          appendHl(hlLayer, layerBounds, r, word);
        }
      }
    }
  }

  // ── Phase 2:词组扫(跨 span,slow path)──
  if (phrasePattern && records.length > 0) {
    // 拼接 fullText:span 之间用单空格分隔,避免跨 span 拼成无空格的连串
    // (V1 决议:跨行不高亮,跨 span 同行依赖空格识别)。
    // 维护偏移映射 spanRanges[i] = { recIdx, startInFull, endInFull }
    interface SpanOffset {
      recIdx: number;
      startInFull: number;
      endInFull: number;
    }
    const offsets: SpanOffset[] = [];
    const parts: string[] = [];
    let fullCursor = 0;
    records.forEach((rec, i) => {
      const startInFull = fullCursor;
      const endInFull = startInFull + rec.str.length;
      offsets.push({ recIdx: i, startInFull, endInFull });
      parts.push(rec.str);
      fullCursor = endInFull;
      // span 之间补 1 个空格作为隐式分隔;Phase 2 在 fullText 上跑 \b 与正则,空格不参与 match 内部
      if (i < records.length - 1) {
        parts.push(' ');
        fullCursor += 1;
      }
    });
    const fullText = parts.join('');

    phrasePattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = phrasePattern.exec(fullText)) !== null) {
      const matchStart = m.index;
      const matchEnd = matchStart + m[0].length;
      const phrase = m[0].toLowerCase().replace(/\s+/g, ' ');

      // 反查起止 span+offset
      const startLoc = locateInSpans(offsets, matchStart);
      const endLoc = locateInSpans(offsets, matchEnd);
      if (!startLoc || !endLoc) continue;
      // matchEnd 可能落在 span 之间的人造空格上 — locate 拿到下一 span 的 0 偏移
      // 跨 span 时 endLoc.recIdx 通常 > startLoc.recIdx;同 span 内直接落
      const startRec = records[startLoc.recIdx];
      const endRec = records[endLoc.recIdx];
      const range = document.createRange();
      try {
        range.setStart(startRec.textNode, startLoc.offsetInSpan);
        range.setEnd(endRec.textNode, endLoc.offsetInSpan);
      } catch {
        continue;
      }
      const rects = range.getClientRects();
      // v1 决议:跨行不高亮 — 多 rect 一律跳过
      if (rects.length !== 1) continue;
      const r = rects[0];
      if (r.width === 0 || r.height === 0) continue;
      appendHl(hlLayer, layerBounds, r, phrase);
    }
  }
}

/** 拼接坐标 → 命中 span 反查;offset 落在人造空格上时取下一 span 的 0 偏移 */
function locateInSpans(
  offsets: Array<{ recIdx: number; startInFull: number; endInFull: number }>,
  pos: number,
): { recIdx: number; offsetInSpan: number } | null {
  // 二分可优化,n 不大线性即可
  for (let i = 0; i < offsets.length; i++) {
    const o = offsets[i];
    if (pos >= o.startInFull && pos <= o.endInFull) {
      return { recIdx: i, offsetInSpan: pos - o.startInFull };
    }
    // 落在 i 与 i+1 之间的人造空格 → 取 i+1 的开头
    if (pos === o.endInFull + 1 && i + 1 < offsets.length) {
      return { recIdx: i + 1, offsetInSpan: 0 };
    }
  }
  return null;
}

function appendHl(
  hlLayer: HTMLElement,
  layerBounds: DOMRect,
  r: DOMRect,
  word: string,
): void {
  const hl = document.createElement('div');
  hl.className = HL_CLASS;
  hl.dataset.vocabWord = word;
  hl.style.left = `${r.left - layerBounds.left}px`;
  hl.style.top = `${r.top - layerBounds.top}px`;
  hl.style.width = `${r.width}px`;
  hl.style.height = `${r.height}px`;
  hlLayer.appendChild(hl);
}

function findTextNode(el: Element): Text | null {
  // pdfjs 4.x:span 通常 firstChild 就是 text node;偶尔嵌一层 span
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) return child as Text;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const inner = findTextNode(child as Element);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * 重扫所有已渲染 page —— vocab 列表变化后调。
 *
 * 查询所有 .textLayer 元素(主区 .krig-ebook-content__page-wrapper 和
 * 全屏 .krig-ebook-paged__page-wrapper 内均有);wrapper = textLayer.parentElement。
 *
 * 注:仅扫当下已 mount 的 textLayer;未来 scroll 进可见区 / 翻到的新页由
 * onTextLayerRendered 回调单独触发,不在此函数范围。
 */
export function rescanAll(): void {
  document.querySelectorAll<HTMLElement>('.textLayer').forEach((tl) => {
    const wrapper = tl.parentElement;
    if (!wrapper) return;
    const hl = ensureLayer(wrapper);
    scanPage(tl, hl);
  });
}

/** 卸载时调:清掉所有高亮 + 隐藏 tooltip */
export function clearAll(): void {
  document
    .querySelectorAll<HTMLElement>(`.${HL_LAYER_CLASS}`)
    .forEach((l) => (l.innerHTML = ''));
  hoveredEl = null;
  hideTooltipNow();
}

// ── Tooltip 单例 ─────────────────────────────────

let tooltipEl: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let ttsAudio: HTMLAudioElement | null = null;
let ttsObjectUrl: string | null = null;

function ensureTooltipEl(): HTMLDivElement {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = TOOLTIP_CLASS;
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);
  tooltipEl.addEventListener('mouseenter', () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  });
  tooltipEl.addEventListener('mouseleave', () => scheduleHide());
  return tooltipEl;
}

function showTooltip(word: string, anchor: DOMRect): void {
  const def = vocabDefs.get(word);
  if (!def) return;
  const phonetic = vocabPhonetics.get(word);
  const el = ensureTooltipEl();

  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  const shortDef = def.length > 200 ? def.slice(0, 200) + '...' : def;
  el.innerHTML = `
    <div class="${TOOLTIP_CLASS}__header">
      <span class="${TOOLTIP_CLASS}__word">${escapeHtml(word)}</span>
      ${phonetic ? `<span class="${TOOLTIP_CLASS}__phonetic">${escapeHtml(phonetic)}</span>` : ''}
      <button class="${TOOLTIP_CLASS}__tts" title="发音">&#x1f50a;</button>
    </div>
    <div class="${TOOLTIP_CLASS}__def">${escapeHtml(shortDef)}</div>
  `;

  const ttsBtn = el.querySelector<HTMLButtonElement>(`.${TOOLTIP_CLASS}__tts`);
  if (ttsBtn) {
    ttsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void playTTS(word);
    });
  }

  el.style.display = 'block';
  el.style.left = `${anchor.left}px`;
  el.style.top = `${anchor.bottom + 6}px`;

  // 边界检测:右出 / 底出时翻转
  requestAnimationFrame(() => {
    if (!tooltipEl) return;
    const tr = tooltipEl.getBoundingClientRect();
    if (tr.right > window.innerWidth - 8) {
      tooltipEl.style.left = `${window.innerWidth - tr.width - 8}px`;
    }
    if (tr.bottom > window.innerHeight - 8) {
      tooltipEl.style.top = `${anchor.top - tr.height - 6}px`;
    }
  });
}

function scheduleHide(): void {
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTooltipNow();
  }, 200);
}

function hideTooltipNow(): void {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (tooltipEl) tooltipEl.style.display = 'none';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function playTTS(word: string): Promise<void> {
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio = null;
  }
  if (ttsObjectUrl) {
    URL.revokeObjectURL(ttsObjectUrl);
    ttsObjectUrl = null;
  }
  const learning = requireCapabilityApi<LearningApi>('learning');
  const buf = await learning.tts(word, 'en');
  if (!buf) return;
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  ttsObjectUrl = URL.createObjectURL(blob);
  ttsAudio = new Audio(ttsObjectUrl);
  ttsAudio.play().catch(() => {});
}

// ── 全局 hover 探测(mousemove + 遍历 BCR 命中检测):一次性挂在 document ──
//
// 为什么不用 elementsFromPoint:vocab-hl pointer-events:none(避免拦截选区/右键),
// pointer-events:none 元素**不参与 hit-testing**,elementsFromPoint 不返回它们
// (2026-05-25 实测确认 — 诊断 log bcrHit=arrow 但 anyHl=false)。
//
// 改走 querySelectorAll + BCR 命中检测:n 一般几十到几百,mousemove 每次 O(n)
// 简单矩形检测,性能可控。第一次命中即 break 不全扫。
//
// 为什么不用 mouseover 委托(pointer-events:auto):auto 会拦截 mousedown 让选区
// 起点变成 vocab-hl(无 text node 选不到),用户拖选 / 右键定位会受影响。

let listenersAttached = false;
let hoveredEl: HTMLElement | null = null;
function attachGlobalListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener('mousemove', (e) => {
    // 零 vocab 时早退:全 app mousemove 监听,性能敏感
    if (!hasAnyVocab()) {
      if (hoveredEl) {
        hoveredEl.classList.remove('is-hover');
        scheduleHide();
        hoveredEl = null;
      }
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    let hit: HTMLElement | null = null;
    const all = document.querySelectorAll<HTMLElement>(`.${HL_CLASS}`);
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        hit = el;
        break;
      }
    }
    if (hit === hoveredEl) return;
    // 离开旧:取消视觉 + 延迟隐
    if (hoveredEl) {
      hoveredEl.classList.remove('is-hover');
      scheduleHide();
    }
    hoveredEl = hit;
    if (hit) {
      hit.classList.add('is-hover');
      const word = hit.dataset.vocabWord;
      if (word) showTooltip(word, hit.getBoundingClientRect());
    }
  });
}

/** view 端初始化时调一次 — attach 全局事件委托 */
export function init(): void {
  attachGlobalListeners();
}
