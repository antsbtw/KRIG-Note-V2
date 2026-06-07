# Keyboard System — 块键盘行为抽象 + 集中模块设计蓝图

> **状态**：抽象设计蓝图（2026-06-07）。本文档是「先定义 → **再抽象** → 最后优化」三步里的**第二步成果**。
> **定位**：在 [`enter-system.md`](./enter-system.md)（回车逐 block 定义）+ [`backspace-system.md`](./backspace-system.md)
> （退格逐 block 定义）**之上**做合并抽象，并给出「把分散在各文件的 Enter/Backspace 逻辑汇聚到一个模块」的蓝图。
> 逐 block 的事实定义仍以那两份为准；本文档负责**统一模型 + 收敛设计**。
> **本文档纯设计，零代码。** 实现（第二步「汇聚」、第三步「优化」）按本蓝图推进。

---

## 推进三步（用户拍板顺序）

1. **逐 block 定义** ✅ 已完成（enter-system.md / backspace-system.md）。
2. **抽象**（本文档）：合并 Enter+Backspace 语义 → 统一模型 + 集中模块设计。
3. **汇聚**：按本蓝图，把目前分散在 10+ 个文件的 Enter/Backspace 处理收敛到**一个模块/函数**。
4. **优化迭代**：在统一模块上按文档要求改行为 / 修 bug / 加规则（一处改，全局一致）。

> 必须**先汇聚再优化**：现状逻辑散在各 block keymap + baseKeymap 兜底，逐处改易漏、易不一致
> （已踩过此坑）。收敛到一处后，所有行为调整在单点完成。

---

## 一、统一心智模型

把编辑器看成**嵌套的「层级栈」**。任意光标位置，从外到内是一串容器层：

```
note（顶级）
  └─ 容器层（blockquote / callout / toggle / column / tableCell …）  ← 可多层嵌套
       └─ 块（paragraph / heading / listItem / codeBlock / caption …）
            └─ 行内（文字 / 光标）
```

**两条公理**（Enter 与 Backspace 都建立在其上）：

- **公理 A — 容器即小 note**：每个容器内部是一个**完整的小 note**，块级键盘行为（Enter/Backspace）在
  容器内部**原样递归适用**，就跟在顶级 note 里一样。容器边界 = 该小 note 的「顶级」。
  - 例外标记：**tableCell 是「封闭小 note」**——内部递归适用，但**边界是硬墙，不可退出**（见公理 B）。
- **公理 B — 边界穿越方向**：
  - **Enter** 在小 note 顶级「再回车」→ **向外/向后**新建（跳出容器，在容器后建块）。
  - **Backspace** 在小 note 顶级「再退格」→ **向外/向前**脱出（退出容器，把块提到容器前/上方）。
  - **tableCell 例外**：两个方向都被硬墙挡住——cell 内 Enter 不跳出 cell、Backspace 不退出 cell。

> 一句话：**Enter 向后展开、Backspace 向前收拢；容器可穿越（进出对称），cell 是硬墙。**

---

## 二、光标位置归一化（两键共用的输入）

任意键盘事件，先归一成 4 个事实，后续语义全由它们决定：

| 事实 | 含义 |
|------|------|
| `atBlockStart` | 光标是否在当前块的起点（行首） |
| `atBlockEnd` | 光标是否在当前块的终点（行尾） |
| `isEmptyBlock` | 当前块是否空 |
| `blockType` + `ancestors[]` | 当前块类型 + 从内到外的容器层栈（含各层 indent、是否首/尾子、是否 isolating-cell） |

> 选区非折叠（有选中）时：Enter=replaceSelection 后再按规则；Backspace=deleteSelection（含选中原子块→删块）。
> 下文均指**折叠光标**的核心情形。

---

## 三、语义动作集（Enter / Backspace 共享的原子操作）

两套行为最终都归结为这组**原子语义动作**。集中模块只需实现这些动作 + 一条决策链：

