/**
 * htmlBlock NodeView — 两态 HTML 预览(V1 → V2 直迁)
 *
 * V1 直迁:src/plugins/note/blocks/html-block.ts NodeView 部分
 *
 * 两态:
 * - placeholder(无 src):🌐 + Upload .html / Embed URL 输入(参考 audio-block)
 * - render(有 src):sandbox iframe + srcdoc 注入主题 + 高度上报脚本 + 拖拽 handle + 工具栏
 *
 * 高度自适应:iframe 内 MutationObserver/load 用 postMessage 上报,parent
 *   监听 'krig-iframe-height' 设 iframe height,上限 min(reported+20, 4000) — V1 line 204。
 *
 * 工具栏:{} 切换源码视图 / ↗ 在新窗口打开 — 二者都通过 loadHtmlContent
 *   拉取 srcdoc(支持 media:// / data:text/html;base64 / http(s))。
 *
 * caption:contentDOM(figcaption)由 PM 接管 — 与 audio-block / image 一致。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64 } from '@capabilities/media-storage';
import { iframeThemeStyleTag } from './iframe-theme';

const HEIGHT_CAP_PX = 4000;
const HEIGHT_BUFFER_PX = 20;
const HEIGHT_MIN_PX = 100;

async function loadHtmlContent(src: string): Promise<string | null> {
  try {
    if (src.startsWith('data:text/html;base64,')) {
      const binary = atob(src.split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }

    try {
      const response = await fetch(src);
      if (response.ok) {
        const buf = await response.arrayBuffer();
        const text = new TextDecoder('utf-8').decode(buf);
        if (text.length > 0) return text;
      }
    } catch {
      /* fall through to XHR */
    }

    return new Promise<string | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', src, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        if (xhr.response) {
          const text = new TextDecoder('utf-8').decode(xhr.response);
          resolve(text.length > 0 ? text : null);
        } else {
          resolve(null);
        }
      };
      xhr.onerror = () => resolve(null);
      xhr.send();
    });
  } catch {
    return null;
  }
}

function injectThemeAndHeightScript(html: string): string {
  const themeStyle = iframeThemeStyleTag();
  const heightScript = `<script>
(function() {
  var lastH = 0;
  function reportHeight() {
    var h = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
    if (h !== lastH && h > 0) {
      lastH = h;
      parent.postMessage({ type: 'krig-iframe-height', height: h }, '*');
    }
  }
  window.addEventListener('load', function() { setTimeout(reportHeight, 50); });
  new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
  setTimeout(reportHeight, 200);
  setTimeout(reportHeight, 1000);
  setTimeout(reportHeight, 3000);
})();
</script>`;

  let prepared = html;
  if (prepared.includes('</head>')) {
    prepared = prepared.replace('</head>', themeStyle + '</head>');
  } else if (prepared.includes('<body')) {
    prepared = prepared.replace('<body', themeStyle + '<body');
  } else {
    prepared = themeStyle + prepared;
  }

  if (prepared.includes('</body>')) {
    return prepared.replace('</body>', heightScript + '</body>');
  }
  return prepared + heightScript;
}

