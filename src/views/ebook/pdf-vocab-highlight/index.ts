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

const vocabSet = new Set<string>();        // normalized lowercase, 单词(无空格)
const vocabDefs = new Map<string, string>();
const vocabPhonetics = new Map<string, string>();
let vocabPattern: RegExp | null = null;

export function setVocab(entries: VocabEntry[]): void {
  vocabSet.clear();
  vocabDefs.clear();
  vocabPhonetics.clear();
  for (const e of entries) {
    const w = e.word.toLowerCase().trim();
    // v1:仅单词,词组跳过(跨 span rect 计算复杂)
    if (!w || w.includes(' ')) continue;
    vocabSet.add(w);
    vocabDefs.set(w, e.definition);
    if (e.phonetic) vocabPhonetics.set(w, e.phonetic);
  }
  // 重建正则:\b(word1|word2|...)\b,大小写不敏感
  if (vocabSet.size === 0) {
    vocabPattern = null;
  } else {
    const escaped = Array.from(vocabSet).map((w) =>
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    vocabPattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  }
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
 * 扫指定 page 的 textLayer,把命中词的 rect 渲染到 hl-layer。
 *
 * 算法:
 * 1. 清空 hl-layer 现有所有 .krig-pdf-vocab-hl 子节点
 * 2. 遍历 textLayer 的所有 span(每个 span 是 pdfjs 渲染的 text item)
 * 3. 对每个 span 的 textContent 跑 vocabPattern,命中位置用 Range + getClientRects 算可视 rect
 * 4. 减 hl-layer 的 BCR 得到相对坐标,绝对定位 div(每个 rect 一个)
 *
 * scale 不参与计算:textLayer span 的 BCR 已含 scale,hl-layer 也作为 sibling 共享 page-wrapper
 * 坐标系,相对定位天然 scale-aware。
 */
export function scanPage(
  textLayer: HTMLElement,
  hlLayer: HTMLElement,
): void {
  // 1. 清旧高亮
  hlLayer.innerHTML = '';

  if (!vocabPattern || vocabSet.size === 0) return;

  // 2. 遍历 textLayer 内所有 span
  // pdfjs 4.x textLayer 内每个 text item 是 <span>,可能套层 <span> 给 transform-origin
  // querySelectorAll('span') 全收,过滤无文字的(role=presentation 等)
  const spans = textLayer.querySelectorAll('span');
  const layerBounds = hlLayer.getBoundingClientRect();

  for (const span of spans) {
    const text = span.textContent;
    if (!text) continue;
    // span 内可能还套子 span;只看叶子 text node 才能算 Range
    const textNode = findTextNode(span);
    if (!textNode) continue;

    // pattern stateful — reset lastIndex 每个 span 独立
    vocabPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = vocabPattern.exec(textNode.data)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const word = m[0].toLowerCase();

      // Range + getClientRects 算可视 rect(span transform 已含 scaleX,client rect 准)
      const range = document.createRange();
      try {
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
      } catch {
        continue;
      }
      const rects = range.getClientRects();
      for (const r of rects) {
        if (r.width === 0 || r.height === 0) continue;
        const hl = document.createElement('div');
        hl.className = HL_CLASS;
        hl.dataset.vocabWord = word;
        hl.style.left = `${r.left - layerBounds.left}px`;
        hl.style.top = `${r.top - layerBounds.top}px`;
        hl.style.width = `${r.width}px`;
        hl.style.height = `${r.height}px`;
        hlLayer.appendChild(hl);
      }
    }
  }
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

// ── 全局 hover 探测(mousemove + elementsFromPoint):一次性挂在 document ──
//
// 为什么不用 mouseover 委托:vocab-hl pointer-events:none(避免拦截选区拖选/右键),
// mouseover 事件不会冒泡到本元素。改用 mousemove + elementsFromPoint 探测光标下的
// vocab-hl 元素。性能上 elementsFromPoint 在主流浏览器 O(1)~O(可见层数),无忧。

let listenersAttached = false;
let hoveredEl: HTMLElement | null = null;
function attachGlobalListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener('mousemove', (e) => {
    // 零 vocab 时早退:不调 elementsFromPoint(全 app mousemove 监听,性能敏感)
    if (vocabSet.size === 0) {
      if (hoveredEl) {
        hoveredEl.classList.remove('is-hover');
        scheduleHide();
        hoveredEl = null;
      }
      return;
    }
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    let hit: HTMLElement | null = null;
    for (const el of els) {
      if ((el as HTMLElement).classList?.contains(HL_CLASS)) {
        hit = el as HTMLElement;
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
