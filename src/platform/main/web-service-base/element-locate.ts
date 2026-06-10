/**
 * 服务无关的「按坐标定位 DOM 元素」原语(铁律 1)
 *
 * AI 单条提取与 X 推文提取共同模式:右键菜单上送 guest viewport 坐标 (x,y),
 * 主进程对该 webContents executeJavaScript 跑 document.elementFromPoint(x,y) 并向上
 * closest 到目标容器选择器。本文件把「在 guest 端按坐标定位最近的某 selector 容器」
 * 抽成可复用脚本生成器。
 *
 * 注:AI 侧的 claude-extract-turn 还要做 SSE/conversation API 配对(服务专属),不在此抽;
 * 这里只抽两边都用的「坐标 → 容器命中布尔/定位」纯 DOM 原语。
 */

/**
 * 生成在 guest webContents 内执行的脚本:elementFromPoint(x,y) 向上找最近的
 * `containerSelector`,命中返 true,否则在 ±band 像素纵向邻域内回退找最近的容器。
 *
 * 返回的脚本求值为 boolean(是否命中一个目标容器)。供「是否点中了推文/对话」判定用。
 *
 * @param x                guest viewport x
 * @param y                guest viewport y
 * @param containerSelector 目标容器 CSS selector(如 'article[data-testid="tweet"]')
 * @param band             纵向回退邻域(像素),默认 24
 */
export function buildHitTestScript(
  x: number,
  y: number,
  containerSelector: string,
  band = 24,
): string {
  const sel = JSON.stringify(containerSelector);
  return `
(function() {
  try {
    var sel = ${sel};
    var el = document.elementFromPoint(${x}, ${y});
    var hit = el && el.closest ? el.closest(sel) : null;
    if (hit) return true;
    // 回退:纵向邻域内找最近容器(点在容器间隙时)
    var list = Array.prototype.slice.call(document.querySelectorAll(sel));
    for (var i = 0; i < list.length; i++) {
      var rect = list[i].getBoundingClientRect();
      if (${y} >= rect.top - ${band} && ${y} <= rect.bottom + ${band}) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
})()
`;
}
