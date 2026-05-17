/**
 * htmlBlock NodeView — 两态 HTML 预览
 *
 * 两态:
 * - placeholder(无 src):🌐 + Upload .html / Embed URL 输入(参考 audio-block)
 * - render(有 src):same-origin iframe + parent 直接 DOM 写入 + ResizeObserver
 *
 * 设计要点 — 为什么不用 sandbox:
 *   V2 默认 CSP `script-src 'self'` 拦 inline / blob script,而 sandbox iframe
 *   下 parent 又读不到 contentDocument 来主动测量高度 → 自动高度死路。
 *   去 sandbox 后 iframe 与 parent 同 origin,parent 直接 contentDocument.open
 *   /write/close 注入 HTML,然后 ResizeObserver 监听 body 高度,无需 iframe 内
 *   任何脚本通信。Trade-off:HTML 内 script 能读 KRIG window 状态 — KRIG 是
 *   本地 app 无敏感 cookie/session,HTML 来源仅用户自己上传,接受此 trade-off。
 *
 * 工具栏:{} 切换源码视图 / ↗ 在新窗口打开(blob URL window.open,这里不进 iframe)。
 * caption:contentDOM(figcaption)由 PM 接管。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64 } from '@capabilities/media-storage';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { iframeThemeStyleTag } from './iframe-theme';

const HEIGHT_CAP_PX = 4000;
const HEIGHT_BUFFER_PX = 4;
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

function injectTheme(html: string): string {
  const themeStyle = iframeThemeStyleTag();
  if (html.includes('</head>')) return html.replace('</head>', themeStyle + '</head>');
  if (html.includes('<body')) return html.replace('<body', themeStyle + '<body');
  return themeStyle + html;
}

export const htmlBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');
  dom.className = 'krig-html-block';

  // render 区(contentEditable=false,完全 NodeView 控制)
  const renderWrap = document.createElement('div');
  renderWrap.className = 'krig-html-block__render';
  renderWrap.contentEditable = 'false';
  dom.appendChild(renderWrap);

  // caption 区(contentDOM,PM 接管)
  const captionDOM = document.createElement('figcaption');
  captionDOM.className = 'krig-html-block__caption';
  dom.appendChild(captionDOM);

  let iframeEl: HTMLIFrameElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let currentSrc: string | null = null;
  // 用户拖拽手动覆盖高度后(写入 attrs.height),不再自动跟随 ResizeObserver。
  let userOverrideHeight = false;

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
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    iframeEl = null;
    currentSrc = null;
    userOverrideHeight = false;
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
    openBtn.title = '在右栏 web view 中打开';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 跨 view 走命令注册(charter §1.2):web-view 自己决定怎么加载 URL —
      // src 可能是 media:// / http(s) / data:。webview 是独立 partition 进程,
      // parent iframe 渲染不受影响(双处同时存在)。
      commandRegistry.execute('web-view.open-url', src);
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

  function applyAutoHeight(iframe: HTMLIFrameElement): void {
    if (userOverrideHeight) return;
    const doc = iframe.contentDocument;
    if (!doc?.documentElement) return;
    const h = Math.max(
      doc.body?.scrollHeight ?? 0,
      doc.body?.offsetHeight ?? 0,
      doc.documentElement.scrollHeight,
      doc.documentElement.offsetHeight,
    );
    if (h > 0) {
      iframe.style.height = `${Math.min(h + HEIGHT_BUFFER_PX, HEIGHT_CAP_PX)}px`;
    }
  }

  /** 找最近的 overflow:auto/scroll 滚动祖先(note 容器),用于拖动期间让 handle
   *  保持跟鼠标 viewport Y 一致 — 即"== 一定要和鼠标绑定"。 */
  function findScrollContainer(el: HTMLElement): HTMLElement | null {
    let cur: HTMLElement | null = el.parentElement;
    while (cur && cur !== document.body) {
      const overflow = getComputedStyle(cur).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * Resize handle 拖动 — Pointer Capture + movementY + "handle 绑鼠标" scrollTop 补偿
   *
   * 设计目标(用户明确表述):
   * - 鼠标向上拖 dy 像素 → handle / caption / 后续内容 在屏幕上**同步上移** dy
   * - iframe 顶部保持 DOM 位置不变(A 模式),height 减 dy
   * - "==" 拖柄始终绑定鼠标 viewport Y 位置
   *
   * 当 iframe 比视口大时,A 模式下 handle 在 DOM 中虽然跟随 iframe bottom 移动,
   * 但其 viewport 位置可能在视口外用户看不到。要让用户视觉感受到"handle 跟鼠标走",
   * 需主动滚动 note 容器,使 handle.getBoundingClientRect().top 紧跟鼠标 clientY。
   */
  function setupHeightResize(handle: HTMLElement, iframe: HTMLIFrameElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      userOverrideHeight = true;
      handle.setPointerCapture(e.pointerId);

      const scrollContainer = findScrollContainer(handle);

      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';

      const onPointerMove = (ev: PointerEvent) => {
        const dy = ev.movementY;
        if (dy === 0) return;

        const currentHeight = iframe.offsetHeight;
        const newHeight = Math.max(HEIGHT_MIN_PX, currentHeight + dy);
        iframe.style.height = `${newHeight}px`;

        // "== 和鼠标绑定" — 每帧把 handle 滚到鼠标 viewport Y 位置。
        // 即便 iframe 比视口高 / 鼠标推到屏幕外都成立:movementY 不受 viewport
        // 限制,iframe 持续缩;scrollTop 调整让 handle 视口位置追上鼠标。
        if (scrollContainer) {
          const handleRect = handle.getBoundingClientRect();
          const handleCenterY = handleRect.top + handleRect.height / 2;
          const diff = handleCenterY - ev.clientY;
          if (Math.abs(diff) > 1) {
            scrollContainer.scrollTop += diff;
          }
        }
      };

      const onPointerUp = () => {
        const finalH = iframe.offsetHeight;
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerUp);
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {
          /* capture released, ignore */
        }
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        if (view.isDestroyed) return;
        updateAttrs({ height: finalH });
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  }

  function buildRender(n: PMNode): void {
    disposeIframe();
    renderWrap.innerHTML = '';

    const src = n.attrs.src as string;
    currentSrc = src;
    userOverrideHeight = n.attrs.height != null;

    const toolbar = buildToolbar(src);
    renderWrap.appendChild(toolbar);

    // 无 sandbox 属性 — iframe 与 parent 同 origin,parent 可直接读 contentDocument。
    const iframe = document.createElement('iframe');
    iframe.className = 'krig-html-block__iframe';
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    iframe.style.backgroundColor = '#ffffff';
    // 用户已拖过 → 沿用用户高度;否则初始 0,等内容加载完 ResizeObserver 自动撑高。
    iframe.style.height = userOverrideHeight ? `${n.attrs.height as number}px` : '0px';
    iframeEl = iframe;

    renderWrap.appendChild(iframe);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'krig-html-block__resize-handle';
    setupHeightResize(resizeHandle, iframe);
    renderWrap.appendChild(resizeHandle);

    // 加载 + 同 origin 写入 — iframe 默认 src=about:blank 即与 parent 同 origin。
    loadHtmlContent(src).then((html) => {
      if (!html || view.isDestroyed) return;
      if (iframeEl !== iframe) return;
      const prepared = injectTheme(html);
      const doc = iframe.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(prepared);
      doc.close();

      // 首次撑高
      applyAutoHeight(iframe);

      // 监听 body 内容变化(D3 / Chart 等动态生成元素)自动跟随
      if (doc.body) {
        resizeObserver = new ResizeObserver(() => applyAutoHeight(iframe));
        resizeObserver.observe(doc.body);
      }
    });
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
          if (updated.attrs.height != null) {
            iframeEl.style.height = `${updated.attrs.height as number}px`;
            userOverrideHeight = true;
          } else {
            userOverrideHeight = false;
            applyAutoHeight(iframeEl);
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
    ignoreMutation(mutation) {
      return mutation.target === renderWrap || renderWrap.contains(mutation.target as Node);
    },
    destroy() {
      disposeIframe();
    },
  };
};
