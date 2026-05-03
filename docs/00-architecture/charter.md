# KRIG-Note V2 总纲

> v0.2 · 2026-05-03 · 草稿
>
> 作者:wenwu + Claude

---

## 0. 为什么有这份新总纲

KRIG-Note V1 二次重构期(2026-04 → 2026-05)产出 700+ 行的 [00-总纲.md](../99-archive-v1/refactor/00-总纲.md),包含六波分波、Step A+B 双 PR、三角架构等过程性规则。但实际重构推进**用户感知 0**——14 个阶段全部"字面合规但运行时违规未消除"。

V2 总纲只继承 V1 的**三大原则**(分层 / 注册 / 抽象),抛弃所有过程性规则。换之以**可见可验证 + 自上而下分层构建**。

---

## 1. 三大原则

### 1.1 分层原则

KRIG-Note V2 有**两套分层**,正交关系。

#### 纵向分层(数据 / 能力流向 4 层)

```
可视化层(View)
   ↓ 注册 / 调用
能力层(Capability) ← 唯一中间层 + npm 依赖屏障
   ↓ 调用 / 读写
语义层(Semantic) ← Atom + block
   ↓ 持久化
存储层(Storage) ← SurrealDB
```

**单向调用**:上层调下层,下层不知上层存在。

#### 横向分层(应用栈 L0~L5)

沿用 V1 [视图层级定义.md](./view-hierarchy.md):

```
L0 应用(Electron 主进程 + 启动入口)
   ↓
L1 窗口(BrowserWindow + 窗口管理)
   ↓
L2 Shell(三栏布局骨架 + Slot 容器)
   ↓
L3 Workspace(WorkMode 实例 + 状态)
   ↓
L4 Slot(Slot 系统 + ViewType 注册)
   ↓
L5 View(视图入口)
```

#### 两套分层正交

同一段代码同时位于"某个纵向层 + 某个横向层"。例:
- NoteView 视图主体 = 纵向**可视化层** + 横向 **L5**
- WorkspaceShell 三栏布局 = 纵向**可视化层** + 横向 **L2**
- capability.text-editing = 纵向**能力层** + 横向跨 L0~L5(被 L5 view 调用,但实现可能涉及 L0 主进程 IPC)

#### 强制规则

- 纵向各层**单向调用**,无逆向依赖
- 能力层是 npm 依赖屏障(详见 § 1.3)
- 可视化层零业务 npm 包 import(react 等纯函数工具白名单除外)

---

### 1.2 注册原则

**所有交互 / 能力 / 视图通过 Registry 注册,不硬编码**。

#### View 注册到能力层

```ts
// views/note/index.ts(可视化层 — 纯声明)
import { registerView } from '@/capabilities';

registerView({
  id: 'note',
  install: ['text-editing', 'find-replace', 'copy-paste', 'history'],
  contextMenu: [...],
  toolbar: [...],
});
```

View **不直接 import 能力实现**——只通过 install 列表声明依赖能力 ID。

#### Capability 注册到 Capability Registry

```ts
// capabilities/text-editing/index.ts
import { registerCapability } from '@/capabilities';

registerCapability({
  id: 'text-editing',
  schema: ...,
  converters: ...,
  createInstance: ...,
  commands: ...,
  contextMenu: [...],
  toolbar: [...],
});
```

Capability 实现注册时携带元数据,由 Capability Registry 统一管理。

#### 五大交互各自 Registry

ContextMenuRegistry / ToolbarRegistry / SlashRegistry / HandleRegistry / FloatingToolbarRegistry 各自独立。能力或视图注册时,菜单项进入对应 Registry。

#### 强制规则

- View 通过 install 列表声明能力依赖,**0 处直接 import 能力实现**
- 能力间不能互相 install(避免依赖图)——视图自己组合多个能力
- 命令实现走 CommandRegistry,菜单项 `command: string` 是字符串引用

---

### 1.3 抽象原则(npm 依赖屏障)

**能力层是所有外部 npm 依赖与上层之间的唯一出入口。**

#### 屏障语义

```
═══════════ npm 依赖屏障 ═══════════
   可视化层(View) ← 不允许 import 业务 npm 包
   ↑
═══════════ npm 依赖屏障 ═══════════
   ↓
   能力层(Capability) ← 唯一允许 import 业务 npm 包
   语义层 / 存储层
```

#### 三条具体规则(沿 V1 § 1.3)

