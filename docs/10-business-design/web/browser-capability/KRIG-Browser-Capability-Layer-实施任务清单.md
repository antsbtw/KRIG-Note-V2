# KRIG Browser Capability Layer 实施任务清单

> 文档类型：实施任务清单  
> 关联文档：`KRIG-Browser-Capability-Layer-设计.md`  
> 状态：执行中 | 创建日期：2026-04-16 | 版本：v0.2

---

## 一、目标

将 `KRIG-Browser-Capability-Layer-设计.md` 拆解为可交付、可验收、可逐步迁移的实现任务。

原则：

- 先接口，后实现
- 先底层能力，后站点适配
- 先和现有 `web-bridge` 共存，再逐步迁移
- 每一步都必须可单独验证
- 通用网页优先，不先围绕个性化页面做专用链
- Electron 原生能力优先，不把 CDP / DevTools 约定接口当成系统边界

---

## 二、阶段总览

### 当前进度表

| 阶段 | 当前状态 | 说明 |
| --- | --- | --- |
| Phase 0：骨架与类型边界 | 已完成 | 文档、目录、接口与基础类型已建立 |
| Phase 1：State / Lease / Trace | 已完成第一版 | per-page trace、page state、lease 主链已接通 |
| Phase 2：Network Capture | 已完成第一版 | request/response、body capture、下载事件、provider 抽象已落地 |
| Phase 3：Runtime / Interaction | 已完成第一版页面扫描 | anchors/interactions 轻量扫描已工作，runtime bridge 仍待抽象 |
| Phase 4：Render / Frame Capture | 已完成第一版 frame 观察 | frame/subframe 观察与落盘已工作，截图主链未系统化推进 |
| Phase 5：Artifact Pipeline | 已完成第一版 | artifact 发现、语义合并、下载升级、frame/anchor 归属已打通 |
| Phase 6：通用网页对象模型落地 | 进行中 | Claude 样本已验证闭环，正向通用 iframe/embed 推广 |
| Phase 7：多类型网页验证 / Adapter 增强 | 未开始系统化推进 | 仍以 Claude 为主样本，尚未形成批量对照样本 |
| Phase 8：Module 5 Browser Tools | 未开始 | 还未输出面向 Module 5 的稳定 browser tools |
| Phase 9：Testing / Verification | 进行中 | 目录化 trace 已成为第一类验证证据，系统化 comparator 仍待补齐 |

### Phase 0：骨架与类型边界

目标：建立目录、接口、类型、文档索引。

状态：

- 已完成 `src/plugins/browser-capability/` 基础目录
- 已完成第一版类型与接口草案
- 已完成设计文档

后续动作：

- 将该目录纳入开发规范
- 明确后续所有浏览器能力新增代码优先落在此目录

### Phase 1：State / Lease / Trace 基础设施

目标：先建立“页面是谁、由谁持有、状态如何、调试怎么落盘”的基础设施。

状态：

- 已完成第一版 page registry / page state / trace writer
- 已完成 per-page run/page/summary/network 落盘
- 已完成当前调试主链对 `debug/browser-capability-traces/<runId>/` 的统一输出

### Phase 2：Network Capture

目标：统一请求、响应、SSE、下载、流式订阅与 response body provider 抽象。

状态：

- 已完成第一版 request/response 观察
- 已完成 response body capture 与 `responses/` 落盘
- 已完成 canonical request 关联
- 已完成 response body provider 抽象的第一版落地
- 已完成下载事件、文件 meta 与 trace summary 对齐

### Phase 3：Runtime / Interaction

目标：统一 DOM 查询、选区、滚动、点击、输入、等待。

状态：

- 已完成第一版轻量 runtime 扫描
- 已落盘 `anchors.json` 与 `interactions.json`
- 已完成 interaction 基础分层：`sidebar/header/composer/artifact/...`
- 正式的 runtime bridge 仍待抽象

### Phase 4：Render / Frame Capture

目标：统一页面截图、区域截图、frame 截图、可视区域抓取。

状态：

