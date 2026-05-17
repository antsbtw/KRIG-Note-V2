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
  let wrapEl: HTMLDivElement | null = null;
  let bodyObserver: ResizeObserver | null = null;
  let wrapObserver: ResizeObserver | null = null;
  let currentSrc: string | null = null;
  // 用户拖拽手动覆盖高度后(写入 attrs.height),不再自动跟随 body ResizeObserver。
  let userOverrideHeight = false;
  // 程序刚 set 的 wrap height — wrapObserver 看到与此一致的尺寸忽略,只反应用户拖动。
  let lastSetWrapHeight = 0;
  // 用户拖动结束后 debounce 写 attrs.height(防 RO 触发过密)。
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
    if (wrapObserver) {
      wrapObserver.disconnect();
      wrapObserver = null;
    }
    if (persistTimer != null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    iframeEl = null;
    wrapEl = null;
    currentSrc = null;
    userOverrideHeight = false;
    lastSetWrapHeight = 0;
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

  /** 设 wrap 高度,同步记录 lastSetWrapHeight 防 wrap RO 当作"用户拖动" */
  function setWrapHeight(wrap: HTMLDivElement, h: number): void {
    lastSetWrapHeight = h;
    wrap.style.height = `${h}px`;
  }

  function applyAutoHeight(iframe: HTMLIFrameElement, wrap: HTMLDivElement): void {
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
      setWrapHeight(wrap, Math.min(h + HEIGHT_BUFFER_PX, HEIGHT_CAP_PX));
    }
  }

  function buildRender(n: PMNode): void {
    disposeIframe();
    renderWrap.innerHTML = '';

    const src = n.attrs.src as string;
    currentSrc = src;
    userOverrideHeight = n.attrs.height != null;

    const toolbar = buildToolbar(src);
    renderWrap.appendChild(toolbar);

    // wrap div:CSS resize:vertical 浏览器原生拖柄(右下角)— 业界标准做法,
    // 浏览器内部处理所有拖动边界情况(viewport / cursor / 容器滚动等)。
    // iframe 在 wrap 内 100% 撑满。
    const wrap = document.createElement('div');
    wrap.className = 'krig-html-block__iframe-wrap';
    const initialHeight = userOverrideHeight
      ? (n.attrs.height as number)
      : HEIGHT_MIN_PX; // body 内容加载后由 applyAutoHeight 撑到实际高度
    setWrapHeight(wrap, initialHeight);
    wrapEl = wrap;

    // 无 sandbox 属性 — iframe 与 parent 同 origin,parent 可直接读 contentDocument。
    const iframe = document.createElement('iframe');
    iframe.className = 'krig-html-block__iframe';
    iframeEl = iframe;
    wrap.appendChild(iframe);

    renderWrap.appendChild(wrap);

    // wrap 尺寸变化监听器 — 区分"程序设的"vs"用户拖的":
    // 用户拖 CSS resize 拖柄 → wrap height 与 lastSetWrapHeight 不一致 →
    // debounce 300ms 后持久化 attrs.height + 锁 userOverrideHeight。
    wrapObserver = new ResizeObserver(() => {
      if (!wrapEl) return;
      const h = wrapEl.offsetHeight;
      if (Math.abs(h - lastSetWrapHeight) < 2) return; // 程序自己设的,忽略
      // 用户拖动 → 锁定 + debounce 持久化
      userOverrideHeight = true;
      lastSetWrapHeight = h;
      if (persistTimer != null) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        if (view.isDestroyed) return;
        if (!wrapEl) return;
        updateAttrs({ height: wrapEl.offsetHeight });
      }, 300);
    });
    wrapObserver.observe(wrap);

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

      // 首次撑高(若用户未手动覆盖)
      applyAutoHeight(iframe, wrap);

      // 监听 body 内容变化(D3 / Chart 等动态生成元素)自动跟随
      if (doc.body) {
        bodyObserver = new ResizeObserver(() => applyAutoHeight(iframe, wrap));
        bodyObserver.observe(doc.body);
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
        } else if (oldHeight !== updated.attrs.height && wrapEl && iframeEl && currentSrc === updated.attrs.src) {
          if (updated.attrs.height != null) {
            setWrapHeight(wrapEl, updated.attrs.height as number);
            userOverrideHeight = true;
          } else {
            userOverrideHeight = false;
            applyAutoHeight(iframeEl, wrapEl);
          }
        }
      }
      return true;
    },
    stopEvent(event) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(
        '.krig-html-block__placeholder, .krig-html-block__toolbar, .krig-html-block__iframe-wrap, .krig-html-block__iframe',
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
