# KRIG Module 5：Agent 设计文档

> 文档类型：模块设计文档
> 产品名称：KRIG / KRIG Note
> 状态：设计阶段 | 创建日期：2026-04-02 | 版本：v0.3
>
> **文档目的**：记录 Module 5 Agent 的架构设计、核心分工和实现路径。
> 作为后续模板库设计、接口规范、实现开发的起点。
>
> **v0.4 变更说明**：
> - 通信层：AIBridge 已收归 WebBridge（`WebBridge-设计.md` 决策 9），Module 5 通过 WebBridge IPC Server 调用
> - §3 更新：复用 WebBridge L3 能力层，不再引用独立 AIBridge
> - §6 工具接口：注明 `krig.ai.*` 和 `krig.browser.*` 是 IWebBridge 的 Module 5 视角封装
> - §9 待设计：新增 IBrowserAutomation 接口定义位置（`src/shared/types/automation-types.ts`）
> - §5.2 补充 Level 0 任务的操作约束矩阵和域名声明机制

---

## 一、核心架构

### 1.1 四角色关系

```
人  →  发出意图（模糊的自然语言）
              ↓
       Orchestrator        懂 KRIG-Note 的能力和接口
              ↓  ↑          把意图翻译成可执行的操作
           Web AI           懂如何思考和解决问题
                            但不知道 KRIG 是什么
              ↓
         KRIG-Note          执行渲染、存储、展示
              ↓
             人              看到结果，发出下一个指令
```

### 1.2 核心分工

| 角色 | 负责 | 不负责 |
|------|------|--------|
| 人 | 目标和最终判断 | 执行细节 |
| Orchestrator | 翻译和协调 | 创造内容、执行操作 |
| Web AI | 思考和知识 | 知道 KRIG 的存在 |
| KRIG-Note | 执行和呈现 | 理解用户意图 |

### 1.3 Orchestrator 的核心价值

Orchestrator 是整个系统里**唯一同时懂两种语言的角色**：

```
向左：能听懂人的模糊意图
向右：能和 Web AI 用自然语言交流
向下：能调用 KRIG-Note 的精确接口

它是翻译官，不是决策者，也不是执行者。
```

**关键约束：**
- Web AI 永远不需要知道 KRIG 的存在，它只是在回答普通问题
- KRIG-Note 永远不需要理解用户意图，它只执行标准接口调用
- 所有"理解"集中在 Orchestrator 一层

### 1.4 与 WebView / WebBridge 的分工

Module 5、WebView、WebBridge 三个模块的职责边界清晰：

```
WebView（View 层 — 呈现）
  └── attach(webview) → WebBridge

WebBridge（通信层 — 操控）
  ├── L3 capabilities/   ← 原子能力：读取、写入、拦截
  ├── ai-interaction.ts  ← 编排能力：send/request/batch
  └── automation/        ← IBrowserAutomation 实现 + 安全策略

Module 5（Agent — 决策）
  └── Orchestrator       ← 做什么、结果是否满足要求
        ↓ IPC 调用
        web:bridge:*     ← WebBridge 的 IPC Server
```

> **AIBridge 已收归 WebBridge**（`WebBridge-设计.md` 决策 9）。
> SSE 拦截、AI 输入框粘贴、双向交互都是 WebBridge L3 能力层的实现，不再作为独立模块。
>
> Module 5 通过 IPC（`web:bridge:*` 命名空间）调用 WebBridge，不直接访问 webview 实例。
> `IBrowserAutomation` 接口定义在 `src/shared/types/automation-types.ts`，Module 5 import 共享类型，不 import WebBridge 内部文件。

---

## 二、Orchestrator 设计

### 2.1 技术选型

**本地模型：Gemma 4 26B A4B（MoE）**

选型理由：
- 每次推理只激活 4B 参数，速度接近小模型，理解深度接近 26B
- 原生支持 Function Calling 和结构化 JSON 输出
- Apache 2.0 许可，本地运行，符合 KRIG local-first 原则
- 中英文混合学术场景表现稳定
- 通过 Ollama 调用，与 Electron 集成路径清晰

**运行环境建议：**

| 用户配置 | 可用模型 | 体验等级 |
|---------|---------|---------|
| Mac M 系列 16GB | Gemma 4 E4B 4-bit | 基础协调能力 |
| Mac M 系列 32GB+ | Gemma 4 26B A4B 4-bit | 完整体验（推荐） |
| Mac M 系列 48GB | Gemma 4 26B A4B 4-bit | 开发基准配置 |