**规则 A(核心)**:所有有状态 / 有生命周期 / 有 UI 的外部 npm 依赖必须经能力层封装。可视化层禁止直接 import。

| 外部 npm 依赖 | 归属能力 |
|---|---|
| `prosemirror-*` | capability.text-editing |
| `three` | capability.canvas-rendering |
| `pdfjs-dist` | capability.pdf-rendering |
| `epubjs / foliate-js` | capability.epub-rendering |
| `electron WebContentsView` | capability.web-rendering(主进程封装) |
| `electron session.webRequest / webContents` | capability.browser-capability |
| AI SDK | capability.ai-conversation |
| `elkjs` | capability.elk-layout |

**规则 B(例外)**:纯函数工具(无状态 / 无生命周期 / 无 UI / 调用即返回)允许任何文件 import,白名单维护。

初版白名单:`react / lodash / dayjs / date-fns / clsx / classnames / nanoid / uuid / zod / zustand / jotai / @types/*`

**规则 C(颗粒度)**:能力颗粒度按"未来可扩展"原则设计。即便当前只一个视图消费,只要符合"有状态封装"特征,也建立独立 Capability,为未来跨视图复用预留接口。

#### 为什么必须是屏障

切换底层库(prosemirror → Lexical / Slate、three → Babylon、pdf.js → 其他 PDF 库)时,**只改对应 capability 内部,所有上层一行不改**。这是"换底层零成本"承诺的物理保证。一旦视图直接 import 外部依赖,承诺即破。所以零例外。

#### ESLint 自检

```ts
// eslint config (示意)
{
  files: ['src/views/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs'],
          message: '视图层禁止 import 业务 npm 包,通过能力层(install 列表)使用' }
      ]
    }]
  }
}
```

---

## 2. 两套分层细则

### 2.1 纵向 4 层

#### 可视化层(View)

**职责**:用户感知 + 视图本地状态。

**包含**:
- 视图 React 组件(NoteView / GraphView / EBookView / WebView)
- 视图本地状态(光标 / 选区 / 滚动 / 缩放)
- 视图独有交互项(contextMenu / toolbar 等的视图特定项)

**调用关系**:View 注册到 Capability Registry,**不直接 import 能力实现**。能力调用通过 install 列表 + Registry 间接路由。

**目录**:`src/views/<view-name>/`

**强制约束**:
- 0 处业务 npm 包 import
- 0 处 `import 'electron'`(电子相关走能力层)
- 0 处直接 import `src/capabilities/<x>/internal/...`(只能 import `src/capabilities` 入口)

#### 能力层(Capability)

**职责**:互操作能力的抽象,封装外部依赖,跨视图复用动作。

**唯一中间层** —— 不再有"表征层"等中间分层。所有跨视图横向抽象都在能力层。

**包含**:
- 业务能力(text-editing / canvas-rendering / pdf-rendering / web-rendering / ...)
- 系统能力(history / find-replace / copy-paste / ...)
- 互操作能力(browser-capability / content-extraction / ai-conversation / ...)

**调用关系**:能力层调用语义层(Atom 类型 + block 概念)+ 存储层(读写)。能力层间禁止互相 install(避免依赖图)。

**目录**:`src/capabilities/<capability-name>/`

**强制约束**:
- 唯一允许 import 业务 npm 包的位置
- 实现细节不外泄(只通过入口 `index.ts` 暴露 API)
- 注册时携带元数据(schema / converters / createInstance / commands / 五大交互)

详细分类见 § 3。

#### 语义层(Semantic)

**职责**:内容本体,与可视化无关。Atom + block 在这里定义。

**包含**:
- Atom 类型定义(`atom-types.ts`)
- block 概念(atom 的语义组合形态;具体形态见 § 4)
- IntentEvent / ID 类型 / 共享类型

**调用关系**:被能力层 + 存储层调用,不主动调用任何上层。

**目录**:`src/semantic/`

**强制约束**:
- 0 处 npm 业务包 import
- 纯类型 + 纯逻辑(不持有状态)
- 跨视图通用(任何视图都能消费)

#### 存储层(Storage)

**职责**:持久化,SurrealDB SDK 调用。

**包含**:
- SurrealDB 连接管理
- Atom 读写 IPC handler
- 数据库 schema 维护

**调用关系**:被能力层调用,不主动调用任何上层。

**目录**:`src/storage/`

**强制约束**:
- 唯一允许 import SurrealDB SDK 的位置
- 通过 IPC 提供给能力层(主进程 / renderer 隔离)

