/**
 * codeBlock NodeView — Mermaid 专用 (V2 最小迁移)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/code-block.ts(剪掉非 mermaid 部分)
 *
 * 行为:
 * - attrs.language !== 'mermaid':构造 <pre class="krig-code-block"><code> 普通代码块
 * - attrs.language === 'mermaid':渲染工具栏 + 代码区 + 预览区,支持分屏/纯预览切换、
 *   下载 PNG
 *
 * NodeView 工厂始终返回完整 NodeView 对象(PM 不接受 undefined / null)。
 *
 * 不带:
 * - 全屏编辑器(架构需要走 V2 popup 体系重写;手工 appendChild 浮层在 V2 PM+slot
 *   架构里 hit-test 会被 PM 事件流抢走,详见 TODO)
 * - 语言下拉(V2 暂无 UI;mermaid block 走专门 slash 命令创建)
 * - ? 语法参考面板(对齐 mathBlock 做法,V1 LaTeX help-panel 也被砍)
 * - 多语言插件框架(V1 code-plugins 不迁,本期只迁 mermaid)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { renderMermaidDiagram } from './mermaid-renderer';
import { downloadBlob } from './save-blob';

const LS_VIEW_KEY = 'krig-mermaid-view-mode';
type ViewMode = 'split' | 'preview';

const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

/** 非 mermaid 的纯代码块 NodeView (等价 spec.toDOM 的 <pre class="krig-code-block"><code>) */
function buildPlainCodeBlockView(language: string): ReturnType<NodeViewConstructor> {
  const dom = document.createElement('pre');
  dom.classList.add('krig-code-block');
  const code = document.createElement('code');
  if (language) code.className = `language-${language}`;
  dom.appendChild(code);
  return {
    dom,
    contentDOM: code,
    update(updatedNode) {
      if (updatedNode.type.name !== 'codeBlock') return false;
      // 语言切到 / 切出 mermaid 都让 PM destroy 重建
      if (updatedNode.attrs.language === 'mermaid') return false;
      const newLang = updatedNode.attrs.language as string;
      code.className = newLang ? `language-${newLang}` : '';
      return true;
    },
  };
}

/** Mermaid NodeView:工具栏 + 代码区 + 预览区 */
function buildMermaidCodeBlockView(
  _initialNode: Parameters<NodeViewConstructor>[0],
  _view: Parameters<NodeViewConstructor>[1],
  _getPos: Parameters<NodeViewConstructor>[2],
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
  toolbar.appendChild(btnToggle);
  toolbar.appendChild(btnCopy);
  toolbar.appendChild(btnDownload);

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

  // 全屏编辑器已砍 — 待 V2 popup 体系重写后补回

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
  return buildPlainCodeBlockView(node.attrs.language as string);
};