本地模型为**增强项而非必选项**：无本地模型时退化为纯手动模式，核心 KRIG 功能不受影响。

**调用时机（懒触发，符合 P6）：**

```
需要调用 Gemma 4 的时机：
  ✓ 解析用户意图，匹配执行模板
  ✓ 生成发给 Web AI 的 prompt
  ✓ 判断 Web AI 的回复是否满足要求
  ✓ 将 Web AI 输出转换为 KRIG 接口所需格式
  ✓ 决定下一步策略（继续 / 调整 / 求助用户）

不需要调用 Gemma 4 的时机：
  ✗ 执行具体操作（网络请求、数据库写入）
  ✗ 格式化输出（纯代码处理）
  ✗ 触发条件判断（定时器、事件监听）
```

### 2.2 Orchestrator 内部组件

```
Orchestrator 系统
    ├── 意图解析层      接收用户输入，匹配模板，Gemma 4 驱动
    ├── 工作记忆层      维护任务执行的完整上下文状态
    ├── Web AI 交互层   构造 prompt，通过 AIBridge 发送/接收/验收
    ├── KRIG 接口层     调用 KRIG-Note 的标准工具接口
    └── 用户通知层      任务完成、需要介入、执行异常时触发
```

### 2.3 工作记忆（Working Memory）

每个任务执行期间，Orchestrator 维护完整上下文，每次调用 Gemma 4 时全部带入：

```
WorkingMemory {
    task_id           : string    // 任务唯一标识
    original_intent   : string    // 用户原始输入，不修改
    matched_template  : string    // 匹配到的模板 id
    success_criteria  : string    // 成功标准
    current_step      : number    // 当前执行到第几步
    execution_history : array     // 每步的输入、输出、判断结果
    ai_conversation   : array     // 和 Web AI 的完整对话记录
    variables         : object    // 模板变量的当前值
    attempt_count     : number    // 当前重试次数
    adjustment_log    : array     // 做过哪些调整，避免循环
}
```

---

## 三、Web AI 通信层（Module 5A）

### 3.1 复用 WebBridge L3 能力层

> **已在 mirro-desktop 验证**：三服务双向交互的完整实现。
> KRIG-Note 中这些能力**收归 WebBridge 模块**（`WebBridge-设计.md` 决策 9），不再作为独立的 AIBridge。
> Module 5 通过 IPC（`web:bridge:*`）调用 WebBridge，不重新设计通信层。

WebBridge L3 能力层（原 AIBridge 收归后的结构）：

```
WebBridge.capabilities/
  ├── ai-service-detector.ts   ← URL 匹配，识别当前 AI 服务
  ├── interceptor.ts           ← 拦截 AI 响应流，缓存 Markdown
  ├── writer.ts                ← 写入能力（含 AI 输入框粘贴）
  └── ai-interaction.ts        ← 编排能力（Orchestrator 通过 IPC 调用）
```

**三服务拦截策略（mirro-desktop 已验证稳定）：**

| 服务 | 策略 | 稳定性 |
|------|------|--------|
| Claude | hook `window.fetch` → 拦截 `text_delta` SSE | 高 |
| ChatGPT | 检测完成 → 调 conversation API 获取完整 Markdown | 高 |
| Gemini | CDP 网络层拦截 `StreamGenerate` | 高 |

### 3.2 Orchestrator 调用的通信接口

Orchestrator 通过 WebBridge 的 ai-interaction 编排能力与 Web AI 交互，不关心底层拦截实现。
调用路径：`Orchestrator → IPC(web:bridge:*) → WebBridge.ai-interaction → L3 writer + interceptor`

```typescript
// Orchestrator 视角的通信接口
// 实现由 WebBridge L3 ai-interaction.ts 提供，通过 IPC 调用

// 单向发送（不等待回复）
send(text: string): Promise<void>

// 双向请求（发送 + 等待回复完成）
request(prompt: string): Promise<string>  // 返回 Markdown

// 带文件的请求（上传文件 + prompt + 等待回复）
requestWithFile(opts: {
  file: Buffer,
  filename: string,
  prompt: string
}): Promise<string>

// 批量请求（分页循环）
batch(pages: string[]): Promise<string[]>

// 开启新会话（切换 AI 服务或重置上下文）
newSession(target: 'claude' | 'gemini' | 'chatgpt'): Promise<void>

// 验收回复（Gemma 4 执行语义判断）
validateResponse(response: string, criteria: string): Promise<boolean>
```

