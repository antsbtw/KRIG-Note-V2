/**
 * ⭐⭐ 说明书自检 —— 加载时逐条查,错了当场报出「哪一段哪一条」(fail loud,不带病运行)
 *
 * 为什么必须有:说明书将来是 AI 改的数据。路径写错一个字母不会报错,只会「取不到 → 0 条」——
 * 正是本仓反复吃亏的那类静默(注入脚本转义被吃 → 采集恒 0 且全绿)。
 * ⭐ 所以每条路径的变量在那个位置有没有、`[*]` 该不该有、正则编不编得过、字段齐不齐,全在加载时查。
 */
import { checkCond, checkPath, checkRegex, checkValue } from './path';
import type { SiteManual } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

function checkNoId(n: unknown, where: string, out: string[]): void {
  if (!isObj(n)) { out.push(`${where}:要 {countAs} 或 {unknownAs}`); return; }
  const has = (isStr(n.countAs) ? 1 : 0) + (isStr(n.unknownAs) ? 1 : 0);
  if (has !== 1) out.push(`${where}:countAs / unknownAs 恰好写一个`);
}

/** 返回全部问题;空数组 = 过 */
export function checkManual(m: unknown): string[] {
  const out: string[] = [];
  if (!isObj(m)) return ['说明书要是一个对象'];
  if (!isStr(m.site)) out.push('site:要写站点名');
  if (!Number.isInteger(m.version) || (m.version as number) < 1) out.push('version:要是 ≥1 的整数');
  if (!Array.isArray(m.outside)) out.push('outside:要是数组(说明书外登记,没有也写 [])');
  else m.outside.forEach((o, i) => {
    if (!isObj(o) || !isStr(o.what) || !isStr(o.where) || !isStr(o.why)) out.push(`outside[${i}]:要 {what, where, why}`);
  });
  const data = m.data;
  if (!isObj(data)) { out.push('data:缺'); return out; }

  if (!Array.isArray(data.noise)) out.push('data.noise:要是数组');
  else data.noise.forEach((n, i) => { if (!isObj(n) || !isStr(n.url) || !isStr(n.why)) out.push(`data.noise[${i}]:要 {url, why}`); });
  if (!Array.isArray(data.orderedByTime)) out.push('data.orderedByTime:要是数组');
  else data.orderedByTime.forEach((r, i) => {
    const at = `data.orderedByTime[${i}]`;
    if (!isObj(r)) { out.push(`${at}:要是对象`); return; }
    checkRegex(r.url, undefined, `${at}.url`, out);
    if (r.require !== undefined && (!Array.isArray(r.require) || r.require.some((s) => !isStr(s)))) out.push(`${at}.require:要是字符串数组`);
  });

  const c = data.census;
  if (!isObj(c)) { out.push('data.census:缺'); return out; }
  const ct = c.containers;
  if (!isObj(ct) || !isStr(ct.find) || !isStr(ct.labelMissing)) out.push('data.census.containers:要 {find, label, labelMissing}');
  else checkValue(ct.label, ['ins'], 'data.census.containers.label', out);
  if (!Array.isArray(c.entries) || c.entries.length === 0) out.push('data.census.entries:要一个非空的路径数组');
  else c.entries.forEach((p, i) => checkPath(p, ['ins'], `data.census.entries[${i}]`, 'allowed', out));
  if (!isObj(c.entry)) out.push('data.census.entry:要 {id, body}');
  else {
    checkValue(c.entry.id, ['entry'], 'data.census.entry.id', out);
    checkValue(c.entry.body, ['entry'], 'data.census.entry.body', out);
  }
  const vars = ['body', 'id'];
  if (c.bind !== undefined) {
    if (!isObj(c.bind)) out.push('data.census.bind:要是对象');
    else for (const [k, v] of Object.entries(c.bind)) {
      if (['body', 'id', 'node', 'child', 'ins', 'entry'].includes(k)) out.push(`data.census.bind.${k}:这个名字是保留的`);
      checkValue(v, vars, `data.census.bind.${k}`, out);
      vars.push(k);
    }
  }
  if (!isObj(c.unknownName) || !Array.isArray(c.unknownName.strip) || !isStr(c.unknownName.empty)) out.push('data.census.unknownName:要 {strip: [正则…], empty}');
  else c.unknownName.strip.forEach((s, i) => checkRegex(s, undefined, `data.census.unknownName.strip[${i}]`, out));

  if (!Array.isArray(c.rules) || c.rules.length === 0) { out.push('data.census.rules:要一个非空数组'); return out; }
  c.rules.forEach((r, i) => {
    const at = `data.census.rules[${i}]`;
    if (!isObj(r)) { out.push(`${at}:要是对象`); return; }
    if (r.why !== undefined && !isStr(r.why)) out.push(`${at}.why:要是字符串`);
    checkCond(r.when, vars, `${at}.when`, out);
    if (r.rule === 'cursor') {
      checkValue(r.value, vars, `${at}.value`, out);
      checkValue(r.direction, vars, `${at}.direction`, out);
      if (!isObj(r.directions) || Object.values(r.directions).some((d) => d !== 'up' && d !== 'down')) out.push(`${at}.directions:要 {方向名: "up"|"down"}`);
    } else if (r.rule === 'group') {
      checkPath(r.children, vars, `${at}.children`, 'required', out);
      checkValue(r.childId, [...vars, 'child'], `${at}.childId`, out);
      checkValue(r.childBody, [...vars, 'child'], `${at}.childBody`, out);
    } else if (r.rule === 'item') {
      if (!isStr(r.kind)) out.push(`${at}.kind:要写条目种类`);
      checkValue(r.node, vars, `${at}.node`, out);
      const nv = [...vars, 'node'];
      if (r.unwrap !== undefined) {
        if (!Array.isArray(r.unwrap)) out.push(`${at}.unwrap:要是数组`);
        else r.unwrap.forEach((u, j) => {
          if (!isObj(u)) { out.push(`${at}.unwrap[${j}]:要 {when, to}`); return; }
          checkCond(u.when, nv, `${at}.unwrap[${j}].when`, out);
          checkValue(u.to, nv, `${at}.unwrap[${j}].to`, out);
        });
      }
      checkValue(r.id, nv, `${at}.id`, out);
      checkNoId(r.missing, `${at}.missing`, out);
      if (r.hidden !== undefined) {
        if (!isObj(r.hidden)) out.push(`${at}.hidden:要 {when, countAs|unknownAs}`);
        else { checkCond(r.hidden.when, nv, `${at}.hidden.when`, out); checkNoId(r.hidden, `${at}.hidden`, out); }
      }
      if (r.variants !== undefined) {
        if (!Array.isArray(r.variants)) out.push(`${at}.variants:要是数组`);
        else r.variants.forEach((v, j) => {
          if (!isObj(v) || !isStr(v.kind)) { out.push(`${at}.variants[${j}]:要 {kind, when}`); return; }
          checkCond(v.when, nv, `${at}.variants[${j}].when`, out);
        });
      }
    } else {
      out.push(`${at}.rule:只认 cursor / item / group,实际是 ${JSON.stringify(r.rule)}`);
    }
  });
  return out;
}

/** 加载:自检不过就抛,把全部问题列出来 */
export function loadManual(raw: unknown): SiteManual {
  const problems = checkManual(raw);
  if (problems.length > 0) {
    const site = isObj(raw) && typeof raw.site === 'string' ? raw.site : '(未知站点)';
    throw new Error(`说明书 ${site} 自检不过(${problems.length} 处):\n  · ${problems.join('\n  · ')}`);
  }
  return raw as SiteManual;
}
