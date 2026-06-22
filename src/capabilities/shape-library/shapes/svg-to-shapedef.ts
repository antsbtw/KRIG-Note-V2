/**
 * svg-to-shapedef — SVG → ShapeDef 导入器(L5-G6c 阶段 B,无代码核心 B1.1)
 *
 * 贡献者丢一个 .svg → 系统解析成 `geometry.kind:'svg'` 的 ShapeDef:
 *   ① DOMParser 取所有 <path d>(多 path 合并成一条 d)
 *   ② 读 viewBox(无则由 path bbox 估)
 *   ③ 自动算 magnets(bbox 的 N/S/E/W 四点,归一化)
 *   ④ textBox 默认整框
 *
 * **d 归一化(SVG1=b 决策)**:真实 SVG 的 d 常含 H/V/S/T + 相对(小写)命令,而下游
 * 渲染 path-to-three.ts 的 parseSvgPathD 只认**空格分隔的绝对 M/L/A/Q/C/Z**。
 * 本导入器把任意 d 归一化成该子集(相对→绝对、H/V→L、S→C、T→Q,空格分隔),
 * 渲染层不动、脏 SVG 在「无代码核心」该处理的地方消化。
 *
 * **fail loud(红线)**:渐变/滤镜/位图/<image>/<text>/无 path / 不支持命令 → warn + 返 null,
 * 不静默吞。
 *
 * **W5 边界**:本文件在 shape-library 内,**0 import three**(DOMParser 是浏览器 web API,非 three)。
 */

import type { ShapeCategory, ShapeDef } from '../types';

export interface SvgImportMeta {
  /** krig.{category}.{name} */
  id: string;
  category: ShapeCategory;
  name: string;
  /** sidecar 覆盖(SV1=b):省则自动算 */
  textBox?: ShapeDef['textBox'];
  magnets?: ShapeDef['magnets'];
}

/** 不支持元素(含则 fail loud 拒绝整个 SVG — 渐变/位图/文字等需降级或拒) */
const UNSUPPORTED_ELEMENTS = [
  'image', 'text', 'use', 'foreignObject', 'filter',
  'lineargradient', 'radialgradient', 'pattern', 'mask', 'clippath',
];

/**
 * SVG 字符串 → ShapeDef(geometry.kind:'svg')。解析失败 / 不支持 → warn + null(fail loud)。
 */
export function parseSvgToShapeDef(svg: string, meta: SvgImportMeta): ShapeDef | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch (e) {
    console.warn(`[svg-to-shapedef] DOMParser failed for ${meta.id}:`, e);
    return null;
  }
  // parsererror 节点 = XML 非法
  if (doc.querySelector('parsererror')) {
    console.warn(`[svg-to-shapedef] malformed SVG for ${meta.id} (parsererror)`);
    return null;
  }
  const svgEl = doc.querySelector('svg');
  if (!svgEl) {
    console.warn(`[svg-to-shapedef] no <svg> root for ${meta.id}`);
    return null;
  }

  // fail loud:不支持元素 → 拒绝(渐变/位图/文字/滤镜等本阶段不降级)。
  // XML/SVG 解析保留标签大小写且 querySelector 大小写敏感(linearGradient 等驼峰),
  // 故扫全部元素按 tagName 小写比对,避免选择器大小写漏判。
  const unsupported = new Set(UNSUPPORTED_ELEMENTS);
  for (const el of Array.from(svgEl.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (unsupported.has(tag)) {
      console.warn(
        `[svg-to-shapedef] unsupported element <${el.tagName}> in ${meta.id} — 拒绝(本阶段不处理渐变/位图/文字/滤镜)`,
      );
      return null;
    }
  }

  // 取所有 <path d> 合并成一条归一化 d
  const paths = Array.from(svgEl.querySelectorAll('path'));
  if (paths.length === 0) {
    console.warn(`[svg-to-shapedef] no <path> in ${meta.id} — 无几何可提取,拒绝`);
    return null;
  }
  const dParts: string[] = [];
  for (const p of paths) {
    const raw = p.getAttribute('d');
    if (!raw) continue;
    const norm = normalizePathD(raw);
    if (norm === null) {
      console.warn(`[svg-to-shapedef] unsupported path command in ${meta.id} — 拒绝`);
      return null;
    }
    if (norm.length > 0) dParts.push(norm);
  }
  if (dParts.length === 0) {
    console.warn(`[svg-to-shapedef] all <path d> empty in ${meta.id} — 拒绝`);
    return null;
  }
  const d = dParts.join(' ');

  // viewBox:优先 SVG viewBox 属性,否则由 path bbox 估
  const viewBox = readViewBox(svgEl) ?? bboxOf(d);
  if (!viewBox || viewBox.w <= 0 || viewBox.h <= 0) {
    console.warn(`[svg-to-shapedef] cannot determine viewBox/bbox for ${meta.id}`);
    return null;
  }

  // magnets:bbox N/S/E/W(归一化 0..1),sidecar 可覆盖
  const magnets = meta.magnets ?? [
    { id: 'N', x: 0.5, y: 0 },
    { id: 'E', x: 1, y: 0.5 },
    { id: 'S', x: 0.5, y: 1 },
    { id: 'W', x: 0, y: 0.5 },
  ];

  return {
    id: meta.id,
    category: meta.category,
    name: meta.name,
    geometry: { kind: 'svg', svgPath: d, viewBox },
    viewBox,
    aspect: 'variable',
    magnets,
    textBox: meta.textBox, // 省 = 整框(NodeRenderer/evaluate 缺省整框)
    default_style: {
      fill: { type: 'solid', color: '#4A90E2', transparency: 0 },
      line: { type: 'solid', color: '#2E5C8A', width: 1.5, dashType: 'solid' },
    },
    source: 'imported',
  };
}

