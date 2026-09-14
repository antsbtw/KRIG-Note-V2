/**
 * diglot-model — G 层解析 / 规范化序列化(步骤④)
 *
 * ⭐⭐ **G 层是「对自动布局的稀疏覆盖层」,不是画布状态的存档**(03 §1.1)。
 * ```
 * S 层(树) ──推导──┐
 *                  ├─→ ELK 自动布局(全量坐标) ─→ Instance[]
 * G 层(稀疏 pos) ──┘   有条目的覆盖自动值;没条目的用算出来的
 * ```
 *
 * 规范化纪律(00 §4,逐条落实):
 * - 条目按 `id` **字典序**排列
 * - 条目内属性键按**固定序**(canonical 键名,英文)—— 见 `KEY_ORDER`
 * - 坐标**量化为整数**,杜绝浮点噪声
 * - ⭐ **不写缺省值**(稀疏纪律:缺席即 auto)
 * - 词表值存 canonical 名(中英别名在**输入层**互通)
 * - ⭐ **规范化幂等**:对规范形再序列化,**字节级不变**(C1)
 *
 * ⭐ 体验类比 `terraform fmt`:随手写,松手变整齐(00 §3)。
 *
 * ⚠️ **跨图种共用**:本文件**不含任何树语义**(不认 parent/order),
 * 只认 id + 属性。bpmn 开工时原样复用(00 §5)。
 */

import type { ParseResult, DiglotError } from './engine-contract';
import type { GEntry, GLayer, GLayerText, GPos, StructureKind } from './types';

// ─────────────────────────────────────────────────────────
// 1. 词表(canonical 名 + 中英别名)
// ─────────────────────────────────────────────────────────

/** `structure` 词表(01 §3.1,按 XMind 十结构全集登记)。v0 只实现 map/logic 的布局算法。 */
const STRUCTURE_CANON: readonly StructureKind[] = [
  'map', 'logic', 'brace', 'org', 'tree', 'timeline', 'fishbone', 'tree-table', 'matrix',
];

/**
 * 中英别名 → canonical(00 §4:「词表值存 canonical 名,中英别名在**输入层**互通」)。
 * ⚠️ 只在**输入层**认别名;序列化一律写 canonical —— 否则 C1 幂等不成立。
 */
const STRUCTURE_ALIAS: Readonly<Record<string, StructureKind>> = {
  '导图': 'map', '思维导图': 'map',
  '逻辑图': 'logic', '逻辑': 'logic',
  '括号图': 'brace', '括号': 'brace',
  '组织结构图': 'org', '组织': 'org',
  '树形图': 'tree', '树': 'tree',
  '时间轴': 'timeline',
  '鱼骨图': 'fishbone', '鱼骨': 'fishbone',
  '树状表格': 'tree-table',
  '矩阵': 'matrix',
};

function canonStructure(raw: string): StructureKind | null {
  const lower = raw.toLowerCase();
  const direct = STRUCTURE_CANON.find((s) => s === lower);
  if (direct) return direct;
  return STRUCTURE_ALIAS[raw] ?? null;
}

// ─────────────────────────────────────────────────────────
// 2. 键序(条目内属性键的固定序)
// ─────────────────────────────────────────────────────────

/**
 * ⭐ 条目内属性键的**固定序**(00 §4)。
 *
 * ⚠️ 这个顺序**必须稳定** —— 它直接决定 C1 幂等。
 * 布尔标志(float/collapsed)排在最前,便于肉眼扫;其余按语义分组。
 */
const KEY_ORDER = ['float', 'pos', 'color', 'shape', 'structure', 'collapsed'] as const;

// ─────────────────────────────────────────────────────────
// 3. 包裹(平文本投影落于文末附录区,包 HTML 注释)
// ─────────────────────────────────────────────────────────

const OPEN = '<!-- diglot';
const CLOSE = '-->';

/**
 * ⭐ 包成 HTML 注释,使文件在任何 Markdown 环境**渲染为干净大纲**(00 §4)。
 * ⚠️ 空 G 层返回空串 —— **不写空壳注释**(稀疏纪律:没条目就是没内容)。
 */
export function wrapGLayer(body: GLayerText): string {
  if (body.trim().length === 0) return '';
  return `${OPEN}\n${body}${CLOSE}\n`;
}

/** 从 HTML 注释里取出 G 层正文;无包裹则原样返回(两种形态都收)。 */
export function unwrapGLayer(text: string): string {
  const open = text.indexOf(OPEN);
  if (open < 0) return text;
  const close = text.indexOf(CLOSE, open + OPEN.length);
  if (close < 0) return text.slice(open + OPEN.length);
  return text.slice(open + OPEN.length, close);
}

// ─────────────────────────────────────────────────────────
// 4. 解析:文本 → 稀疏条目
// ─────────────────────────────────────────────────────────

