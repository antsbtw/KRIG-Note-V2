/**
 * htmlBlock NodeView — 两态 HTML 预览
 *
 * 两态:
 * - placeholder(无 src):🌐 + Upload .html / Embed URL 输入(参考 audio-block)
 * - render(有 src):iframe.src = media:// URL + postMessage 测高 bridge
 *
 * 为什么直接走 iframe.src 而不是 srcdoc / doc.write(2026-05-19 重定):
 *   - doc.write 同 origin:iframe 继承 parent CSP(`script-src 'self'`)→ AI
 *     artifact 内的 inline / 跨域 script 全部被拦,Chart.js / D3 完全跑不动。
 *   - srcdoc + sandbox:Chromium 规范 srcdoc 仍继承父框架 CSP(即使 sandbox 让
 *     origin 变 opaque),实测同样被 script-src 'self' 拦。
 *   - blob: URL:W3C CSP3 spec 把 blob: / filesystem: 列为 local scheme,继承
 *     创建者 CSP,同样不行。
 *   - 自定义 standard scheme(media://):有独立 origin,**不继承 parent CSP**,
 *     iframe 内文档自己的 CSP(我们不注 meta = 无)→ inline / 跨域 script 自由
 *     执行。这是唯一干净路径。
 *
 *   Trade-off:iframe 与 parent 跨 origin,parent 读不到 contentDocument →
 *   自动高度走 iframe 内 bridge script + parent.postMessage 回传(主进程
 *   media:// handler 在 .html 响应中注入 theme + bridge,见 media-store-impl)。
 *   源码视图改用 loadHtmlContent 拉原始文件文本。
 *
 * 工具栏:{} 切换源码视图 / ↗ 在右栏 web-view 打开同一文件。
 * caption:contentDOM(figcaption)由 PM 接管。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64 } from '@capabilities/media-storage';
import { commandRegistry } from '@slot/command-registry/command-registry';

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
  let currentSrc: string | null = null;
  // 缓存当前 src 加载到的 HTML 源码,供 {} 源码视图直接渲染(跨 origin 后无法读 contentDocument)。
  let currentHtmlText: string | null = null;
  // 用户拖拽手动覆盖高度后(写入 attrs.height),不再自动跟随 bridge postMessage 回传的高度。
  let userOverrideHeight = false;

  // 跨 origin iframe 通过 postMessage 回传高度;listener 挂 window,在 destroy 中移除。
  //
  // 防反馈环:Chart.js / D3 等 responsive lib 在 iframe 内会监听 body 大小,iframe
  // 自身高度变化触发 body resize,RO 再次报告新高度 → 无限放大。两道闸:
  //   1. 阈值过滤:新高度跟当前高度差 < FEEDBACK_DEAD_BAND px 直接忽略
  //   2. 单调升高:report 涨势达到平台后只接受小幅波动,不再追逐 lib 跨次重排
  let lastReportedHeight = 0;
  const FEEDBACK_DEAD_BAND_PX = 8;
  function onBridgeMessage(e: MessageEvent): void {
    const data = e.data as { tag?: string; height?: number } | null;
    if (!data || data.tag !== 'krig-html-resize') return;
    if (!iframeEl || e.source !== iframeEl.contentWindow) return;
    if (userOverrideHeight) return;
    const h = data.height;
    if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return;
    if (Math.abs(h - lastReportedHeight) < FEEDBACK_DEAD_BAND_PX) return;
    lastReportedHeight = h;
    iframeEl.style.height = `${Math.min(h + HEIGHT_BUFFER_PX, HEIGHT_CAP_PX)}px`;
  }
  window.addEventListener('message', onBridgeMessage);

  function updateAttrs(patch: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(patch)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    tr.setMeta('addToHistory', false); // 内部 attr 同步不进 undo 栈
    view.dispatch(tr);
  }

  function disposeIframe(): void {
    if (iframeEl) {
      const io = (iframeEl as unknown as { __krigIO?: IntersectionObserver }).__krigIO;
      if (io) io.disconnect();
    }
    iframeEl = null;
    currentSrc = null;
    currentHtmlText = null;
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
    // sandbox 后 parent 读不到 contentDocument,改用缓存的源码文本;若 race 期还没就位再 fetch 一次。
    if (currentHtmlText) {
      pre.textContent = currentHtmlText;
    } else {
      loadHtmlContent(src).then((html) => {
        if (html) pre.textContent = html;
      });
    }
    renderWrap.appendChild(pre);
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
  /**
   * Resize 拖动 — Pointer Capture + movementY + 临时 spacer 让 scrollHeight 守恒
   *
   * 多回合反复试错的根因(诊断日志铁证):
   *
   * 用户拖动开始时若 note 容器已经滚到底部(scrollTop == scrollMax),iframe 缩短
   * 会让 scrollHeight 减小 → 浏览器自动 clamp scrollTop 到新上限(规范行为)。
   *
   * 结果:handle DOM offsetTop 减小 X 像素 + scrollTop 同步减少 X 像素 → viewport
   * 上互相抵消,handle viewport Y 完全不变 — 用户看到 "==" 钉在原位不跟鼠标走,
   * 即便 iframe 真的在缩短(渲染区在视口外用户也看不见)。
   *
   * 修法:拖动期间在 handle 后插一个 spacer div,高度 = (initialHeight - currentHeight)。
   * iframe 缩 X 则 spacer 补 X,scrollHeight 全程保持初始值不变 → scrollTop 不被
   * clamp → handle DOM offsetTop 真的减小 → viewport Y 自然跟鼠标。
   *
   * pointerup 移除 spacer,scrollHeight 自然回到含新 iframe height 的真实值。
   */
  function setupHeightResize(handle: HTMLElement, iframe: HTMLIFrameElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      userOverrideHeight = true;
      handle.setPointerCapture(e.pointerId);

      const initialIframeHeight = iframe.offsetHeight;
      const spacer = document.createElement('div');
      spacer.style.height = '0px';
      spacer.style.pointerEvents = 'none';
      handle.parentElement?.insertBefore(spacer, handle.nextSibling);

      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';

      const onPointerMove = (ev: PointerEvent) => {
        const dy = ev.movementY;
        if (dy === 0) return;
        const newHeight = Math.max(HEIGHT_MIN_PX, iframe.offsetHeight + dy);
        iframe.style.height = `${newHeight}px`;
        const shrinkage = initialIframeHeight - newHeight;
        spacer.style.height = `${Math.max(0, shrinkage)}px`;
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
        spacer.remove();
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

    // iframe.src = media:// → 跨 origin(独立 standard scheme),不继承 parent CSP。
    // 主进程 media:// handler 拦截 .html 响应,在 <body> 末插入 theme + bridge script,
    // bridge 通过 parent.postMessage 报告高度,parent 端 onBridgeMessage 接收。
    const iframe = document.createElement('iframe');
    iframe.className = 'krig-html-block__iframe';
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    iframe.style.backgroundColor = '#ffffff';
    // 用户已拖过 → 沿用用户高度;否则初始 0,等 bridge postMessage 报高度后撑开。
    iframe.style.height = userOverrideHeight ? `${n.attrs.height as number}px` : '0px';
    iframe.src = src;
    iframeEl = iframe;

    renderWrap.appendChild(iframe);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'krig-html-block__resize-handle';
    setupHeightResize(resizeHandle, iframe);
    renderWrap.appendChild(resizeHandle);

    // 源码视图需要原始文本,异步拉一份缓存。
    loadHtmlContent(src).then((html) => {
      if (!html || view.isDestroyed) return;
      if (iframeEl !== iframe) return;
      currentHtmlText = html;
    });

    // iframe 可能被 toggle 折叠 / 滚出视口而初次测高为 0;变可见时通知 bridge 重测。
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ tag: 'krig-html-remeasure' }, '*');
          }
        }
      });
      io.observe(iframe);
      // 关联到 iframe 元素上,disposeIframe 时一起清。
      (iframe as unknown as { __krigIO?: IntersectionObserver }).__krigIO = io;
    }
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
            // 撤回手动高度:等 iframe 内 bridge 下一次 ResizeObserver tick 自动报高度撑回。
            userOverrideHeight = false;
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
      window.removeEventListener('message', onBridgeMessage);
      disposeIframe();
    },
  };
};