### 3.3 DOM 优先，截图作为 Fallback

**已确认决策**（来自 WebView 设计讨论）：

```
主要方式：DOM 读取（信息密度高、token 少、稳定）
  getTextContent()       → 纯文本，适合 LLM 处理
  querySelectorAll()     → 结构化元素信息
  getLinks()             → 链接列表

Fallback：截图（仅 DOM 不够时使用）
  screenshot()           → 可见区域（不是全页）
  主要用途：Canvas 内容、验证码、视觉布局理解
```

对 Orchestrator 的影响：Gemma 4 优先处理文本输入，只在必要时请求截图，控制推理成本。

---

## 四、模板库设计

### 4.1 模板的本质

```
模板 = 任务类型的标准执行流程

回答三个问题：
  1. 这类任务的标准步骤是什么？
  2. 哪些步骤需要调用 Web AI（导师）？
  3. 最终调用 KRIG-Note 的哪个工具输出？
```

**大模型作为"导师"的定位：**

```
不清晰的部分 → 问 Web AI（导师）获取知识和方向
清晰的执行   → Orchestrator + KRIG-Note 工具完成

导师不执行任务，只提供知识。
Orchestrator 拿到答案后自己完成剩余工作。
```

### 4.2 模板结构

```
Template {
    id                : string    // "bpmn_from_description"
    name              : string    // "从描述生成流程图"
    category          : string    // 见分类体系
    trigger_keywords  : array     // 用于意图匹配的关键词
    description       : string    // 模板用途说明

    steps : [
        {
            id              : string
            type            : string
                // "web_ai"       调用 Web AI（通过 AIInteraction）
                // "orchestrator" Gemma 4 自身处理
                // "krig_tool"    调用 KRIG-Note 工具接口
                // "browser"      调用 IBrowserAutomation
                // "user_confirm" 等待用户确认（Level 1+）
            prompt_template : string    // 发给 Web AI 的 prompt，支持变量插值
            tool            : string    // krig_tool 时指定具体工具
            input           : string    // 输入变量名
            output          : string    // 输出存入的变量名
            validation      : string    // 结果验收标准
        }
    ]

    variables         : object    // 模板变量定义和默认值
    success_criteria  : string    // 整体成功标准
    level             : 0|1|2|3   // 自动化等级
    fallback          : string    // 失败处理策略

    // Level 0 安全约束（见 §5.2）
    allowed_domains   : string[]  // 此模板允许访问的域名
    allowed_operations: string[]  // 此模板允许的操作类型
}
```

### 4.3 模板分类体系

**Category 1：图表生成**
```
bpmn_from_description      从自然语言描述生成流程图（BPMN）
graph_from_extraction      从文本提取关系，生成图谱
timeline_from_events       从事件序列生成时间线
mindmap_from_topic         从主题生成思维导图
spacetime_from_text        从叙事文本提取时空活动图
```

**Category 2：内容提取**
```
extract_to_note            从任意内容提取关键信息到 Note
extract_concepts           提取概念候选节点（对接 Module 3）
extract_structured_data    提取结构化数据
```

**Category 3：Web AI 协作**
```
consult_and_summarize      咨询大模型，整理结论到 Note
multi_ai_compare           同一问题发给多个 Web AI，对照结果
iterative_refinement       迭代优化，直到满足用户标准
```

**Category 4：定时监控**
```
monitor_and_extract        定时监控内容源，提取符合特征的内容
watch_and_notify           监控变化，触发通知或后续任务
```

### 4.4 模板示例：从描述生成流程图

```
Template: bpmn_from_description

steps:
  Step 1 [web_ai]
    prompt_template:
      "请将以下流程描述整理成标准的 BPMN 流程结构。
       用 JSON 格式输出，包含 nodes 和 edges：
       nodes: [{id, type, label}]
       edges: [{from, to, label}]
       流程描述：{{user_description}}"
    output: bpmn_json

  Step 2 [orchestrator]
    任务：验证 bpmn_json 格式是否符合 KRIG BPMN 接口规范
    input: bpmn_json
    output: validated_bpmn

  Step 3 [krig_tool]
    tool: bpmn_renderer
    input: validated_bpmn

成功标准：BPMN 图成功渲染到用户界面
level：1（渲染结果需用户确认）
```

### 4.5 模板示例：时空活动图（红楼梦场景）

