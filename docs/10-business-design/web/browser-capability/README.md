# Browser Capability Layer 文档索引

本目录用于集中存放 KRIG Browser Capability Layer 的独立设计文档，避免与现有 Web/AI 提取问题文档混淆。

## 文档列表

- [KRIG-Browser-Capability-Layer-设计.md](KRIG-Browser-Capability-Layer-设计.md)
  说明 Browser Capability Layer 的目标、分层、目录结构与第一版接口草案。

- [KRIG-Browser-Capability-Layer-实施任务清单.md](KRIG-Browser-Capability-Layer-实施任务清单.md)
  将设计文档拆解为可执行的实现阶段、任务项、里程碑和建议顺序。

- [KRIG-Browser-Capability-Layer-测试方案.md](KRIG-Browser-Capability-Layer-测试方案.md)
  定义 Browser Capability Layer 的测试目标、测试模块、夹具策略和比对方法。

- [Defuddle-vs-Browser-Capability-对比分析.md](Defuddle-vs-Browser-Capability-对比分析.md)
  Defuddle（mirro-desktop 生产实现）与 Browser Capability Layer 的逐能力对比、差异分析和整合建议。

- [Artifact-Import-设计.md](Artifact-Import-设计.md)
  基于 Browser Capability artifact 识别的 Note 导入设计：单条提取替代 + 整页提取新功能。

- [Claude-Artifact-类型全表.md](Claude-Artifact-类型全表.md)
  Claude 所有 artifact 类型的完整分类、处理状态、待办优先级。确保不遗漏任何类型。

- [ChatGPT-Artifact-类型全表.md](ChatGPT-Artifact-类型全表.md)
  ChatGPT 所有内容类型分析：对话树结构、18 种内容类型、与 Claude 对比、Browser Capability 集成方案。

- [Gemini-Artifact-类型全表.md](Gemini-Artifact-类型全表.md)
  Gemini 所有内容类型分析：batchexecute 协议、位置数组 schema、11 种内容类型、三平台统一提取架构。

- [多平台提取-开发测试计划.md](多平台提取-开发测试计划.md)
  ChatGPT / Gemini 提取的分阶段开发计划、测试矩阵和风险评估。先分开验证，后抽象合并。

## 当前状态（2026-04-19 更新）

### 基础设施层（Phase 0-5）— 已完成

| 能力项 | 状态 | 说明 |
| --- | --- | --- |
| 生命周期 / 页面注册 | ✅ 已完成 | per-page trace、page state、lease 主链已工作 |
| Network Capture | ✅ 已完成 | canonical request 关联、body capture、下载事件已接通 |
| Response Body Provider | ✅ 已完成 | CDP provider 抽象已落地 |
| 通用 extracted 落盘 | ✅ 已完成 | `responses/` 与 `pages/<pageId>/extracted/` 已稳定输出 |
| Claude conversation 提取 | ✅ 已完成 | `conversation.json` 落盘 + 主动 probe |
| Artifact 发现与合并 | ✅ 已完成 | show_widget / create_file / bash_tool local_resource 全部识别 |
| Frame / iframe 归属 | ✅ 已完成 | artifact → frame → domAnchor → interaction 完整链 |

### Artifact 导入链路（Phase D/B/C）— 已完成

| 能力项 | 状态 | 说明 |
| --- | --- | --- |
| Phase D: 旧链路清理 | ✅ 已完成 | `processClaudeArtifactsFull` 已移除，DOM 模拟下载代码已清理 |
| Phase B: 单条提取 | ✅ 已完成已测试 | 右键菜单 → `browserCapabilityExtractTurn` → Note |
| Phase C: 整页提取 | ✅ 已完成已测试 | "提取整页对话" 按钮 → `extractFullConversation` → Note |
| SVG artifact 渲染 | ✅ 已完成 | SVG DOM 直接渲染（image block SVG 路径） |
| HTML artifact 渲染 | ✅ 已完成 | html-block sandbox iframe 渲染 |
| bash_tool local_resource | ✅ 已完成 | 从 tool_result 识别 + Claude API 主动下载 |
| 消息索引映射 | ✅ 已修复 | DOM assistant-only 索引 → conversation 全消息索引 |

### 未开始的部分

| 能力项 | 状态 | 说明 |
| --- | --- | --- |
| Phase 7: 多类型网页验证 | ❌ 未开始 | ChatGPT / Gemini / 普通网页 |
| Phase 8: Module 5 Browser Tools | ❌ 未开始 | 面向 Agent 的高层 browser tools |
| Phase 9: 系统化测试 | ⚠️ 部分 | trace 目录作为验证证据，comparator 待补 |
| Phase E: SVG Block | ⚠️ 设计完成 | 独立 svg-block 的 ProseMirror schema + NodeView |
| Defuddle 整合 | ❌ 未开始 | L2 Runtime content-extractor provider |

## 下一步

1. 多类型网页验证（ChatGPT / Gemini adapter）
2. SVG Block 独立渲染（替代 image block 的 SVG 分支）
3. Defuddle 整合为 L2 content-extractor provider
4. Module 5 Browser Tools 输出
