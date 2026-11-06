/**
 * latex-images — 把「公式渲染成图片」的网页公式还原成 LaTeX,让 Defuddle 认得出来
 *
 * 背景(2026-11-05,AoPS wiki 真实页面 + jsdom 跑真注入脚本复现):
 *   AoPS / WordPress 类站点把公式渲染成 `<img class="latex" alt="$1{:}30$">`,
 *   块级公式是 `<img class="latexcenter" alt="\[ ... \]">`,LaTeX 源码就在 alt 里。
 *   Defuddle 本来认 `img.latex`,但它**先**把宽或高 < 33px 的图片当图标删掉
 *   (findSmallImages / removeSmallImages),**后**才识别公式 —— 行内公式图只有 14px 高,
 *   识别前就没了。结果剪藏出来「at , traveling … steady miles per hour」,数字全丢,
 *   选项行 (A)…(E) 整行消失。
 *
 * 修法:Defuddle 运行前,把这类图换成 `<span data-latex="…" display="inline|block">`
 *   (Defuddle 的公式选择器认 `[data-latex]`,不是 img 就不会被当小图删),
 *   Defuddle 跑完再用返回的 restore() 换回原图 —— 用户正在看的网页不变。
 *   `[asy]` 开头的 alt 是 Asymptote 绘图源码(真图),保留图片,只把冗长源码 alt 换成 'figure'。
 *
 * ⚠️ 本文件的函数会被 `toString()` 注入到网页里执行(defuddle-script / linked-answers 两处):
 *   **必须自给自足** —— 不引用任何外部变量 / import / 其他函数;只用 ES5 语法能做到的事。
 */
export function latexImagesToMath(doc: Document): () => void {
  var swaps: Array<{ kind: 'node'; now: Element; orig: Element } | { kind: 'alt'; el: Element; alt: string }> = [];
  var imgs = doc.querySelectorAll('img.latex, img.latexcenter');
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    var alt = (img.getAttribute('alt') || '').trim();
    var latex: string | null = null;
    var block = false;
    var m = alt.match(/^\\\[([\s\S]*)\\\]$/) || alt.match(/^\$\$([\s\S]*)\$\$$/);
    if (m) {
      latex = m[1];
      block = true;
    } else {
      m = alt.match(/^\$([\s\S]*)\$$/);
      if (m) latex = m[1];
    }
    if (latex === null) {
      if (/^\[asy\]/i.test(alt)) {
        swaps.push({ kind: 'alt', el: img, alt: img.getAttribute('alt') || '' });
        img.setAttribute('alt', 'figure');
      }
      continue;
    }
    latex = latex.trim();
    if (!latex || !img.parentNode) continue;
    var span = doc.createElement('span');
    span.setAttribute('data-latex', latex);
    span.setAttribute('display', block ? 'block' : 'inline');
    span.textContent = latex;
    img.parentNode.replaceChild(span, img);
    swaps.push({ kind: 'node', now: span, orig: img });
  }
  return function restore() {
    for (var k = swaps.length - 1; k >= 0; k--) {
      var s = swaps[k];
      if (s.kind === 'alt') s.el.setAttribute('alt', s.alt);
      else if (s.now.parentNode) s.now.parentNode.replaceChild(s.orig, s.now);
    }
  };
}

/**
 * 记下页面上公式图 / 绘图的**显示尺寸**(width/height 属性):AoPS 的图片文件是 2 倍图
 * (570×530 的文件按 285×265 显示),转 markdown 后尺寸丢了 → 笔记里按文件像素显示成两倍大。
 * 返回 { 绝对地址: [宽, 高] },导入时写进 image 块的 width/height。
 */
export function collectLatexFigureSizes(doc: Document): Record<string, [number, number]> {
  var out: Record<string, [number, number]> = {};
  var imgs = doc.querySelectorAll('img.latex[width], img.latexcenter[width]');
  for (var i = 0; i < imgs.length; i++) {
    var w = parseInt(imgs[i].getAttribute('width') || '', 10);
    var h = parseInt(imgs[i].getAttribute('height') || '', 10);
    var src = imgs[i].getAttribute('src') || '';
    if (!src || !(w > 0)) continue;
    try {
      src = new URL(src, doc.baseURI || location.href).href;
    } catch (e) {
      continue;
    }
    out[src] = [w, h > 0 ? h : 0];
  }
  return out;
}
