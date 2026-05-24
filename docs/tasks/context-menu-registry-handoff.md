# L4 右键体系重构(contextInfoProviderRegistry)+ PDF 标注右键接入 + 文字流高亮

## 背景

2026-05-24 推 PR `feature/pdf-annotation-as-thought`(3 commit,已合 main)时,
讨论 PDF 标注右键加思考 / 改颜色 / 删除等菜单时,发现**现有 L4 右键体系硬编码业务字段**,
违反分层原则。用户拍板:**走方案 A — 完整重构 L4 右键体系为注册式**,
为长期产品打底,**不接受任何硬编码债务**。

## 用户拍板规则(本文档核心,违反我会回滚)

1. **严格遵循分层原则** — L4 不知道任何 view / capability 业务概念
2. **严格遵循注册原则** — view / capability 通过 register API 贡献检测逻辑
3. **不引入新的硬编码** — 即使是"小一行"
4. **不破回归** — 既有 5 个 view(note / thought / ebook / web / canvas)右键全套菜单
   行为 100% 不变
5. **拆 PR 推进** — α-1 重构 + 既有迁移 / α-2 ebook 接入 / α-3 文字流高亮,
   每个 PR 独立验证 + commit + merge

---

## 现状(2026-05-24 PR1 后)

### L4 右键体系:`src/slot/triggers/use-context-menu-trigger.ts`

字面违反分层的代码:

```ts
// line 63: L4 字面知道 "thought-id" / "thought-block-id" 业务概念
const thoughtEl = target?.closest('[data-thought-id], [data-thought-block-id]');
const thoughtId =
  thoughtEl?.getAttribute('data-thought-id') ??
  thoughtEl?.getAttribute('data-thought-block-id') ??
  null;

// line 73: L4 字面 import text-editing capability 拿 pmInstanceId
const textEditing = getCapabilityApi<TextEditingApi>('text-editing');
const pmInstanceId = textEditing?.instanceRegistry.getFocusedInstanceId() ?? null;

// line 48-51: L4 字面知道 link 概念
const inLinkDom = !!target?.closest('a[href]');
const inLinkSel = !!selPayload?.activeMarks?.includes('link');
```

### ContextInfo 类型:`context-menu-types.ts`

字面把业务字段写进 L4 类型:

```ts
export interface ContextInfo {
  hasSelection, isEditable,  // 通用
  hasLink, hasMarks, hasBlockSelection,  // text-editing 业务
  thoughtId,  // thought capability 业务
  pmInstanceId,  // text-editing 业务
  x, y,  // 通用
}
```

### EnabledWhen 枚举:同上文件

```ts
type EnabledWhen =
  | 'always' | 'has-selection' | 'is-editable'  // 通用
  | 'has-link' | 'has-marks' | 'has-block-selection'  // text-editing 业务
  | 'has-thought';  // thought 业务
```

---

## 目标架构(方案 A)

### 核心:两个新 L4 Registry

```ts
// 1. ContextInfo 字段贡献者
contextInfoProviderRegistry.register({
  id: 'text-editing',
  provider: (target: HTMLElement, baseCtx: BaseContextInfo) => ({
    hasLink: target.closest('a[href]') !== null
      || selection.api.getCurrent()?.activeMarks?.includes('link'),
    hasMarks: !!selection.api.getCurrent()?.activeMarks?.length,
    hasBlockSelection: ['block', 'multi-block'].includes(
      selection.api.getCurrent()?.kind ?? ''
    ),
    pmInstanceId: getCapabilityApi<TextEditingApi>('text-editing')
      ?.instanceRegistry.getFocusedInstanceId() ?? null,
  }),
});

contextInfoProviderRegistry.register({
  id: 'thought',
  provider: (target) => {
    const el = target.closest('[data-thought-id], [data-thought-block-id]');
    return {
      thoughtId: el?.getAttribute('data-thought-id')
              ?? el?.getAttribute('data-thought-block-id') ?? null,
    };
  },
});

contextInfoProviderRegistry.register({
  id: 'ebook',
  provider: (target) => ({
    pdfAnnotationId: target.closest('[data-pdf-annotation-id]')
      ?.getAttribute('data-pdf-annotation-id') ?? null,
  }),
});

// 2. EnabledWhen 谓词贡献者
enabledWhenRegistry.register('has-link', (ctx) => !!ctx.custom.hasLink);
enabledWhenRegistry.register('has-thought', (ctx) => !!ctx.custom.thoughtId);
enabledWhenRegistry.register('has-pdf-annotation', (ctx) => !!ctx.custom.pdfAnnotationId);
// ... 等
```