---

### 2.2 横向 L0~L5

#### L0 应用(Electron 主进程 + 启动入口)

**包含**:
- Electron app 生命周期管理
- 主进程入口(`src/main/index.ts`)
- IPC 总线(主进程侧)
- 数据目录管理

**对应纵向**:跨纵向多层(包含 L0 部分的存储层、能力层主进程实现等)。

#### L1 窗口

**包含**:BrowserWindow 创建 + 窗口管理(主窗口 / 设置窗口等)。

**对应纵向**:可视化层(窗口外壳)+ 能力层(窗口管理 API)。

#### L2 Shell

**包含**:三栏布局骨架(TopBar / LeftSlot / MainSlot / RightSlot)+ Slot 容器机制 + 窗口可拖拽分隔线。

**对应纵向**:可视化层(布局组件)。

#### L3 Workspace

**包含**:WorkMode 实例(demo-a Note / demo-b EBook / demo-c Web)+ Workspace 状态(activeViewId / activeResource 等)+ pluginStates 字典。

**对应纵向**:能力层(Workspace 状态管理能力)+ 存储层(状态持久化)。

#### L4 Slot

**包含**:Slot 系统(slot 注册 + 视图实例化机制)+ ViewType 注册表 + Capability Registry。

**对应纵向**:能力层(Registry 基础设施)。

#### L5 View

**包含**:视图入口 React 组件(NoteView / GraphView / EBookView / WebView 等)+ 视图独有交互。

**对应纵向**:可视化层(视图主体)。

---

### 2.3 屏障检查机制

#### ESLint 自检规则

```js
// .eslintrc 关键规则
overrides: [
  {
    files: ['src/views/**', 'src/semantic/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs', 'foliate-js'],
        importNames: ['ipcRenderer'],  // electron renderer API 走能力层
      }],
    },
  },
  {
    files: ['src/storage/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['*'], message: '存储层只允许 import surrealdb + 内部模块' }],
      }],
    },
  },
];
```

#### CI 卡死

任何违规 = CI 失败,无法 merge。

---

## 3. 能力层内部分类

能力层内部按职责分 3 类(子目录组织,不是新层):

### 3.1 表征类能力(Representation Capabilities)

**作用**:把语义投影成视图特定形态(渲染方法)。

**内含 blockView**:具体的 block → DOM / SVG / mesh 投影机制(详见 § 4)。

| 能力 | 渲染目标 | 内部依赖 |
|---|---|---|
| `text-editing` | atom → block → PM doc → DOM | prosemirror-* |
| `canvas-rendering` | atom → SVG / Three mesh | three |
| `pdf-rendering` | PDF → 页面流 | pdfjs-dist |
| `epub-rendering` | EPUB → 页面流 | epubjs / foliate-js |
| `web-rendering` | webpage → DOM | electron WebContentsView |

### 3.2 互操作类能力(Interop Capabilities)

**作用**:跨视图通用的动作抽象,与"投影"无关。

| 能力 | 动作抽象 | 内部依赖 |
|---|---|---|
| `browser-capability` | 浏览器底层(network / artifact / interaction)| electron session / webContents |
| `content-extraction` | 从源提取语义(任意来源 → atom)| 各源解析器 |
| `ai-conversation` | AI 对话(切模型 / 提取回复)| AI SDK |
| `elk-layout` | 自动布局算法 | elkjs |

详细参考 [99-archive-v1/refactor/00-总纲.md § 5.9](../99-archive-v1/refactor/00-总纲.md) 能力清单。

### 3.3 系统服务类能力(System Service Capabilities)

**作用**:系统级跨视图通用功能。

| 能力 | 功能 |
|---|---|
| `history` | 撤销 / 重做 |
| `find-replace` | 查找替换 |
| `copy-paste` | 跨视图剪贴板(含 atom) |

---

## 4. block 与 atom 的精确定位

### 4.1 atom — 语义最小单元

**所属层**:语义层。

**形态**:`{ type, content?, attrs?, marks?, text? }`(沿用 V1 ProseMirror node JSON 形态)。

**特性**:
- 内容最小单元(textInline / mathInline / link / mark 等)
- 平铺存储(嵌套通过 `content` 字段)
- 不可变(被多个视图消费时各持副本)
- 视图无关(不挂任何 view-meta)

**例子**:
```ts
{ type: 'text', text: 'hello' }
{ type: 'mathInline', attrs: { latex: 'x^2 + 1' } }
```

