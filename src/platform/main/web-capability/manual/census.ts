/**
 * ⭐⭐⭐ 通用清点 —— 照说明书「数据」段数一份载荷里网站列了什么(纯函数,离线可测)
 *
 * 由 X 的 `censusPage`(2026-10-16,`src/modules/x/x-page-ledger.ts`)抽出:
 * 走法、归类顺序、去重、不认识的照样计数留名 —— 都与它一致;站点相关的全部挪进说明书。
 * ⭐ 以**网站列出的条目**为准逐个 id 对账,不比总数(解析器会连引用 / 转发里层一起取,总数天然偏多)。
 */
import { evalCond, evalValue, getMany, str, type Scope } from './path';
import type { Census, CensusRule, CensusSpec, ManualNoId } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 不是 JSON → null(调用方自己决定记成什么) */
export function census(spec: CensusSpec, text: string): Census | null {
  let root: unknown;
  try { root = JSON.parse(text); } catch { return null; }

  const items = new Map<string, string[]>();
  const counts: Record<string, number> = {};
  const cursors: { up?: string; down?: string } = {};
  const otherCursors: Record<string, number> = {};
  const unknown: Record<string, number> = {};
  const containers: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string): void => { m[k] = (m[k] ?? 0) + 1; };
  const strips = spec.unknownName.strip.map((s) => new RegExp(s));
  const nameOf = (id: string): string => strips.reduce((s, r) => s.replace(r, ''), id) || spec.unknownName.empty;
  const noId = (n: ManualNoId): void => { if ('countAs' in n) bump(counts, n.countAs); else bump(unknown, n.unknownAs); };

  const apply = (rule: CensusRule, scope: Scope): void => {
    if (rule.rule === 'cursor') {
      const dir = str(evalValue(rule.direction, scope)).toLowerCase();
      const mapped = Object.entries(rule.directions).find(([k]) => k.toLowerCase() === dir)?.[1];
      if (mapped) cursors[mapped] = str(evalValue(rule.value, scope));
      else bump(otherCursors, dir || '(无方向)');
      return;
    }
    if (rule.rule === 'group') {
      for (const child of getMany(rule.children, scope)) {
        if (!isObj(child)) continue;
        const s = { ...scope, child };
        visit(str(evalValue(rule.childId, s)), evalValue(rule.childBody, s));
      }
      return;
    }
    let node = evalValue(rule.node, scope);
    if (!isObj(node)) { noId(rule.missing); return; }
    for (const u of rule.unwrap ?? []) {
      if (evalCond(u.when, { ...scope, node })) { node = evalValue(u.to, { ...scope, node }); break; }
    }
    const s = { ...scope, node };
    const id = str(evalValue(rule.id, s));
    if (id === '') { noId(rule.missing); return; }
    if (rule.hidden && evalCond(rule.hidden.when, s)) { noId(rule.hidden); return; }
    const kind = rule.variants?.find((v) => evalCond(v.when, s))?.kind ?? rule.kind;
    const list = items.get(kind) ?? [];
    list.push(id);
    items.set(kind, list);
  };

  const visit = (id: string, body: unknown): void => {
    if (!isObj(body)) { bump(unknown, nameOf(id)); return; }
    const scope: Record<string, unknown> = { id, body };
    for (const [name, v] of Object.entries(spec.bind ?? {})) scope[name] = evalValue(v, scope);
    const rule = spec.rules.find((r) => evalCond(r.when, scope));
    if (rule) apply(rule, scope);
    else bump(unknown, nameOf(id));
  };

  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!isObj(v)) return;
    const list = v[spec.containers.find];
    if (Array.isArray(list)) {
      for (const ins of list) {
        if (!isObj(ins)) continue;
        bump(containers, str(evalValue(spec.containers.label, { ins })) || spec.containers.labelMissing);
        for (const p of spec.entries) {
          for (const entry of getMany(p, { ins })) {
            if (!isObj(entry)) continue;
            visit(str(evalValue(spec.entry.id, { entry })), evalValue(spec.entry.body, { entry }));
          }
        }
      }
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(root);

  const dedup: Record<string, readonly string[]> = {};
  for (const [k, ids] of items) dedup[k] = [...new Set(ids)];
  return { items: dedup, counts, cursors, otherCursors, unknown, containers };
}
