/**
 * ⭐ 界面跑主进程流程的薄壳(Module5-04 第 4 步 4b,2026-10-26)—— 开始 → 每秒看一眼进度 → 可叫停
 * 流程本身在主进程(x-flows.ts);这里只把「等它跑完」和「看进度」接起来,界面不再自己循环调能力。
 */
import { xDataCall, type XDataInvoke, type XDataResult } from './x-data-types';

export type FlowRunView = {
  readonly runId: string; readonly flow: string; readonly scope: string;
  readonly msg?: string; readonly i?: number; readonly total?: number; readonly stopRequested?: boolean; readonly done?: boolean;
};

/** 发起流程并等它跑完;期间每秒把这个流程最新的进度交给 onProgress(只看还在跑的那份) */
export async function runFlow(call: XDataInvoke, flowId: string, wsId: string, onProgress: (r: FlowRunView) => void): Promise<XDataResult> {
  let alive = true;
  const t = setInterval(() => {
    void xDataCall({ op: 'flowRuns', scope: wsId }).then((r) => {
      if (!alive || r.status !== 'ok') return;
      const run = (r.value as FlowRunView[]).filter((x) => x.flow === flowId && x.done !== true).at(-1);
      if (run) onProgress(run);
    });
  }, 1000);
  try {
    return await xDataCall(call);
  } finally {
    alive = false;
    clearInterval(t);
  }
}

/** 叫停(当前那步做完就停);没有在跑的也说出来 */
export async function stopFlow(flowId: string, wsId: string): Promise<string | null> {
  const r = await xDataCall({ op: 'flowStop', flow: flowId, scope: wsId });
  return r.status === 'ok' ? null : r.reason;
}
