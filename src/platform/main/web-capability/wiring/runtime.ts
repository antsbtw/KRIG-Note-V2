/**
 * Web 能力层的运行期单例 —— 接线层共用的一套 registry / bus / recorder / probe
 *
 * 各能力本身是纯逻辑类(可 new 多个,便于单测);**生产运行时只要一套**,
 * 集中在这里,免得各消费者各建一份导致「A 登记的页面 B 查不到」。
 */

import { PageRegistry } from '../page';
import { NetworkEventBus, CdpBodyProvider } from '../net';
import { TraceRecorder, HealthProbe, NetMonitor } from '../trace';
import { ScriptRegistry, registerAIScripts } from '../dom';
import { ElectronDomRunner } from './electron-dom';

export const pageRegistry = new PageRegistry();
export const netBus = new NetworkEventBus();
export const bodyProvider = new CdpBodyProvider(netBus);
export const traceRecorder = new TraceRecorder();
export const healthProbe = new HealthProbe();

/** ⭐ 预注册脚本表 —— 业务方只能按 id 取用,拼不出坏脚本 */
export const scriptRegistry = new ScriptRegistry();
registerAIScripts(scriptRegistry);
export const domRunner = new ElectronDomRunner(scriptRegistry, traceRecorder);

/**
 * per-page 的网络观测器。
 * 一个页面一个 —— 否则「这个页面近 5 分钟零捕获」会被别的页面的流量掩盖掉。
 */
const monitors = new Map<string, NetMonitor>();

export function getNetMonitor(pageId: string): NetMonitor {
  let m = monitors.get(pageId);
  if (!m) {
    m = new NetMonitor({ recorder: traceRecorder });
    monitors.set(pageId, m);
  }
  return m;
}

export function dropNetMonitor(pageId: string): void {
  monitors.delete(pageId);
}

export function listMonitoredPages(): string[] {
  return Array.from(monitors.keys());
}
