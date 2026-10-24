/**
 * X 能力登记的共用件(Module5-04 第 3 步,2026-10-24)—— 认号、参数小工具、一条能力的构造器
 * 读库(x-capabilities-read.ts)/ 改库(x-capabilities-write.ts)两批共用;认号那句话全 X 只此一份。
 */
import { defineCapability, type CapabilityKind } from '@platform/main/capability/capability';
import { readWsAccount } from './x-account-repo';
import { DEFAULT_PEOPLE_FILTER, PEOPLE_GROUPS, PEOPLE_SORTS, type PeopleFilter } from './x-people-query';

export type O = Record<string, unknown>;
export type Acc = { readonly restId: string; readonly handle: string };

/** 认出这个 ws 登录的号(要数字 id)—— 全 X 能力共用这一句话 */
export async function wsAccount(wsId: string): Promise<Acc | { refused: string }> {
  const a = await readWsAccount(wsId);
  if (!a) return { refused: `${wsId} 还没认出登录的是哪个号 —— 打开 X 网页,在运营面板点「认号」` };
  if (!a.restId) return { refused: `${wsId} 登录的是 @${a.handle},但数字 id 还没拿到 —— 在运营面板点「认号」` };
  return { restId: a.restId, handle: a.handle };
}

// ── 参数小工具:返回值或 Bad(原因)──
export class Bad { constructor(readonly why: string) {} }
export const str = (o: O, k: string): string => { const v = o[k]; if (typeof v !== 'string' || v.trim() === '') throw new Bad(`要 ${k}`); return v; };
export const digits = (o: O, k: string): string => { const v = o[k]; if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Bad(`${k} 要数字 id`); return v; };
export const int = (o: O, k: string, lo: number, hi: number, def?: number): number => {
  const v = o[k] === undefined ? def : o[k];
  if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Bad(`${k} 要 ${lo}–${hi} 的整数`);
  return v as number;
};
export const iso = (o: O, k: string): string => { const v = o[k]; if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new Bad(`${k} 要 ISO 时间`); return v; };
/**
 * 筛选条件:没给的字段用默认值(AI / 收件箱可以只给 group);分组 / 范围 / 排序认不出 → invalid
 * (2026-10-24 Windows 真机:原来不校验,跑进 queryPeople 才抛「不认识的分组」,被记成 failed)
 */
export const peopleFilter = (raw: unknown): PeopleFilter => {
  const f = { ...DEFAULT_PEOPLE_FILTER, ...(raw && typeof raw === 'object' ? (raw as Partial<PeopleFilter>) : {}) };
  if (!PEOPLE_GROUPS.some((g) => g.id === f.group)) throw new Bad(`filter.group 只认 ${PEOPLE_GROUPS.map((g) => g.id).join(' / ')}`);
  if (f.scope !== 'in' && f.scope !== 'excluded') throw new Bad('filter.scope 只认 in / excluded');
  if (!PEOPLE_SORTS.some((x) => x.id === f.sort)) throw new Bad(`filter.sort 只认 ${PEOPLE_SORTS.map((x) => x.id).join(' / ')}`);
  return f;
};
export const modeOf = (m: unknown): 'ask' | 'engage' | 'vpn' => (m === 'engage' || m === 'vpn' ? m : 'ask');

/**
 * 一条 X 能力(读库 / 改库共用)。
 * @param account 要认号:从参数的 wsId 认,认出的号作为 run 的第二个参数
 * @param subject 这次是为谁(跨库只存字符串,如 x_author:<id>)
 */
export function xCap<I extends O>(kind: CapabilityKind, def: {
  readonly id: string;
  readonly describe: string;
  readonly inputDoc: Readonly<Record<string, string>>;
  readonly parse: (o: O) => I;
  readonly account?: boolean;
  readonly probe?: boolean;
  readonly subject?: (i: I) => string | undefined;
  readonly run: (i: I, acc: Acc) => Promise<unknown> | unknown;
}): void {
  defineCapability<I, unknown, Acc>({
    id: def.id,
    kind,
    subject: def.subject,
    describe: def.describe,
    inputDoc: def.inputDoc,
    probe: def.probe,
    parse: (raw) => {
      try {
        return def.parse(raw && typeof raw === 'object' ? (raw as O) : {});
      } catch (e) {
        if (e instanceof Bad) return e.why;
        throw e;
      }
    },
    prepare: def.account
      ? async (i) => {
        const acc = await wsAccount(i.wsId as string);
        return 'refused' in acc ? acc : { ctx: acc };
      }
      : undefined,
    run: async (i, ctx) => def.run(i, ctx.prep),
  });
}

