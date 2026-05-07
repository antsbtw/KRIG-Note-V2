/**
 * SVG 辅助 — image block 的 SVG 直接 DOM 插入路径
 *
 * V1 来源:src/plugins/note/blocks/image.ts(loadSvgContent / injectSvgStyles)
 *
 * 为什么 SVG 要走 innerHTML 而不是 <img>:
 * - <img src="*.svg"> 把 SVG 当独立 document 渲染,主页面 CSS 变量(--xxx)失效
 * - 字体 fallback 失败(SVG 内 text 元素无法继承外部字体)
 * - 内部事件 / a11y 标签等都被 sandbox
 * 走 <div> + innerHTML 后 SVG 跟主 DOM 树合并,这些问题消失
 *
 * 安全(L5-B3.5 风险 § 8.2 改进 V1):
 * - V1 直接 innerHTML,SVG 内 <script> / on* 事件可能执行(同源)
 * - V2 加 sanitize:剥离 <script> 节点 + on* 属性 + javascript: URL
 *   不引 DOMPurify(~50KB 重 + V2 暂无外部 npm 加包习惯),手写一个轻量级清洗
 */

/**
 * 判断 src 是否是 SVG
 */
export function isSvgSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  return src.endsWith('.svg') || src.startsWith('data:image/svg+xml');
}

/**
 * 加载 SVG 文本内容(支持 data:image/svg+xml;base64 / 普通 URL)
 *
 * 先 fetch,失败时退到 XHR(自定义协议如 media:// 在某些 Electron 版本 fetch 可能不通)
 *
 * 返回 SVG 文本字符串,失败返回 null
 */
export async function loadSvgContent(src: string): Promise<string | null> {
  try {
    if (src.startsWith('data:image/svg+xml;base64,')) {
      const binary = atob(src.split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    if (src.startsWith('data:image/svg+xml,')) {
      try {
        return decodeURIComponent(src.slice('data:image/svg+xml,'.length));
      } catch (err) {
        console.warn('[svg-helpers] data: URL decode failed', err);
        return null;
      }
    }

    // Try fetch first
    try {
      const response = await fetch(src);
      if (response.ok) {
        const buf = await response.arrayBuffer();
        const text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('<svg')) return text;
        console.warn('[svg-helpers] fetch ok but no <svg> in body', { src, len: text.length, head: text.slice(0, 80) });
      } else {
        console.warn('[svg-helpers] fetch non-ok', { src, status: response.status });
      }
    } catch (err) {
      console.warn('[svg-helpers] fetch threw, fallback to XHR', { src, err });
    }

    // Fallback: XMLHttpRequest
    return new Promise<string | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', src, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        if (xhr.response) {
          const text = new TextDecoder('utf-8').decode(xhr.response);
          if (text.includes('<svg')) {
            resolve(text);
            return;
          }
          console.warn('[svg-helpers] XHR ok but no <svg> in body', { src, status: xhr.status, len: text.length, head: text.slice(0, 80) });
        } else {
          console.warn('[svg-helpers] XHR onload but no response', { src, status: xhr.status });
        }
        resolve(null);
      };
      xhr.onerror = () => {
        console.warn('[svg-helpers] XHR error', { src });
        resolve(null);
      };
      xhr.send();
    });
  } catch (err) {
    console.warn('[svg-helpers] loadSvgContent unexpected error', { src, err });
    return null;
  }
}

/**
 * 轻量级 SVG sanitize:剥离潜在脚本攻击向量
 *
 * 在 innerHTML 之前调用 sanitizeSvgString,**或**在 innerHTML 之后调用 sanitizeSvgInDom。
 * 这里采用 DOM 路径(更可靠,不用复杂正则):
 *   1. innerHTML 写入临时 element
 *   2. 遍历清洗
 *   3. 把清洗后的子节点搬到目标 container
 *
 * 清洗策略:
 *   - 删除 `<script>` / `<foreignObject>`(可包含 HTML)
 *   - 删除 `on*` 事件属性(onclick / onload 等)
 *   - 把 href / xlink:href 中的 `javascript:` URL 剥离
 */
function sanitizeSvgInDom(root: Element): void {
  // 1. 删 script / foreignObject
  root.querySelectorAll('script, foreignObject').forEach((el) => el.remove());

  // 2. 遍历所有 element,清 on* 属性 + 危险 href
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === 1) elements.push(node as Element);
    node = walker.nextNode();
  }
  for (const el of elements) {
    // on* 事件属性
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      // javascript: URL
      if (name === 'href' || name === 'xlink:href' || name === 'src') {
        const val = (attr.value || '').trim().toLowerCase();
        if (val.startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }
}

/**
 * 把 SVG 文本安全地塞进 container(替换 container 当前内容)
 *
 * 步骤:
 * 1. 创建临时 div,innerHTML = svgText
 * 2. sanitize
 * 3. 移动到 container
 */
export function injectSvgStringSafe(container: HTMLElement, svgText: string): void {
  const tmp = document.createElement('div');
  tmp.innerHTML = svgText;
  sanitizeSvgInDom(tmp);
  // 清空 container 后把 tmp 子节点搬过去
  container.innerHTML = '';
  while (tmp.firstChild) {
    container.appendChild(tmp.firstChild);
  }
}

/**
 * SVG 注入后的样式微调:贴合 container 大小
 *
 * V1 同款的"尊重 SVG 自带 width/height"行为有问题:很多 SVG 自带硬编码小尺寸
 * (如 <svg width="380" height="220">),导致显示成小图。
 *
 * V2 改为:
 * - 把自带的 width/height **属性**搬到 viewBox(如果还没设)以保持比例
 * - 移除自带的 width/height 属性
 * - 强制 style.width: 100%(贴合 canvas div,canvas 由 NodeView 控大小)
 * - style.height: auto 保持比例
 * - preserveAspectRatio 默认 'xMidYMid meet' 已 OK
 */
export function injectSvgStyles(container: HTMLElement): void {
  const svg = container.querySelector('svg');
  if (!svg) return;

  const widthAttr = svg.getAttribute('width');
  const heightAttr = svg.getAttribute('height');
  // 没 viewBox 时,把 width/height 转成 viewBox 保持原始比例
  if (!svg.hasAttribute('viewBox') && widthAttr && heightAttr) {
    const w = parseFloat(widthAttr);
    const h = parseFloat(heightAttr);
    if (!Number.isNaN(w) && !Number.isNaN(h) && w > 0 && h > 0) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
  }
  // 移除硬编码尺寸,让 CSS 控制
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
}