| 动作 | 说明 | 用于 |
|------|------|------|
| `splitBlock(inheritFormat)` | 拆当前块，新块继承格式（indent/textIndent/align） | Enter |
| `insertSiblingAfter(type, inheritIndent)` | 在当前块后插同级块（如 toggle 后建 toggle） | Enter |
| `exitContainerForward` | 跳出容器，在容器**后**建正文段 | Enter（容器/ caption 顶级） |
| `softBreak` | 块内插换行不拆块（`\n` / hardBreak） | Enter（代码块）/ Shift-Enter |
| `demoteFormat` | 脱一层格式外壳：标题→正文 / 列表项→正文 / indent−1 | Backspace（脱壳第 1 步） |
| `liftAlign` | 上提对齐到上一级（空行换层级，**不合并**） | Backspace（脱壳后第 2 步） |
| `exitContainerBackward` | 退出容器，把块提到容器**前/上方**（逐块，空容器解散） | Backspace（容器顶级） |
| `mergePrev` | 与上一块合并（joinBackward） | Backspace（顶级朴素正文段） |
| `deleteAtom` | 删原子块（仅 NodeSelection / handle，**非** caption 退格） | Backspace |
| `noop` | 吃掉键、不动（保护 / 硬墙） | isTitle 保护 / cell 边界 |

---

## 四、两键的决策链（核心抽象）

### 4.1 Enter 决策链（向后展开）

光标折叠时，按块类型 + 位置：

1. **代码块内** → `softBreak`（插 `\n`）；末尾且末字符已是 `\n` → `exitContainerForward`（双回车跳出，删空块）。
2. **caption（单段）内** → 光标后内容切出 → `exitContainerForward`（块下方新正文段）。
3. **收起 toggle 标题行** → `insertSiblingAfter(toggle, inheritIndent)`。
4. **容器/小 note 内空段（在该层顶级）** → `exitContainerForward`（跳出该层容器）。
5. **listItem 空项** → 退出列表（= 容器版 exit）；非空 → `splitBlock`（新项继承 indent）。
6. **普通 textblock**：`splitBlock(inheritFormat)`；标题块尾 → 新块为**正文段**（不延续标题）。

> Enter 的「继承格式」「跳出容器」与 Backspace 的「脱壳」「退出容器」是同一组层级动作的**镜像**。

### 4.2 Backspace 决策链（向前收拢 —— 即 backspace-system §2.0 优先级链）

光标在**块首 / 空块**时，从高到低**每次只走一步**：

1. **isTitle 文档标题** → `noop`（保护，不删不合并）。
2. **媒体 caption 内**（非 NodeSelection）→ 删字符；caption 空后 → 光标移出到块上方（**不删块**）。
3. **当前块 indent>0** → `demoteFormat`（indent−1）。
4. **当前块是标题** → `demoteFormat`（heading→paragraph，保留文字；下次退格再继续）。
5. **当前块是列表项** → 退出列表变正文段（容器版 demote）。
6. **在容器内、已到该层顶级**：
   - 普通容器（blockquote/callout/toggle/column）→ `exitContainerBackward`（逐块提出；空容器解散）。
   - **tableCell** → `noop`（硬墙，不退出、不跨 cell、不删表格）。
7. **已是顶级朴素正文段** → `mergePrev`（与上一块合并）。

> 「上提对齐 `liftAlign`」是 6 在多层嵌套时的中间态：未到最外层前，每退一步是换层级对齐，不是合并。
> 合并（`mergePrev`）只在**最外层顶级**才发生。

---

## 五、集中模块设计蓝图（第二步「汇聚」用）

### 5.1 目标

把现状**分散的 Enter/Backspace 处理**（见两份文档附录：toggle/column/image/html/math-visual 各自
keymap、build-list-keymap、build-code-block-keymap、build-split-indent-keymap、baseKeymap 兜底）
**收敛到单一模块**，统一装载一组 keymap。

### 5.2 建议形态