// ─────────────────────────────────────────────────────────
// d 归一化:任意 SVG d → 空格分隔的绝对 M/L/A/Q/C/Z(parseSvgPathD 消费子集)
// ─────────────────────────────────────────────────────────

/** 拆 d 成 [{cmd, args[]}]:命令字母 + 紧随的数字串(支持逗号/空格/负号粘连/小数点) */
function tokenizePathD(d: string): Array<{ cmd: string; args: number[] }> | null {
  const out: Array<{ cmd: string; args: number[] }> = [];
  // 匹配命令字母后跟随的数字段
  const cmdRe = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(d)) !== null) {
    const cmd = m[1];
    const numRe = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
    const args: number[] = [];
    let nm: RegExpExecArray | null;
    while ((nm = numRe.exec(m[2])) !== null) args.push(Number(nm[0]));
    out.push({ cmd, args });
  }
  return out.length > 0 ? out : null;
}

/**
 * 归一化:相对→绝对、H/V→L、S→C、T→Q,输出空格分隔绝对 M/L/A/Q/C/Z 串。
 * 不支持的命令 / 参数不足 → 返 null(fail loud)。
 */
export function normalizePathD(d: string): string | null {
  const tokens = tokenizePathD(d);
  if (!tokens) return null;

  const parts: string[] = [];
  let cx = 0, cy = 0;        // 当前点
  let sx = 0, sy = 0;        // 子路径起点(Z 回到此)
  let prevCtrlX = 0, prevCtrlY = 0; // 上一段三次/二次控制点(S/T 反射用)
  let prevCmd = '';

  const emit = (s: string): void => { parts.push(s); };

  for (const { cmd, args } of tokens) {
    const rel = cmd === cmd.toLowerCase() && cmd !== cmd.toUpperCase();
    const C = cmd.toUpperCase();

    switch (C) {
      case 'M': {
        // M 后续坐标对按 L 处理(SVG 规范)
        if (args.length < 2) return null;
        for (let i = 0; i + 1 < args.length; i += 2) {
          let x = args[i], y = args[i + 1];
          if (rel) { x += cx; y += cy; }
          if (i === 0) { emit(`M ${num(x)} ${num(y)}`); sx = x; sy = y; }
          else emit(`L ${num(x)} ${num(y)}`);
          cx = x; cy = y;
        }
        break;
      }
      case 'L': {
        if (args.length < 2) return null;
        for (let i = 0; i + 1 < args.length; i += 2) {
          let x = args[i], y = args[i + 1];
          if (rel) { x += cx; y += cy; }
          emit(`L ${num(x)} ${num(y)}`);
          cx = x; cy = y;
        }
        break;
      }
      case 'H': {
        if (args.length < 1) return null;
        for (const a of args) {
          const x = rel ? cx + a : a;
          emit(`L ${num(x)} ${num(cy)}`);
          cx = x;
        }
        break;
      }
      case 'V': {
        if (args.length < 1) return null;
        for (const a of args) {
          const y = rel ? cy + a : a;
          emit(`L ${num(cx)} ${num(y)}`);
          cy = y;
        }
        break;
      }
      case 'C': {
        if (args.length < 6) return null;
        for (let i = 0; i + 5 < args.length; i += 6) {
          let x1 = args[i], y1 = args[i + 1], x2 = args[i + 2], y2 = args[i + 3], x = args[i + 4], y = args[i + 5];
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
          emit(`C ${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)}`);
          prevCtrlX = x2; prevCtrlY = y2;
          cx = x; cy = y;
        }
        break;
      }
      case 'S': {
        // S → C:第一控制点 = 上一段控制点关于当前点反射(若上一段非 C/S 则用当前点)
        if (args.length < 4) return null;
        for (let i = 0; i + 3 < args.length; i += 4) {
          let x2 = args[i], y2 = args[i + 1], x = args[i + 2], y = args[i + 3];
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
          const reflect = (prevCmd === 'C' || prevCmd === 'S');
          const x1 = reflect ? 2 * cx - prevCtrlX : cx;
          const y1 = reflect ? 2 * cy - prevCtrlY : cy;
          emit(`C ${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)}`);
          prevCtrlX = x2; prevCtrlY = y2;
          cx = x; cy = y;
          prevCmd = 'C';
        }
        continue; // 已手动维护 prevCmd
      }
      case 'Q': {
        if (args.length < 4) return null;
        for (let i = 0; i + 3 < args.length; i += 4) {
          let x1 = args[i], y1 = args[i + 1], x = args[i + 2], y = args[i + 3];
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
          emit(`Q ${num(x1)} ${num(y1)} ${num(x)} ${num(y)}`);
          prevCtrlX = x1; prevCtrlY = y1;
          cx = x; cy = y;
        }
        break;
      }
      case 'T': {
        // T → Q:控制点 = 上一段控制点关于当前点反射(上一段非 Q/T 则用当前点)
        if (args.length < 2) return null;
        for (let i = 0; i + 1 < args.length; i += 2) {
          let x = args[i], y = args[i + 1];
          if (rel) { x += cx; y += cy; }
          const reflect = (prevCmd === 'Q' || prevCmd === 'T');
          const x1 = reflect ? 2 * cx - prevCtrlX : cx;
          const y1 = reflect ? 2 * cy - prevCtrlY : cy;
          emit(`Q ${num(x1)} ${num(y1)} ${num(x)} ${num(y)}`);
          prevCtrlX = x1; prevCtrlY = y1;
          cx = x; cy = y;
          prevCmd = 'Q';
        }
        continue;
      }
      case 'A': {
        if (args.length < 7) return null;
        for (let i = 0; i + 6 < args.length; i += 7) {
          const rx = args[i], ry = args[i + 1], rot = args[i + 2];
          const large = args[i + 3] ? 1 : 0, sweep = args[i + 4] ? 1 : 0;
          let x = args[i + 5], y = args[i + 6];
          if (rel) { x += cx; y += cy; }
          emit(`A ${num(rx)} ${num(ry)} ${num(rot)} ${large} ${sweep} ${num(x)} ${num(y)}`);
          cx = x; cy = y;
        }
        break;
      }
      case 'Z': {
        emit('Z');
        cx = sx; cy = sy;
        break;
      }
      default:
        // 不支持命令
        return null;
    }
    prevCmd = C;
  }
  return parts.join(' ');
}