```
Template: spacetime_from_text

steps:
  Step 1 [web_ai]
    prompt_template:
      "从以下文本中提取{{extraction_target}}的活动时间线。
       按 JSON 格式输出：
       [{person, event, time, location, related_persons}]
       文本内容：{{input_content}}"
    output: spacetime_data

  Step 2 [orchestrator]
    任务：将数据转换为 KRIG Graph 接口所需格式
    input: spacetime_data
    output: graph_data

  Step 3 [krig_tool]
    tool: graph_renderer
    input: graph_data
    config: {layout: "timeline", group_by: "person"}

成功标准：时空关系图成功渲染到 Graph 视图
level：1
```

### 4.6 模板示例：定时监控内容源

```
Template: monitor_and_extract

allowed_domains: ["{{source_domain}}"]    // 从 source_url 提取域名
allowed_operations: ["navigate", "read"]  // 只读，禁止写入

steps:
  Step 1 [browser]
    action: navigate
    target: "{{source_url}}"
    output: page_content

  Step 2 [web_ai]
    prompt_template:
      "从以下内容中，找出符合「{{filter_criteria}}」特征的条目。
       以 JSON 格式返回：[{title, content, url, relevance_score}]
       内容：{{page_content}}"
    output: filtered_items

  Step 3 [orchestrator]
    任务：验证 filtered_items 是否合理（数量、质量）
    input: filtered_items
    output: validated_items

  Step 4 [krig_tool]
    tool: note.create
    input: validated_items

成功标准：符合特征的条目成功写入 Note
level：0（定时全自动，结果在用户下次打开时可见）
```

---

## 五、任务自动化等级

### 5.1 等级定义

```
Level 0：全自动，无需人工介入
  特征：纯读取、无副作用、结果可逆
  例子：定时抓取内容、提取关键词
  安全约束：域名白名单 + 操作白名单（见 §5.2）
  失败处理：静默重试，超过阈值后通知用户

Level 1：自动执行，结果需用户确认
  特征：有写入操作，影响范围在 KRIG 内部
  例子：提取内容写入 Note、创建候选概念节点
  失败处理：暂存结果，用户下次打开时确认

Level 2：半自动，关键节点需用户介入
  特征：涉及外部写入或不可逆操作
  例子：在外部平台发布内容
  失败处理：遇到关键节点暂停，等用户决策后继续

Level 3：人工主导，Orchestrator 辅助
  特征：高风险、需要用户判断
  例子：涉及隐私数据、重要决策
  失败处理：只提供建议，不执行
```

### 5.2 Level 0 安全约束：共享 Session 下的操作边界

> **核心问题**：Level 0 任务全自动执行时，用户不在看着。
> 共享 session 意味着 Agent 拥有用户的登录态——如果不加约束，
> Agent 误导航到银行页面、误提交表单的后果用户无法即时阻止。
>
> 普通浏览：人在看着，随时可停 → 基础审批即可
> Level 0 全自动：人不在看着 → 需要**域名白名单 + 操作白名单**双重约束

#### 与 WebView AutomationPolicy 的分工

两个模块各管一层，互补不重叠：

```
Module 5（本模块）控制：
  ├── 任务在什么情况下需要人介入（Level 0–3）
  ├── 每个模板允许的域名范围（allowed_domains）
  └── 每个模板允许的操作类型（allowed_operations）

WebView §13.5 控制：
  ├── AutomationPolicy.trustedDomains — 全局域名白名单
  ├── AutomationPolicy.blockedPatterns — 全局路径黑名单
  └── AutomationPolicy.blockedFields — 全局敏感字段黑名单
```

**执行链路**：

```
Orchestrator 启动 Level 0 任务
  → 从模板读取 allowed_domains + allowed_operations
  → 传给 WebView Automation Layer 作为本次任务的约束
  → WebView 在模板约束 ∩ 全局白名单 范围内执行
  → 超出范围 → 拒绝 + 日志 + 通知用户
```

取交集，不取并集——模板的 `allowed_domains` 不能突破全局白名单，只能进一步收窄。

#### Level 0 操作约束矩阵

| 操作类型 | Level 0 | Level 1 | Level 2+ |
|---------|---------|---------|----------|
| `navigate` | 白名单域名内允许 | 允许 | 允许 |
| `read`（getTextContent, querySelectorAll） | 允许 | 允许 | 允许 |
| `click`（链接、按钮） | 白名单域名内允许 | 允许 | 需确认 |
| `type`（输入文本） | 仅 AI 服务输入框 | 允许 | 需确认 |
| `upload`（文件上传） | 仅 AI 服务 | 允许 | 需确认 |
| `fillForm`（通用表单） | **禁止** | 允许 | 需确认 |
| `evaluate`（任意 JS） | **禁止** | 需审批 | 需审批 |

