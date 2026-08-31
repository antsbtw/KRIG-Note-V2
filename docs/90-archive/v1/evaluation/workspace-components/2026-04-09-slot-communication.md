# Slot 间通信机制评估（2026-04-09）

## 范围
- 消息协议/匹配：`src/shared/types.ts`（`ProtocolRegistration`、`ViewMessage`）、`src/main/protocol/registry.ts`
- 路由实现：`src/main/ipc/handlers.ts` 中 `IPC.VIEW_MESSAGE_SEND/RECEIVE` 处理、`src/main/window/shell.ts` 的 `getActiveProtocol()`、`getActiveViewWebContentsIds()`
- Renderer 接口：`src/main/preload/view.ts` 暴露的 `sendToOtherSlot` / `onMessage`
- 参考原则：分层设计、层间契约、模块自包含、可替换性、命名/可描述性。

## 发现（按严重度排序）
1) **协议匹配仅基于活跃 WorkMode（左/右），未绑定具体 View 实例或 Variant 数据（契约不完整）**  
   - 位置：`getActiveProtocol()` 以 `pool.activeLeftId` / `pool.rightWorkModeId` → viewType/variant 做匹配。  
   - 影响：同一 WorkMode 下不同实例或数据（如不同 Note、不同 Web 变体）共享协议判定，无法实现更细粒度的安全/路由控制。  

2) **消息为不透明通道，无 schema 校验或鉴权（潜在安全/鲁棒性隐患）**  
   - 位置：`IPC.VIEW_MESSAGE_SEND` 直接转发 `ViewMessage`，未验证 `protocol/action/payload`。  
   - 影响：恶意或错误的消息可能导致对侧异常；缺少版本/类型保障，违背“层间契约清晰”。  

3) **右槽存在性/绑定与通信耦合不严谨**  
   - `getActiveViewWebContentsIds()` 仅返回当前 activeLeftId/rightView；若右槽关闭，发送方仍可调用 send，消息被静默丢弃，无反馈。  
   - 影响：调试困难；调用方无法判断消息是否送达。  

4) **协议注册/匹配缺少可配置优先级与冲突处理**  
   - `protocolRegistry.match` (未展示细节) 仅简单匹配，不支持优先级或多协议并存规则；在多插件组合时不明确。  

5) **命名与可描述性不足**  
   - `ViewMessage` 仅三个字段（protocol/action/payload），未明确哪些值保留、哪些由协议定义；缺少文档/类型枚举。  

## 改进建议
- 将协议匹配提升到“实例级”：匹配 left/right 的 viewType + variant + instanceId（或附加 data 中的角色），允许协议声明更细粒度约束。 
- 为 `ViewMessage` 定义 schema/类型守卫；在 main 路由层做基础验证和日志，避免无效/危险 payload。 
- 在 `sendToOtherSlot` 返回值中指示是否路由成功；当右槽不存在或未匹配协议时给出可选回调/事件。 
- 为 `protocolRegistry` 增加优先级与冲突检测；支持多个协议命中时的决策策略。 
- 补充通信机制文档（协议命名、action 约束、payload 规范），确保“命名即设计”。 

## 评估时间
- 2026-04-09  基于仓库当前代码快照。
