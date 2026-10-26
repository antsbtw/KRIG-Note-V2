/**
 * ⭐⭐ 卡片队列 —— 主进程(Module5-04 第 4 步 4c,2026-10-26)
 *
 * 用户 10-26 选「现在就把卡片队列搬到主进程」+「发完这张再准备下一张」:
 *   这一批人 / 第几张 / 前面每张的结果存在这里(进库 x_card_queue),关窗口、重启 app 后还停在那一张;
 *   下一张在这张做完(发送 / 跳过 / 放一放 / 下一个)之后才由卡片准备 —— 不把左边网页带走;发送还是人点。
 * 卡片里的准备 / 草拟 / 选推文 / 发送不在这里(本来就是单个能力调用)。
 * 一个号一种卡一份(求关 / 互动 / 回复求助各一份)。
 */
import { getXDB } from '@storage/surreal/client';
import { capFailed, capRefused, defineCapability } from '@platform/main/capability/capability';

export type CardMode = 'ask' | 'engage' | 'vpn';
export type CardWho = { readonly restId: string; readonly handle: string; readonly name?: string; readonly hisTweetId?: string };
export type CardQueue = {
  readonly wsId: string;
  readonly mode: CardMode;
  readonly items: readonly CardWho[];
  /** 现在第几张(从 0 起) */
  readonly index: number;
  /** 前面每张的结果 */
  readonly done: ReadonlyArray<{ readonly who: CardWho; readonly outcome: string }>;
  readonly startedAt: string;
};

const idOf = (wsId: string, mode: CardMode): string => `${wsId}:${mode}`;

async function readQueue(wsId: string, mode: CardMode): Promise<CardQueue | null> {
  const [rows] = await getXDB().query<[Array<{ state: string }>]>(
    "SELECT state FROM type::record('x_card_queue', $id)", { id: idOf(wsId, mode) },
  );
  const raw = rows?.[0]?.state;
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as CardQueue;
  } catch (e) {
    /** ⚠️ 存坏了要响,不当成「没有」(那样会把没做完的那批悄悄丢掉) */
    throw capFailed(`库里的卡片队列(${idOf(wsId, mode)})读不出来:${e instanceof Error ? e.message : String(e)}`);
  }
}

async function writeQueue(q: CardQueue): Promise<void> {
  await getXDB().query(
    "UPSERT type::record('x_card_queue', $id) SET ws_id = $ws, mode = $mode, state = $state, updated_at = time::now()",
    { id: idOf(q.wsId, q.mode), ws: q.wsId, mode: q.mode, state: JSON.stringify(q) },
  );
}

async function deleteQueue(wsId: string, mode: CardMode): Promise<void> {
  await getXDB().query("DELETE type::record('x_card_queue', $id)", { id: idOf(wsId, mode) });
}

type O = Record<string, unknown>;
const ws = (o: O): string | null => (typeof o.wsId === 'string' && o.wsId !== '' ? o.wsId : null);
const modeOf = (o: O): CardMode | null => (o.mode === 'ask' || o.mode === 'engage' || o.mode === 'vpn' ? o.mode : null);
const base = (raw: unknown): { wsId: string; mode: CardMode } | string => {
  const o = (raw ?? {}) as O;
  const w = ws(o); const m = modeOf(o);
  if (!w) return '要 wsId';
  if (!m) return 'mode 只认 ask / engage / vpn';
  return { wsId: w, mode: m };
};
const DOC = { wsId: '哪个 workspace', mode: 'ask(求关)/ engage(互动)/ vpn(回复求助)' };

let registered = false;