**核心逻辑**：Level 0 的操作范围严格限定为**读取 + 与 AI 服务对话**。这恰好覆盖了 Orchestrator 指挥 Web AI 的核心场景（登录 claude.ai → 发 prompt → 拿回复），同时防止了意外操作敏感页面。

#### 模板声明域名的机制

每个模板在定义时声明 `allowed_domains`：

```typescript
// 模板定义
Template: monitor_and_extract {
  level: 0,
  allowed_domains: ["{{source_domain}}"],     // 变量，从 source_url 自动提取
  allowed_operations: ["navigate", "read"],   // 只读
  // ...
}

// 运行时：Orchestrator 解析变量
const resolvedDomains = template.allowed_domains.map(d =>
  d === "{{source_domain}}" ? new URL(variables.source_url).hostname : d
);

// 传给 WebView
automation.setTaskConstraints({
  taskId: task.id,
  level: 0,
  allowedDomains: resolvedDomains,            // 模板级白名单
  allowedOperations: template.allowed_operations,
});
```

内置模板的默认 `allowed_domains`：

| 模板类别 | 默认 allowed_domains |
|---------|---------------------|
| Web AI 协作（consult, compare） | `['claude.ai', 'chatgpt.com', 'gemini.google.com']` |
| 定时监控（monitor） | `['{{source_domain}}']`（从用户配置的 URL 提取） |
| 内容提取（extract） | `['claude.ai', 'chatgpt.com', 'gemini.google.com']` |
| 图表生成（bpmn, graph） | `['claude.ai', 'chatgpt.com', 'gemini.google.com']` |

用户自定义模板可以扩展 `allowed_domains`，但不能突破全局 `AutomationPolicy.trustedDomains`。

#### 全链路安全检查示意

```
用户创建 Level 0 定时任务：每天 9 点监控 arxiv.org 新论文
  │
  ├── 模板：monitor_and_extract
  │     allowed_domains: ["arxiv.org"]
  │     allowed_operations: ["navigate", "read"]
  │
  ├── 全局白名单检查（WebView AutomationPolicy）：
  │     arxiv.org 不在默认 trustedDomains 中
  │     → 提示用户："此任务需要访问 arxiv.org，是否添加到可信域名？"
  │     → 用户确认 → arxiv.org 加入全局白名单
  │
  └── 运行时（每天 9 点自动触发）：
        Step 1 [browser] navigate("https://arxiv.org/list/cs.AI/recent")
          → 域名 arxiv.org ∈ 模板白名单 ∩ 全局白名单 → 允许
        Step 2 [browser] getTextContent()
          → 操作 read ∈ allowed_operations → 允许
        Step 3 [web_ai] request(prompt)
          → 域名 claude.ai ∈ 全局白名单 → 允许
        Step 4 [krig_tool] note.create(...)
          → KRIG 内部操作，不受域名限制
        ✓ 完成

        假如 Web AI 回复中包含一个链接，Orchestrator 想跟进：
        Step X [browser] navigate("https://bank.example.com")
          → bank.example.com ∉ 模板白名单 → 拒绝 + 日志 + 跳过此步
```

### 5.3 任务等级与 WebView 安全策略的总结

```
Module 5 控制：任务在什么情况下需要人介入（Level 0–3）
               + 每个任务能访问的域名范围（模板级白名单）
               + 每个任务能执行的操作类型（操作白名单）

WebView 控制：全局域名白名单（AutomationPolicy.trustedDomains）
              + 全局路径黑名单（blockedPatterns）
              + 全局敏感字段黑名单（blockedFields）

双重过滤：模板约束 ∩ 全局约束 = 实际允许范围
```

### 5.4 任务状态机

```
idle
  ↓  触发条件满足（定时 / 事件 / 手动）
running
  ↓  遇到 Level 2+ 节点
waiting_for_user
  ↓  用户确认
running
  ↓  成功标准满足
done
  ↓  等待下次触发
idle

任意阶段失败 → retry（按 retry_policy）
超过重试阈值 → failed → 通知用户
```

---

## 六、KRIG-Note 工具接口

Orchestrator 已知的 KRIG-Note 标准工具接口（随模块开发持续更新）：