### ContextInfo 结构重构

```ts
interface BaseContextInfo {
  hasSelection: boolean;   // 通用 — DOM Selection
  isEditable: boolean;     // 通用 — target.isContentEditable
  x: number;
  y: number;
}

interface ContextInfo extends BaseContextInfo {
  /** 各 capability/view 注册的 provider 贡献的自定义字段 */
  custom: Record<string, unknown>;
}
```

业务字段不再是 ContextInfo 顶层属性,**全部进 custom**。

### EnabledWhen 不再是固定枚举

字面变 `type EnabledWhen = string`,L4 不知道有哪些值,
由 enabledWhenRegistry 提供 predicate 判定。registry 找不到对应 predicate 时,
fallback 到通用 enabledWhen('always' / 'has-selection' / 'is-editable')。

### use-context-menu-trigger 改造

```ts
// 1. 收集所有 provider 的输出合并到 custom
const custom: Record<string, unknown> = {};
for (const p of contextInfoProviderRegistry.all()) {
  Object.assign(custom, p.provider(target, baseCtx));
}

// 2. ContextInfo 组装
const context: ContextInfo = {
  hasSelection, isEditable, x, y,
  custom,
};

// 3. filter items 用 enabledWhenRegistry 判定
const items = contextMenuRegistry.getItemsForContext(viewId, context);
// 内部:enabledWhen 走 enabledWhenRegistry.eval(name, context)
```

---

## 现状字段迁移清单(PR-α-1 必须全部迁完)

### 现有 ContextInfo 字段 → custom 字段

| 现有顶层字段 | 迁到 | provider |
|---|---|---|
| `thoughtId` | `custom.thoughtId` | thought capability |
| `pmInstanceId` | `custom.pmInstanceId` | text-editing capability |
| `hasLink` | `custom.hasLink` | text-editing capability |
| `hasMarks` | `custom.hasMarks` | text-editing capability |
| `hasBlockSelection` | `custom.hasBlockSelection` | text-editing capability |
| `hasSelection` | **保留顶层**(通用 DOM 概念) | base |
| `isEditable` | **保留顶层**(通用 DOM 概念) | base |
| `x` / `y` | **保留顶层** | base |

### 现有 EnabledWhen → enabledWhenRegistry

| 现有 enabledWhen | 注册方 | predicate |
|---|---|---|
| `always` | L4 builtin | () => true |
| `has-selection` | L4 builtin | ctx => ctx.hasSelection |
| `is-editable` | L4 builtin | ctx => ctx.isEditable |
| `has-link` | text-editing capability | ctx => !!ctx.custom.hasLink |
| `has-marks` | text-editing capability | ctx => !!ctx.custom.hasMarks |
| `has-block-selection` | text-editing capability | ctx => !!ctx.custom.hasBlockSelection |
| `has-thought` | thought capability | ctx => !!ctx.custom.thoughtId |
| `has-pdf-annotation`(新) | ebook view | ctx => !!ctx.custom.pdfAnnotationId |

### 现有命令消费 controller.context.thoughtId 等的位置

需 grep 所有 `controller.context.thoughtId` / `controller.context.pmInstanceId` 等,
改为 `controller.context.custom.thoughtId` 等。

预估改动点:
- `src/views/thought/thought-commands.ts` (delete-thought-at-cursor)
- `src/views/thought/command-impl/add-from-note.ts` (pmInstanceId)
- `src/views/thought/command-impl/ask-ai.ts` (pmInstanceId)
- `src/capabilities/text-editing/ui/context-menu/items.ts` (各种命令)
- 其他 grep 找

---

## PR 拆分

### PR-α-1:L4 重构 + 既有字段迁移

**目标**:L4 体系换底,**行为 100% 不变**,既有 5 view 右键测试全部 PASS。

