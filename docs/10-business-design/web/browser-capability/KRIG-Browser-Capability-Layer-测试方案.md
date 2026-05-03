# KRIG Browser Capability Layer 测试方案

> 文档类型：测试设计文档  
> 关联文档：`KRIG-Browser-Capability-Layer-设计.md`  
> 关联任务：`KRIG-Browser-Capability-Layer-实施任务清单.md`  
> 状态：执行验证中 | 创建日期：2026-04-16 | 版本：v0.2

---

## 一、测试目标

当前执行状态：

- 目录化 trace 已成为当前第一类验证证据
- Claude 页面已经验证通了：
  - `conversation.json`
  - `artifacts.json`
  - `downloads.json`
  - `frames.json`
  - `anchors.json`
  - `interactions.json`
- 当前自动化 comparator 仍在规划中，现阶段以“目录化 trace + 人工核对 + 多轮回归”作为主验证方式

Browser Capability Layer 的测试目标，不是只验证某个站点“代码能跑”，而是验证：

**网页中用户可见、可交互的数据，是否被 KRIG 以正确的层级、正确的位置、正确的语义提取和落库。**

因此测试对象必须覆盖：

- 普通网页
- AI 网页
- iframe / widget
- 下载附件
- 表单与交互
- 结构化正文
- fallback 截图

---

## 二、核心测试原则

### 2.1 以“浏览器可见结果”为对照基准

测试的黄金标准不是 DOM，也不是 API 单独某一层，而是：

- 用户在浏览器里实际看见了什么
- 用户实际能点什么
- 用户实际能下载什么

然后验证 KRIG 提取结果是否一致。

### 2.2 分层验证，不混为一谈

同一页面要分层测试：

- 网络层是否拿到正确数据
- DOM/frame 层是否定位正确
- render 层截图是否对齐
- persistence 层是否正确落库
- Note 输出是否保持语义

### 2.3 “站点案例”与“能力案例”分开

测试必须分成两类：

1. 能力测试  
验证 Browser Capability Layer 的底层能力，例如下载、截图、事件订阅。

2. 站点适配测试  
验证 Claude / ChatGPT / Gemini / 普通网页在这套能力上是否工作正常。

### 2.4 先固定输入，再比对输出

复杂网页测试不能只靠在线实时页面。需要可复用的测试样本：

- 固定 HTML fixture
- 固定截图基线
- 固定下载文件
- 固定 API 响应
- 固定提取缓存

这样才能做回归测试。

### 2.5 目录化 trace 是第一类测试证据

除了自动化断言，Browser Capability Layer 还必须把“网页解析过程”和“提取结果”保存到目录中，作为人工检查和回归比对的第一类证据。

当前默认目录约定：

- `debug/browser-capability-traces/<runId>/run.json`
- `debug/browser-capability-traces/<runId>/run-summary.json`
- `debug/browser-capability-traces/<runId>/pages/<pageId>/page.json`
- `debug/browser-capability-traces/<runId>/pages/<pageId>/summary.json`
- `debug/browser-capability-traces/<runId>/pages/<pageId>/network.jsonl`
- `debug/browser-capability-traces/<runId>/pages/<pageId>/responses/*`
- `debug/browser-capability-traces/<runId>/pages/<pageId>/extracted/*`

这样即使没有自动化 comparator，也可以通过目录内容直接验证代码能力。

---

## 三、测试分层

### 3.1 Level A：类型与接口测试

目标：

- 类型定义稳定
- 顶层接口不破坏调用约定

关注：

- `IBrowserCapabilityLayer`
- `IBrowserStateAPI`
- `IBrowserNetworkAPI`
- `IBrowserRenderAPI`
- `IBrowserArtifactAPI`

### 3.2 Level B：能力单元测试

目标：

- 每个子能力单独可测

示例：

- request-observer 能否记录请求
- network-event-bus 能否正确分发 chunk
- rect-capture 能否按给定 rect 输出图片
- download-monitor 能否拿到 filename/mime/bytes
- subscribe / unsubscribe / 多订阅者过滤是否正确

### 3.3 Level C：页面夹具测试

目标：

- 对固定网页夹具做稳定提取验证

输入：

- 本地 HTML
- 本地 iframe fixture
- 本地下载按钮 fixture

输出：

- 提取结果 JSON
- 截图
- 附件入库记录

### 3.4 Level D：真实站点适配测试

目标：

- 验证 Claude / ChatGPT / Gemini / 普通网页适配

输入：

- 登录后的真实页面
- 真实下载卡片
- 真实 iframe/widget

输出：

- probe 结果
- 提取缓存
- Note 导入结果
- run 目录 trace

### 3.5 Level E：视觉对比测试

目标：

- 验证“浏览器中看到的内容”和“KRIG 提取后生成的内容”是否一致

这一级是 Browser Capability Layer 特有的关键测试层。

### 3.6 层间执行策略

建议默认执行顺序：

1. Level A
2. Level B
3. Level C
4. Level D
5. Level E

建议规则：