详见 [V1 KRIG-Atom 体系设计文档](../99-archive-v1/refactor/00-总纲.md) 引用的 atom-types.ts。

### 4.2 block — atom 的语义组合形态

**所属层**:语义层。

**形态**:atom 的组合,**block 自身可嵌套 block**(嵌套关系内置)。

**例子**:
- `textBlock` = 一组 inline atom(text + mark)
- `mathBlock` = 一个 mathInline atom 的容器
- `bulletList` = 一组 textBlock 或 list-item 的容器(block 嵌套 block)
- `callout` = 一组任意 block 的容器(block 嵌套 block)

**特性**:
- 是语义层概念,**不是渲染逻辑**
- 自包含语义(textBlock 知道自己是"一段文本",不知道渲染成 `<p>` 还是别的)
- 跨视图共享(同一份 block 数据,Note 视图渲染成滚动文本流,Graph 视图渲染成节点 label)

### 4.3 blockView — block 的渲染方法

**所属层**:能力层(表征类能力内部)。

**形态**:能力层提供的"如何把 block 渲染成 view 特定形态"的实现。

**例子**:
- `capability.text-editing` 内部含 `textBlockView`(把 textBlock atom 渲染成 PM nodeView)
- `capability.text-editing` 内部含 `bulletListView`(把 bulletList block 渲染成 PM 列表 nodeView)
- `capability.canvas-rendering` 内部含 `textBlockView`(把 textBlock atom 渲染成 SVG)

**特性**:
- 同一个 block(如 textBlock)在不同能力下有不同 blockView 实现
- 切换底层库(PM → Lexical)时,只改 blockView 内部,block 概念不变
- blockView 是能力层的内部细节,**视图不直接接触**(通过能力层入口调用)

### 4.4 主轴关系

```
语义层
  ├─ atom(最小单元)
  └─ block(atom 组合,block 内部可嵌套 block)
       ↓ 调用能力层投影
能力层
  └─ blockView(block 的渲染方法,各能力提供自己的实现)
       ↓ 投影到
可视化层
  └─ View(用户看到 / 操作的具体形态)
```

---

## 5. 自我诊断规范

### 5.1 每层启动信号

启动时各层输出 `Lx alive` 诊断行(横向)+ 各纵向层就绪信号:

```
[L0] Platform alive | window: 1, ipc: ready
[L1] Window alive | main BrowserWindow created
[L2] Shell alive | layout: 3-column, slots: ['top', 'left', 'main', 'right']
[L3] Workspace alive | workspaces: 3, active: 'demo-a'
[L4] Slot alive | view types: ['note', 'graph'], capabilities: ['text-editing', 'history']
[L5] View alive | active: 'note', registered views: ['note']

[Capability] alive | registered: ['text-editing', 'history', 'find-replace']
[Semantic] alive | atom types: ['text', 'mathInline', ...], block types: [...]
[Storage] alive | surrealdb: connected, db: 'krig-note-v2'
```

### 5.2 启动失败信号

```
[L3] State INIT FAILED
  ↳ reason: cannot read /Users/.../krig-note-v2/workspaces.json
  ↳ at: src/state/persistence/loader.ts:42
  ↳ next layer (L4) WILL NOT START
```

### 5.3 健康检查 IPC

```ts
// 每层暴露健康检查 IPC
ipc.invoke('health.L0')          // { alive, since, errors }
ipc.invoke('health.capability')  // { registered: [...], errors }
ipc.invoke('health.storage')     // { connected, db, errors }
```

调试时主动查询任意层状态。

### 5.4 状态可观测

每层维护内部状态计数器(slot 数 / 注册项数 / 活跃实例数),通过 IPC 查询。

---

## 6. 节奏规则

### 6.1 横向 L0~L5 自上而下推进

按用户感知优先级,L0 先做(应用启动 + 主窗口),依次 L1 → L5。每层完成才进下一层。

### 6.2 一层一阶段,不细拆

V1 教训:**过度细拆 → 每阶段"小修小补" → 推进归零**。V2 反过来:**一层一阶段,完成才进下一层**。

