/**
 * @deprecated Wave 3.3 起 ChannelHub 实现已下沉到 src/shared/event-bus/channel.ts
 *
 * 本文件保留 re-export 兜底。新代码请直接 import from '@shared/event-bus/channel'。
 *
 * 迁移原因:能力层(src/capabilities/*)反向 import L4 基础设施形成纵向逆流
 * (audit 报告 P2-6)。ChannelHub 是纯内存 pub/sub 原语,放 shared/ 才符合
 * charter § 1.1 单向调用约束。
 */

export { ChannelHub } from '@shared/event-bus/channel';
export type { ChannelListener } from '@shared/event-bus/channel';
