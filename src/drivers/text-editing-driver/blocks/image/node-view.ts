/**
 * image NodeView — 三态渲染 + Upload / Embed / Resize / SVG
 *
 * 三态:
 * - placeholder(无 src):🖼 + Upload + Embed link
 * - 普通图(有 src,非 SVG):<img> + 左右 resize handles
 * - SVG 图:<div> + safe innerHTML(剥离 script / on*)+ resize
 *
 * caption 区:contentDOM,V2 schema content='text-block',允许空段落
 *
 * 关键点:
 * - placeholder ↔ 图态切换 / SVG ↔ 普通图切换 → update 返回 false 让 PM 重建 NodeView
 * - alignment 写 attrs,渲染靠 wrapper 的 data-alignment(CSS 接管)
 * - resize 直接改 width attr;handle hover 才显示
 * - mediaPutBase64 走 IPC(@storage/media-store);失败时 fallback 直接用 data URL
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { mediaPutBase64 } from '@storage/media-store';
import {
  isSvgSrc,
  loadSvgContent,
  injectSvgStringSafe,
  injectSvgStyles,
} from './svg-helpers';

export const imageNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.className = 'krig-image-block';
  dom.setAttribute('data-alignment', (node.attrs.alignment as string) || 'center');

  const imgWrapper = document.createElement('div');
  imgWrapper.className = 'krig-image-block__wrapper';
  imgWrapper.contentEditable = 'false';
  dom.appendChild(imgWrapper);

  // caption 区(contentDOM,PM 接管)
  const captionDOM = document.createElement('div');
  captionDOM.className = 'krig-image-block__caption';
  dom.appendChild(captionDOM);

  // 当前态记录(给 update 检测态切换用)
  let currentSrc: string | null = (node.attrs.src as string | null) ?? null;
  let currentIsSvg = isSvgSrc(currentSrc);

  /** 写一组 attrs 到 PM(setNodeAttribute 不重验 content)*/
  function updateAttrs(patch: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(patch)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    view.dispatch(tr);
  }

  /** placeholder(无 src):Upload + Embed link */
  function buildPlaceholder(): void {
    imgWrapper.innerHTML = '';

    const placeholder = document.createElement('div');
    placeholder.className = 'krig-image-block__placeholder';

    const icon = document.createElement('span');
    icon.className = 'krig-image-block__placeholder-icon';
    icon.textContent = '🖼';
    placeholder.appendChild(icon);

    const actions = document.createElement('div');
    actions.className = 'krig-image-block__placeholder-actions';

    // Upload 按钮
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'krig-image-block__placeholder-btn';
    uploadBtn.textContent = 'Upload';
    uploadBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          const r = await mediaPutBase64(dataUrl, file.type, file.name);
          if (r.success && r.mediaUrl) {
            updateAttrs({ src: r.mediaUrl, alt: file.name });
          } else {
            // fallback:直接用 data URL(刷新后丢,但当前 session 能看)
            console.warn('[image] mediaPutBase64 failed:', r.error);
            updateAttrs({ src: dataUrl, alt: file.name });
          }
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
    actions.appendChild(uploadBtn);

    // Embed link
    const embedBtn = document.createElement('button');
    embedBtn.className = 'krig-image-block__placeholder-btn';
    embedBtn.textContent = 'Embed link';

    const embedInput = document.createElement('input');
    embedInput.type = 'text';
    embedInput.placeholder = 'Paste image URL...';
    embedInput.className = 'krig-image-block__placeholder-input';
    embedInput.style.display = 'none';

    embedBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isShown = embedInput.style.display !== 'none';
      if (isShown) {
        // 二次点击:提交
        const url = embedInput.value.trim();
        if (url) updateAttrs({ src: url });
      } else {
        embedInput.style.display = 'inline-block';
        queueMicrotask(() => embedInput.focus());
      }
    });
    embedInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = embedInput.value.trim();
        if (url) updateAttrs({ src: url });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        embedInput.style.display = 'none';
        embedInput.value = '';
      }
    });
    embedInput.addEventListener('mousedown', (e) => e.stopPropagation());
    actions.appendChild(embedBtn);
    actions.appendChild(embedInput);

    placeholder.appendChild(actions);
    imgWrapper.appendChild(placeholder);
  }

  /** 普通图态:<img> + resize handles */
  function buildImg(src: string): void {
    imgWrapper.innerHTML = '';

    const imgArea = document.createElement('div');
    imgArea.className = 'krig-image-block__img-area';

    const img = document.createElement('img');
    img.src = src;
    img.alt = (node.attrs.alt as string) || '';
    if (node.attrs.title) img.title = node.attrs.title as string;
    if (node.attrs.width) img.style.width = `${node.attrs.width}px`;

    img.addEventListener('load', () => {
      // 首次加载默认贴合容器宽度(不超过自然宽度,避免低分辨率小图被强行放大模糊)
      if (!node.attrs.width && !node.attrs.height) {
        const containerWidth = imgWrapper.clientWidth || imgArea.clientWidth || 0;
        const targetWidth =
          containerWidth > 0
            ? Math.min(containerWidth, img.naturalWidth)
            : img.naturalWidth;
        updateAttrs({ width: targetWidth, height: null });
      }
    });

    imgArea.appendChild(makeResizeHandle('left', img, imgArea));
    imgArea.appendChild(img);
    imgArea.appendChild(makeResizeHandle('right', img, imgArea));

    imgWrapper.appendChild(imgArea);
  }

  /** SVG 态:<div> + 安全 innerHTML + resize handles */
  function buildSvg(src: string): void {
    imgWrapper.innerHTML = '';

    const imgArea = document.createElement('div');
    imgArea.className = 'krig-image-block__img-area';

    const canvas = document.createElement('div');
    canvas.className = 'krig-image-block__svg-canvas';
    if (node.attrs.width) canvas.style.width = `${node.attrs.width}px`;

    // 异步加载
    loadSvgContent(src).then((svgText) => {
      if (svgText) {
        injectSvgStringSafe(canvas, svgText);
        injectSvgStyles(canvas);
        // 首次加载默认贴合容器宽度(SVG 矢量,放大不损失,贴满父级编辑器宽度)
        // 注意:imgWrapper / imgArea 是 inline-block,内容没尺寸时 clientWidth=0;
        //   读 dom.parentElement(ProseMirror 内容区)的 clientWidth 才稳
        if (!node.attrs.width && !node.attrs.height) {
          const parentEl = dom.parentElement;
          const containerWidth =
            parentEl?.clientWidth ||
            imgWrapper.clientWidth ||
            imgArea.clientWidth ||
            0;
          if (containerWidth > 0) {
            updateAttrs({ width: containerWidth, height: null });
          }
        }
      } else {
        canvas.textContent = '⚠ SVG 加载失败';
      }
    });

    imgArea.appendChild(makeResizeHandle('left', canvas, imgArea));
    imgArea.appendChild(canvas);
    imgArea.appendChild(makeResizeHandle('right', canvas, imgArea));

    imgWrapper.appendChild(imgArea);
  }

  /**
   * 创建 resize handle:鼠标拖拽改 target 的 width
   * - target 是要 resize 的元素(img / canvas)
   * - rect 容器用于计算实时宽度
   */
  function makeResizeHandle(
    side: 'left' | 'right',
    target: HTMLElement,
    rect: HTMLElement,
  ): HTMLElement {
    const handle = document.createElement('div');
    handle.className = `krig-image-block__resize-handle krig-image-block__resize-handle--${side}`;
    handle.contentEditable = 'false';
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = target.getBoundingClientRect().width;
      const sign = side === 'right' ? 1 : -1;
      rect.classList.add('krig-image-block__img-area--resizing');

      function onMove(ev: MouseEvent) {
        const delta = (ev.clientX - startX) * sign;
        const newWidth = Math.max(40, Math.round(startWidth + delta));
        target.style.width = `${newWidth}px`;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        rect.classList.remove('krig-image-block__img-area--resizing');
        const finalWidth = Math.round(target.getBoundingClientRect().width);
        updateAttrs({ width: finalWidth });
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    return handle;
  }

  /** 初始构建 */
  function rebuild(src: string | null): void {
    if (!src) {
      buildPlaceholder();
    } else if (isSvgSrc(src)) {
      buildSvg(src);
    } else {
      buildImg(src);
    }
  }

  rebuild(currentSrc);

  return {
    dom,
    contentDOM: captionDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'image') return false;
      const newSrc = (updatedNode.attrs.src as string | null) ?? null;
      const newIsSvg = isSvgSrc(newSrc);

      // 态切换 → 让 PM 重建 NodeView
      const stateChanged =
        (currentSrc === null) !== (newSrc === null) || currentIsSvg !== newIsSvg;
      if (stateChanged) return false;

      // 同一态内的 attr 更新
      dom.setAttribute(
        'data-alignment',
        (updatedNode.attrs.alignment as string) || 'center',
      );

      if (newSrc) {
        // 普通图:更新 src / alt / title / width
        if (!newIsSvg) {
          const img = dom.querySelector('img') as HTMLImageElement | null;
          if (img) {
            if (img.src !== newSrc) img.src = newSrc;
            img.alt = (updatedNode.attrs.alt as string) || '';
            img.title = (updatedNode.attrs.title as string) || '';
            const w = updatedNode.attrs.width as number | null;
            img.style.width = w ? `${w}px` : '';
          }
        } else {
          // SVG:src 变了重新加载
          const canvas = dom.querySelector('.krig-image-block__svg-canvas') as
            | HTMLElement
            | null;
          if (canvas && newSrc !== currentSrc) {
            loadSvgContent(newSrc).then((svgText) => {
              if (svgText) {
                injectSvgStringSafe(canvas, svgText);
                injectSvgStyles(canvas);
              }
            });
          }
          if (canvas) {
            const w = updatedNode.attrs.width as number | null;
            canvas.style.width = w ? `${w}px` : '';
          }
        }
      }

      currentSrc = newSrc;
      currentIsSvg = newIsSvg;
      return true;
    },
    selectNode() {
      dom.classList.add('krig-image-block--selected');
    },
    deselectNode() {
      dom.classList.remove('krig-image-block--selected');
    },
    stopEvent(event) {
      // placeholder 内的输入 / 按钮交互不要被 PM 拦
      const target = event.target as HTMLElement | null;
      if (target?.closest('.krig-image-block__placeholder')) return true;
      // resize handle 拖拽
      if (target?.closest('.krig-image-block__resize-handle')) return true;
      return false;
    },
    ignoreMutation(mutation) {
      // imgWrapper 是非 contentEditable,内部 DOM 变化(SVG 注入 / resize style 更新等)不报告
      const target = mutation.target as Node;
      if (imgWrapper.contains(target)) return true;
      return false;
    },
  };
};
