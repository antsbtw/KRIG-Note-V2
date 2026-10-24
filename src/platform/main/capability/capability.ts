/**
 * ⭐⭐⭐ 能力目录 + 执行器 —— 平台层,不认识任何业务(Module5-04 §3.2 / §3.3,2026-10-23)
 *
 * ── 为什么有它 ──
 *
 * 原来「做之前要满足什么、做时要占住什么、做完记什么、结果长什么样」靠每个调用方自觉:
 * 同一个功能走界面查忙、走收件箱不查;界面「再找一轮」不查搜索额度;结果格式十几种。入口越多抄漏越多。
 * 现在一个功能登记一次(defineCapability),所有入口 —— 界面(ui)/ 定时器(timer)/ 开发收件箱(inbox)/ AI(ai)——
 * 都调 `execute(id, input, { caller })`,走同一道关。AI 能做的 = 人能点的(用户 10-22:「先一切皆可为」)。
 *
 * ── 执行器固定顺序 ──
 *
 *   校验(parse)→ 前提检查(prepare:认号 / 额度 / 网页在不在,模块自己写)→ 占锁(needs)
 *   → run → 放锁 → 写一行 flow_step_run → 返回统一结果
 *
 * - run 只干活:不查忙、不记日志、不管结果格式。没做成就 `throw capFailed(why)`;
 *   跑到一半发现不该做 `throw capRefused(why)`;别的异常一律算 failed(并且响)。
 * - 统一结果:ok / refused(没动手)/ failed(做了没成)/ invalid(参数不对)。定时器只在 ok 时算「做过了」。
 * - 锁走 `flow/resource-lock`(只有持有者能放);run 拿到的 `ctx.held` 是本次占住的 资源 → token,
 *   往下调别的需要同一把锁的函数时把 token 带进去(如搜索滚动的 ownToken)。
 *
 * ⚠️ 只在主进程用(模块级登记表每进程一份)。renderer 经各模块的 IPC 调。
 */
import { acquireLock, releaseLock } from '../flow/resource-lock';
import { recordCall } from '../flow/flow-run-repo';

export type CapabilityKind = 'input' | 'control' | 'output';
export type Caller = 'ui' | 'timer' | 'inbox' | 'ai';

export type CapResult<T> =
  | { readonly ok: true; readonly value: T; readonly callId: string }
  | { readonly ok: false; readonly kind: 'refused' | 'failed' | 'invalid'; readonly why: string; readonly callId: string };

/**
 * 要占的资源(如 `page:<wcId>`);purpose 给被拒的人看;
 * label = 被拒时怎么称呼这个资源(如「X 网页」)—— 平台不认识业务,由模块给,不给就用资源键
 */
export type Need = { readonly resource: string; readonly purpose: string; readonly label?: string };

export type Prepared<C> = { readonly refused: string } | { readonly needs?: readonly Need[]; readonly ctx: C };

export type RunCtx<C> = {
  readonly caller: Caller;
  readonly callId: string;
  /** 本次占住的 资源 → token */
  readonly held: ReadonlyMap<string, string>;
  /** prepare 算好的东西(认出的号 / 网页 wcId …) */
  readonly prep: C;
};

export interface Capability<I, O, C = undefined> {
  /** 模块.对象.动作,如 x.engage.prepare */
  readonly id: string;
  readonly kind: CapabilityKind;
  /** 给 AI 读的一句话 */
  readonly describe: string;
  /** 每个参数一句说明(给 AI 读) */
  readonly inputDoc: Readonly<Record<string, string>>;
  /** 校验在执行器做,调用方不做;不对就返回原因 */
  readonly parse: (raw: unknown) => I | string;
  /** 前提检查 + 要占什么;不给 = 没有前提、不占资源 */
  readonly prepare?: (input: I) => Promise<Prepared<C>>;
  readonly run: (input: I, ctx: RunCtx<C>) => Promise<O>;
  /** 这次是为谁跑的(跨库只存字符串,如 x_author:<id>) */
  readonly subject?: (input: I) => string | undefined;
  /**
   * 状态轮询(界面每 1–5 秒刷一次):执行记录照记、只留 7 天(用户 10-24「全记,只留 7 天」);
   * 成功的不打终端(防刷屏,我的判断),没成的照打。
   */
  readonly probe?: boolean;
  /** 记录里的输出摘要;不给 = 原样(太大就只记字段名) */
  readonly summarize?: (out: O) => Record<string, unknown>;
}

class CapSignal extends Error {
  constructor(readonly kind: 'refused' | 'failed', why: string) { super(why); }
}
/** run 里:做了没成 */
export const capFailed = (why: string): Error => new CapSignal('failed', why);
/** run 里:跑到一半发现不该做(没对外界动手) */
export const capRefused = (why: string): Error => new CapSignal('refused', why);

