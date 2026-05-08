/**
 * vocab-highlight plugin — 生词高亮 + hover tooltip(L5-B3.20b)
 *
 * V1 → V2 直迁:src/plugins/note/learning/vocab-highlight-plugin.ts(212 行)
 *
 * 行为:
 * - PM Decoration:把生词本里的词在 PM 文档里 inline 高亮(`.vocab-highlight` class)
 * - hover tooltip:鼠标悬停高亮词 → 显释义 + TTS 按钮(模块级 DOM,不走 popup-registry)
 * - 通过 dispatch `vocabHighlightPluginKey` meta(Set<string>)更新词表 → 重建 decorations
 *
 * V1 → V2 改造:
 * - viewAPI.playTTS → @capabilities/learning.tts(W5 严格态 A 允许 driver 直 import capability)
 * - 模块级 vocabDefs 通过 export 函数 updateVocabDefs 更新(供 tooltip 显释义)
 *
 * 装载位置:editor-view-builder.ts plugins 链。
 *
 * 触发更新:view 层 learning-integration 订阅 capability.onVocabChanged → 调
 * driver.setVocabWords → 遍历 instanceRegistry → 每 instance dispatch meta + 模块级 vocabDefs 更新。
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { tts } from '@capabilities/learning';

export const vocabHighlightPluginKey = new PluginKey<VocabHighlightState>('vocabHighlight');

interface VocabHighlightState {
  words: Set<string>;
  decos: DecorationSet;
}

// ─── 模块级 vocab 定义(供 tooltip 显释义)─────────────────

/** word (lowercase) → definition */
const vocabDefs = new Map<string, string>();

/**
 * 更新生词定义(driver setVocabWords 调本函数,跟 dispatch meta 一起)
 * 内部模块级,不走 plugin state(tooltip 是模块级 DOM,不需要 plugin state 同步)。
 */
export function updateVocabDefs(entries: Array<{ word: string; definition: string }>): void {
  vocabDefs.clear();
  for (const e of entries) {
    vocabDefs.set(e.word.toLowerCase(), e.definition);
  }
}

// ─── tooltip(模块级 DOM,生命周期跟随 hover)──────────

let tooltipEl: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let ttsAudio: HTMLAudioElement | null = null;
let ttsObjectUrl: string | null = null;

function handleTTS(word: string): void {
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio = null;
  }
  if (ttsObjectUrl) {
    URL.revokeObjectURL(ttsObjectUrl);
    ttsObjectUrl = null;
  }
  void tts(word, 'en').then((buf) => {
    if (!buf) return;
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    ttsObjectUrl = URL.createObjectURL(blob);
    ttsAudio = new Audio(ttsObjectUrl);
    ttsAudio.play().catch(() => { /* ignore */ });
  });
}

function showTooltip(word: string, rect: DOMRect): void {
  const def = vocabDefs.get(word.toLowerCase());
  if (!def) return;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'vocab-tooltip';
    document.body.appendChild(tooltipEl);

    tooltipEl.addEventListener('mouseenter', () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    });
    tooltipEl.addEventListener('mouseleave', () => {
      hideTooltip();
    });
  }

  const shortDef = def.length > 200 ? def.slice(0, 200) + '...' : def;
  tooltipEl.innerHTML = `
    <div class="vocab-tooltip__header">
      <span class="vocab-tooltip__word">${escapeHtml(word)}</span>
      <button class="vocab-tooltip__tts" title="发音">&#x1f50a;</button>
    </div>
    <div class="vocab-tooltip__def">${escapeHtml(shortDef)}</div>
  `;

  const ttsBtn = tooltipEl.querySelector('.vocab-tooltip__tts');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', () => handleTTS(word));
  }

  tooltipEl.style.display = 'block';
  tooltipEl.style.left = `${rect.left}px`;
  tooltipEl.style.top = `${rect.bottom + 6}px`;

  // 边界翻边(右溢出 → 贴右;下溢出 → 翻到上方)
  requestAnimationFrame(() => {
    if (!tooltipEl) return;
    const tr = tooltipEl.getBoundingClientRect();
    if (tr.right > window.innerWidth - 8) {
      tooltipEl.style.left = `${window.innerWidth - tr.width - 8}px`;
    }
    if (tr.bottom > window.innerHeight - 8) {
      tooltipEl.style.top = `${rect.top - tr.height - 6}px`;
    }
  });
}

function hideTooltip(): void {
  hideTimer = setTimeout(() => {
    if (tooltipEl) tooltipEl.style.display = 'none';
    hideTimer = null;
  }, 200);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Decorations 构建 ────────────────────────────────

function buildDecorations(doc: PMNode, words: Set<string>): DecorationSet {
  if (words.size === 0) return DecorationSet.empty;

  // 生词支持短语(含空格)— 转义正则元字符
  const escaped = Array.from(words).map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(node.text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      decos.push(
        Decoration.inline(from, to, {
          class: 'vocab-highlight',
          'data-vocab-word': match[0].toLowerCase(),
        }),
      );
    }
  });

  return DecorationSet.create(doc, decos);
}

// ─── Plugin ──────────────────────────────────────────

export function buildVocabHighlightPlugin(): Plugin {
  return new Plugin<VocabHighlightState>({
    key: vocabHighlightPluginKey,

    state: {
      init(): VocabHighlightState {
        return { words: new Set(), decos: DecorationSet.empty };
      },

      apply(tr, value, _oldState, newState): VocabHighlightState {
        const newWords = tr.getMeta(vocabHighlightPluginKey) as Set<string> | undefined;
        if (newWords) {
          return {
            words: newWords,
            decos: buildDecorations(newState.doc, newWords),
          };
        }
        if (tr.docChanged) {
          return {
            ...value,
            decos: buildDecorations(newState.doc, value.words),
          };
        }
        return value;
      },
    },

    props: {
      decorations(state) {
        return vocabHighlightPluginKey.getState(state)?.decos;
      },

      handleDOMEvents: {
        mouseover(_view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement;
          if (target.classList?.contains('vocab-highlight')) {
            const word = target.dataset.vocabWord || target.textContent || '';
            const rect = target.getBoundingClientRect();
            showTooltip(word, rect);
          }
          return false;
        },
        mouseout(_view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement;
          if (target.classList?.contains('vocab-highlight')) {
            hideTooltip();
          }
          return false;
        },
      },
    },
  });
}
