# 全仓要不要都改成 `src/modules/<x>/`？

> 用户 2026-09-30 提问：
> 「目前的 view 架构都是这样，但是我更建议是迁移成 src/modules/x/ 这样的组织，
> 　也就是说未来是否所有的模块都努力做大松耦合，可卸载才更好？」

⭐ 先说结论：**方向对，但现状比想象的好得多 —— 别急着搬家。**

---

## 一、实测：现在耦合到什么程度

⚠️ 下面每个数都是量出来的，不是读代码推断的。

### ⭐⭐ 跨 view 引用 = **0**

```
note · ebook · web · graph-canvas-view · thought · mail · ai   （7 个 view）
之间互相 import 的次数：0
```

唯一命中的 2 处是**注释**（`web-bookmark-commands.ts:7` 写「仿 ebook/bookshelf-commands.ts」、
`nav-side-content.tsx:16` 写「范本：note/nav-side-content.tsx:166」）—— 引用的是范本出处，不是代码依赖。

### ⭐⭐ view 已经是**自注册**的

`renderer/index.tsx` 第 86–95 行：

```ts
import '@views/note';   // L5-A:NoteView self-register(触发 viewType / commands / NavSide 注册)
import '@views/web';    // L5-B4
import '@views/ebook';  // L5-C1
import '@views/ai';
import '@views/mail';
import '@views/graph-canvas-view';
import '@views/thought';
```

**这已经就是你想要的「一行注册」。** 删掉那一行，view 就不挂了。

### 没有 X 那种「巨型 handler」

| 模块 | main 侧最大文件 |
|---|---|
| note | `capability-impl.ts` 1162 行 |
| ebook | `capability-impl.ts` 859 行 |
| graph | `canvas-store.ts` 685 行 |

对比 X 当年：**一个 `x-timeline-handlers.ts` 1516 行、48 个 IPC、import 21 个模块**。
⭐ 别的模块没有这个形态 —— **X 的病不是「横向分层」造成的**，是那个巨型 handler 造成的。

---

## 二、⚠️ 那为什么 X 拔不掉，别的模块看起来还好？

因为这**两件事根本不同**：

| | X | 其他模块 |
|---|---|---|
| main 侧 | 1 个 handler 焊死 48 个 IPC + 21 个 import | 按能力分文件 |
| 通道表 | **62 条**挤在全局 `channel-names.ts` | 各自少量 |
| preload | 11 个方法 + `xTimeline` 整个命名空间对象 | 少量 |
| 删 UI 之后 | **底层一个模块都没掉** | —— |

⭐ 所以 **X 是特例，不是「views 架构」的通病**。
把全仓搬成 `modules/` 并不能治 X 的病（那是 handler 的病），
反过来，X 治好了也不证明别的模块需要搬家。

---

## 三、⭐ 真正的缺口只有一个：commands 还要**两行**

`renderer/index.tsx` 现在是这样：

```ts
// 第 38-46 行：具名 import（8 个）
import { registerNoteCommands } from '@views/note/note-commands';
import { registerEBookCommands } from '@views/ebook/bookshelf-commands';
...
// 第 108-115 行：再显式调一次（8 次）
registerNoteCommands(rendererWsId);
registerEBookCommands(rendererWsId);
...
```

→ **卸载一个模块要删两处**（import 一行 + 调用一行），而 view 只要删一行。

⭐⭐ **这才是唯一值得动的地方**，而且它与「要不要搬目录」**完全无关**：
让 commands 也走 view 那套自注册即可，改动量是一个模块两行。

---

## 四、建议：不搬家，补三件事

⭐ 判据不是「目录长什么样」，而是**「删掉它要动几处」**。
目录结构是手段，装卸性才是目的 —— 现在手段已经基本达标了。

### ✅ 已做完（2026-09-30）

**① commands 改自注册**（commit 9156164f）
`ViewDefinition` 加 `commands?: (wsId) => void`，registry **只收不跑**，
renderer 在 `onMyWsIdReady` 里调一次 `runViewCommandRegistrars(wsId)`。