- Level A 失败时，B-E 默认跳过
- Level B 失败时，C-E 只允许继续执行不依赖该能力的 case
- Level C 失败说明通用能力或夹具链路有问题，应优先修复，不应直接依赖 Level D 兜底
- Level D 失败但 C 通过，优先怀疑 adapter、真实站点差异或权限约束
- Level E 建议用于关键回归与发版前验证，不必要求每次轻量 CI 全量运行

---

## 四、测试模块设计

建议新增：

```text
src/plugins/browser-capability/testing/
├── fixtures/
│   ├── pages/
│   ├── iframes/
│   ├── downloads/
│   └── responses/
├── harness/
│   ├── fixture-server.ts
│   ├── browser-test-runtime.ts
│   └── snapshot-writer.ts
├── comparators/
│   ├── text-compare.ts
│   ├── artifact-compare.ts
│   ├── screenshot-compare.ts
│   └── note-output-compare.ts
└── cases/
    ├── generic-page-cases.ts
    ├── iframe-cases.ts
    ├── attachment-cases.ts
    └── ai-service-cases.ts
```

---

## 五、测试方法

## 5.1 目录化运行记录法

方法：

- 每次真实运行或夹具运行都生成独立 `runId`
- 将页面解析结果、网络日志、响应体、提取结果按页面落盘
- 以目录内容作为“这次能力实际做了什么”的标准证据

目的：

- 方便人工阅读与定位问题
- 方便同一页面多次运行做回归比对
- 让“代码是否真的拿到页面数据”可以脱离断点与临时 console 进行验证

最低目录要求：

- `run.json`
- `run-summary.json`
- `pages/<pageId>/page.json`
- `pages/<pageId>/summary.json`
- `pages/<pageId>/network.jsonl`
- `pages/<pageId>/responses/*`
- `pages/<pageId>/extracted/*`

建议补充：

- `pages/<pageId>/lifecycle.jsonl`
- `pages/<pageId>/anchors.json`
- `pages/<pageId>/frames.json`

人工检查时至少回答：

- 这个页面到底发了哪些关键请求
- 哪些响应体真的被拿到了
- 提取结果是否已经写到 `extracted/`
- 结果来自 network / download / frame / render 的哪一层

## 5.2 正文比对

比对目标：

- 页面中用户实际可见的正文结构
- KRIG 提取后的结构化正文

比对维度：

- 标题层级
- 段落顺序
- 列表项顺序
- 代码块内容
- 数学块保留情况

输出建议：

- `expected.text.json`
- `actual.text.json`
- `diff.text.md`

## 5.3 Artifact 比对

比对目标：

- 页面中的 artifact 实体
- KRIG probe / 下载 / capture 后得到的 artifact 记录

比对维度：

- 数量
- 顺序
- 类型
- 标题/标签
- 位置锚点
- 是否成功落库

输出建议：

- `expected.artifacts.json`
- `actual.artifacts.json`
- `diff.artifacts.md`

并建议将实际结果同时写入：

- `pages/<pageId>/extracted/artifacts.json`

## 5.4 附件比对

比对目标：

- 浏览器中可下载文件
- KRIG 内部附件块

比对维度：

- 文件名
- mimeType
- byteLength
- hash
- media store 引用
- Note 中是否为内部附件而不是正文块

并建议将实际结果同时写入：

- `pages/<pageId>/extracted/downloads.json`

## 5.5 响应体与日志比对

比对目标：

- 浏览器运行时实际发生的关键请求
- KRIG trace 中记录的 `network.jsonl`、`responses/*`、`run-summary.json`

比对维度：

- 关键 URL 是否出现
- `response-body-captured` 是否出现
- `bodyRef` 是否可回溯到真实文件
- 页面级统计是否与目录内容一致
- 多页面运行时是否正确分到各自 `pages/<pageId>/`

输出建议：

- `expected.network.json`
- `actual.network.json`
- `diff.network.md`

## 5.6 视觉比对

比对目标：

- 浏览器可见区域截图
- KRIG fallback/render capture 结果

比对维度：

- 区域是否正确
- 内容是否错位
- 是否截到相邻 section
- 是否把 spinner / loading 态当作最终结果

输出建议：

- `expected.visible.png`
- `actual.capture.png`
- `diff.overlay.png`

## 5.7 Note 输出比对

比对目标：

- 最终进入 Note 的结果是否语义正确

比对维度：

- 正文位置
- callout 位置
- 附件位置
- 图片位置
- fileBlock / image / codeBlock 语义是否正确

---

## 六、测试夹具类型

### 6.1 普通网页夹具

用于验证：

- 标题
- 段落
- 列表
- 表格
- 图片

### 6.2 iframe 夹具

用于验证：

- 嵌套 iframe
- visible iframe
- 0x0 outer iframe + inner visible iframe
- iframe 内再嵌套下载按钮

### 6.3 下载夹具

用于验证：

- Download card
- 不同文件类型下载
- 文件名提取
- media store 落地

### 6.4 流式响应夹具

用于验证：

- SSE
- websocket
- chunked response
- parser 行为