export const htmlBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');
  dom.className = 'krig-html-block';

  // render 区(contentEditable=false,完全 NodeView 控制 — placeholder 或 iframe)
  const renderWrap = document.createElement('div');
  renderWrap.className = 'krig-html-block__render';
  renderWrap.contentEditable = 'false';
  dom.appendChild(renderWrap);

  // caption 区(contentDOM,PM 接管)
  const captionDOM = document.createElement('figcaption');
  captionDOM.className = 'krig-html-block__caption';
  dom.appendChild(captionDOM);

  let messageListener: ((e: MessageEvent) => void) | null = null;
  let iframeEl: HTMLIFrameElement | null = null;
  let currentSrc: string | null = null;

  function updateAttrs(patch: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(patch)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    view.dispatch(tr);
  }

  function disposeIframe(): void {
    if (messageListener) {
      window.removeEventListener('message', messageListener);
      messageListener = null;
    }
    iframeEl = null;
    currentSrc = null;
  }

  function buildPlaceholder(): void {
    disposeIframe();
    renderWrap.innerHTML = '';

    const ph = document.createElement('div');
    ph.className = 'krig-html-block__placeholder';

    const icon = document.createElement('span');
    icon.className = 'krig-html-block__placeholder-icon';
    icon.textContent = '🌐';
    ph.appendChild(icon);

    const actions = document.createElement('div');
    actions.className = 'krig-html-block__placeholder-actions';

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'krig-html-block__placeholder-btn';
    uploadBtn.textContent = 'Upload HTML';
    uploadBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.html,.htm';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          if (view.isDestroyed) return;
          const dataUrl = reader.result as string;
          const mimeType = file.type || 'text/html';
          const r = await mediaPutBase64(dataUrl, mimeType, file.name);
          if (view.isDestroyed) return;
          if (r.success && r.mediaUrl) {
            updateAttrs({
              src: r.mediaUrl,
              title: file.name.replace(/\.[^.]+$/, ''),
            });
          } else {
            console.warn('[htmlBlock] mediaPutBase64 failed:', r.error);
            updateAttrs({
              src: dataUrl,
              title: file.name.replace(/\.[^.]+$/, ''),
            });
          }
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
    actions.appendChild(uploadBtn);

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'krig-html-block__placeholder-url';
    urlInput.placeholder = 'Paste HTML URL (http / https / media:// / data:text/html;base64,...)';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url) updateAttrs({ src: url });
      }
    });
    actions.appendChild(urlInput);

    ph.appendChild(actions);
    renderWrap.appendChild(ph);
  }

  function buildToolbar(src: string): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'krig-html-block__toolbar';

    const sourceBtn = document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.className = 'krig-html-block__toolbar-btn';
    sourceBtn.textContent = '{ }';
    sourceBtn.title = '查看源码';
    sourceBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSourceView(src);
    });
    toolbar.appendChild(sourceBtn);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'krig-html-block__toolbar-btn';
    openBtn.textContent = '↗';
    openBtn.title = '在新窗口中打开';
    openBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const html = await loadHtmlContent(src);
      if (html) {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    });
    toolbar.appendChild(openBtn);

    return toolbar;
  }

  function toggleSourceView(src: string): void {
    const existing = renderWrap.querySelector('.krig-html-block__source') as HTMLElement | null;
    if (existing) {
      existing.remove();
      if (iframeEl) iframeEl.style.display = 'block';
      return;
    }
    if (iframeEl) iframeEl.style.display = 'none';
    const pre = document.createElement('pre');
    pre.className = 'krig-html-block__source';
    loadHtmlContent(src).then((html) => {
      if (html) pre.textContent = html;
    });
    renderWrap.appendChild(pre);
  }

  function setupHeightResize(handle: HTMLElement, iframe: HTMLIFrameElement): void {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startHeight = iframe.offsetHeight;

      const onMouseMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startY;
        const newHeight = Math.max(HEIGHT_MIN_PX, startHeight + dy);
        iframe.style.height = `${newHeight}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (view.isDestroyed) return;
        updateAttrs({ height: iframe.offsetHeight });
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function buildRender(n: PMNode): void {
    disposeIframe();
    renderWrap.innerHTML = '';

    const src = n.attrs.src as string;
    currentSrc = src;

    const toolbar = buildToolbar(src);
    renderWrap.appendChild(toolbar);

    const iframe = document.createElement('iframe');
    iframe.className = 'krig-html-block__iframe';
    iframe.setAttribute('sandbox', (n.attrs.sandbox as string) || 'allow-scripts');
    iframe.style.width = '100%';
    iframe.style.height = n.attrs.height ? `${n.attrs.height as number}px` : '0px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    iframe.style.backgroundColor = '#ffffff';
    iframeEl = iframe;

    loadHtmlContent(src).then((html) => {
      if (!html || view.isDestroyed) return;
      if (iframeEl !== iframe) return;
      iframe.srcdoc = injectThemeAndHeightScript(html);
    });

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'krig-iframe-height' && typeof e.data.height === 'number') {
        if (e.source === iframe.contentWindow) {
          const h = Math.min(e.data.height + HEIGHT_BUFFER_PX, HEIGHT_CAP_PX);
          iframe.style.height = `${h}px`;
        }
      }
    };
    window.addEventListener('message', onMessage);
    messageListener = onMessage;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'krig-html-block__resize-handle';
    setupHeightResize(resizeHandle, iframe);

    renderWrap.appendChild(iframe);
    renderWrap.appendChild(resizeHandle);
  }

  function paint(n: PMNode): void {
    if (n.attrs.src) buildRender(n);
    else buildPlaceholder();
  }

  paint(node);

  return {
    dom,
    contentDOM: captionDOM,
    update(updated) {
      if (updated.type.name !== 'htmlBlock') return false;
      const hadSrc = !!node.attrs.src;
      const hasSrc = !!updated.attrs.src;
      const oldSrc = node.attrs.src;
      const oldHeight = node.attrs.height;
      node = updated;
      if (hadSrc !== hasSrc) {
        paint(node);
      } else if (hasSrc) {
        if (oldSrc !== updated.attrs.src) {
          buildRender(updated);
        } else if (oldHeight !== updated.attrs.height && iframeEl && currentSrc === updated.attrs.src) {
          if (updated.attrs.height) {
            iframeEl.style.height = `${updated.attrs.height as number}px`;
          }
        }
      }
      return true;
    },
    stopEvent(event) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(
        '.krig-html-block__placeholder, .krig-html-block__toolbar, .krig-html-block__resize-handle, .krig-html-block__iframe',
      )) {
        return true;
      }
      return false;
    },
    // renderWrap 子树由 NodeView 完全控制(iframe srcdoc 写入 / resize 改 height /
    // placeholder→render 切换都会触发 mutation);若不忽略 PM 会以为 DOM 偏离 doc
    // 反复销毁重建 NodeView → 死循环。captionDOM 由 PM 接管不在此守门内。
    ignoreMutation(mutation) {
      return mutation.target === renderWrap || renderWrap.contains(mutation.target as Node);
    },
    destroy() {
      disposeIframe();
    },
  };
};
