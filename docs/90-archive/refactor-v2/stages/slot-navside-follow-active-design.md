# navSide 跟随活跃槽 — 实施交接

> 立项日期:2026-08-07
> 前置:分支 `feat/multi-window-step2`,commit `a6f425d6`(左右对称化六连已合)
> 状态:**设计已拍板,待实施**。本文档是给新对话的完整交接,读完即可开工。

---

## 0. 一句话目标

**点哪一栏,navSide 就呈现哪一栏的导航;在 navSide 上的操作也落到哪一栏。**

用户原话:

> 1、鼠标点击 left slot,navSide 高亮这个 file,如果在 navSide 对应操作另外一个 file,它也只呈现在 left slot;不会出现在 right slot;
> 2、鼠标点击 right slot,对应 navSide 高亮这个 file,如果在 navSide 对应操作另外一个 file,它也只呈现在 right slot;不会出现在 left slot;
> 实际上把 navSide 的呈现和操作也绑定在了 slot 上。

---

## 1. 必读背景(不读会做错方向)

### 1.1 已完成的六个 commit

左右 slot 已完成对称化,`f8d8104d..a6f425d6`:

| commit | 做了什么 |
|---|---|
| `0d38cbbc` | PM `instanceId` 带 slot 维度(`${wsId}::slot:${slot}`);删 wsId 兜底改 fail loud |
| `d75fab0d` | SlotArea 渲染单元改 `(viewId, slot)` 二元组,同一 view 可左右双开;补 `bus.slot.openLeft` |
| `4fda395b` | per-slot 活跃笔记(`rightActiveNoteId`);baseSnapshot key 改 scopeKey |
| `c7720f37` | toolbar 命令作用于自己那一栏(新增 `toolbar-invocation.ts`) |
| `674b4b9a` | **废除铁律 9**(切主 view 不再自动关 right);树加「在右栏打开」 |
| `a6f425d6` | 立 PROTOCOL.md §1.5 Slot 对称性原则 |

**动手前必读**:`src/slot/workspace-bus/PROTOCOL.md` §1.5(四条原则),它是本次实施的宪法。

### 1.2 关键事实:抽象已存在,只缺一个维度

`viewTypeRegistry` + `nav-side-registry` + `NavSideBinding` **已经是**「view 声明内容、框架统一挂载」的结构层。view 不自己渲染 navSide。

问题**不是缺抽象**,而是这层抽象按 `viewId` 索引,而:

```ts
// WorkspaceInstance.tsx:74
let activeViewId = state.slotBinding.left ?? state.slotBinding.right ?? null;
```

**`activeViewId` 恒等于 left**,整个结构层不知道「槽」的存在。

⇒ 本次任务 = **给现有结构层补一个 slot 维度**,不是从零建层。

### 1.3 本次**不做**通用 ActiveResourceManager(重要)

用户与上一轮讨论的结论:

- 方向认同「把 per-slot 资源抽成通用层」,但**现在只有 Note 一个 per-slot 实现**
- 照着一个实现抽出的接口很可能是「Note 形状的」,等 eBook 接入才发现不合身
- 遵循用户既有决策「先复用后抽象」(见 memory `project-block-serialization-layering`)

**⇒ 本次只服务 Note,不抽公共层。** 等 eBook 成为第二个 per-slot 实现时再抽。
实施时若发现某段逻辑"明显该通用",**写 TODO 注释标记,不要提前抽**。

---

## 2. 实施步骤(6 步,建议一次做完)

> 为什么一次做完:3 和 5 分开会产生尴尬中间态 —— navSide 内容换到右栏了,
> 但树上点笔记还是开到左栏,比现状更让人困惑。

### 步骤 1:立 `activeSlot` 单一来源

新建(建议)`src/workspace/workspace-state/active-slot.ts`:

- 语义:**最后被用户点击/编辑的那个槽**
- 存储:**纯内存、会话级、per-wsId**。**不进 `pluginStates`,不落库**
  (重启后没有编辑焦点,回落 left 天经地义)
- 需可被 React 订阅(`useSyncExternalStore` 模式,参考 `toc-toggle-store.ts`)
- 默认值:`'left'`
- **必须提供回落保护**:right 槽被关闭时(`slotBinding.right === null`),
  activeSlot 必须回落 `'left'` —— 否则会出现「焦点指向不存在的槽」→
  树上点笔记开到虚空

**铁律**:activeSlot 是「当前槽」的**唯一**来源。高亮、命令目标、navSide 挂载
全部从它读,**不允许各算各的**。这是本次抽象的核心价值;若出现第二处
自行判断"当前是哪个槽"的代码,即为实施失败。