**改动**:
1. 新增 `src/slot/interaction-registries/context-info-provider-registry.ts`
2. 新增 `src/slot/interaction-registries/enabled-when-registry.ts`
3. 重构 `src/slot/triggers/use-context-menu-trigger.ts` 走 registry
4. 重构 `src/slot/interaction-registries/context-menu-registry/context-menu-types.ts`
   (ContextInfo / EnabledWhen 类型变)
5. 重构 `src/slot/interaction-registries/context-menu-registry/context-menu-registry.ts`
   (getItemsForContext 内 enabledWhen 走 enabledWhenRegistry.eval)
6. **各 capability 注册 provider + enabledWhen predicate**:
   - text-editing capability(注册 hasLink/hasMarks/hasBlockSelection/pmInstanceId provider + 3 predicate)
   - thought capability(注册 thoughtId provider + has-thought predicate)
7. **命令消费 controller.context.xxx 全部迁** custom.xxx

**测试范围**:
- Note view 右键(剪贴板组 / 移除链接 / 移除格式 / 查词 / 翻译 / 框定 / 删除 Block / 加思考 / 问 AI / 删除 Thought)
- Thought view 右键(类似 Note)
- Web view 右键
- Canvas view 右键(若有)
- 现有 ebook view 右键(标注右键删除)

**预估**:~430 行,~5 文件新增 + ~10 文件改

---

### PR-α-2:ebook 标注右键接入

**目标**:▢ 行为回退 + ebook 注册 provider + 菜单 6 项 + 命令实现。

**改动**:
1. **▢ 行为回退**:`EBookView.handlePdfAnnotationCreate` 不再自动调
   `thought-view.add-from-pdf-annotation`(创建后不开右槽,等右键)
2. **AnnotationLayer**:已有标注 div 加 `data-pdf-annotation-id={ann.id}`
3. **ebook view 注册 provider**:`contextInfoProviderRegistry.register({ id: 'ebook',
   provider: (target) => ({ pdfAnnotationId: ... }) })`
4. **ebook view 注册 enabledWhen**:`enabledWhenRegistry.register('has-pdf-annotation',
   ctx => !!ctx.custom.pdfAnnotationId)`
5. **菜单 6 项注册**(`src/views/ebook/context-menu-content.ts` 新文件):
   - `💭 加思考`(已实现命令 `thought-view.add-from-pdf-annotation`)
   - `🤖 问 AI`(占位 stub:toast "本期未实现,待 AIView 支持 image input")
   - `🎨 改颜色`(submenu:USER_THOUGHT_TYPES 5 色,调
     `thought-view.change-type`)
   - `🗑 删除标注`(等价于现有右键直接删 — 走 `thought-view.delete-thought`)
   - `📸 截图复制`(把 BookLocator.thumbnail base64 写剪贴板)
   - `📖 查词` / `🌐 翻译`(占位 stub:PDF 无 text selection,待 PR-α-3)
6. **新命令实现**:
   - `ebook-view.copy-annotation-screenshot` 写剪贴板
   - `ebook-view.ask-ai-from-annotation`(占位)
7. **删 AnnotationLayer 内现有 onContextMenu 删除路径**(右键菜单接管)

**预估**:~200 行

---

### PR-α-3:文字流高亮(B 类:Apple Preview 模式)

**目标**:新增 PDF 文字流高亮(highlight / underline / strikethrough)。

**改动**:
1. **PDFRenderer 扩 API**:监听 textLayer 选区 → emit `{ pageNum, textRects, textContent }`
2. **EBookHostHandle 扩**:`onPdfTextSelected(callback)`
3. **EBookView 接收 textSelection** → 弹 picker(5 色 + Underline + Strikethrough)
4. **picker 组件**(对齐 EpubAnnotationPicker 样式)
5. **BookLocator schema 扩**:加 `textRects?: Array<{x,y,w,h,pageNum}>` 字段
6. **markStyle 取值扩**:`'highlight' | 'strikethrough'`(已在 schema 字面允许)
7. **AnnotationLayer 渲染**:
   - `markStyle='highlight'`:按 textRects 逐矩形画 div(背景色 半透明)
   - `markStyle='strikethrough'`:同上但只画 rect 中线
   - `markStyle='underline'`:同上但只画 rect 底线
8. **usePdfAnnotations.createFromTextSelection** 新 entry
9. **PR-α-2 占位 stub 实化**:📖 查词 / 🌐 翻译 接 learning capability,用 textContent 调

