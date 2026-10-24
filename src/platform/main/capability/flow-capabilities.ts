/**
 * ⭐ 平台自带的能力:查执行记录(Module5-04 第 2 步,2026-10-23)
 * 「系统跑了什么」本身也是一个能力 —— AI 要能自己回看:谁、何时、调了什么、结果、为什么没做成。
 * ⚠️ 只读 krig_flow;读写都走 flow-run-repo(唯一碰 flow 表的地方)。
 */
import { defineCapability } from './capability';
import { listCalls } from '../flow/flow-run-repo';

let registered = false;

export function registerFlowCapabilities(): void {
  if (registered) return;
  registered = true;
  defineCapability<{ limit: number; capability?: string; caller?: string; status?: string }, unknown>({
    id: 'flow.calls.recent',
    kind: 'input',
    describe: '最近的能力调用记录(谁调的、调了什么、结果、没做成的原因、耗时),新的在前',
    inputDoc: {
      limit: '最多几条,1–200,默认 20',
      capability: '可选:只看这个能力',
      caller: '可选:只看 ui / timer / inbox / ai',
      status: '可选:只看 ok / refused / failed / invalid',
    },
    parse: (raw) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const limit = o.limit === undefined ? 20 : o.limit;
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 200) return 'limit 要 1–200';
      for (const k of ['capability', 'caller', 'status'] as const) {
        if (o[k] !== undefined && (typeof o[k] !== 'string' || o[k] === '')) return `${k} 要非空字符串`;
      }
      if (o.caller !== undefined && !['ui', 'timer', 'inbox', 'ai'].includes(o.caller as string)) return 'caller 只认 ui / timer / inbox / ai';
      if (o.status !== undefined && !['ok', 'refused', 'failed', 'invalid'].includes(o.status as string)) return 'status 只认 ok / refused / failed / invalid';
      return { limit: limit as number, capability: o.capability as string | undefined, caller: o.caller as string | undefined, status: o.status as string | undefined };
    },
    run: async (i) => ({ calls: await listCalls(i) }),
    /** 别把整页记录又原样存进记录里 */
    summarize: (out) => ({ count: (out as { calls: unknown[] }).calls.length }),
  });
}