建议至少覆盖这些具体场景：

- 单订阅者正常接收完整流
- 多订阅者同时订阅同一 `pageId`，互不干扰
- chunk 按正常顺序到达
- chunk 延迟到达但仍可按时间顺序重建
- 中途断流后重新建立订阅
- 同一请求在完成前收到多段 `response-chunk`
- `response-complete` 先于 UI 渲染完成到达，但提取层仍能正确收尾
- 下载完成事件与正文流事件并发出现时，互不串扰

并补充订阅模型测试：

- subscriber 注册时，若系统有 replay/buffer 机制，必须明确其范围并验证行为
- `unsubscribe` 后不得继续收到后续事件
- 过滤条件不同的 subscriber 不得互相污染

### 6.5 失败场景夹具

用于验证：

- 网络超时
- 下载中断
- frame 加载失败
- SSE / websocket 连接断开
- response body provider 无法提供 body

重点检查：

- 错误是否显式
- trace 是否可回溯
- 是否错误地把失败当成功

### 6.6 边界场景夹具

用于验证：

- 空页面
- 无 frame 页面
- 只有 iframe 没有主内容的页面
- 0 字节下载文件
- 极大响应体 / 极大文件

### 6.7 并发场景夹具

用于验证：

- 两个 lease 同时申请同一页面
- 多个 subscriber 同时监听同一 `pageId`
- 多页面并发运行时 trace 是否正确隔离
- 下载事件与流式正文事件同时发生时是否串扰

### 6.8 AI 样本页夹具

用于验证：

- 正文 + 图片 + iframe + 下载卡片混合场景
- 长对话
- 虚拟列表
- section 锚点

---

## 七、自动化测试输出格式

建议所有测试都输出统一结果：

```ts
type BrowserCapabilityTestResult = {
  caseId: string;
  category: 'text' | 'artifact' | 'attachment' | 'render' | 'integration';
  status: 'passed' | 'failed' | 'partial';
  expectedRef?: string;
  actualRef?: string;
  diffRef?: string;
  notes?: string[];
};
```

这样便于：

- CLI 测试
- 本地开发
- 未来集成到 Module 5 的自检流程

同时每个测试 case 都应输出关联的 trace run 引用，例如：

- `runId`
- `runDir`
- `pageIds`

---

## 八、建议的第一批测试用例

### Case 1：普通网页正文提取

验证：

- 标题/段落/列表顺序正确

### Case 2：单附件下载

验证：

- 点击下载
- 文件入 media store
- Note 中为 fileBlock

### Case 3：双 iframe + 单 card 混合页

验证：

- 2 个 visual artifact
- 1 个 trailing attachment
- 三者顺序不串位

### Case 4：长页面 section 截图 fallback

验证：

- 两个不同标题段截图不会复用同一 rect

### Case 5：AI 样本页回归

验证：

- 正文
- callout
- 附件
- 图片
- 最终 Note 输出

### Case 6：SSE 流式订阅回归

验证：

- 多 chunk 文本可被完整重组
- 中断重连不会造成重复拼接
- 多订阅者下事件不会丢失或串流
- 订阅解除后不会继续收到事件

### Case 6b：流式订阅过滤与取消回归

验证：

- 不同 `urlIncludes` / `kind` 过滤条件下事件分发正确
- `unsubscribe` 后立即停止接收
- replay/buffer 语义符合实现声明

### Case 7：目录化 trace 回归

验证：

- 每次运行都产生独立 `runId`
- `run-summary.json` 与 `pages/<pageId>/summary.json` 统计一致
- 关键请求能在 `network.jsonl` 和 `responses/*` 中互相回溯
- `extracted/` 中的页面级结果可直接供人工核查

### Case 8：失败与边界场景回归

验证：

- 网络超时 / 下载失败 / frame 失败时，输出显式错误
- 空页面 / 0 字节文件 / 无 frame 页面不导致错误成功
- trace 中能明确看到失败阶段与原因

### Case 9：并发场景回归

验证：

- 多 lease / 多 subscriber / 多页面并发时状态正确隔离
- 事件不过度广播
- 目录化 trace 不串页

---

## 九、和当前 Claude 问题的关系

当前 Claude 提取问题已经说明：

- 单看 DOM 不够
- 单看 probe 不够
- 单看下载成功也不够
- 必须建立“浏览器可见结果”与“提取后结果”的对照测试

否则就会出现：

- probe 认为正确，但位置错
- 下载成功，但语义错
- 截图成功，但截错区域
- Note 导入成功，但内容对不上

这正是 Browser Capability Layer 必须有独立测试模块的原因。

---

## 十、立即建议

建议立刻加进实施任务清单的测试任务：

1. 建 `testing/fixtures` 基础目录
2. 建 `browser-test-runtime`
3. 建 `artifact-compare` 与 `screenshot-compare`
4. 将 `debug/browser-capability-traces/<runId>/` 目录输出纳入正式测试产物
5. 先做一个“2 iframe + 1 card”混合测试页夹具
6. 用它替代 Claude 页面做第一批回归测试
