/**
 * 说明书的路径 / 取值 / 条件 —— 求值与自检(纯函数)
 *
 * 语法见 `types.ts` 文件头。⚠️ 这里**不 eval 任何东西**:路径按点号切开逐级取键,
 * 正则只拿来 `.test()`。说明书写得再坏,最多是取不到值,不会执行出别的事。
 */
import type { ManualCond, ManualValue } from './types';

export type Scope = Readonly<Record<string, unknown>>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');

type ParsedPath = { readonly root: string; readonly keys: readonly string[]; readonly spread: boolean };

const PATH_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*)*)(\[\*\])?$/;
const parsed = new Map<string, ParsedPath | null>();

export function parsePath(p: string): ParsedPath | null {
  const hit = parsed.get(p);
  if (hit !== undefined) return hit;
  const m = PATH_RE.exec(p);
  const out = m ? { root: m[1], keys: m[2] === '' ? [] : m[2].slice(1).split('.'), spread: m[3] !== undefined } : null;
  parsed.set(p, out);
  return out;
}

function walk(pp: ParsedPath, scope: Scope): unknown {
  let cur: unknown = scope[pp.root];
  for (const k of pp.keys) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 取一个值(路径不许带 `[*]`,自检会拦;这里遇到就当取不到) */
export function getOne(p: string, scope: Scope): unknown {
  const pp = parsePath(p);
  if (!pp || pp.spread) return undefined;
  return walk(pp, scope);
}

/** 取一串对象:带 `[*]` 的摊开数组;不带的,是对象就取它一个 */
export function getMany(p: string, scope: Scope): unknown[] {
  const pp = parsePath(p);
  if (!pp) return [];
  const v = walk(pp, scope);
  if (pp.spread) return Array.isArray(v) ? v : [];
  return isObj(v) ? [v] : [];
}

export function evalValue(v: ManualValue, scope: Scope): unknown {
  if (typeof v === 'string') return getOne(v, scope);
  if ('first' in v) {
    for (const p of v.first) { const x = getOne(p, scope); if (x !== undefined && x !== null) return x; }
    return undefined;
  }
  if ('firstObject' in v) {
    for (const p of v.firstObject) { const x = getOne(p, scope); if (isObj(x)) return x; }
    return undefined;
  }
  for (const p of v.firstString) { const x = str(getOne(p, scope)); if (x !== '') return x; }
  return '';
}

const regexes = new Map<string, RegExp>();
function re(src: string, flags = ''): RegExp {
  const key = `${flags}/${src}`;
  let r = regexes.get(key);
  if (!r) { r = new RegExp(src, flags); regexes.set(key, r); }
  return r;
}

export function evalCond(c: ManualCond, scope: Scope): boolean {
  if ('isObject' in c) return isObj(evalValue(c.isObject, scope));
  if ('isArray' in c) return Array.isArray(evalValue(c.isArray, scope));
  if ('nonEmpty' in c) return str(evalValue(c.nonEmpty, scope)) !== '';
  if ('equals' in c) return str(evalValue(c.equals[0], scope)) === c.equals[1];
  if ('contains' in c) return str(evalValue(c.contains[0], scope)).includes(c.contains[1]);
  if ('matches' in c) return re(c.matches[1], c.matches[2] ?? '').test(str(evalValue(c.matches[0], scope)));
  if ('any' in c) return c.any.some((x) => evalCond(x, scope));
  if ('all' in c) return c.all.every((x) => evalCond(x, scope));
  return !evalCond(c.not, scope);
}

/* ───────────────────────── 自检 ───────────────────────── */

/** 自检一条路径:语法对不对、变量在这个位置有没有、`[*]` 该不该有 */
export function checkPath(p: unknown, vars: readonly string[], where: string, spread: 'never' | 'allowed' | 'required', out: string[]): void {
  if (typeof p !== 'string') { out.push(`${where}:路径要是字符串,实际是 ${JSON.stringify(p)}`); return; }
  const pp = parsePath(p);
  if (!pp) { out.push(`${where}:路径「${p}」写法不对(要 $变量.键.键,末尾可带 [*])`); return; }
  if (!vars.includes(pp.root)) out.push(`${where}:路径「${p}」用了 $${pp.root},这里只有 ${vars.map((v) => `$${v}`).join(' ')}`);
  if (spread === 'never' && pp.spread) out.push(`${where}:路径「${p}」这里只取一个值,不能带 [*]`);
  if (spread === 'required' && !pp.spread) out.push(`${where}:路径「${p}」这里取的是一串,要以 [*] 结尾`);
}

export function checkValue(v: unknown, vars: readonly string[], where: string, out: string[]): void {
  if (typeof v === 'string') { checkPath(v, vars, where, 'never', out); return; }
  if (!isObj(v)) { out.push(`${where}:取值要是路径或 {first|firstObject|firstString: [...]},实际是 ${JSON.stringify(v)}`); return; }
  const keys = Object.keys(v);
  const op = keys[0];
  if (keys.length !== 1 || !['first', 'firstObject', 'firstString'].includes(op)) {
    out.push(`${where}:取值只认 first / firstObject / firstString 之一,实际是 {${keys.join(',')}}`);
    return;
  }
  const list = v[op];
  if (!Array.isArray(list) || list.length === 0) { out.push(`${where}.${op}:要一个非空的路径数组`); return; }
  list.forEach((p, i) => checkPath(p, vars, `${where}.${op}[${i}]`, 'never', out));
}

const COND_OPS = ['isObject', 'isArray', 'nonEmpty', 'equals', 'contains', 'matches', 'any', 'all', 'not'];

export function checkCond(c: unknown, vars: readonly string[], where: string, out: string[]): void {
  if (!isObj(c)) { out.push(`${where}:条件要是对象,实际是 ${JSON.stringify(c)}`); return; }
  const keys = Object.keys(c);
  const op = keys[0];
  if (keys.length !== 1 || !COND_OPS.includes(op)) {
    out.push(`${where}:条件只认 ${COND_OPS.join(' / ')} 之一,实际是 {${keys.join(',')}}`);
    return;
  }
  const arg = c[op];
  const at = `${where}.${op}`;
  switch (op) {
    case 'isObject': case 'isArray': case 'nonEmpty':
      checkValue(arg, vars, at, out); return;
    case 'equals': case 'contains':
      if (!Array.isArray(arg) || arg.length !== 2 || typeof arg[1] !== 'string') { out.push(`${at}:要 [取值, "字面量"]`); return; }
      checkValue(arg[0], vars, `${at}[0]`, out); return;
    case 'matches': {
      if (!Array.isArray(arg) || (arg.length !== 2 && arg.length !== 3) || typeof arg[1] !== 'string' || (arg.length === 3 && typeof arg[2] !== 'string')) {
        out.push(`${at}:要 [取值, "正则"] 或 [取值, "正则", "标志"]`); return;
      }
      checkValue(arg[0], vars, `${at}[0]`, out);
      checkRegex(arg[1], arg[2] as string | undefined, `${at}[1]`, out);
      return;
    }
    case 'any': case 'all':
      if (!Array.isArray(arg) || arg.length === 0) { out.push(`${at}:要一个非空的条件数组`); return; }
      arg.forEach((x, i) => checkCond(x, vars, `${at}[${i}]`, out)); return;
    default:
      checkCond(arg, vars, at, out);
  }
}

export function checkRegex(src: unknown, flags: string | undefined, where: string, out: string[]): void {
  if (typeof src !== 'string') { out.push(`${where}:正则要是字符串`); return; }
  try { new RegExp(src, flags ?? ''); } catch (e) { out.push(`${where}:正则「${src}」编不过(${e instanceof Error ? e.message : String(e)})`); }
}
