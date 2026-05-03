# KRIG SurrealDB Schema 设计文档

> 文档类型：数据库架构设计（规划阶段）
> 产品名称：KRIG / KRIG Note
> 状态：**草案，待功能稳定后正式实施**
> 创建日期：2026-03-26 | 版本：v0.5
>
> **重要说明**：SurrealDB 计划在大部分功能完成后引入，
> 确保数据结构的准确性和可扩展性。本文档记录当前讨论形成的
> 设计思路，作为正式引入时的起点，不是当前实施规范。
>
> **v0.5 变更说明**：
> - 采用统一 Atom 层（方案 A）：`atom` 表覆盖所有内容来源，废弃 `block` 表
> - `atom` 表新增 `source_type`、`from`（FromReference）、`node_ids` 字段
> - 原 `atom` 表的 `bbox`/`page` 字段迁移到 `from.pdfBbox`/`from.pdfPage`
> - 原 `block` 表功能合并入 `atom` 表（source_type: 'note'）
> - 详细类型体系见 `KRIG-Atom体系设计文档.md`

---

## 一、设计原则

### 1.1 按语义域划分表，不按技术结构划分

每张表对应一个有意义的知识域，而不是把所有数据塞进少数几张大表。

SurrealDB 的表概念比传统关系数据库更灵活：
- 同一张表可以存不同结构的记录
- 表和表之间可以直接建边，不需要外键
- 支持命名空间隔离（每本书、每篇笔记是独立子图）

### 1.2 配合懒惰构建原则（P6）

每个子图（book、note）可以独立地、按需地推断内部关系，不触发全局扫描。Schema 设计需要为局部查询优化，而不是为全图查询优化。

### 1.3 为自动记录预留空间

用户不应该手动维护自己的工作状态。凡是系统可以自动捕捉的行为，都应该有对应的表结构支撑。

### 1.4 node + triple 二元模型，一切从三元组涌现（P7 落地基础）

知识图谱的核心结构只有两张表：`node` 和 `triple`。

不引入 concept / inference_queue / user_connection 三张专用表。原因：

- **concept 表**的问题：把"分类"硬编码进 schema，是 Notion 式思维，违反 P4。节点类型通过 `node.type` 字段涌现，不需要独立的表。
- **inference_queue 表**的问题：候选节点的生命周期可以完全用 `node.confidence` + `node.status` 字段表达。
- **user_connection 表**的问题：用户手动建立的关系通过 `triple.confidence` 和 `triple.source` 字段区分。

**P7（系统提议，用户确认）在此模型内的落地方式：**

```
系统生成候选节点  →  node，confidence < 1.0，status: "candidate"
用户确认         →  node.confidence = 1.0，status: "confirmed"
用户手动连接     →  triple，confidence = 1.0，source: "user"
系统推断关系     →  triple，confidence < 1.0，source: "system:{method}"
过期清理         →  定期清理 status: "candidate" 且超过 expired_at 的 node
```

---

## 二、表结构规划

### 2.1 activity_log — 用户操作日志

**职责**：自动、被动地记录用户的所有操作轨迹，零用户负担。

```
activity_log {
    id          : string,
    timestamp   : datetime,
    view_type   : string,       // "note" | "pdf" | "web" | "ai" | "graph"
    view_id     : record,
    action_type : string,       // "open" | "edit" | "read" | "search" | "connect"
    duration_ms : number,
    metadata    : object,
}
```

---

### 2.2 book:{id} — 书本元数据

```
book:{id} {
    id          : string,
    title       : string,
    authors     : array,
    isbn        : string,
    imported_at : datetime,
    source_path : string,
    status      : string,       // "importing" | "ready" | "indexed"
    atom_count  : number,
}
```

书本的内容（段落、公式、图表、表格）统一存入 `atom` 表（source_type: 'pdf_book'）。

---

### 2.3 note:{id} — 笔记元数据

```
note:{id} {
    id          : string,
    title       : string,
    created_at  : datetime,
    updated_at  : datetime,
    tags        : array,
}
```

笔记的内容（Block）统一存入 `atom` 表（source_type: 'note'）。

---

### 2.4 atom — 统一内容存储层

**职责**：存储所有来源的内容单元。覆盖 Note 编辑器 Block、PDF 导入内容、Web 提取内容、AI 对话提取内容。

> 原 `atom:{book_id}_{atom_id}` 表和 `block:{note_id}_{block_id}` 表合并为此表。
> 详细类型体系（AtomType、AtomContent、FromReference）见 `KRIG-Atom体系设计文档.md`。

