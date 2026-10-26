/**
 * ⭐⭐⭐ 流程 —— 平台层,不认识任何业务(Module5-04 §3.4 / 第 4 步 4b,2026-10-26)
 *
 * 流程 = 一个能力,里面一步步调别的能力(`f.call`)。原来这些循环写在界面组件里(逐个筛人、5 条一批地判、
 * 搜索后扫倾向、按标签页采还带重试),主进程 / 定时器 / AI 都够不着;现在在主进程跑,界面只「开始 → 看进度 → 可叫停」。
 *
 * - 每一步走执行器(校验 / 前提 / 锁 / 记录 / 统一结果),记录挂在这次流程名下:run_id = 流程那次调用的 callId。
 * - 步骤的调用方 = 流程的调用方 —— AI 起的流程里,对外动作那一步照样被执行器拒(要人批复)。
 * - 同一个流程在同一个范围(scope,如 workspace)一次只跑一份:用资源锁 `flow:<id>:<scope>`(原子,锁对账里看得见)。
 * - 进度:`f.step(i, total, msg)` / `f.say(msg)`;界面 / AI 用 `flow.runs` 看。跑完的留 60 秒(界面要显示最后一句)。
 * - 叫停:`flow.stop`;流程在步与步之间看 `f.stopped()`,当前那步做完才停;`f.onStop` 可挂钩子(如通知正在跑的采集停下)。
 * - 沿用 Module5-01「可重组步骤、不做分支」:流程里的判断只是「这一步成没成 / 要不要接着」,要选走哪条路的交给 AI 层。
 * ⚠️ 只在主进程用(模块级状态每进程一份)。
 */
import { defineCapability, capRefused, execute, type CapResult, type Caller, type Capability, type Need, type Prepared } from './capability';

export type FlowRun = {
  readonly runId: string;
  readonly flow: string;
  readonly scope: string;
  readonly caller: Caller;
  readonly startedAt: number;
  msg?: string;
  i?: number;
  total?: number;
  stopRequested?: boolean;
  done?: boolean;
  ok?: boolean;
  endedAt?: number;
};

export type FlowCtx<C> = {
  readonly runId: string;
  readonly caller: Caller;
  /** 流程自己占住的资源 → token(如网页锁,往下调需要同一把锁的能力时带进去) */
  readonly held: ReadonlyMap<string, string>;
  readonly prep: C;
  say(msg: string): void;
  step(i: number, total: number, msg?: string): void;
  stopped(): boolean;
  onStop(cb: () => void): void;
  /** 调一个能力 —— 调用方 = 流程的调用方,记录挂在这次流程名下 */
  call(id: string, input: unknown): Promise<CapResult<unknown>>;
};

type Live = FlowRun & { hooks: Array<() => void> };
const runs = new Map<string, Live>();
const KEEP_DONE_MS = 60_000;

function prune(now = Date.now()): void {
  for (const [id, r] of runs) if (r.done && r.endedAt !== undefined && now - r.endedAt > KEEP_DONE_MS) runs.delete(id);
}

export function listFlows(scope?: string): FlowRun[] {
  prune();
  return [...runs.values()]
    .filter((r) => scope === undefined || r.scope === scope)
    .map(({ hooks: _h, ...pub }) => ({ ...pub }));
}

/** 叫停;没有在跑的这次 → false */
export function stopFlow(runId: string): boolean {
  const r = runs.get(runId);
  if (!r || r.done) return false;
  if (!r.stopRequested) {
    r.stopRequested = true;
    console.log(`[flow] 叫停 ${r.flow}(${r.scope})#${runId}`);
    for (const cb of r.hooks) {
      try { cb(); } catch (e) { console.error(`[flow] ${r.flow} 叫停钩子出错:`, e); }
    }
  }
  return true;
}

