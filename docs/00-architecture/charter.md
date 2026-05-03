# KRIG-Note V2 简化总纲

> v0.1 · 2026-05-03 · 草稿,待用户审阅
>
> 作者:wenwu + Claude

---

## 0. 为什么有这份新总纲

KRIG-Note V1 重构期(2026-04 → 2026-05)产出 700+ 行的[`docs/refactor/00-总纲.md`](../99-archive-v1/refactor/00-总纲.md),包含:
- 6 波分波规划
- Step A + Step B 双 PR 拆分
- 三角架构(Commander/Builder/Auditor)
- 临时引用模式 + 字节级照抄

但实际重构推进**用户感知 0**——14 个阶段 / 15 个三角架构循环全部"字面合规但运行时违规未消除"。

V2 总纲**只保留 V1 的目标态原则**(分层 / 注册 / 抽象 / Capability 设计),**抛弃**所有过程性规则(波次划分 / Step A+B / 三角架构 / 字节级判据 / 临时引用)。换之以**可见可验证**的"自上而下分层构建"。

## 1. 核心承诺

V2 必须做到 V1 做不到的 4 件事:

1. **每层独立可跑** — `npm start` 跑到 Lx 阶段时,这一层及之下都活着,Lx+1 之上无所谓
2. **每层自我诊断** — 启动时 console 报告 "L0 alive / L1 alive / ... / Lx alive",问题时直接定位
3. **每层可手动验证** — 用户能操作并看到结果(不是"代码审核通过"而是"我在 UI 上看到了")
4. **每层完成才进下一层** — 上一层未通过验证,绝不开始下一层

## 2. 分层定义(L0 → L5,自上而下构建)

按 V1 [视图层级定义.md](./view-hierarchy.md) 的标准 + 简化:

| 层 | 名称 | 范围 | "活着"的判据 |
|---|---|---|---|
| **L0** | 平台层 | Electron 主进程 + 主窗口 + IPC 总线 | 启动后看到一个写"L0 alive"的窗口 |
| **L1** | 内核层 | Atom schema + IntentEvent + 共享类型 | console 打印"L1: schema validated, X types loaded" |
| **L2** | 主题层 | Design Tokens + CSS variables + 字体 | 窗口背景色/字体生效,console 打印"L2: theme applied" |
| **L3** | 状态层 | WorkspaceState + ActiveResource + 持久化 | 切窗口/重启,状态正确恢复;console 打印"L3: state restored" |
| **L4** | 框架层 | Workspace 三栏布局 + NavSide + Companion + TopBar + Slot 系统 | 三栏可见 + 可拖拽分隔线 + Slot 切换正常 |
| **L5** | 视图层 | NoteView (V2 起步**仅此一个**) + 未来 Graph / EBook / Web | NoteView 能编辑文档 + 内容持久化 + 撤销/重做 |

## 3. 三大设计原则(继承自 V1 总纲 § 1)

### 3.1 分层原则

**自下而上的依赖**:Lx 只能依赖 L0~Lx-1,不能依赖 Lx+1 及以上。

实现要求:
- L0 不引用 L5 视图
- L5 不引用 L4 内部细节(只通过 L4 暴露的 Slot API)
- 跨层调用走"接口"而非"具体实现"

### 3.2 注册原则

**所有交互/能力/视图通过 Registry 注册**,不硬编码:
- ContextMenuRegistry / ToolbarRegistry / SlashRegistry / HandleRegistry / FloatingToolbarRegistry
- CapabilityRegistry(L4 平台层)
- ViewDefinitionRegistry(L4 平台层)
- CommandRegistry(命令实现走字符串引用)

### 3.3 抽象原则(渲染层 vs 能力层彻底分离)

**任何外部 npm 依赖必须经 Capability 封装,视图层零直接 import**:
- ProseMirror → `capability.text-editing` 内部
- Three.js → `capability.canvas-interaction` 内部
- pdf.js → `capability.pdf-rendering` 内部
- foliate-js → `capability.epub-rendering` 内部
- Electron API(WebContentsView 等) → `capability.web-rendering` 内部

切换底层库时,**只改对应 capability 内部,所有视图一行不改**。

## 4. 自我诊断规范

### 4.1 每层启动时的诊断信号

```
[L0] Platform alive | window: 1, ipc: ready
[L1] Kernel alive | schemas: 12, types: 47, intents: 8
[L2] Theme alive | tokens: 64, font: Noto Sans SC, mode: light
[L3] State alive | workspaces: 3, active: 'demo-a', restored from: <path>
[L4] Frame alive | slots: 4 (left/main/right/companion), navside: 4 panels
[L5] Views alive | registered: ['note.editor'], active view: note.editor
```

### 4.2 启动失败时的诊断信号

```
[L3] State INIT FAILED
  ↳ reason: cannot read /Users/.../krig-note-v2/workspaces.json
  ↳ at: src/state/persistence/loader.ts:42
  ↳ next layer (L4) WILL NOT START
```

### 4.3 健康检查 IPC

每层暴露一个"健康检查"IPC:
- `ipc.invoke('health.L0')` → `{ alive: true, since: <ts>, errors: [] }`
- `ipc.invoke('health.L4')` → `{ alive: true, slots: ['left', 'main', 'right'], registries: [...] }`

renderer 可在调试时主动查询任意层状态。

### 4.4 状态可观测