```
atom:{source_id}_{atom_id} {
    id              : string,

    // 来源定位
    source_type     : string,       // "note" | "pdf_book" | "web" | "ai_conversation"
    source_id       : string,       // note_id / book_id / conversation_id

    // 内容（见 Atom 体系设计文档）
    type            : string,       // AtomType（20+ 种，含 paragraph/heading/mathBlock 等）
    content         : object,       // 对应 type 的精确结构（AtomContent）
    order           : number,       // 在文档或父容器中的顺序
    parent_id       : string,       // 父 Atom ID（容器子节点，扁平存储）

    // 来源追溯（FromReference，统一格式）
    from {
        extraction_type : string,   // "manual"|"pdf"|"web"|"ai-conversation"|"epub"|"clipboard"
        pdf_book_id     : string,   // PDF 来源：关联 book:{id}
        pdf_page        : number,   // PDF 来源：页码（原 atom.page）
        pdf_bbox        : object,   // PDF 来源：页面坐标（原 atom.bbox）
        url             : string,   // Web 来源：原始网页 URL
        page_title      : string,   // Web 来源：页面标题
        conversation_id : string,   // AI 对话来源：ai_conversation 表 ID
        message_index   : number,   // AI 对话来源：消息索引
        epub_cfi        : string,   // EPUB 来源：CFI 定位符
        citation        : object,   // 学术引用信息（title/author/doi 等）
        extracted_at    : datetime,
    },

    // Thought Tab（P5，仅 source_type: 'note' 时有效）
    thought         : string,

    // 知识图谱
    dirty           : boolean,      // 是否需要重新推断关系（P6）
    node_ids        : array,        // 关联的 node 表记录 ID（异步回填）

    // 时间
    created_at      : datetime,
    updated_at      : datetime,
}
```

**各来源的写入示例：**

```
Note 编辑器手动输入：
  source_type: "note", source_id: "note:xxx"
  type: "paragraph", from.extraction_type: "manual"

PDF 导入（原 atom 表内容）：
  source_type: "pdf_book", source_id: "book:xxx"
  type: "mathBlock", from.pdf_page: 42, from.pdf_bbox: {...}

Web 提取：
  source_type: "web", source_id: "note:xxx"（写入的目标 Note）
  type: "paragraph", from.url: "https://arxiv.org/..."

AI 对话提取：
  source_type: "ai_conversation", source_id: "ai_conv:xxx"
  type: "paragraph", from.conversation_id: "...", from.message_index: 3
```

---

### 2.5 node — 知识图谱节点

**职责**：知识图谱的核心节点表。系统生成的候选节点和用户确认的节点都在此表，通过 `confidence` 和 `status` 区分。

```
node {
    id            : string,
    name          : string,
    aliases       : array,
    definition    : string,
    type          : string,     // 自由文本，从数据涌现，不枚举

    // P7 的核心承载字段
    confidence    : number,     // 0.0–1.0，系统候选 < 1.0，用户确认 = 1.0
    source_method : string,     // "user" | "tfidf" | "yake" | "ner" | "cooccurrence"
    status        : string,     // "candidate" | "confirmed" | "rejected"
    expired_at    : datetime,   // 候选过期时间（status: candidate 时有效）
    source_ref    : record,     // 来源节点引用（atom / block）

    created_at    : datetime,
    updated_at    : datetime,
}
```

**P7 生命周期：**

```
系统分析 → node（candidate, confidence<1.0, expired_at: +30d）
    ↓
用户确认 → confidence=1.0, status="confirmed", expired_at 清空
用户忽略 → 到期自动清理
用户拒绝 → status="rejected"，不再出现在候选列表
```

---

### 2.6 triple — 知识图谱关系

**职责**：所有节点之间的有向关系，包括系统推断和用户手动建立。

```
triple {
    id          : string,
    subject     : record<node>,
    predicate   : string,       // 自由文本，不枚举
    object      : record<node>,
    confidence  : number,       // 系统推断 < 1.0，用户手动 = 1.0
    source      : string,       // "user" | "system:ner" | "system:cooccurrence" | "system:embedding"
    note        : string,       // 用户备注
    context_ref : record,       // 关系来源的上下文（atom / block）
    created_at  : datetime,
    updated_at  : datetime,
}
```

`source = 'user'` 的记录系统增量更新时跳过，永不覆盖（P1）。

---

### 2.7 词频辅助表

```
word_freq {
    id          : string,
    word        : string,
    freq        : number,
    doc_count   : number,
    updated_at  : datetime,
}

word_doc {
    id          : string,
    word        : string,
    doc_id      : record,
    tf          : number,
    tfidf       : number,
    updated_at  : datetime,
}
```

词频表是原始信号层，不直接进入图谱。高 TF-IDF 词经 YAKE/NER 过滤后写入 `node`（candidate）。

---

### 2.8 ai_conversation — AI 对话历史

