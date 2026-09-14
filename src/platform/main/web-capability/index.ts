/**
 * Web 能力层(`docs/10-business-design/web/capability-layer/`)。
 *
 * 五个能力:web.page(控制)/ web.net(网络)/ web.dom(读取与脚本)/
 * web.input(输入)/ web.trace(诊断)。
 *
 * 当前已建 `web.page`(步 1)、`web.net`(步 2)与 `web.trace`(步 2.5)。新层独立建,**谁也不依赖它**,
 * 旧代码一行不动 —— 见 `08-migration-strategy.md` §1.1。
 */
export * from './result';
export * as page from './page';
export * as net from './net';
export * as trace from './trace';
export * as dom from './dom';
