/**
 * web-rendering capability — 入口(W4.2 C3)
 *
 * 职责:封装 Electron `<webview>` tag 的整个生命周期 + SyncDriver / TranslateDriver
 * 编排,让 view 层只做"组合 + 状态订阅 + 命令注册"(charter § 1.4 view 归属)。
 *
 * 对外面孔:
 * - Host(普通 webview)— forwardRef HostHandle
 * - TranslateHost(翻译模式 webview)— 不需要 ref(右栏被动)
 * - 类型:HostProps / TranslateHostProps / HostHandle / WebContextMenuPayload / WebviewElement
 *
 * **不暴露**:slot-bus(capability 内部模块)— 按 W4.2 设计文档 § 3.2 边界
 *
 * 装配关系(charter § 1.3 表格):
 * - capability.web-rendering 内部依赖:
 *   - @drivers/web-sync-driver(SyncDriver / SYNC_ACTION / WEB_TRANSLATE_PROTOCOL)
 *   - @drivers/web-translate-driver(TranslateDriver)
 * - driver 之间互不依赖(driver 协议铁律 5),由 capability 编排
 *
 * view install 路径:`install: ['web-rendering']`(audit review P1-A:不列 driver ID)
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { Host } from './Host';
import { TranslateHost } from './translate-host';

// 类型 export 保留(view 通过 @capabilities/web-rendering/types 拿,index 不强制导出
// 但同步保留方便外部 type only 消费)
export type { HostProps } from './Host';
export type { TranslateHostProps } from './translate-host';
export type { HostHandle, WebContextMenuPayload, WebviewElement } from './webview-types';

// W5 C4:Host / TranslateHost 模块级 export 删除(0 消费者,view 走 registry 间接路由)。
// driver/slot 不消费 web-rendering — 此处不留过渡兜底,作为零消费者纯洁化。

capabilityRegistry.register({
  id: 'web-rendering',
  api: { Host, TranslateHost },
});