| 横向阶段 | 工作量 | 完成判据 |
|---|---|---|
| L0 应用层 | Electron 启动 + 主窗口 + 自我诊断 | npm start 看到 "L0 alive" 窗口 |
| L1 窗口层 | 窗口管理 + 多窗口可创建 | 可创建主窗口 + 设置窗口 |
| L2 Shell 层 | 三栏布局 + Slot 容器 | 三栏可见 + 分隔线可拖 |
| L3 Workspace 层 | WorkMode 切换 + 状态持久化 | 切 workspace + 重启状态恢复 |
| L4 Slot 层 | ViewType 注册 + Slot 实例化 | 注册一个测试 view + 在 Slot 内挂载 |
| L5 NoteView | NoteView 完整功能(从 V1 整体迁移) | 编辑 + 持久化 + 撤销 / 重做 |

### 6.3 每阶段的"完成"定义

完成 = 同时满足:
1. ✅ npm start 跑得起来
2. ✅ 用户操作能看到该层功能(不是"代码审核通过"是"UI 上看到")
3. ✅ console 打印 "Lx alive" 诊断行
4. ✅ 上一层的"alive 行"也在(不能因为加 Lx 把 Lx-1 弄坏)
5. ✅ 健康检查 IPC 返回 `alive: true`

任意一项不满足 = 阶段未完成。

### 6.4 阶段间拍板

- 每层完成后,Claude 写一份 `docs/<阶段名>-completion-report.md` 描述"用户应该能看到什么"
- 用户实际跑 `npm start` 验证 → 看到符合预期则确认通过 → 进下一层
- 用户验证失败则当场调试,直到验证通过才进下一层

不再三角架构。Claude 一个人写代码,用户一个人验收。

### 6.5 业务代码搬迁原则

L5 阶段(NoteView)允许从 V1 整体搬迁 NoteEditor.tsx 等业务代码:
- **复用 V1 已稳定的实现**(NoteEditor.tsx 1100 行已经经过实战检验)
- **改外层契约**(让它通过 V2 的能力层 + Registry 接口被托管)
- **内部逻辑零改动**(避免业务回归)

搬完后,V2 的 NoteView 在用户视角应该**与 V1 完全一致**——但架构上已经"能力层是唯一 npm 屏障 + 视图是纯声明"。

---

## 7. 与 V1 总纲的关系

### 7.1 继承(目标态原则)

V2 沿用 V1 总纲 § 1 的三大原则的内核:
- § 1.1 分层原则(扩展为纵向 4 层 + 横向 L0~L5 正交)
- § 1.2 注册原则(扩展为 view 注册到能力层 + 五大 Registry)
- § 1.3 抽象原则(强化为 npm 依赖屏障)

### 7.2 抛弃(过程性规则)

V2 不沿用 V1:
- 6 波分波(§ 2)
- Step A + Step B 双 PR(§ 2.2)
- 三角架构 + 三份提示词(§ 7)
- 临时引用模式(§ 2)
- 字节级照抄判据(各阶段 task-card)
- 立卡 SHA / 双口径 / lint warnings 严格(各 task-card)

### 7.3 修正(术语精确化)

V2 修正 V1 术语:
- V1 "Capability.converters" 字段 → V2 理解为"能力暴露 atom ↔ 内部表示的转换",归能力层一部分(不是独立"表征层")
- V1 "TextBlock / RenderBlock / ContainerBlock 三基类" → V2 简化为"block(自身可嵌套 block)",三基类归能力层实现细节
- V1 没有"blockView" 概念 → V2 引入(block 的渲染方法,归能力层)

---

## 8. 待拍板

- [ ] L0 起点具体范围:仅 Electron 启动 + 主窗口 + 写"L0 alive"? 还是含 IPC + 数据目录?
- [ ] V2 何时算"达到 V1 等价可替代"(NoteView 等价就行 / 全部视图等价 / 不替代)
- [ ] V1 是否继续维护(完全停止 / 仅修 bug)
- [ ] 自我诊断输出形式(只 console? 加 GUI 状态栏? 加日志文件?)
- [ ] L4 Slot 层与 V1 现有 Slot 系统的关系(继承 V1 实现 / 重新设计)

---

## 9. 修订记录

| 日期 | 版本 | 内容 | 作者 |
|---|---|---|---|
| 2026-05-03 | v0.1 | 初稿;承袭 V1 § 1.1/1.2/1.3 + 引入"L0~L5 自下而上工程顺序" | wenwu + Claude |
| 2026-05-03 | v0.2 | 完全重写;**修正 v0.1 把横向应用栈与纵向数据流混为一谈的错误**;明确两套分层正交;引入"取消表征层 + 能力层是唯一中间层 + 屏障"理解;引入 atom / block / blockView 三层精确定位 | wenwu + Claude |