- 已完成第一版 frame/subframe 观察与 `frames.json` 落盘
- 已完成 artifact 到具体 subframe 的关联
- 截图、rect capture、frame capture 仍待系统化推进

### Phase 5：Artifact Pipeline

目标：统一正文、附件、widget、iframe、fallback 的结构化处理链。

状态：

- 已完成第一版 `artifacts.json` / `downloads.json`
- 已打通 message semantics -> artifact -> download/meta 合并
- 已打通 artifact -> subframe -> domAnchor -> interaction 的闭环
- 当前仍以 Claude 样本作为首个验证对象

### Phase 6：通用网页对象模型落地

目标：建立对任意网页成立的页面级结构化缓存与验证模型。

状态：

- 已在 Claude 页面上验证通用页面级缓存模型：
  - `frames.json`
  - `anchors.json`
  - `interactions.json`
  - `artifacts.json`
  - `downloads.json`
- 下一步是推广到更通用的 iframe / embed 页面，而不是停留在单一样本

### Phase 7：多类型网页验证 / Adapter 增强

目标：在普通网页、复杂网页和 AI 页面上验证同一套底层能力，adapter 仅作为增强层接入。

### Phase 8：Module 5 Browser Tools

目标：给 Module 5 输出高层 browser tools，而不是站点细节。

### Phase 9：Testing / Verification

目标：建立浏览器可见结果与 KRIG 提取结果之间的系统化比对能力。

---

## 三、详细任务拆解

## Phase 1：State / Lease / Trace 基础设施

### Task 1.1：实现 `page-registry`

目标：

- 为每个活跃页面分配稳定 `pageId`
- 维护 `pageId -> webContents / guest / metadata` 映射

输出文件建议：

- `src/plugins/browser-capability/core/page-registry.ts`

验收标准：

- 能注册页面
- 能查询页面
- 页面销毁时自动清理

### Task 1.2：实现 `frame-registry`

目标：

- 维护每个 `pageId` 下的 frame 树
- 记录 `frameId / parentFrameId / url / visible`

输出文件建议：

- `src/plugins/browser-capability/core/frame-registry.ts`

验收标准：

- 主 frame 与子 frame 可列举
- frame 导航后 URL 更新
- frame 销毁后状态正确移除

### Task 1.3：实现 `lease-manager`

目标：

- 为页面资源建立租约机制
- 支持用户、agent、system 三类 owner

输出文件建议：

- `src/plugins/browser-capability/core/lease-manager.ts`

验收标准：

- 可申请 lease
- 可释放 lease
- 支持 TTL 过期回收
- 能列出当前全部 lease

### Task 1.4：实现统一 trace 落盘

目标：

- 替换当前零散的 `aiExtractionCacheWrite`
- 建立统一的 capture/debug trace 写盘入口

输出文件建议：

- `src/plugins/browser-capability/persistence/debug-trace-store.ts`

验收标准：

- 任意 `pageId/stage/payload` 可写盘
- trace 文件名稳定、可回溯
- 与现有 debug 缓存目录兼容或可迁移

依赖：

- Task 1.1

---

## Phase 2：Network Capture

### Task 2.1：实现 `request-observer`

目标：

- 接入 `session.webRequest`
- 统一记录 request / response 元信息

输出文件建议：

- `src/plugins/browser-capability/network/request-observer.ts`

验收标准：

- 能记录请求 URL、method、状态码
- 能关联到 `pageId`
- 能关联到 `frameId`

### Task 2.2：实现 `response-store`

目标：

- 存储可回放的响应体引用
- 区分文本、二进制、流式片段

输出文件建议：

- `src/plugins/browser-capability/network/response-store.ts`

验收标准：

- 可以通过 `requestId` 取回 body
- 大响应体不直接常驻内存

### Task 2.2b：实现 `response-body-provider` 抽象

目标：

- 将 response body 获取能力从单一协议实现中解耦
- 允许 `session/webRequest`、下载管线、页面注入 hook、CDP 等多来源并存

输出文件建议：

- `src/plugins/browser-capability/network/response-body-provider.ts`

验收标准：