**职责**：持久化 WebView AIBridge 捕获的 Web AI 对话记录。
来源：WebView §7.3 SSECaptureManager 拦截的对话内容。

```
ai_conversation {
    id            : string,
    service       : string,         // "claude" | "chatgpt" | "gemini"
    title         : string,         // 对话标题（从 AI 服务 DOM 提取）
    url           : string,         // 对话 URL，可回溯
    messages      : array,          // AIMessage[]
    captured_at   : datetime,
    workspace_id  : string,         // 哪个 Workspace 产生的（可选）
    task_id       : string,         // 关联的 Module 5 任务（可选，见 2.8）
}

// AIMessage 结构
ai_message {
    role          : string,         // "user" | "assistant"
    content       : string,         // Markdown 格式
    timestamp     : datetime,
}
```

**与知识图谱的对接路径（通过 Thought 系统，符合 P7）：**

```
ai_conversation（原始对话，系统自动捕获）
    ↓  用户主动选择有价值的片段
Thought（用户提取，关联源对话）
    anchor: { type: 'ai-conversation', conversation_id, message_index }
    ↓  用户确认
node（confirmed，进入正式图谱）
```

和 WebView 网页提取、EBookView 标注的知识化路径是同一个模式：
**源材料 → 持久化 → 用户选择性提取 → Thought → 知识图谱。**

不同来源汇聚到同一出口（Thought 系统），架构一致。

---

### 2.9 task — Module 5 任务定义

**职责**：存储 Module 5 Agent 的任务定义和执行状态。

```
task {
    id                : string,
    name              : string,
    description       : string,         // 用户原始意图描述
    template_id       : string,         // 匹配的模板 id
    trigger           : object,         // 触发条件
                                        //   { type: "cron", cron: "0 9 * * *" }
                                        //   { type: "event", event: "note_created" }
                                        //   { type: "manual" }
    level             : number,         // 0 | 1 | 2 | 3（自动化等级）
    variables         : object,         // 模板变量的当前值
    success_criteria  : string,
    retry_policy      : object,         // { max_retries, interval_ms, give_up_after }
    status            : string,         // "idle" | "running" | "waiting" | "done" | "failed"
    last_run          : datetime,
    next_run          : datetime,       // cron 任务的下次执行时间
    result            : object,         // 最近一次执行结果摘要
    created_at        : datetime,
    updated_at        : datetime,
}
```

---

### 2.10 task_execution — Orchestrator 决策记录

**职责**：记录 Module 5 Orchestrator 每次任务执行的完整决策过程，支持审计和回溯。

与 `ai_conversation` 的区别：
```
ai_conversation   ← Web AI 对话内容（用户可见的知识材料）
task_execution    ← Orchestrator 的决策过程（系统审计记录）
```

```
task_execution {
    id            : string,
    task_id       : record<task>,       // 关联任务
    started_at    : datetime,
    ended_at      : datetime,
    status        : string,             // "done" | "failed" | "aborted"
    steps         : array,              // ExecutionStep[]
    final_result  : object,
}

// ExecutionStep 结构（对应 Orchestrator 每次调用 Gemma 4 的决策）
execution_step {
    step_id       : string,
    type          : string,             // "web_ai" | "orchestrator" | "krig_tool" | "browser"
    input         : object,
    output        : object,
    reasoning     : string,             // Gemma 4 的判断依据（可解释性，P1）
    timestamp     : datetime,
    duration_ms   : number,
    success       : boolean,
}
```

---

## 三、图谱层整体结构

```
┌──────────────────┐  ┌─────────────────┐  ┌──────────────────────┐
│  book:热力学基础   │  │  note:卡诺循环   │  │  ai_conversation     │
│  （元数据）        │  │  （元数据）       │  │  messages[]          │
└────────┬──────────┘  └────────┬─────────┘  └──────────┬───────────┘
         │                      │                        │
         ↓                      ↓                        ↓
┌──────────────────────────────────────────────────────────────────┐
│                        atom 表（统一内容层）                       │
│                                                                  │
│  source_type:"pdf_book"   type:"mathBlock"  from.pdf_page:42    │
│  source_type:"note"       type:"paragraph"  from.type:"manual"  │
│  source_type:"web"        type:"paragraph"  from.url:"arxiv..." │
│  source_type:"ai_conv"    type:"paragraph"  from.conv_id:"..."  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ 异步提取（dirty 标记，P6）
                         ↓ 用户确认（P7）
┌──────────────────────────────────────────────────────────────────┐
│                        node 表                                    │
│  "熵增原理"   confidence:1.0  confirmed                          │
│  "卡诺循环"   confidence:1.0  confirmed                          │
│  "做功"       confidence:0.76 candidate  （系统候选）            │
└──────────────────────┬───────────────────────────────────────────┘
                       │  triple 表
    "熵增原理" ──prerequisite_of──> "热力学第二定律"  source:user
    "卡诺循环" ──exemplifies──────> "热力学第二定律"  source:user
    "做功"     ──related_to───────> "熵增原理"        source:system:cooccurrence
```