每层维护内部状态计数器(slot 数 / 注册项数 / 活跃实例数),通过 IPC 查询。便于排错。

## 5. 节奏规则

### 5.1 一层一阶段,不细拆

V1 教训:**过度细拆 → 每阶段"小修小补" → 推进归零**。V2 反过来:**一层一阶段,完成才进下一层**。

L0 一个阶段。L1 一个阶段。... L5 一个阶段(NoteView 单一视图)。**6 个阶段共 6 次"用户可感知"推进**。

### 5.2 每阶段的"完成"定义

完成 = 同时满足:
1. ✅ npm start 跑得起来
2. ✅ 用户操作能看到该层功能(不是"代码审核通过"是"UI 上看到")
3. ✅ console 打印 "Lx alive" 诊断行
4. ✅ 上一层的"alive 行"也在(不能因为加 Lx 把 Lx-1 弄坏)
5. ✅ 健康检查 IPC 返回 `alive: true`

任意一项不满足 = 阶段未完成。

### 5.3 阶段间的拍板

- 每层完成后,Claude 写一份 `docs/<阶段名>-completion-report.md` 描述"用户应该能看到什么"
- 用户实际跑 `npm start` 验证 → 看到符合预期则口头/文字确认通过 → 进下一层
- 用户验证失败则当场调试,直到验证通过才进下一层

不再三角架构。不再 Commander/Builder/Auditor 多角色。Claude 一个人写代码,用户一个人验收。

### 5.4 业务代码搬迁原则

L5 阶段(NoteView)允许从 V1 整体搬迁 NoteEditor.tsx 等业务代码:
- **复用 V1 已稳定的实现**(NoteEditor.tsx 1100 行已经经过实战检验)
- **改外层契约**(让它通过 V2 的 capability + ViewDefinition 接口被托管)
- **内部逻辑零改动**(避免业务回归)

搬完后,V2 的 NoteView 在用户视角应该**与 V1 完全一致**——但架构上已经渲染层/能力层彻底分离。

## 6. 目录结构

```
KRIG-Note-V2/
├─ src/
│  ├─ main/                          ← L0 主进程
│  │  ├─ index.ts                    (入口)
│  │  ├─ window/                     (主窗口创建 + 管理)
│  │  ├─ ipc/                        (IPC 总线 + 健康检查 handlers)
│  │  └─ diagnostics/                (L0 自我诊断模块)
│  ├─ kernel/                        ← L1 内核层
│  │  ├─ atom-types/                 (Atom schema)
│  │  ├─ intents/                    (IntentEvent 类型)
│  │  └─ diagnostics.ts              (L1 自我诊断)
│  ├─ theme/                         ← L2 主题层
│  │  ├─ tokens/                     (Design Tokens)
│  │  └─ diagnostics.ts              (L2 自我诊断)
│  ├─ state/                         ← L3 状态层
│  │  ├─ workspace/                  (WorkspaceState)
│  │  ├─ persistence/                (持久化)
│  │  └─ diagnostics.ts              (L3 自我诊断)
│  ├─ frame/                         ← L4 框架层
│  │  ├─ workspace-shell/            (三栏布局)
│  │  ├─ slot/                       (Slot 系统)
│  │  ├─ navside/                    (NavSide 框架)
│  │  ├─ registries/                 (5 大交互 Registry + Capability/ViewDef Registry)
│  │  └─ diagnostics.ts              (L4 自我诊断)
│  ├─ capabilities/                  ← L5 能力层(被视图 install)
│  │  ├─ text-editing/                (ProseMirror 封装)
│  │  └─ ...                         (按需添加)
│  └─ views/                         ← L5 视图层
│     └─ note/                       (NoteView,V2 第一个落地)
└─ docs/
   └─ (按 README.md 列出)
```

## 7. 与 V1 总纲的关系

V1 总纲 [`docs/99-archive-v1/refactor/00-总纲.md`](../99-archive-v1/refactor/00-总纲.md) 作为**理论参考**保留,不作 V2 工作指南。

V2 总纲(本文件)的"目标态"原则继承自 V1 § 1.1 / § 1.2 / § 1.3 / § 5.4 / § 5.5 / § 5.8——这些是 V1 的精华,V2 直接采纳。

V2 抛弃 V1 的:
- 6 波分波规划(§ 2)
- Step A + Step B 双 PR(§ 2.2)
- 三角架构 + 三份提示词(§ 7)
- 临时引用模式(§ 2)
- 字节级照抄判据(各阶段 task-card)
- 立卡 SHA / 双口径 / lint warnings 严格(各 task-card 判据)

## 8. 待拍板

- [ ] L0 范围具体定义(仅 Electron 启动 + 主窗口 + 写"L0 alive"? 还是含 IPC + 数据目录?)
- [ ] 自我诊断输出格式(只 console? 加 GUI 状态栏? 加日志文件?)
- [ ] V2 何时算"达到 V1 等价可替代"(NoteView 等价就行 / 全部视图等价 / 不替代)
- [ ] V1 是否继续维护(完全停止 / 仅修 bug)

## 9. 修订记录

| 日期 | 版本 | 内容 | 作者 |
|---|---|---|---|
| 2026-05-03 | v0.1 | 初稿;承袭 V1 § 1.1/1.2/1.3/5.4/5.5/5.8 目标态原则 + 抛弃过程性规则 + 引入"L0~L5 自上而下 + 自我诊断" | wenwu + Claude |