export function defineFlow<I, O, C = undefined>(def: {
  readonly id: string;
  readonly describe: string;
  readonly inputDoc: Readonly<Record<string, string>>;
  readonly parse: (raw: unknown) => I | string;
  /** 同一个流程在这个范围里一次只跑一份(通常是 workspace) */
  readonly scope: (i: I) => string;
  /** 流程自己的前提 + 要占的资源(如整段占着网页) */
  readonly prepare?: (i: I) => Promise<Prepared<C>>;
  readonly subject?: (i: I) => string | undefined;
  readonly summarize?: (out: O) => Record<string, unknown>;
  readonly run: (i: I, f: FlowCtx<C>) => Promise<O>;
}): Capability<I, O, C> {
  return defineCapability<I, O, C>({
    id: def.id,
    kind: 'control',
    describe: `流程:${def.describe}`,
    inputDoc: def.inputDoc,
    parse: def.parse,
    subject: def.subject,
    summarize: def.summarize,
    prepare: async (i) => {
      const own: Need = { resource: `flow:${def.id}:${def.scope(i)}`, purpose: def.describe, label: `「${def.describe}」已经在跑 —— ` };
      if (!def.prepare) return { needs: [own], ctx: undefined as C };
      const p = await def.prepare(i);
      if ('refused' in p) return p;
      return { needs: [own, ...(p.needs ?? [])], ctx: p.ctx };
    },
    run: async (i, ctx) => {
      const rec: Live = { runId: ctx.callId, flow: def.id, scope: def.scope(i), caller: ctx.caller, startedAt: Date.now(), hooks: [] };
      runs.set(ctx.callId, rec);
      const f: FlowCtx<C> = {
        runId: ctx.callId, caller: ctx.caller, held: ctx.held, prep: ctx.prep,
        say: (msg) => { rec.msg = msg; },
        step: (n, total, msg) => { rec.i = n; rec.total = total; if (msg !== undefined) rec.msg = msg; },
        stopped: () => rec.stopRequested === true,
        onStop: (cb) => { rec.hooks.push(cb); },
        call: (id, input) => execute(id, input, { caller: ctx.caller, runId: ctx.callId }),
      };
      try {
        const v = await def.run(i, f);
        rec.ok = true;
        return v;
      } catch (e) {
        rec.ok = false;
        rec.msg = `出错:${e instanceof Error ? e.message : String(e)}`;
        throw e;
      } finally {
        rec.done = true;
        rec.endedAt = Date.now();
        prune();
      }
    },
  });
}

let controlRegistered = false;
/** flow.runs / flow.stop —— AI 和界面看进度、叫停 */
export function registerFlowControlCapabilities(): void {
  if (controlRegistered) return;
  controlRegistered = true;
  defineCapability<{ scope?: string }, FlowRun[]>({
    id: 'flow.runs', kind: 'input', probe: true,
    describe: '正在跑 / 刚跑完(60 秒内)的流程:进度、在干什么、有没有被叫停',
    inputDoc: { scope: '可选:只看这个范围(通常是 workspace)' },
    parse: (raw) => {
      const s = (raw as { scope?: unknown } | undefined)?.scope;
      return s === undefined ? {} : typeof s === 'string' && s !== '' ? { scope: s } : 'scope 要非空字符串';
    },
    run: async (i) => listFlows(i.scope),
  });
  defineCapability<{ runId?: string; flow?: string; scope?: string }, { stopped: string }>({
    id: 'flow.stop', kind: 'control',
    describe: '叫停一个正在跑的流程(当前那步做完就停)',
    inputDoc: { runId: '流程那次的 id(flow.runs 里有)', flow: '或者:流程 id', scope: '+ 范围' },
    parse: (raw) => {
      const o = (raw ?? {}) as { runId?: unknown; flow?: unknown; scope?: unknown };
      if (typeof o.runId === 'string' && o.runId !== '') return { runId: o.runId };
      if (typeof o.flow === 'string' && typeof o.scope === 'string') return { flow: o.flow, scope: o.scope };
      return '要 runId,或 flow + scope';
    },
    run: async (i) => {
      const id = i.runId ?? [...runs.values()].find((r) => r.flow === i.flow && r.scope === i.scope && !r.done)?.runId;
      if (!id || !stopFlow(id)) throw capRefused('没有在跑的这个流程');
      return { stopped: id };
    },
  });
}

/** 测试用 */
export function _resetFlows(): void {
  runs.clear();
}
