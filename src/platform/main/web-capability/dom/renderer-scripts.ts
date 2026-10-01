/**
 * renderer 侧注入脚本的预注册表(L2 收口最后一块,步 2)
 *
 * ── 为什么要收进来 ──
 *
 * 这些脚本原本由 renderer 直接 `webview.executeJavaScript(...)` 注入,
 * 四个实测缺陷(设计 §〇):
 *  ① `sync-driver` **26 处静默吞异常、零日志**
 *  ② ⭐ `replace(/占位符/g, side)` 把运行时值**文本替换进脚本源码** ——
 *     与 `project-x-inject-template-escape` 同机制,**且已经咬过一次**
 *     (占位符在 `sync-inject.js` 出现 2 处:一处注释一处真实变量,
 *      当初 `replace(string,string)` 只换了注释 → sync 行为异常)
 *  ③ 9 处运行时值拼进脚本 ④ 零留痕
 *
 * ⭐ 收进来之后:参数走 `JSON.stringify` **绑定值**,调用方只给 `scriptId`
 * —— 从类型层面拼不出坏脚本;且自动获得 `trace` 留痕。
 *
 * ⚠️ **脚本本体一行没动** —— `?raw` 整文件照原样注入,
 * 这里只负责「在它前面定义绑定变量」。改脚本内容是另一回事,不混在收口里。
 */

import type { RegisteredScript, ScriptId, ScriptParams } from './types';
import type { ScriptRegistry } from './script-registry';
// ⚠️ Vite `?raw`:把 .js 文件原文当字符串读(与 renderer 侧同一手法)
import syncInjectRaw from '../../../../drivers/web-sync-driver/sync-inject.js?raw';

export const RENDERER_SCRIPTS = {
  /** 双开 web view 的同步内核(guest 端事件队列 + 滚动/点击/输入采集) */
  syncInject: 'renderer.sync-inject' as ScriptId,
} as const;

/** 缺参数就抛,不静默用默认值(那会把「忘了传」变成静默错误) */
function requireSide(params: ScriptParams): 'left' | 'right' {
  const v = params['side'];
  if (v !== 'left' && v !== 'right') {
    throw new Error(`[web.dom] sync-inject 的 side 必须是 'left' | 'right',收到 ${String(v)}`);
  }
  return v;
}

export const RENDERER_SCRIPT_DEFINITIONS: readonly RegisteredScript[] = [
  {
    id: RENDERER_SCRIPTS.syncInject,
    purpose: '双开 web view 同步内核(guest 端注入;side 决定本侧身份)',
    /**
     * ⭐ **绑定值,不是文本替换**:在脚本本体**之前**定义
     * `window.__krigSyncSideBound`,脚本体读它。
     *
     * ⚠️ 这样即使 side 的值里带引号/反斜杠也拼不坏脚本 ——
     * 而旧的 regex 替换做不到这一点(它改的是源码文本)。
     */
    build: (p) => {
      const side = requireSide(p);
      return `(function(){ window.__krigSyncSideBound = ${JSON.stringify(side)}; })();\n`
        + (syncInjectRaw as unknown as string);
    },
  },
];

/** 把本表登记进脚本注册表(由 `wiring/runtime.ts` 在启动时调一次)*/
export function registerRendererScripts(registry: ScriptRegistry): void {
  for (const def of RENDERER_SCRIPT_DEFINITIONS) {
    registry.register(def);
  }
}