⚠️ 它当初没跟 view 一起自注册**不是疏忽**：命令注册要本窗口真 wsId，
多窗口下不能用 `snapshot.activeId` 顶替（新窗口会拿到 ws-1，命令注册到别人头上）。
所以做成「登记与执行分开」，而不是纯副作用 import。

⭐⭐ 两种注册顺序都不漏：wsId 先到时，晚注册的 view 当场补跑 ——
因为 `onMyWsIdReady` 是**一次性**的（`use-workspace.ts:41`），
只在那一刻跑一遍的话，之后注册的 view 命令会**静默没有**且不报错。

**② 守卫泛化到 7 个模块**（commit 8fa6daef）
`tests/modules/module-detachable.test.ts`，判据：目录之外认识它 ≤ 1。
顺带把 note 最后一处接线（`initNoteBaseSnapshotSync`）收回自注册。

### ⭐ 结果：7 个模块全部 = 1 处

| 模块 | 被外部认识 | 引用别的 view |
|---|---|---|
| note · web · ebook · ai · mail · graph-canvas-view · thought | **各 1 处**（renderer 的 self-register） | **0** |

非破坏性验证（以 mail 为例）：入 1 处、出 0 处。

⭐⭐ 守卫第二条断言「那一处必须是 renderer」**不是多余的**：
实测注入「把 thought 的 self-register 从 renderer 挪到 note/index.ts」，
**总数仍是 1**、第一条照样绿，只有这条红 ——
**数字达标不代表没耦合，得看耦在谁身上。**

### ⏸️ 原建议做（已完成，保留原文供对照）

1. **commands 改自注册** —— 让「删一行」对所有模块都成立（现在只有 view 成立）
2. **把可装卸守卫泛化** —— 现在 `x-module-detachable.test.ts` 只钉 X，
   把它改成「每个模块被外部认识的处数 ≤ 1」，一次覆盖 7 个模块
3. **X 用新形态建**（`src/modules/x/`）—— ⭐ 它是唯一从零开始的，
   **拿它当试点零成本**，验证 modules/ 形态好不好用，再决定要不要推广

### ⏸️ 建议先别做（代价高、收益不明）

**把 note / ebook / mail / thought 搬进 `modules/`。**

实测搬家成本：

| 模块 | 要搬的文件 | 要改的 import |
|---|---|---|
| note | 49 | **30 处** |
| ebook | 43 | 15 处 |
| thought | 25 | 9 处 |
| mail | 19 | 4 处 |

⚠️ 合计 **136 个文件、58 处 import**，而**换来的装卸性提升 = 0**
（跨 view 耦合本来就是 0，view 本来就自注册）。

⭐ 这正是 [[project-module-boundary-governance]] 记的那条：
**优先架构纯度，不优先改动量** —— 反过来说，
**改动量大而纯度不变的搬家，不该排在前面**。

---

## 五、⚠️ 搬家真正的风险（不是工作量）

1. **副作用 import 看不见** —— `import '@views/note'` 这类 tsc 查不出来，
   搬家时漏改一条，编译全绿、运行时白屏（删 X 时**炸过两次**）
2. **一次动 136 个文件，出事没法二分** —— 而本仓已有 6 个测试文件
   处于加载失败状态，基线本身不干净
3. ⭐ **收益要能说清楚**：「更整齐」不是判据，
   「删掉它要动几处」才是 —— 而这个数**搬家前后一样**

---

## 六、如果将来确实要搬，正确的顺序

⭐ 不要一次搬完。**按模块逐个搬，每搬一个先让守卫变红再变绿**：

```
① 先补守卫（模块被外部认识 ≤ 1）      ← 此时全仓红，看清真实欠账
② 修到全绿（不搬家，只改注册方式）      ← 装卸性达标
③ 挑一个最小的模块（mail，19 文件/4 处）试搬
④ 真删一次验证，再决定要不要搬第二个
```

⚠️ 反过来（先搬家后补守卫）会重蹈覆辙：
守卫建立时已有一堆违规，只能进 `KNOWN_DEBT`，而**本仓的 KNOWN_DEBT 从来没被清掉过**。