### 步骤 2:容器级点击捕获 → 写 activeSlot

在 `SlotArea.tsx` 的每个 slot 容器(`.krig-slot-view`)上挂点击捕获。

**必须用 DOM 容器捕获,不能用编辑器焦点** —— 理由:toolbar 按钮有
`onMouseDown={e => e.preventDefault()}`(不抢编辑器焦点),用焦点判断会漏掉
「点了那一栏的工具栏」这种情况。这个坑在 `c7720f37` 修 toggle-toc 时踩过。

**判定范围**(用户已确认「都算」):点在该 slot 容器内的**任何位置**都算激活 ——
正文、工具栏按钮、空白区(「未选择笔记」态)均可。

注意 `pos === 'hidden'` 的单元不参与(不可见,不该被激活)。

### 步骤 3:navSide 内容按 activeSlot 挂载

`WorkspaceInstance.tsx:74` 的 `activeViewId` 改为按 activeSlot 解析:

```
activeSlot === 'right' ? slotBinding.right : slotBinding.left
```

保留现有兜底:该槽为 null 时回落到另一槽,再回落到第一个有 navSideTab 的 view。

**⚠️ 高风险点**:`activeViewId` 同时驱动 **4 个交互触发器**
(`WorkspaceInstance.tsx:85-88` 的 useContextMenuTrigger / useSlashTrigger /
useHandleTrigger / useFloatingToolbarTrigger)。改它会连带影响右键菜单、
Slash、handle、浮动工具栏的 view 归属。

实施时**必须实机验证这 4 项在两栏都正常**,不能只看 navSide。
若发现触发器需要与 navSide 不同的解析,**分成两个变量**,不要强行共用。

### 步骤 4:活跃槽视觉提示(**必须与步骤 3 同期**)

用户已选定方案:**活跃栏工具栏高亮 / 非活跃栏工具栏压暗**。

- 只动 36px 工具栏条,**正文区完全不碰**
  (理由:分屏主要用途是对照阅读,压暗正文与此目的直接冲突)
- 程度:**中** —— 标题明显变灰、底色降一档
- **按钮图标一起变灰**(非活跃栏按钮点下去会先激活那栏,"半禁用"是诚实表达)
- 复用既有变量:`toolbar-frame.css` 已有 `--bg-elevated` / `--border-muted`

**为什么必须同期**:navSide 会随点击整个换掉,没有视觉提示用户无法预判
点击结果,那比不做更难用。

### 步骤 5:note 高亮 + 树操作绑定到 activeSlot

- **高亮**:navSide 笔记树的选中高亮 = 「activeSlot 那一栏的 activeNoteId」
  —— 实时派生,**不新增持久化字段**
- **树左键点笔记**:开到 activeSlot 那一栏
  (`nav-side-content.tsx:80` 和 `:134` 两处 `note-view.set-active`)

现有 `setActiveNote(wsId, noteId, slot)` 已支持 slot 参数(`4fda395b` 加的),
直接传 activeSlot 即可。

**注意**:这改变了「左键恒进左栏」的旧行为。这是用户明确要的
(见 §0 引文),不是回归。

### 步骤 6:树右键项改「在另一栏打开」

`context-menu-registrations.ts` 的 `note-view.fl-note.open-in-right`
(`674b4b9a` 新加):

- 现状:固定「在右栏打开」
- 改为:**「在另一栏打开」**,始终指向 activeSlot 的对侧
  (焦点在左 → 送右;焦点在右 → 送左)
- 理由:步骤 5 之后左键已能开到活跃栏,固定"在右栏"在焦点已是右栏时
  就成了多余的同义项;改成"另一栏"则永远有独立价值

命令 `note-view.set-active-in-right` 需相应泛化为可指定目标槽
(或新增对侧命令),实施者自行取舍,但**不要留两个语义重叠的命令**。

---

## 3. 验收标准

### 3.1 功能

| # | 操作 | 预期 |
|---|---|---|
| 1 | 点左栏正文 → 看 navSide | 呈现左栏 view 的导航;左栏工具栏高亮 |
| 2 | 点右栏正文 | navSide 换成右栏 view 的导航;高亮移到右栏 |
| 3 | 左 Note / 右 eBook,点右栏 | navSide 变成**书架**(跨 view 生效,这是主要收益) |
| 4 | 点右栏的**工具栏按钮**(非正文) | 同样激活右栏(容器捕获,非焦点) |
| 5 | 焦点在右栏 → 树上左键点另一篇 | 开在**右栏**,左栏不动 |
| 6 | 焦点在右栏 → 树上右键 | 显示「在另一栏打开」,点了送**左栏** |
| 7 | 关掉右栏 | activeSlot 回落 left,navSide 回到左栏导航 |
| 8 | 右键菜单 / Slash / handle / 浮动工具栏 | **两栏都正常**(步骤 3 高风险点) |

