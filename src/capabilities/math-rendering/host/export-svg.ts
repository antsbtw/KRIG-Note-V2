/**
 * host/export-svg — Self-contained SVG 导出
 *
 * 把 mafs 渲染的 SVG 元素打包成"独立可渲染"的 SVG 字符串:
 * - clone SVG
 * - 从 document.styleSheets 提取 mafs / katex 相关 CSS rules
 * - 内联 <style> 节点塞 SVG 头部
 * - 序列化输出
 *
 * 用途:
 * - 下载 SVG 文件(用户分享/外部打开,需独立样式)
 * - inline 缩略图缓存(PR4 SVG 缓存方案:全屏 ⛶ 退出时写 PM,
 *   inline dangerouslySetInnerHTML 渲染不依赖外部 CSS)
 *
 * 实现注意:
 * - 跨域 stylesheet 访问 .cssRules 会 throw(SecurityError),需 try/catch
 * - mafs 走 CSS 变量(--mafs-bg/--mafs-fg/--mafs-line-color),
 *   提取后须额外在 SVG style 内 :root / svg 选择器内补默认值
 * - katex 在 LaTeX label 内用 <foreignObject> 包 HTML,样式来自全局 katex.css
 */

/** 默认 mafs 主题(SVG 自身背景) */
const DEFAULT_BG = '#1e1e1e';

/**
 * 跟随 SVG 元素树,把每个元素的 getComputedStyle 中"非默认"的关键样式
 * 固化为 style attribute。
 *
 * 为什么不用 CSS rules 提取:mafs 给 SVG 元素的 stroke/fill 走外部 CSS
 * 选择器(可能 :where() / 嵌套规则),关键字匹配捞不到,且即便捞到 inline 内
 * 选择器命中也不一定生效(CSS 变量解析需要全祖先链)。直接把"已生效的最终值"
 * 写成 inline attribute 是最稳路径。
 *
 * 关键样式集合:SVG 视觉相关 — stroke / fill / stroke-width / stroke-opacity /
 * fill-opacity / opacity / font-size / font-family / color。
 */
const KEY_STYLES = [
  'stroke', 'fill', 'stroke-width', 'stroke-opacity', 'fill-opacity',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-size', 'font-family', 'color', 'visibility', 'display',
] as const;

/**
 * 把 src 元素的 computed style 复制到 dst 元素 inline style。
 * 跳过值为 'none' 的 display(不动可见性)、值为 transparent 的 fill(默认)。
 */
function inlineComputedStyles(src: Element, dst: Element): void {
  const cs = getComputedStyle(src);
  const styles: string[] = [];
  for (const prop of KEY_STYLES) {
    const val = cs.getPropertyValue(prop);
    if (!val || val === 'initial' || val === 'inherit') continue;
    // 跳过 transparent/none 的 stroke + fill(默认值,无需固化)
    // 但 stroke=rgb(...)/fill=rgb(...) 这种实际生效的值必须固化
    styles.push(`${prop}:${val}`);
  }
  if (styles.length === 0) return;
  // 保留已有 style attribute,追加(已有的更优先)
  const existing = dst.getAttribute('style') || '';
  const combined = styles.join(';') + (existing ? ';' + existing : '');
  dst.setAttribute('style', combined);
}

/**
 * 把 mafs 渲染的 SVGElement 导出为 self-contained SVG 字符串。
 *
 * 实现:DOM 双指针并行遍历(原 SVG 拿 computedStyle,clone SVG 写 inline style),
 * 把每个元素的关键视觉样式固化为 style attribute。
 *
 * 优点:不依赖任何外部 CSS、不依赖 mafs 的选择器结构,产物可直接
 * dangerouslySetInnerHTML 或下载文件外部打开,视觉一致。
 *
 * 注意:foreignObject 内的 HTML(KaTeX label)不能这么处理 — HTML 计算样式
 * 太多,递归 inline 会爆炸 size。但 KaTeX 自带样式(部分 inline 部分继承
 * font-family / color),且 svg 容器层 font + color 固化后 katex 多数情况
 * 能正常显示;若 inline 端缺 katex.css 全局可单独补。
 */
export function exportSelfContainedSvg(svgEl: SVGElement): string {
  // 1. clone(不动原 DOM)
  const clone = svgEl.cloneNode(true) as SVGElement;

  // 2. 同步遍历 src + clone,把 computedStyle 固化进 clone 的 style attribute
  //    (foreignObject 内 HTML 不递归 — KaTeX 自带 inline style 大体够用)
  const srcWalker = document.createTreeWalker(svgEl, NodeFilter.SHOW_ELEMENT);
  const dstWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  // 第一次 nextNode 跳到第一个真正的元素
  let srcNode: Element | null = srcWalker.currentNode as Element;
  let dstNode: Element | null = dstWalker.currentNode as Element;
  while (srcNode && dstNode) {
    if (srcNode.namespaceURI === 'http://www.w3.org/2000/svg') {
      inlineComputedStyles(srcNode, dstNode);
    }
    srcNode = srcWalker.nextNode() as Element | null;
    dstNode = dstWalker.nextNode() as Element | null;
  }

  // 3. clone 根上加背景色 + 兜底字体(让 SVG 文件外部打开也有底色)
  const rootStyle = clone.getAttribute('style') || '';
  clone.setAttribute('style', `background:${DEFAULT_BG};font-family:system-ui,-apple-system,sans-serif;${rootStyle}`);

  // 4. 序列化
  return new XMLSerializer().serializeToString(clone);
}
