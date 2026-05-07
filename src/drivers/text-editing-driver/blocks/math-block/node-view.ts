/**
 * mathBlock NodeView — 两态(rendered / edit)+ KaTeX 渲染
 *
 * V1 → V2 直迁:src/plugins/note/blocks/math-block.ts
 *
 * 性能优化(V1 直迁):
 * - KaTeX 渲染缓存:LaTeX 未变化跳过重复渲染(lastRenderedLatex / lastPreviewLatex)
 * - 共享 IntersectionObserver:所有 mathBlock 实例复用一个 observer,200px lazy 渲染
 * - 共享全局 mousedown:单一 listener 管理所有进入 edit 的 mathBlock
 *
 * 砍 V1:LaTeX 速查面板(help-panel/latex)— 留 L5-B+,本阶段编辑头不放 ? 按钮
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/** 渲染 KaTeX 到 target,处理空 / 错误情况 */
function renderKaTeX(target: HTMLElement, source: string): void {
  const trimmed = source.trim();
  if (!trimmed) {
    target.innerHTML = '<div class="krig-math-block__empty">点击编辑 LaTeX 公式</div>';
    return;
  }
  try {
    target.innerHTML = '';
    katex.render(trimmed, target, { throwOnError: false, displayMode: true, strict: false });
  } catch {
    target.innerHTML = '<div class="krig-math-block__error">Invalid LaTeX</div>';
  }
}

// ── 共享 IntersectionObserver(所有 mathBlock 实例复用)──

type LazyRenderCallback = () => void;
const lazyRenderCallbacks = new Map<Element, LazyRenderCallback>();

const sharedIntersectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const cb = lazyRenderCallbacks.get(entry.target);
        if (cb) {
          cb();
          lazyRenderCallbacks.delete(entry.target);
          sharedIntersectionObserver.unobserve(entry.target);
        }
      }
    }
  },
  { rootMargin: '200px' },
);

// ── 共享全局 mousedown 监听 ──

interface ActiveMathEditor {
  dom: HTMLElement;
  exit: () => void;
}

const activeMathEditors = new Set<ActiveMathEditor>();

function onGlobalMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  // 留个 escape hatch:点 .krig-help-panel(后续接入)不退出
  if (target.closest('.krig-help-panel')) return;
  for (const editor of activeMathEditors) {
    if (!editor.dom.contains(target)) {
      editor.exit();
    }
  }
}

function registerActiveEditor(editor: ActiveMathEditor): void {
  if (activeMathEditors.size === 0) {
    document.addEventListener('mousedown', onGlobalMouseDown);
  }
  activeMathEditors.add(editor);
}

function unregisterActiveEditor(editor: ActiveMathEditor): void {
  activeMathEditors.delete(editor);
  if (activeMathEditors.size === 0) {
    document.removeEventListener('mousedown', onGlobalMouseDown);
  }
}