- 顶层 `IBrowserNetworkAPI` 不直接暴露协议绑定实现
- body provider 可被替换
- trace / cache 中的 `bodyRef` 不依赖具体 provider 类型
- 明确写出 v0.1 首选 provider 组合与 fallback 顺序

### Task 2.3：实现 `network-event-bus`

目标：

- 支持流式订阅
- 支持 request start / chunk / complete / download complete 事件

输出文件建议：

- `src/plugins/browser-capability/network/network-event-bus.ts`

验收标准：

- 可以按 `pageId` 订阅
- 可以按 `kind/url/frameId` 过滤
- 多订阅者互不干扰
- `unsubscribe` 后立即停止接收新事件
- 并发订阅下不会串流

### Task 2.4：实现 SSE capture 统一层

目标：

- 将 Claude / ChatGPT / Gemini 的 SSE/fetch 流统一到事件模型

输出文件建议：

- `src/plugins/browser-capability/network/sse-capture.ts`
- 站点差异留给 `artifact/site-adapters/`

验收标准：

- 可向上层输出完整文本流
- 可输出 chunk 级事件

依赖：

- Task 2.3

### Task 2.5：实现下载监控

目标：

- 统一下载开始、完成、失败、落盘、入 media store

输出文件建议：

- `src/plugins/browser-capability/network/download-monitor.ts`

验收标准：

- 可稳定拿到 filename / mime / bytes
- 可产出 `DownloadRecord`

---

## Phase 3：Runtime / Interaction

### Task 3.1：实现 `runtime-bridge`

目标：

- 提供统一 `eval/query/queryAll/getText/getHTML`

输出文件建议：

- `src/plugins/browser-capability/runtime/runtime-bridge.ts`

验收标准：

- 支持对指定页面执行脚本
- 错误格式统一

### Task 3.2：实现 `section-locator`

目标：

- 根据 heading / 文本锚点稳定定位页面区块

输出文件建议：

- `src/plugins/browser-capability/runtime/section-locator.ts`

验收标准：

- 能返回 heading 对应 anchor
- 可以辅助后续截图和 artifact 绑定

### Task 3.3：实现 `selection-reader`

目标：

- 抽象用户当前选区

输出文件建议：

- `src/plugins/browser-capability/runtime/selection-reader.ts`

验收标准：

- 能返回 text/html/rects
- 在普通网页与 AI 网页都可工作

### Task 3.4：实现 interaction 基础能力

目标：

- 统一 click/rightClick/type/press/scroll/hover/waitFor

输出文件建议：

- `src/plugins/browser-capability/interaction/*.ts`

验收标准：

- 统一错误处理
- 同时支持 selector / rect / anchorId

---

## Phase 4：Render / Frame Capture

### Task 4.1：实现 `page-capture`

目标：

- 整页截图
- 可见区截图

输出文件建议：

- `src/plugins/browser-capability/render/page-capture.ts`

### Task 4.2：实现 `rect-capture`

目标：

- 区域截图
- 多 rect 批量截图

输出文件建议：

- `src/plugins/browser-capability/render/rect-capture.ts`

### Task 4.3：实现 `frame-capture`

目标：

- 对 frame 维度做截图 / frame 可见性判断

输出文件建议：

- `src/plugins/browser-capability/render/frame-capture.ts`

验收标准：

- 明确区分同源 frame 与跨域 frame 行为
- 跨域 frame 无法结构化读取时，返回受限结果或显式错误，而不是伪装成功

### Task 4.4：实现 SVG / Canvas 导出能力

目标：

- 若页面能直接给出 `svg`，优先取结构化 SVG
- `canvas` 退化为位图

输出文件建议：

- `src/plugins/browser-capability/render/svg-export.ts`
- `src/plugins/browser-capability/render/canvas-capture.ts`

---

## Phase 5：Artifact Pipeline

### Task 5.1：实现 `artifact-probe`

目标：

- 统一识别 card / iframe / widget / file / chart

输出文件建议：

- `src/plugins/browser-capability/artifact/artifact-probe.ts`

验收标准：