export function registerCardQueueCapabilities(): void {
  if (registered) return;
  registered = true;

  defineCapability<{ wsId: string; mode: CardMode; people: CardWho[] }, CardQueue & { replaced?: number }>({
    id: 'x.cards.start', kind: 'control',
    describe: '起一批卡片(求关 / 互动 / 回复求助):记下这一批人,从第 1 张开始;同一种卡没做完的那批会被盖掉',
    inputDoc: { ...DOC, people: '[{ restId, handle, name?, hisTweetId? }],1–100 个' },
    parse: (raw) => {
      const b = base(raw);
      if (typeof b === 'string') return b;
      const p = (raw as O).people;
      if (!Array.isArray(p) || p.length === 0 || p.length > 100) return 'people 要 1–100 个';
      const people: CardWho[] = [];
      for (const [n, x] of (p as O[]).entries()) {
        if (!x || typeof x.restId !== 'string' || !/^\d+$/.test(x.restId) || typeof x.handle !== 'string' || x.handle === '') return `people[${n}] 要数字 restId + handle`;
        people.push({
          restId: x.restId, handle: x.handle,
          name: typeof x.name === 'string' ? x.name : undefined, hisTweetId: typeof x.hisTweetId === 'string' ? x.hisTweetId : undefined,
        });
      }
      return { ...b, people };
    },
    run: async (i) => {
      const old = await readQueue(i.wsId, i.mode);
      const replaced = old && old.index < old.items.length ? old.items.length - old.index : 0;
      if (replaced > 0) {
        console.warn(`[x.cards] ${i.wsId} ${i.mode} 新起一批,盖掉了没做完的那批(还剩 ${replaced} 张)`);
      }
      const q: CardQueue = { wsId: i.wsId, mode: i.mode, items: i.people, index: 0, done: [], startedAt: new Date().toISOString() };
      await writeQueue(q);
      console.log(`[x.cards] ${i.wsId} ${i.mode} 起一批 ${q.items.length} 张`);
      /** replaced 只回给调用方(界面要说出来),不进库 */
      return replaced > 0 ? { ...q, replaced } : q;
    },
  });

  defineCapability<{ wsId: string; mode: CardMode }, CardQueue | null>({
    id: 'x.cards.state', kind: 'input',
    describe: '这种卡有没有没做完的那批、现在第几张、前面每张的结果(界面一打开先问,重启后接着)',
    inputDoc: DOC, parse: base,
    run: (i) => readQueue(i.wsId, i.mode),
  });

  defineCapability<{ wsId: string; mode: CardMode; index: number; outcome: string }, { finished: boolean; queue?: CardQueue; done: CardQueue['done'] }>({
    id: 'x.cards.advance', kind: 'control',
    describe: '这张卡做完了(发送 / 跳过 / 放一放 / 下一个):记下结果,到下一张;最后一张做完这一批就结束',
    inputDoc: { ...DOC, index: '刚做完的是第几张(防连点 / 两个窗口重复往下走)', outcome: '这张的结果(一句话)' },
    parse: (raw) => {
      const b = base(raw);
      if (typeof b === 'string') return b;
      const o = raw as O;
      if (!Number.isInteger(o.index) || (o.index as number) < 0) return 'index 要非负整数';
      if (typeof o.outcome !== 'string' || o.outcome === '') return '要 outcome';
      return { ...b, index: o.index as number, outcome: o.outcome };
    },
    run: async (i) => {
      const q = await readQueue(i.wsId, i.mode);
      if (!q) throw capRefused('没有在做的这一批');
      if (q.index !== i.index) throw capRefused(`已经不是第 ${i.index + 1} 张了(现在第 ${q.index + 1} 张)—— 没重复往下走`);
      const done = [...q.done, { who: q.items[q.index], outcome: i.outcome }];
      if (q.index + 1 >= q.items.length) {
        await deleteQueue(i.wsId, i.mode);
        console.log(`[x.cards] ${i.wsId} ${i.mode} 这一批 ${q.items.length} 张做完了`);
        return { finished: true, done };
      }
      const next: CardQueue = { ...q, index: q.index + 1, done };
      await writeQueue(next);
      return { finished: false, queue: next, done };
    },
  });

  defineCapability<{ wsId: string; mode: CardMode }, { done: CardQueue['done'] }>({
    id: 'x.cards.end', kind: 'control',
    describe: '结束这一批(剩下的不做了),返回已做完的那些',
    inputDoc: DOC, parse: base,
    run: async (i) => {
      const q = await readQueue(i.wsId, i.mode);
      await deleteQueue(i.wsId, i.mode);
      if (q) console.log(`[x.cards] ${i.wsId} ${i.mode} 结束这一批:做了 ${q.done.length} / ${q.items.length} 张`);
      return { done: q?.done ?? [] };
    },
  });
}
