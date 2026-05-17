/**
 * codeBlock NodeView — Mermaid 专用 + Generic(Phase 1 加 generic 路径)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/code-block.ts(剪掉非 mermaid 部分)
 *
 * 行为:
 * - attrs.language === 'mermaid':渲染工具栏 + 代码区 + 预览区,支持分屏/纯预览切换、
 *   下载 PNG、**全屏编辑**(走 L2 fullscreen-overlay)
 * - 其他语言('' / javascript / typescript / python / json / markdown / 任意已注册):
 *   走 buildGenericCodeBlockView — 带 hover toolbar(语言下拉 + Copy);Fullscreen
 *   Phase 1 不渲染,Phase 3 启用
 *
 * NodeView 工厂始终返回完整 NodeView 对象(PM 不接受 undefined / null)。
 *
 * 切换 mermaid ↔ generic:update 返回 false 让 PM destroy 重建(确保两侧 DOM 结构差
 * 异不被强行 patch)。
 *
 * 全屏编辑器:走 L2 fullscreen-overlay 体系,Component 是 React 组件,事件不被
 * PM 抢(见 [[fullscreen/MermaidFullscreenPanel]] + [[fullscreen/menu-context]])。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { renderMermaidDiagram } from './mermaid-renderer';
import { downloadBlob } from './save-blob';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';
import { setMermaidFullscreenContext } from './fullscreen/menu-context';
import { createGenericToolbar } from './generic-toolbar';

const LS_VIEW_KEY = 'krig-mermaid-view-mode';
type ViewMode = 'split' | 'preview';

const FULLSCREEN_OVERLAY_ID = 'text-editing.fullscreen.mermaid';

const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_FULLSCREEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

/** 从 view.dom 反查 driver instanceId(Host.tsx mount 时挂在 data-instance-id 上)*/
function findInstanceId(view: { dom: HTMLElement }): string | null {
  const el = view.dom.closest('[data-instance-id]') as HTMLElement | null;
  return el?.getAttribute('data-instance-id') ?? null;
}

/** Generic codeBlock NodeView(非 mermaid;Phase 1:toolbar + lang dropdown + Copy) */
function buildGenericCodeBlockView(
  initialNode: Parameters<NodeViewConstructor>[0],
  view: Parameters<NodeViewConstructor>[1],
  getPos: Parameters<NodeViewConstructor>[2],
): ReturnType<NodeViewConstructor> {
  // 外层 div(对齐 mermaid NodeView 结构,共用 .krig-code-block / __toolbar CSS)
  const dom = document.createElement('div');
  dom.classList.add('krig-code-block', 'krig-code-block--generic');

  const pre = document.createElement('pre');
  pre.classList.add('krig-code-block__pre');
  const code = document.createElement('code');
  code.classList.add('krig-code-block__code');
  const initialLang = initialNode.attrs.language as string;
  if (initialLang) code.classList.add(`language-${initialLang}`);
  pre.appendChild(code);

  const toolbar = createGenericToolbar({
    initialLanguage: initialLang,
    getCodeText: () => code.textContent || '',
    onLanguageChange: (newLang) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== 'codeBlock') return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: newLang,
      });
      view.dispatch(tr);
    },
  });

  dom.appendChild(toolbar.el);
  dom.appendChild(pre);

  return {
    dom,
    contentDOM: code,
    // toolbar / dropdown DOM 变化不让 PM 重渲(对齐 mermaid 写法)
    ignoreMutation(mutation) {
      return !code.contains(mutation.target);
    },
    update(updatedNode) {
      if (updatedNode.type.name !== 'codeBlock') return false;
      // 语言切到 mermaid → 让 PM destroy 重建,走 mermaid NodeView 分支
      if (updatedNode.attrs.language === 'mermaid') return false;
      const newLang = updatedNode.attrs.language as string;
      // 同步 <code> className(影响 Phase 2 高亮 plugin 之外的 CSS 兜底)
      code.className = 'krig-code-block__code' + (newLang ? ` language-${newLang}` : '');
      toolbar.setLanguage(newLang);
      return true;
    },
    destroy() {
      toolbar.destroy();
    },
  };
}