/** 4 位小数 */
function num(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ─────────────────────────────────────────────────────────
// viewBox / bbox
// ─────────────────────────────────────────────────────────

function readViewBox(svgEl: Element): { w: number; h: number } | null {
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { w: parts[2], h: parts[3] };
    }
  }
  // 退 width/height 属性(去单位)
  const w = parseFloat(svgEl.getAttribute('width') ?? '');
  const h = parseFloat(svgEl.getAttribute('height') ?? '');
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
  return null;
}

/**
 * 由归一化 d 估 bbox(只看 M/L/A/Q/C 的终点 + 控制点;粗略包络,够算 viewBox)。
 * 归一化 d 是空格分隔绝对坐标,直接扫数字对。
 */
function bboxOf(d: string): { w: number; h: number } | null {
  const tokens = d.trim().split(/\s+/);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let i = 0;
  const consume = (n: number): number[] => {
    const r = tokens.slice(i + 1, i + 1 + n).map(Number);
    i += 1 + n;
    return r;
  };
  const pt = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  while (i < tokens.length) {
    switch (tokens[i]) {
      case 'M': case 'L': { const [x, y] = consume(2); pt(x, y); break; }
      case 'Q': { const [x1, y1, x, y] = consume(4); pt(x1, y1); pt(x, y); break; }
      case 'C': { const [x1, y1, x2, y2, x, y] = consume(6); pt(x1, y1); pt(x2, y2); pt(x, y); break; }
      case 'A': { const a = consume(7); pt(a[5], a[6]); break; }
      case 'Z': i += 1; break;
      default: i += 1; break;
    }
  }
  if (!Number.isFinite(minX)) return null;
  // bbox 以原点为基准取右下范围(归一化坐标系从 0 起;若 SVG 有负坐标,w/h 取跨度)
  const w = Math.max(maxX, maxX - minX);
  const h = Math.max(maxY, maxY - minY);
  return { w: w > 0 ? w : 100, h: h > 0 ? h : 100 };
}