- 输出统一 `ArtifactRecord`
- 明确区分“通用 surface 识别”和“adapter 语义解释”
- 不将站点私有模型直接写入底层缓存

### Task 5.2：实现 `placeholder-mapper`

目标：

- 建立 markdown 占位符与 artifact 实体的稳定绑定

输出文件建议：

- `src/plugins/browser-capability/artifact/placeholder-mapper.ts`

验收标准：

- 支持稀疏回填
- 不再依赖简单顺序替换

### Task 5.3：实现 `attachment-pipeline`

目标：

- 所有 Download card 都先按附件处理

输出文件建议：

- `src/plugins/browser-capability/artifact/attachment-pipeline.ts`

验收标准：

- 先下载 bytes
- 先入 media store
- 再输出内部附件引用

### Task 5.4：实现 `frame-artifact-pipeline`

目标：

- 处理 iframe/widget 类 artifact

输出文件建议：

- `src/plugins/browser-capability/artifact/frame-artifact-pipeline.ts`

验收标准：

- 只负责从 frame 内部获取资源或结构化结果
- 不在该 pipeline 内部隐含调用 render fallback
- 若 frame 管线失败，失败原因必须显式向上返回，由上层 adapter 决定是否调用 `render-fallback-pipeline`

### Task 5.5：实现 `render-fallback-pipeline`

目标：

- 为无法结构化提取的 artifact 提供可控 fallback

输出文件建议：

- `src/plugins/browser-capability/artifact/render-fallback-pipeline.ts`

验收标准：

- fallback 明确标记来源为 render
- 不污染正文顺序

---

## Phase 6：通用网页对象模型落地

### Task 6.1：建立页面级结构化缓存模型

目标：

- 将页面解析结果统一写入目录化缓存，便于回放与人工验证
- 页面级缓存模型首先服务于通用网页对象，而不是站点私有对象

输出文件建议：

- `pages/<pageId>/page.json`
- `pages/<pageId>/summary.json`
- `pages/<pageId>/responses/*`
- `pages/<pageId>/extracted/`

验收标准：

- 每次运行都能产出稳定 run 目录
- 每个页面都有独立目录
- 可从目录回看页面状态、网络体、提取结果

### Task 6.2：实现通用页面级 extracted 缓存

目标：

- 在 `extracted/` 下优先落通用对象缓存

输出建议：

- `artifacts.json`
- `downloads.json`
- `anchors.json`
- `frames.json`

验收标准：

- 文件命名与内容不依赖站点私有模型
- 能表达 `ArtifactRecord[]` / `DownloadRecord[]` / `DomAnchor[]` / `FrameState[]`

### Task 6.3：正文迁移到 network/source-first

目标：

- 正文不再依赖 DOM 顺序

### Task 6.4：DOM 仅做语义补面

目标：

- DOM 只用于锚点、可见性与页面语义补齐
- 不再作为正文主链

验收标准：

- 正文主链可独立于 DOM 工作
- DOM 输出可回收到 `anchors.json`

## Phase 7：多类型网页验证 / Adapter 增强

### Task 7.1：普通网页验证样本接入

目标：

- 用普通内容页、表单页、iframe 混合页验证通用对象模型

### Task 7.2：复杂网页验证样本接入

目标：

- 用后台页、长页面、复杂交互页验证目录化缓存与结构化输出

### Task 7.3：AI 页面 adapter 增强

目标：

- 在不改变底层通用模型的前提下，用 Claude / ChatGPT / Gemini 增强解析结果

验收标准：

- adapter 只追加解释与增强
- 不反向定义底层缓存格式
- 不把站点私有 API 结构上升为底层标准模型

### Task 7.4：附件 / widget / iframe 迁移验证

目标：

- 在真实复杂页面上验证 attachment-pipeline / frame-artifact-pipeline / render fallback 的分层是否成立

## Phase 8：Module 5 Browser Tools

### Task 8.1：定义高层 browser tools

目标：

- 为 Module 5 暴露高阶工具，而不是 selector/DOM 细节

输出建议：

- `src/shared/types/browser-tools-types.ts`