/** Mermaid NodeView:工具栏 + 代码区 + 预览区 */
function buildMermaidCodeBlockView(
  _initialNode: Parameters<NodeViewConstructor>[0],
  view: Parameters<NodeViewConstructor>[1],
  getPos: Parameters<NodeViewConstructor>[2],
): ReturnType<NodeViewConstructor> {
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let viewMode: ViewMode = (localStorage.getItem(LS_VIEW_KEY) as ViewMode) || 'split';

  const dom = document.createElement('div');
  dom.classList.add('krig-code-block', 'krig-code-block--mermaid');

  const toolbar = document.createElement('div');
  toolbar.classList.add('krig-code-block__toolbar');
  toolbar.setAttribute('contenteditable', 'false');
  dom.appendChild(toolbar);

  const createBtn = (icon: string, title: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.classList.add('krig-code-block__toolbar-btn');
    btn.innerHTML = icon;
    btn.title = title;
    return btn;
  };

  const langLabel = document.createElement('span');
  langLabel.classList.add('krig-code-block__lang-label');
  langLabel.textContent = 'mermaid';
  toolbar.appendChild(langLabel);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  toolbar.appendChild(spacer);

  const btnToggle = createBtn(ICON_EYE, '切换代码 / 预览');
  const btnCopy = createBtn(ICON_COPY, '复制代码');
  const btnDownload = createBtn(ICON_DOWNLOAD, '下载 PNG');
  const btnFullscreen = createBtn(ICON_FULLSCREEN, '全屏编辑');
  toolbar.appendChild(btnToggle);
  toolbar.appendChild(btnCopy);
  toolbar.appendChild(btnDownload);
  toolbar.appendChild(btnFullscreen);

  const pre = document.createElement('pre');
  pre.classList.add('krig-code-block__pre');
  const code = document.createElement('code');
  code.classList.add('krig-code-block__code', 'language-mermaid');
  pre.appendChild(code);
  dom.appendChild(pre);

  const preview = document.createElement('div');
  preview.classList.add('krig-code-block__preview', 'krig-code-block__mermaid');
  preview.setAttribute('contenteditable', 'false');
  dom.appendChild(preview);

  const updateViewMode = (mode: ViewMode): void => {
    viewMode = mode;
    btnToggle.classList.toggle('krig-code-block__toolbar-btn--active', mode === 'preview');
    btnToggle.title = mode === 'split' ? '隐藏代码' : '显示代码';
    pre.style.display = mode === 'preview' ? 'none' : '';
    dom.classList.toggle('krig-code-block--preview-only', mode === 'preview');
    preview.style.display = 'flex';
  };

  const renderMermaid = (source: string): void => {
    void renderMermaidDiagram(source, preview);
  };

  const scheduleRender = (): void => {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderMermaid(code.textContent || ''), 500);
  };

  btnToggle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const next: ViewMode = viewMode === 'split' ? 'preview' : 'split';
    updateViewMode(next);
    localStorage.setItem(LS_VIEW_KEY, next);
  });

  btnCopy.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(code.textContent || '').then(() => {
      btnCopy.classList.add('krig-code-block__toolbar-btn--copied');
      btnCopy.title = '已复制!';
      setTimeout(() => {
        btnCopy.classList.remove('krig-code-block__toolbar-btn--copied');
        btnCopy.title = '复制代码';
      }, 1500);
    });
  });

  btnDownload.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const svgEl = preview.querySelector('svg') as SVGElement | null;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGElement;
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
      const p = vb.split(/\s+/).map(Number);
      clone.setAttribute('width', String(p[2] || 800));
      clone.setAttribute('height', String(p[3] || 600));
    }
    const svgData = new XMLSerializer().serializeToString(clone);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * 2;
      canvas.height = img.naturalHeight * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => {
        if (b) downloadBlob(b, 'mermaid-diagram.png');
      }, 'image/png');
    };
    img.src = dataUri;
  });

  // 全屏编辑器:走 L2 fullscreen-overlay 体系
  btnFullscreen.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const instanceId = findInstanceId(view);
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (!instanceId || pos == null) return;
    setMermaidFullscreenContext({ instanceId, nodePos: pos });
    fullscreenOverlayController.show(FULLSCREEN_OVERLAY_ID);
  });

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(code, { childList: true, characterData: true, subtree: true });

  updateViewMode(viewMode);
  setTimeout(() => renderMermaid(code.textContent || ''), 50);

  return {
    dom,
    contentDOM: code,
    ignoreMutation(mutation) {
      return !code.contains(mutation.target);
    },
    update(updatedNode) {
      if (updatedNode.type.name !== 'codeBlock') return false;
      // 语言切出 mermaid → 让 PM destroy 重建走 plain 路径
      if (updatedNode.attrs.language !== 'mermaid') return false;
      scheduleRender();
      return true;
    },
    destroy() {
      observer.disconnect();
      if (renderTimer) clearTimeout(renderTimer);
    },
  };
}

export const codeBlockNodeView: NodeViewConstructor = (node, view, getPos) => {
  if (node.attrs.language === 'mermaid') {
    return buildMermaidCodeBlockView(node, view, getPos);
  }
  return buildGenericCodeBlockView(node, view, getPos);
};
