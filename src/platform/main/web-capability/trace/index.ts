/**
 * `web.trace` —— Web 能力层的横切能力:诊断(如实记录)+ 维护(健康探针)。
 *
 * 步 2.5 交付:三条流记录器(纯逻辑)+ 健康探针 + 与 web.net 的接缝。
 * **本步不接任何消费者**,也不落盘(sink 只留接口,接线时接真 fs)。
 */
export * from './types';
export * from './recorder';
export * from './health';
export { NetMonitor, type NetMonitorOptions } from './net-monitor';