### Task 8.2：实现 page lease 驱动的多页面编排

目标：

- Module 5 使用 lease，而不是裸 `pageId`

### Task 8.3：实现 browser memory / execution trace 输出

目标：

- 让 Module 5 能读取浏览器历史状态与执行轨迹

---

## Phase 9：Testing / Verification

### Task 9.1：建立 testing 目录骨架

目标：

- 建立 `testing/fixtures/harness/comparators/cases`

输出文件建议：

- `src/plugins/browser-capability/testing/...`

### Task 9.2：实现 fixture-server

目标：

- 本地稳定提供 HTML / iframe / 下载测试页

### Task 9.3：实现 browser-test-runtime

目标：

- 统一拉起页面、执行能力、输出结果

### Task 9.4：将目录化 trace/run 作为第一类测试产物

目标：

- 将当前 `debug/browser-capability-traces/<runId>/` 目录输出正式纳入测试方法
- 使“网页解析及日志保存到目录中”成为默认验证路径

验收标准：

- 每次测试运行都生成独立 run 目录
- 至少包含 `run.json`、`run-summary.json`、`pages/<pageId>/page.json`、`network.jsonl`、`responses/`、`extracted/`
- 可以仅通过目录内容完成人工核查与回归比对

### Task 9.5：实现 text / artifact / screenshot comparator

目标：

- 让提取结果能和浏览器可见结果做自动比对

### Task 9.6：建立第一批混合夹具

目标：

- 至少包含：
  - 普通正文页
  - 单附件页
  - 2 iframe + 1 card 混合页
  - 长 section fallback 页

### Task 9.7：建立站点适配回归测试

目标：

- 用 Claude 作为真实站点回归样本
- 但不让真实站点成为唯一测试来源

---

## 四、建议执行顺序

建议按下面顺序推进：

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8

原因：

- 先有 state/lease/trace，后续所有调试才稳定
- 先有 network/event/download，正文与附件主链才稳
- 再做 DOM/runtime/interaction，避免早期过度依赖页面结构
- render/fallback 最后兜底
- 通用对象模型先稳定，再接入 adapter 和 Module 5

---

## 五、里程碑建议

### Milestone A：能力底座可运行

当前状态：已达成

包含：

- page-registry
- lease-manager
- request-observer
- network-event-bus
- debug-trace-store

完成标准：

- 可以创建页面
- 可以观察请求
- 可以订阅流
- 可以写统一 trace

### Milestone B：单网页提取闭环

当前状态：已达成第一版

包含：

- runtime-bridge
- section-locator
- rect-capture
- attachment-pipeline

完成标准：

- 普通网页正文可提取
- 附件可下载并入库
- 可视区可截图

### Milestone C：通用网页对象模型闭环

当前状态：已部分达成

包含：

- 页面级结构化缓存
- frame-artifact-pipeline
- placeholder-mapper
- response-body-provider

完成标准：

- 页面解析结果和日志可统一落入目录
- 普通网页正文、附件、iframe/widget 都能产出通用对象缓存

### Milestone D：多类型网页验证 / Adapter 增强

当前状态：未开始系统化推进

包含：

- 普通网页样本
- iframe/widget 样本
- AI 页面 adapter 增强

完成标准：

- 同一套底层能力可在多类型网页上工作
- adapter 仅作为增强层，不破坏通用缓存模型

### Milestone E：Module 5 接入

当前状态：未开始

包含：

- browser tools
- page lease orchestration
- execution trace consumption

完成标准：

- Module 5 可以稳定调用浏览器层能力

---

## 六、立即可执行的下一步

建议按当前实现状态继续推进这 5 个方向：

1. 将 `artifact -> anchor -> interaction` 闭环推广到通用 iframe / embed 页面。
2. 继续收敛 `interactions.json` 的噪声、分层和 artifact 归属规则。
3. 将当前轻量页面扫描抽象成正式的 `runtime-bridge`。
4. 开始系统化推进 `render / rect / frame capture`，补齐截图能力。
5. 为 Module 5 设计第一版稳定的 browser capability surface。