type AnyCap = Capability<unknown, unknown, unknown>;
const registry = new Map<string, AnyCap>();

export function defineCapability<I, O, C = undefined>(cap: Capability<I, O, C>): Capability<I, O, C> {
  if (registry.has(cap.id)) throw new Error(`[capability] ${cap.id} 登记了两次 —— 两份实现必漂,只许一份`);
  registry.set(cap.id, cap as unknown as AnyCap);
  return cap;
}

/** 给 AI 读的目录 */
export function listCapabilities(): Array<{ id: string; kind: CapabilityKind; describe: string; inputDoc: Readonly<Record<string, string>> }> {
  return [...registry.values()].map((c) => ({ id: c.id, kind: c.kind, describe: c.describe, inputDoc: c.inputDoc }));
}

let seq = 0;
function newCallId(now: number): string {
  seq = (seq + 1) % 1_000_000;
  return `call_${new Date(now).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** 状态轮询的记录留几天(用户 10-24 定 7 天);清理见 flow-run-repo purgeExpiredCalls */
export const PROBE_KEEP_DAYS = 7;

/** 记录里放多大的输出原样(再大只记字段名)—— 回看够用,不把 flow 库撑大 */
const OUTPUT_INLINE_LIMIT = 4000;
function defaultSummary(out: unknown): Record<string, unknown> | undefined {
  if (out === undefined) return undefined;
  const s = JSON.stringify(out) ?? '';
  if (s.length <= OUTPUT_INLINE_LIMIT) return { value: out };
  return { truncated: true, length: s.length, keys: out && typeof out === 'object' ? Object.keys(out as object) : [] };
}
const asRecord = (x: unknown): Record<string, unknown> | undefined =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : x === undefined ? undefined : { value: x };

export async function execute(
  id: string, raw: unknown, opts: { readonly caller: Caller; readonly runId?: string },
): Promise<CapResult<unknown>> {
  const t0 = Date.now();
  const callId = newCallId(t0);
  const cap = registry.get(id);
  const kindOf = cap?.kind ?? 'unknown';
  const probe = cap?.probe === true;
  let input: unknown;
  let subjectRef: string | undefined;
  const held = new Map<string, string>();

  const finish = async (r: CapResult<unknown>, output?: Record<string, unknown>): Promise<CapResult<unknown>> => {
    for (const token of [...held.values()].reverse()) releaseLock(token);
    held.clear();
    const durationMs = Date.now() - t0;
    const tail = r.ok ? '' : ` —— ${r.why}`;
    const line = `[cap] ${id}(${opts.caller})${r.ok ? 'ok' : r.kind} ${durationMs}ms${tail} #${callId}`;
    if (!r.ok && r.kind === 'failed') console.warn(line); else if (!(probe && r.ok)) console.log(line);
    await recordCall({
      callId, runId: opts.runId, capability: id, kind: kindOf, caller: opts.caller,
      status: r.ok ? 'ok' : r.kind, why: r.ok ? undefined : r.why,
      input: asRecord(input ?? raw), output, subjectRef, durationMs, keepDays: probe ? PROBE_KEEP_DAYS : undefined,
    });
    return r;
  };

  if (!cap) return finish({ ok: false, kind: 'invalid', why: `目录里没有能力 ${id}`, callId });
  const parsed = cap.parse(raw);
  if (typeof parsed === 'string') return finish({ ok: false, kind: 'invalid', why: parsed, callId });
  input = parsed;
  subjectRef = cap.subject?.(parsed);

  let prep: Prepared<unknown> = { ctx: undefined };
  try {
    if (cap.prepare) prep = await cap.prepare(parsed);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[cap] ${id} 前提检查出错:${why}`);
    return finish({ ok: false, kind: 'failed', why: `前提检查出错:${why}`, callId });
  }
  if ('refused' in prep) return finish({ ok: false, kind: 'refused', why: prep.refused, callId });

  for (const n of prep.needs ?? []) {
    const a = acquireLock(n.resource, n.purpose, opts.caller);
    if (!a.ok) {
      const why = `${n.label ?? `${n.resource} `}正忙:${a.why}`;
      return finish({ ok: false, kind: 'refused', why, callId });
    }
    held.set(n.resource, a.token);
  }

  try {
    const value = await cap.run(parsed, { caller: opts.caller, callId, held, prep: prep.ctx });
    return finish({ ok: true, value, callId }, cap.summarize ? cap.summarize(value) : defaultSummary(value));
  } catch (e) {
    if (e instanceof CapSignal) return finish({ ok: false, kind: e.kind, why: e.message, callId });
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[cap] ${id} 出错:`, e);
    return finish({ ok: false, kind: 'failed', why: `出错:${why}`, callId });
  }
}

/** 测试用 */
export function _resetCapabilities(): void {
  registry.clear();
}