/** 坐标:`x,y` → 整数对。⚠️ 解析即量化,不把浮点带进模型。 */
function parsePos(raw: string): GPos | null {
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * ⭐ G 层文本 → 稀疏条目。
 *
 * ⚠️ **坏行不污染模型**(C6):任一行不合法 → `ok:false`,
 * **不返回半个模型**,错误**定位到行**。调用侧保持上一有效状态。
 *
 * ⭐ **未知记号原样透传**(C9 / 00 §2.3):不认识的 `key=value` 收进
 * `unknown`,序列化时原样吐回 —— **即便将来加了自己的语法,也不许丢**。
 */
export function parseGLayer(text: GLayerText): ParseResult<GLayer> {
  const body = unwrapGLayer(text);
  const g = new Map<string, GEntry>();
  const errors: DiglotError[] = [];
  const lines = body.split('\n');

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (line.length === 0) return;
    // 注释行(方便用户在 G 层里写说明)
    if (line.startsWith('#')) return;

    if (!line.startsWith('^')) {
      errors.push({ line: lineNo, message: `G 层条目必须以 ^ 开头,读到:${line}` });
      return;
    }

    const tokens = line.slice(1).split(/\s+/).filter((t) => t.length > 0);
    const id = tokens[0];
    if (!id) {
      errors.push({ line: lineNo, message: '条目缺少 id' });
      return;
    }

    const entry: {
      pos?: GPos; color?: string; shape?: string;
      structure?: StructureKind; collapsed?: boolean; float?: boolean;
      unknown?: Record<string, string>;
    } = {};
    const unknown: Record<string, string> = {};

    for (const tok of tokens.slice(1)) {
      // 布尔标志(无 =)
      if (tok === 'collapsed') { entry.collapsed = true; continue; }
      if (tok === 'float') { entry.float = true; continue; }

      const eq = tok.indexOf('=');
      if (eq < 0) {
        errors.push({ line: lineNo, message: `无法解析记号:${tok}(应为 key=value 或已知标志)` });
        continue;
      }
      const key = tok.slice(0, eq);
      const value = tok.slice(eq + 1);
      if (value.length === 0) {
        errors.push({ line: lineNo, message: `${key} 的值为空` });
        continue;
      }

      switch (key) {
        case 'pos': {
          const p = parsePos(value);
          if (!p) {
            errors.push({ line: lineNo, message: `pos 应为 "x,y" 两个数,读到:${value}` });
            break;
          }
          entry.pos = p;
          break;
        }
        case 'color':
          entry.color = value;
          break;
        case 'shape':
          entry.shape = value;
          break;
        case 'structure': {
          const c = canonStructure(value);
          if (!c) {
            errors.push({
              line: lineNo,
              message: `structure 不在词表内:${value}(可用:${STRUCTURE_CANON.join('/')})`,
            });
            break;
          }
          entry.structure = c;
          break;
        }
        default:
          // ⭐ 未知记号 —— 不是坏行,原样留着(C9)
          unknown[key] = value;
      }
    }

    if (Object.keys(unknown).length > 0) entry.unknown = unknown;

    // ⚠️ 同一 id 出现两次:后者合并进前者(用户随手写,松手变整齐)
    const prev = g.get(id);
    g.set(id, prev ? { ...prev, ...entry, unknown: { ...prev.unknown, ...entry.unknown } } : entry);
  });

  // ⚠️ fail loud:有任何坏行就整体拒绝,不返回半个模型(C6)
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: g };
}

// ─────────────────────────────────────────────────────────
// 5. 序列化:稀疏条目 → 规范形
// ─────────────────────────────────────────────────────────

/** 一条属性的规范形 token;返回 null = 该键缺席(⭐ 不写缺省值)。 */
function tokenFor(key: (typeof KEY_ORDER)[number], e: GEntry): string | null {
  switch (key) {
    case 'float':
      return e.float === true ? 'float' : null;
    case 'pos':
      // ⭐ 坐标量化为整数(即便模型里混进了浮点,序列化这一关也要挡住)
      return e.pos ? `pos=${Math.round(e.pos.x)},${Math.round(e.pos.y)}` : null;
    case 'color':
      return e.color ? `color=${e.color}` : null;
    case 'shape':
      return e.shape ? `shape=${e.shape}` : null;
    case 'structure':
      return e.structure ? `structure=${e.structure}` : null;
    case 'collapsed':
      return e.collapsed === true ? 'collapsed' : null;
  }
}

/**
 * ⭐ 稀疏条目 → 规范形文本。
 *
 * 规范形定义(00 §4):
 * - 条目按 id **字典序**
 * - 条目内键按 `KEY_ORDER` **固定序**;未知记号按其 key 字典序**排在最后**
 * - 坐标整数;⭐ **不写缺省值**
 * - ⚠️ **无任何属性的条目整条不输出** —— 稀疏纪律:
 *   一个 id 若没有被触碰过的属性,它根本不该存在于 G 层
 *
 * ⭐ **幂等**:对本函数输出再 parse+serialize,**字节级不变**(C1)。
 */
export function serializeGLayer(g: GLayer): GLayerText {
  const ids = [...g.keys()].sort();
  const out: string[] = [];

  for (const id of ids) {
    const e = g.get(id);
    if (!e) continue;

    const parts: string[] = [];
    for (const key of KEY_ORDER) {
      const t = tokenFor(key, e);
      if (t !== null) parts.push(t);
    }
    // ⭐ 未知记号原样吐回,按 key 字典序排在最后(C9)
    for (const k of Object.keys(e.unknown ?? {}).sort()) {
      parts.push(`${k}=${e.unknown![k]}`);
    }

    // ⚠️ 稀疏:零属性的条目不输出(否则 C5「新建节点 G 层零条目」会被架空)
    if (parts.length === 0) continue;
    out.push(`^${id} ${parts.join(' ')}`);
  }

  return out.length > 0 ? out.join('\n') + '\n' : '';
}