### 3.2 质量门槛

- `npx tsc --noEmit -p tsconfig.json` —— **不得新增错误**
  基线已有 1 条:`src/views/x-inbox/XInboxView.tsx(714,48) WebkitAppRegion`,
  与本次无关,不要试图修
- `npx vitest run` —— **625 passed 不得减少**
  基线 6 个 suite 因 Electron `app.getPath` 在 vitest 下不可用而 import 失败,
  与本次无关,属正常
- 纯 UI 行为改动,自动化测不到 —— **必须真机验证 §3.1 全部 8 项**

---

## 4. 硬约束(违反即返工)

1. **activeSlot 单一来源** —— 全仓只此一处判断"当前是哪个槽"。
   出现第二处自行推导即实施失败(这是本次抽象的全部意义)。
2. **不落库** —— activeSlot 纯内存会话级,不进 `pluginStates`。
3. **不抽通用 ActiveResourceManager** —— 见 §1.3,本次只服务 Note。
4. **不做 per-slot navSide 状态** —— 展开/排序/多选/剪贴板**保持单份共享**。
   用户已确认:navSide 单份、工作区级(PROTOCOL.md §1.5 原则 2)。
   只有「指针」跟随焦点,「样子」共享。
5. **不碰正文区视觉** —— 视觉提示只动工具栏(§2 步骤 4)。
6. **fail loud** —— 解析不出 activeSlot 时 `console.error`,不静默兜底
   (用户铁律,见 memory `feedback-fail-loud-no-fallback`)。
7. **不重算 hash / 不加静默 fallback** —— 通用铁律。

---

## 5. 已知风险与坑

| 风险 | 说明 |
|---|---|
| **`activeViewId` 一改牵动 4 个触发器** | §2 步骤 3。必须实机验右键/Slash/handle/浮动工具栏 |
| **navSide 会比现在"跳"得频繁** | 以前只在切主 view 时变,以后点另一栏就变。这是定义的正确行为;若试用后觉得太跳,**先报告用户再改**,不要自行加"只跟随同类 view"的条件判断(那正违背本次减少条件分支的初衷) |
| **模块级单例前提** | `renameTrigger`(`context-menu-registrations.ts:19`)等 4 处单例的正确性建立在「navSide 只有一个」上。本次**保持单份**故安全;**切勿**顺手改成每槽一份 |
| **toolbar 按钮 preventDefault** | 不抢焦点,所以焦点判断不可靠 —— 必须用容器捕获 |

---

## 6. 关键文件地图

| 文件 | 作用 |
|---|---|
| `src/workspace/workspace-instance/WorkspaceInstance.tsx:74-88` | `activeViewId` 解析 + 4 触发器挂载(**震中**) |
| `src/workspace/workspace-instance/slot-area/SlotArea.tsx` | slot 容器渲染,点击捕获挂这里 |
| `src/slot/frame-bindings/NavSideBinding.tsx` | navSide 内容渲染(按 viewId) |
| `src/slot/toolbar-registry/toolbar-invocation.ts` | 已有的「命令由哪个槽触发」上下文,可参考其模式 |
| `src/views/note/data-model.ts` | `setActiveNote(wsId, noteId, slot)` / `noteInstanceId` / `noteScopeKey` |
| `src/views/note/nav-side-content.tsx:80,134` | 树左键 → `note-view.set-active` |
| `src/views/note/context-menu-registrations.ts` | 树右键项(步骤 6) |
| `src/workspace/workspace-instance/toolbar-frame/toolbar-frame.css` | 工具栏样式(步骤 4) |
| `src/slot/workspace-bus/PROTOCOL.md` §1.5 | **对称性原则,本次宪法** |

---

## 7. 交付

- 建议 **2-3 个 commit**:①activeSlot + 点击捕获 ②navSide 挂载 + 视觉 ③树绑定 + 右键项
- commit message 用中文,说明**根因与取舍**,不只列改动
- 完成后需回报:§3.1 八项的真机验证结果(逐项),以及 tsc / vitest 实际输出
- **如实报告**:哪项没验、哪项不通过,都要明说;不要报"应该没问题"
