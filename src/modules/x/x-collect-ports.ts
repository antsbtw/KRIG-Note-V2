/**
 * ⭐ `WebviewPorts` 的主进程实现 —— 把 X 的采集编排接到能力层(2026-10-13,3a)
 *
 * 原来 renderer 经 webDomInvoke 调 `goto` / `harvest` / `run`;现在在主进程**直接调同一组入口**
 * (`web-collect-engine` 的 gotoOnPage / harvestOnPage / runScriptOnPage),
 * 留痕也调**同一份**(`collect-trace` 的 traceGoto / traceHarvest)——
 * 所以走 IPC 与走这里,导航/采集/留痕是一样的。
 *
 * ⚠️ 失败语义照搬原来经 IPC 时 renderer 看到的样子(行为不变):
 *   goto    只有 failed 才算没到(degraded 算到了)
 *   harvest 解析不出页面 / 抛异常 → null(runCollect 当「没采到」处理)
 *   run     不是 ok/degraded → 抛「翻页脚本失败:…」
 * ⭐ 每条失败都在**主进程终端**打一行(原来 ipc-dom 的 failed() 也是这么做的)。
 *
 * ⚠️ 每个动作都**重新 resolve** —— 与经 IPC 时一样(每次调用各自 resolve):
 * 采集中页面被关掉,下一步就如实失败,而不是拿着一个死掉的 wc 接着用。
 */

import {
  resolve, gotoOnPage, harvestOnPage, runScriptOnPage,
} from '@platform/main/web-capability/wiring/web-collect-engine';
import { traceGoto, traceHarvest } from '@platform/main/web-capability/wiring/collect-trace';
import type { WebviewPorts } from './x-collect-on-webview';
import type { RunHarvest } from './x-collect-run';

const say = (m: string): void => { console.warn('[x.collect] ' + m); };
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function webviewPorts(wcId: number): WebviewPorts {
  return {
    async goto(name, params) {
      const got = resolve({ wcId });
      if ('error' in got) { say(got.error); return { ok: false, reason: got.error }; }
      try {
        const r = await gotoOnPage(got.pageId, name, params);
        traceGoto(got.pageId, name, params, r);
        if (r.status === 'failed') {
          const reason = String((r as { reason?: unknown }).reason ?? '(未给原因)');
          say(`goto ${name} 失败:${reason}`);
          return { ok: false, reason };
        }
        return { ok: true };
      } catch (e) {
        const reason = `goto 抛异常: ${msg(e)}`;
        say(reason);
        return { ok: false, reason };
      }
    },

    async harvest(plan) {
      const got = resolve({ wcId });
      if ('error' in got) { say(got.error); return null; }
      try {
        const rep = await harvestOnPage(got.wc, got.pageId, plan);
        traceHarvest(got.pageId, got.wc.getURL(), rep);
        return rep as RunHarvest;
      } catch (e) {
        say(`harvest 抛异常: ${msg(e)}`);
        return null;
      }
    },

    async runScript(scriptId, params) {
      const got = resolve({ wcId });
      if ('error' in got) { say(got.error); throw new Error(`翻页脚本失败:${got.error}`); }
      let rr: Awaited<ReturnType<typeof runScriptOnPage>>;
      try {
        rr = await runScriptOnPage(got.wc, got.pageId, scriptId, params as Parameters<typeof runScriptOnPage>[3]);
      } catch (e) {
        const reason = `run 抛异常: ${msg(e)}`;
        say(reason);
        throw new Error(`翻页脚本失败:${reason}`);
      }
      if (rr.status !== 'ok' && rr.status !== 'degraded') {
        const reason = String((rr as { reason?: unknown }).reason ?? '(未给原因)');
        say(`脚本 ${scriptId} 失败:${reason}`);
        throw new Error(`翻页脚本失败:${reason}`);
      }
      return (rr as { value?: unknown }).value;
    },
  };
}