---

## 四、表总览

| 表 | 层次 | 来源模块 | 状态 |
|---|---|---|---|
| activity_log | 行为记录层 | 全局 | 待引入 |
| book:{id} | 内容元数据层 | Module 1 PDF | 待引入 |
| note:{id} | 内容元数据层 | Module 2 Note | 待引入 |
| atom | 内容存储层（统一） | 全模块 | 待引入（替代旧 atom + block 两表） |
| node | 知识图谱层 | Module 3 | 已在 mirro-desktop 实现 |
| triple | 知识图谱层 | Module 3 | 已在 mirro-desktop 实现 |
| word_freq | 词频辅助层 | Module 3 | 已在 mirro-desktop 实现 |
| word_doc | 词频辅助层 | Module 3 | 已在 mirro-desktop 实现 |
| ai_conversation | AI 交互层 | Module 1 WebView | 待引入 |
| task | Agent 层 | Module 5 | 待设计 |
| task_execution | Agent 层 | Module 5 | 待设计 |

---

## 五、引入时机与实施建议

### 当前阶段（功能开发期）

- mirro-desktop 的 12 表 schema（node、triple、word_freq、word_doc 等）与本文档兼容
- 新增的 ai_conversation、task、task_execution 三张表随对应模块成熟后引入
- 重点确保功能逻辑正确，数据结构细节留待迁移时确认

### 引入 SurrealDB 的前置条件

```
□  PDF 阅读基础功能（Batch 1）完成
□  Note 编辑器核心功能完成
□  Block 数据结构稳定（类型、字段不再频繁变动）
□  AI 分屏交互模式确定（WebView Batch 3）
□  图谱视图基本交互确定
```

### mirro-desktop 当前实现的对应关系

| mirro-desktop 表 | 本文档对应 | 状态 |
|-----------------|-----------|------|
| note | note:{id} | 对齐 |
| thought | atom.thought 字段（source_type:'note'） | 对齐 |
| highlight | atom 的子集（from.extraction_type:'pdf'） | 对齐 |
| pdf_book | book:{id} | 对齐 |
| atom_index（PDF）| atom（source_type:'pdf_book'）| 统一合并 |
| note doc_content | atom（source_type:'note'）| 统一合并，需迁移 |
| node | node | 对齐 |
| triple | triple | 对齐 |
| atom_index | atom_index 辅助表 | 对齐 |
| word_freq | word_freq | 对齐 |
| word_doc | word_doc | 对齐 |
| activity_log | activity_log | 未实现，待引入 |
| — | ai_conversation | 新增，随 WebView Batch 4 引入 |
| — | task | 新增，随 Module 5 引入 |
| — | task_execution | 新增，随 Module 5 引入 |

---

## 六、待确认事项

- [ ] Atom 的粒度：段落级还是句子级（影响 PDF 导入的 atom 数量级）
- [ ] node 候选的推断算法选型（embedding / NER / 混合）
- [ ] node 候选的默认过期时长（建议 30 天，待确认）
- [ ] 用户确认 UI 的交互形式：批量确认面板 vs 图谱内联确认
- [ ] triple.predicate 是否维护推荐词表（不枚举，但给用户输入提示）
- [ ] ai_conversation 的保留策略（本地存多久？是否同步云端）
- [ ] task_execution 的保留策略（建议按任务保留最近 N 次）
- [ ] atom 表的数据迁移时机（mirro-desktop 旧格式 → 统一 Atom 格式）
- [ ] 多设备场景下子图的合并策略

---

## 七、技术选型参考（词频→图谱链路）

```
阶段 1：分词
  中文/英文：Intl.Segmenter（零依赖，已在 mirro-desktop 验证）
  备选：jieba（Python，适合需要词性标注的场景）

阶段 2：词频权重
  TF-IDF，写入 word_freq / word_doc 两表
  IDF 基准：wordfreq 库（覆盖 40+ 语言预计算频率）

阶段 3：关键词提取
  YAKE（Python，无监督，适合单文档冷启动）

阶段 4：命名实体识别
  英文：spaCy
  中文：pkuseg 或 HanLP
  输出写入 node 表，status: "candidate"，source_method: "ner"

阶段 5：写入 node 表
  批量写入，confidence 由算法决定，expired_at 设置过期时间
```

**选型约束**：全部本地运行，零网络依赖，符合 KRIG local-first 原则。

---

*本文档随功能迭代持续更新。正式引入 SurrealDB 前，版本号保持 v0.x。*
