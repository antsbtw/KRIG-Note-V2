/**
 * compute/marching-squares — 隐式方程 F(x,y)=0 等值线提取
 *
 * 标准 marching squares 算法:
 * 1. 在 (xMin..xMax) × (yMin..yMax) 矩形上铺 N×N 网格
 * 2. 对每个网格顶点求 F 值
 * 3. 每个格子按四角符号(+/-)组合得到 16 种 case(2^4)
 * 4. case 决定线段穿过格子哪两条边,线性插值求边上交点
 *
 * 输出:多条线段 [(x1,y1),(x2,y2)],driver 用 mafs 渲染。
 *
 * 不做的:
 * - 鞍点歧义处理(case 5/10 默认走"两条独立线段"分支,够教学用)
 * - 连通分量重组(每个线段独立,渲染时 Polyline 一段段画)
 */

/** marching squares 输出:一个线段两端点 */
export type ImplicitSegment = [[number, number], [number, number]];

/**
 * F(x,y) = 0 → 线段列表
 *
 * @param fn F(x,y) 标量场
 * @param xMin/xMax/yMin/yMax 采样区域(通常 = viewBox)
 * @param resolution 网格分辨率(默认 100,即 100×100 = 10000 格)
 */
export function marchingSquares(
  fn: (x: number, y: number) => number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  resolution: number = 100,
): ImplicitSegment[] {
  const N = Math.max(8, Math.round(resolution));
  const dx = (xMax - xMin) / N;
  const dy = (yMax - yMin) / N;

  // 顶点 F 值缓存:(N+1) × (N+1)
  const grid: number[][] = new Array(N + 1);
  for (let i = 0; i <= N; i++) {
    grid[i] = new Array(N + 1);
    const x = xMin + i * dx;
    for (let j = 0; j <= N; j++) {
      const y = yMin + j * dy;
      const v = fn(x, y);
      // NaN/Inf 视作 0(避免插值崩),实际产出可能略偏但不会 crash
      grid[i][j] = Number.isFinite(v) ? v : 0;
    }
  }

  const segments: ImplicitSegment[] = [];

  // 线性插值:在边 (xa,ya)-(xb,yb) 上找 F=0 的点
  // va = F(xa,ya), vb = F(xb,yb), 符号相反
  function lerp(
    xa: number, ya: number, va: number,
    xb: number, yb: number, vb: number,
  ): [number, number] {
    const t = va / (va - vb);
    return [xa + t * (xb - xa), ya + t * (yb - ya)];
  }

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      // 格子四角(逆时针):BL → BR → TR → TL
      const x0 = xMin + i * dx;
      const x1 = x0 + dx;
      const y0 = yMin + j * dy;
      const y1 = y0 + dy;

      const fBL = grid[i][j];         // (x0, y0)
      const fBR = grid[i + 1][j];     // (x1, y0)
      const fTR = grid[i + 1][j + 1]; // (x1, y1)
      const fTL = grid[i][j + 1];     // (x0, y1)

      // 4-bit case index:TL TR BR BL = 8 4 2 1
      const c =
        (fBL > 0 ? 1 : 0) |
        (fBR > 0 ? 2 : 0) |
        (fTR > 0 ? 4 : 0) |
        (fTL > 0 ? 8 : 0);

      if (c === 0 || c === 15) continue; // 全同号,无线穿过

      // 4 条边上的交点(只在必要时算)
      // bottom: BL→BR (y=y0)
      // right:  BR→TR (x=x1)
      // top:    TR→TL (y=y1)
      // left:   TL→BL (x=x0)
      let pBottom: [number, number] | null = null;
      let pRight:  [number, number] | null = null;
      let pTop:    [number, number] | null = null;
      let pLeft:   [number, number] | null = null;

      if ((c & 1) !== (c & 2) >> 1) pBottom = lerp(x0, y0, fBL, x1, y0, fBR);
      if ((c & 2) >> 1 !== (c & 4) >> 2) pRight = lerp(x1, y0, fBR, x1, y1, fTR);
      if ((c & 4) >> 2 !== (c & 8) >> 3) pTop = lerp(x1, y1, fTR, x0, y1, fTL);
      if ((c & 8) >> 3 !== (c & 1)) pLeft = lerp(x0, y1, fTL, x0, y0, fBL);

      switch (c) {
        case 1: case 14: segments.push([pBottom!, pLeft!]);   break;
        case 2: case 13: segments.push([pBottom!, pRight!]);  break;
        case 3: case 12: segments.push([pLeft!,   pRight!]);  break;
        case 4: case 11: segments.push([pTop!,    pRight!]);  break;
        case 5:
          // 鞍点歧义:简化处理走两条独立线段(默认假设中心同 BL/TR 符号)
          segments.push([pLeft!, pTop!]);
          segments.push([pBottom!, pRight!]);
          break;
        case 6: case 9:  segments.push([pTop!,    pBottom!]); break;
        case 7: case 8:  segments.push([pTop!,    pLeft!]);   break;
        case 10:
          // 同 case 5 鞍点
          segments.push([pLeft!, pBottom!]);
          segments.push([pTop!, pRight!]);
          break;
      }
    }
  }

  return segments;
}
