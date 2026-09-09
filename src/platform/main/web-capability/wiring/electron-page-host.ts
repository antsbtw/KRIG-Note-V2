/**
 * `web.net` 的 Electron 接线适配 —— 把真 `WebContents` 包成 `PageHost`
 *
 * ⭐ 这是能力层**唯一**碰 Electron 的地方。`web.net` / `web.page` / `web.trace`
 * 三层保持零 electron 依赖(有守卫扫),真实运行时的胶水集中在这里。
 *
 * ── 真机实测的四条事实(2026-09-08,Electron 40.6.0,非 mock)──
 *
 * 步 2 的 `web.net` 建立在四个关于 Electron 行为的假设上,已全部实测确认:
 *
 * | 假设 | 实测 |
 * |---|---|
 * | `attach()` 失败**抛异常** | ✅ 三种失败形态全抛 |
 * | 抛的是 Error 子类(有 `.message`) | ✅ `TypeError`,`.message` 可读 |
 * | `on('detach')` 的 `args[1]` 是 reason | ✅ argc=2,`args[1] === 'target closed'` |
 * | `isAttached()` 反映真实状态 | ✅ attach 后 true / detach 后 false |
 *
 * 实测到的三种 attach 失败形态(都抛):
 *   1. 重复 attach → `TypeError: Debugger is already attached to the target`
 *      ⭐ 最常见的一种,也正是 X 那 8 处全写 try/catch 的原因
 *   2. 协议版本不支持 → `Requested protocol version is not supported`
 *   3. 对已销毁的 wc → `Object has been destroyed`
 *
 * ⚠️ 复现时注意:shell 里若有 `ELECTRON_RUN_AS_NODE=1`,Electron 会退化成纯 Node,
 * `require('electron')` 命中 npm launcher 包而非内部 API,表现为 `app` undefined。
 * 用 `env -u ELECTRON_RUN_AS_NODE` 清掉再跑。
 */

import type { DebuggerLike, PageHost } from '../net/body-provider';

/**
 * 把 Electron 的 `WebContents` 适配成 `web.net` 要的 `PageHost`。
 *
 * ⭐ 返回的 `debugger` **只暴露 `DebuggerLike` 的四个方法,其中没有 `detach`** ——
 * 拿到它的人无法关灯(单一持有者模型的机器强制点)。
 */
export function toPageHost(wc: Electron.WebContents): PageHost {
  const dbg = wc.debugger;
  const adapted: DebuggerLike = {
    isAttached: () => dbg.isAttached(),
    attach: (version: string) => { dbg.attach(version); },
    sendCommand: (method: string, params?: unknown) =>
      dbg.sendCommand(method, params as Record<string, unknown> | undefined),
    on: (event: 'detach' | 'message', listener: (...args: unknown[]) => void) => {
      dbg.on(event as 'detach', ((...args: unknown[]) => { listener(...args); }) as never);
    },
  };

  return {
    hostId: wc.id,
    debugger: adapted,
    onDestroyed: (listener: () => void) => {
      // ⚠️ 已销毁的 wc 再挂监听会抛(实测「Object has been destroyed」),先判一次
      if (wc.isDestroyed()) {
        listener();
        return;
      }
      wc.once('destroyed', listener);
    },
  };
}