export const mathBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;
  let editing = false;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedLatex: string | null = null;
  let lastPreviewLatex: string | null = null;

  // ── DOM 结构 ──
  const dom = document.createElement('div');
  dom.classList.add('krig-math-block');

  const rendered = document.createElement('div');
  rendered.classList.add('krig-math-block__rendered');
  rendered.setAttribute('contenteditable', 'false');
  dom.appendChild(rendered);

  function applyColorStyles(n: typeof node): void {
    const color = (n.attrs as { color?: string | null }).color;
    const bgColor = (n.attrs as { bgColor?: string | null }).bgColor;
    rendered.style.color = color || '';
    dom.style.backgroundColor = bgColor || '';
  }
  applyColorStyles(node);

  const editorArea = document.createElement('div');
  editorArea.classList.add('krig-math-block__editor');
  editorArea.style.display = 'none';

  const headerBar = document.createElement('div');
  headerBar.classList.add('krig-math-block__header');
  headerBar.setAttribute('contenteditable', 'false');

  const label = document.createElement('span');
  label.classList.add('krig-math-block__label');
  label.textContent = '∑ Block equation';
  headerBar.appendChild(label);

  // L5-B3.6 砍 V1 ? help 按钮:LaTeX 速查面板留 L5-B+
  // 编辑头只显示 label,不放按钮

  editorArea.appendChild(headerBar);

  const code = document.createElement('pre');
  code.classList.add('krig-math-block__code');
  editorArea.appendChild(code);

  const livePreview = document.createElement('div');
  livePreview.classList.add('krig-math-block__preview');
  livePreview.setAttribute('contenteditable', 'false');
  editorArea.appendChild(livePreview);

  dom.appendChild(editorArea);

  // ── Helpers ──
  function getLatex(): string {
    return node.textContent;
  }

  function renderRenderedView(): void {
    const latex = getLatex();
    if (latex === lastRenderedLatex) return;
    lastRenderedLatex = latex;
    renderKaTeX(rendered, latex);
  }

  function renderLivePreview(): void {
    const latex = getLatex();
    if (latex === lastPreviewLatex) return;
    lastPreviewLatex = latex;
    requestAnimationFrame(() => {
      renderKaTeX(livePreview, latex);
    });
  }

  function scheduleRender(): void {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderLivePreview(), 200);
  }

  // ── Edit 态切换 ──
  const selfEditor: ActiveMathEditor = { dom, exit: () => exitEditMode() };

  function enterEditMode(): void {
    if (editing) return;
    editing = true;
    dom.classList.add('krig-math-block--editing');
    rendered.style.display = 'none';
    editorArea.style.display = 'block';
    lastPreviewLatex = null; // 清缓存,强制重新渲染
    renderLivePreview();

    registerActiveEditor(selfEditor);

    // 把光标移到 LaTeX 源码末尾
    setTimeout(() => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        const resolvedNode = view.state.doc.nodeAt(pos);
        if (resolvedNode) {
          const endPos = pos + resolvedNode.nodeSize - 1;
          try {
            const tr = view.state.tr.setSelection(
              TextSelection.create(view.state.doc, endPos),
            );
            view.dispatch(tr);
          } catch {
            /* ignore — pos 可能已变 */
          }
        }
      }
      view.focus();
    }, 10);
  }

  function exitEditMode(): void {
    if (!editing) return;
    editing = false;
    dom.classList.remove('krig-math-block--editing');
    editorArea.style.display = 'none';
    rendered.style.display = '';
    lastRenderedLatex = null; // 清缓存,强制刷新
    renderRenderedView();
    unregisterActiveEditor(selfEditor);
  }

  rendered.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterEditMode();
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (editing && e.key === 'Escape') {
      e.preventDefault();
      exitEditMode();
    }
  };
  dom.addEventListener('keydown', onKeyDown);

  // 监听 contentDOM 文本变化 → live preview
  const mutationObserver = new MutationObserver(() => {
    if (editing) scheduleRender();
  });
  mutationObserver.observe(code, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  // 空块自动进入 edit 态
  if (!initialNode.textContent.trim()) {
    setTimeout(() => enterEditMode(), 0);
  }

  // Lazy 初始渲染(共享 observer)
  lazyRenderCallbacks.set(dom, () => {
    if (!editing) renderRenderedView();
  });
  sharedIntersectionObserver.observe(dom);

  return {
    dom,
    contentDOM: code,
    ignoreMutation(mutation) {
      // 只允许 contentDOM(LaTeX 源码 pre)的 mutation 通过到 PM,其他都忽略
      // (rendered KaTeX DOM、editorArea 等非 contentEditable 区域的变化 PM 不该看到)
      return !code.contains(mutation.target);
    },
    update(updatedNode) {
      if (updatedNode.type.name !== 'mathBlock') return false;
      node = updatedNode;
      applyColorStyles(updatedNode);
      if (editing) {
        scheduleRender(); // 编辑中走防抖
      } else {
        renderRenderedView(); // 缓存会跳过未变内容
      }
      return true;
    },
    destroy() {
      sharedIntersectionObserver.unobserve(dom);
      lazyRenderCallbacks.delete(dom);
      mutationObserver.disconnect();
      unregisterActiveEditor(selfEditor);
      dom.removeEventListener('keydown', onKeyDown);
      if (renderTimer) clearTimeout(renderTimer);
    },
  };
};