```
src/drivers/text-editing-driver/keyboard/
  resolve-context.ts     // 光标 → §二 的 4 个事实 + ancestors 栈
  semantic-actions.ts    // §三 的原子动作实现（split/exit/demote/lift/merge/...）
  enter-decision.ts      // §4.1 决策链
  backspace-decision.ts  // §4.2 决策链（优先级链）
  build-keyboard-keymap.ts  // 装一组 { Enter, Shift-Enter, Backspace }，内部走决策链
```

- editor-view-builder 只装 **`buildKeyboardKeymap()`** 一个（替代现状散落的多个 Enter/Backspace keymap）。
- 各 block 不再各写 keymap.ts 的 Enter/Backspace；**块差异通过「块类型 + spec 元数据」在决策链里分支**
  （而非每块一个 plugin）。
- 仍可保留少量「纯 UI」例外（math-inline 弹窗、placeholder URL 输入框 —— 走原生 DOM，与文档流正交，不收编）。

### 5.3 可选：声明式 spec 元数据

决策链需要的「块特性」可在 BlockSpec 声明，减少决策链里硬编码 block 名：

| 元数据 | 含义 | 谁用 |
|--------|------|------|
| `isContainer` | 内部是小 note（递归 + 可穿越边界） | 公理 A / exit 动作 |
| `isCellLike` | 小 note 但硬墙不可退出 | tableCell |
| `isCaption` | 单段 caption（Enter 跳出 / Backspace 不删块） | image/html/math-visual/audio/video/tweet |
| `isCodeArea` | 内部代码区（Enter=softBreak，双回车跳出） | codeBlock / math-block |
| `isAtomCard` | 原子卡片（仅选中/handle 删块） | hr/file-block/external-ref |
| `protectStart` | 块首退格保护（不删不合并） | isTitle |
| `formatAttrs` | 拆块/退格继承的格式 attr 列表 | paragraph/heading: [indent,textIndent,align] |

> 有了这层声明，决策链对绝大多数 block 是**数据驱动**的，新增 block 只声明元数据即自动获得正确键盘行为。

---

## 六、收编对照表（现状分散 → 汇聚后）

| 现状（分散） | 汇聚后归属 |
|-------------|-----------|
| blocks/toggle-list/keymap.ts（Enter 收起态） | enter-decision §4.1 步 3（insertSiblingAfter）+ spec `isContainer` |
| blocks/column-list/keymap.ts（Enter 退出 / Backspace 删空列） | enter §4.1 步 4 / backspace §4.2 步 6（exitContainer）+ `isContainer` |
| blocks/image・html-block・math-visual/keymap.ts（caption Enter） | enter §4.1 步 2 + spec `isCaption` |
| build-list-keymap.ts（splitListItem） | enter §4.1 步 5 + backspace §4.2 步 5 |
| build-code-block-keymap.ts（Enter/Backspace） | enter §4.1 步 1 + backspace §2.4 + spec `isCodeArea` |
| build-split-indent-keymap.ts（Enter 继承 indent） | 并入 `splitBlock(inheritFormat)` |
| build-hard-break-keymap.ts（Shift-Enter） | semantic `softBreak` |
| baseKeymap 的 Enter/Backspace 兜底 | 决策链末步（splitBlock / mergePrev）显式接管 |
| audio/video/tweet 缺 keymap → caption 回车删块 **bug** | 收编即修复（统一走 isCaption 分支） |
| 容器首块退格「退不出容器」**缺陷** | 收编即修复（exitContainerBackward 绕过 isolating） |

> 汇聚本身顺带消除两处已知缺陷（caption 回车删块、退不出容器），无需单独打补丁。

---

## 七、待迭代点（第三步优化时处理）

- `liftAlign`（多层嵌套上提对齐）的精确实现：跨容器层时光标 / 选区的落点。
- isolating 容器的 `exitContainerBackward`：需自定义命令绕过 PM 默认 joinBackward 被挡的问题。
- 继承格式 `formatAttrs` 是否随块类型可配（如 heading 是否继承 align）。
- Delete 键 / Mod-Backspace：当前全无定义，是否纳入同一模块。