```typescript
// ── Note 操作 ──
krig.note.write(noteId: string, content: Block[]): Promise<void>
krig.note.create(title: string, content: Block[]): Promise<noteId>

// ── 图表渲染 ──
krig.diagram.renderBPMN(data: BPMNData): Promise<void>
krig.diagram.renderMindmap(data: MindmapData): Promise<void>
krig.diagram.renderTimeline(data: TimelineData): Promise<void>

// ── 图谱操作 ──
krig.graph.render(data: GraphData, config: GraphConfig): Promise<void>
krig.graph.addCandidateNode(node: CandidateNode): Promise<void>

// ── Web AI 交互（WebBridge L3 ai-interaction，通过 IPC 调用）──
// krig.ai.* 是 IWebBridge 接口的 Module 5 视角封装，底层由 WebBridge 实现
krig.ai.send(target: AITarget, text: string): Promise<void>
krig.ai.request(target: AITarget, prompt: string): Promise<string>
krig.ai.requestWithFile(opts: AIFileRequest): Promise<string>
krig.ai.batch(target: AITarget, pages: string[]): Promise<string[]>
krig.ai.newSession(target: AITarget): Promise<void>

// ── 浏览器操控（WebBridge L3 capabilities，通过 IPC 调用）──
// krig.browser.* 是 IWebBridge 接口的 Module 5 视角封装
// IBrowserAutomation 接口定义在 src/shared/types/automation-types.ts
krig.browser.navigate(url: string): Promise<void>
krig.browser.getTextContent(): Promise<string>
krig.browser.querySelectorAll(selector: string): Promise<ElementInfo[]>
krig.browser.click(selector: string): Promise<void>
krig.browser.type(selector: string, text: string): Promise<void>
krig.browser.screenshot(): Promise<Buffer>  // fallback，优先使用 DOM

// ── 任务约束（传给 WebBridge automation-policy）──
krig.browser.setTaskConstraints(constraints: TaskConstraints): void
```

---

## 七、可解释性原则

> 对应 P1：组织思考，不替代思考。

Orchestrator 的每次决策必须可追溯：

```typescript
interface ExecutionRecord {
    step_id      : string
    type         : string       // 调用了什么
    input        : object       // 输入是什么
    output       : object       // 输出是什么
    reasoning    : string       // Gemma 4 的判断依据
    timestamp    : datetime
    duration_ms  : number
}
```

用户在任务执行记录中，能看到 Orchestrator 的每一步决策过程，而不只是最终的成功或失败。

`ExecutionRecord` 存入 SurrealDB `task_execution` 表，与 `ai_conversation` 表分开：

```
ai_conversation   ← WebView 捕获的 Web AI 对话内容（用户可见内容）
task_execution    ← Orchestrator 的决策过程记录（任务审计）
```

**安全审计特别记录**：Level 0 任务的日志中，每次域名检查和操作检查的结果都记入 `execution_step`，包括被拒绝的请求：

```typescript
// 被拒绝的操作也记录
{
  step_id: "step-7",
  type: "browser",
  input: { action: "navigate", url: "https://bank.example.com" },
  output: null,
  reasoning: "REJECTED: domain bank.example.com not in allowed_domains [arxiv.org]",
  success: false,
}
```

---

## 八、与其他模块的关系

Module 5 是独立模块，通过标准接口与其他模块交互，不存在强依赖：

```
Module 5 Agent
    ↓  调用（单向）
    ├── Module 1 WebView
    │     ├── AIBridge（AIInteraction）  ← Web AI 通信
    │     └── Automation Layer          ← 浏览器操控
    │           ↑ setTaskConstraints()  ← Module 5 传入任务级安全约束
    ├── Module 2（Note / BPMN）          ← 写入 Note，调用图表工具
    ├── Module 3（知识图谱）              ← 写入候选节点
    └── Module 4（Graph 渲染）            ← 调用图谱渲染

Module 5 不被其他模块调用。
其他模块不感知 Module 5 的存在。
```

---

## 九、待设计事项

```
□  模板库的 SurrealDB 表结构
□  模板的版本管理机制（用户自定义模板 vs 内置模板）
□  Orchestrator 与 Ollama 的集成方案（IPC 路径）
□  task_execution 表的存储结构（SurrealDB）
□  用户任务定义界面的交互设计
□  多 Web AI 对照结果的合并策略
□  无本地模型时的降级方案（纯手动模式的 UX）
□  用户自定义模板的 allowed_domains 验证 UI
□  Level 0 任务的执行日志查看界面
□  IBrowserAutomation 接口定义（src/shared/types/automation-types.ts）
```

---

*本文档随设计讨论持续更新。*
*模板库内容在独立文档中维护，本文档只记录架构和原则。*
