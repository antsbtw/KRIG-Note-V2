/**
 * `web.net` —— Web 能力层的「输出·网络捕获」能力。
 *
 * 步 2 交付:事件总线 + 关联 + 单一持有者 body provider。
 * **本步不接任何消费者**(AI / X 都是后面的步骤)。
 */
export * from './types';
export * from './web-net';
export * from './correlate';
export { NetworkEventBus, type NetworkListener } from './bus';
export { CdpBodyProvider, shouldCaptureBody, decodeBody, type DebuggerLike, type PageHost } from './body-provider';
