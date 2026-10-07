/**
 * `HookHost` 的 Electron 实现(M4)—— 能力层与 CDP 之间的**唯一接缝**
 *
 * ⚠️ 本文件在 `wiring/`:这是能力层唯一允许碰 Electron 的地方
 * (`page-boundary-guard` 钉着)。
 *
 * ── ⭐ 用到的三个 CDP 能力 ──
 *
 * · `Runtime.addBinding`                     页面里多一个可调用的函数
 * · `Page.addScriptToEvaluateOnNewDocument`  **站点脚本之前**执行(赢得原型竞赛)
 * · `Runtime.evaluate`                       给已加载完的文档补一次
 *
 * ⚠️ 这三个都要先 `Runtime.enable` / `Page.enable`,
 * 而 `Network.enable` 是 `body-provider` 那条腿开的 —— **互不干扰**,
 * 同一个 debugger 可以同时开多个 domain。
 */

import type { WebContents } from 'electron';
import type { HookHost } from '../hook/types';

/** 每个 wc 只装一次 binding 监听 —— ⚠️ 装两次会让每条数据回来两份 */
const bound = new WeakSet<WebContents>();

export function toHookHost(wc: WebContents): HookHost {
  const dbg = wc.debugger;
  const listeners: Array<(name: string, payload: string) => void> = [];

  return {
    hostId: wc.id,

    async addBinding(name: string): Promise<void> {
      /**
       * ⚠️ `Runtime.enable` 必须在 `addBinding` 之前 ——
       * 否则 binding 注册成功但 `Runtime.bindingCalled` **永远不来**,
       * 而且**不报错**(页面那边调用照常成功)。
       * ⭐ 这正是本仓反复出现的「静默失效」形态。
       */
      await dbg.sendCommand('Runtime.enable');
      await dbg.sendCommand('Runtime.addBinding', { name });

      if (!bound.has(wc)) {
        bound.add(wc);
        dbg.on('message', (_e, method, params) => {
          if (method !== 'Runtime.bindingCalled') return;
          const p = params as { name?: unknown; payload?: unknown };
          if (typeof p.name !== 'string' || typeof p.payload !== 'string') return;
          for (const l of listeners) l(p.name, p.payload);
        });
      }
    },

    onBindingCalled(listener: (name: string, payload: string) => void): void {
      listeners.push(listener);
    },

    async addScriptOnNewDocument(source: string): Promise<string> {
      /**
       * ⭐⭐ 这是 M4 的**命门**:它让脚本在站点自己的代码之前跑,
       * 从而能覆写 `XMLHttpRequest`/`fetch` 的原型 ——
       * 社区把这叫「**赢得原型竞赛**」。晚一步就钩不住。
       */
      await dbg.sendCommand('Page.enable');
      const r = await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
      return String((r as { identifier?: unknown })?.identifier ?? '');
    },

    async evaluateNow(source: string): Promise<void> {
      /**
       * ⚠️ 给**已经加载完**的文档补一次 —— 没有它的话,
       * 人点「开始」之后不刷新就永远钩不到
       * (CDP 那条腿正是栽在这个竞态上:attach 晚于首次请求)。
       * ⭐ 脚本自带防重,补装不会钩两遍。
       */
      await dbg.sendCommand('Runtime.evaluate', {
        expression: source,
        // ⚠️ 必须在**页面主世界**求值,不是隔离世界 ——
        //    隔离世界里改原型对站点代码无效(那是扩展的 content script 模型)
        includeCommandLineAPI: false,
        awaitPromise: false,
      });
    },
  };
}