**预估**:~350 行

---

## 严格执行约束(再次强调)

1. **L4 不知道任何业务字段名** — 唯一例外:base 字段 `hasSelection / isEditable / x / y`
2. **provider 顺序无依赖** — 各 capability 独立注册,合并到 custom
3. **provider 名字冲突 = 后注册覆盖**(documented),不报错
4. **migration 期同时支持新旧 ContextInfo 字段?** — **不支持**,一次性切换。
   既有命令消费方一次性改完才能 commit。**这是分层重构,中间状态不发布**
5. **EnabledWhen 找不到 predicate** → 字面 fallback `() => true`(开放,不报错),
   但 warning console.log(便于发现注册遗漏)
6. **每个 PR 必须独立可测** — α-1 PASS 才开 α-2,α-2 PASS 才开 α-3
7. **每个 PR 测试范围必须含 5 view 现有右键不破回归**

---

## 启动 prompt(给新对话用)

```
请读 docs/tasks/context-menu-registry-handoff.md 完整理解任务背景。

我们要做的是 L4 右键体系重构(方案 A 完整版),分 3 个 PR 推进:
PR-α-1 重构 → PR-α-2 ebook 接入 → PR-α-3 文字流高亮。

**本次会话只做 PR-α-1**(L4 重构 + 既有字段迁移)。

**严格遵守**:
- 分层原则(L4 不知道业务字段)
- 注册原则(view/capability 通过 register API 贡献)
- 不引入新硬编码(连"小一行"都不行)
- 不破回归(5 view 现有右键 100% 行为不变)

**实施前必须**:
1. 读完 handoff 文档 + 相关现有代码(use-context-menu-trigger.ts +
   context-menu-types.ts + context-menu-registry.ts + 5 view 的 context-menu-*.ts)
2. 跟我确认 PR-α-1 详细实施计划(provider/registry API 签名 / migration 顺序)
3. 不要立刻动手 — 先讨论 + 拍板

**实施期间**:
- 严格按 [[strict-compliance-workflow]] 工作流
- 每改一个文件 tsc check 一次,避免堆积错
- 既有命令消费 controller.context.xxx 的位置必须 grep 全找到
- migration 是 atomic — 全部改完才能 commit,中间不可工作的状态不 commit

**测试要求**:
- 5 view 右键测试用例由我提供(实施完后我手动测)
- 不破回归才 commit

CWD:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`(V2 漂移已 7 次教训,
每个 Bash 必 cd /...V2 + Read 用绝对路径)
```

---

## 相关记忆 / 文档

- `[[strict-compliance-workflow]]` — 严格态工作流(4 条纪律)
- `[[v2-is-workspace-v1-is-reference]]` — V2 cwd 漂移防御
- `[[diag-log-before-speculation]]` — 跨模块 bug 先 log 再说
- `[[merge-requires-explicit-ok]]` — commit/merge 独立授权
- `[[branch-module-boundary]]` — 分支按模块切,中间多 commit 不合 main
- `[[layered-refactor-charter]]` — 分层重构总纲
- `[[navside-arch-debt]]` — 类似的"view 跨界改 app 状态"债务案例
- `src/slot/DESIGN.md` — slot 层架构总述
- `src/views/README.md` — view 注册 contextMenu 范例

---

## 已合 main 的依赖代码(本任务基于这些之上)

- `4a596f69` feat(ebook+thought): PDF 框选标注一体化 thought + 颜色=类型 + 跳源高亮
- `0eaafe73` refactor(ebook): 解耦 isFullscreen 与 navSideCollapsed(职责分层)
- `2e172686` feat(thought): PDF anchor 截图进 doc 第一行 image + anchor 区改页码

---

## 历史背景

2026-05-22 用户曾做过 L2 全屏 overlay(`aecaf845`),次日 5/23 因"双实例同步漂移"
拆掉简化(`e8d192af` 把 navSideCollapsed 当 isFullscreen 用)。

2026-05-24 用户重新拍板:不接受"为了简化而违反分层"的债务设计。本任务是
对那次拆掉重新走"正确架构"的修正方向之一(右键体系)。

**核心精神**:即使代价是改动量大、PR 拆多次,也要走正确的架构 — 因为这是
长期产品,任何硬编码债都会指数级累积。
