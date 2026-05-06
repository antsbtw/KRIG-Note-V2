# L5-B2 Marks + Headings + Input-rules + 真 undo-redo + Toolbar 实施设计 v0.1

> **范围**:driver 加 4 个 marks(bold/italic/strike/code) + h1/h2/h3 keymap+input-rules + markdown 风格 mark input-rules + prosemirror-history 真 undo-redo + selection capability 第一次真消费(active marks/blockType) + Toolbar 接入(heading dropdown + 4 mark 按钮) + 应用级 keymap(Cmd+Z / Cmd+B / Cmd+1 等)。
>
> **不在范围**:lists(留 L5-B3) / blockquote(留 L5-B3) / link mark(留 L5-C) / underline + highlight mark(留 L5-C) / floating-toolbar(留 L5-B2.5/B3) / dnd block-handle(留 L5-B3) / multi-envelope clipboard(留 L5-B3) / 笔记搜索过滤(留 L5-C+) / horizontalRule + codeBlock 输入规则(留 L5-B3 加新 block 时)。
>
> **协议依据**:
> - [drivers/text-editing-driver/DESIGN.md](../../../src/drivers/text-editing-driver/DESIGN.md) v0.2(driver 实施设计)
> - [drivers/text-editing-driver/BLOCK-SPEC.md](../../../src/drivers/text-editing-driver/BLOCK-SPEC.md) v0.1(block 子协议)
> - [capabilities/COMMON-PROTOCOL.md](../../../src/capabilities/COMMON-PROTOCOL.md) v0.3(5 capability 协议)
> - [drivers/COMMON-DRIVER-PROTOCOL.md](../../../src/drivers/COMMON-DRIVER-PROTOCOL.md) v0.2(driver 协议)
>
> 文档版本:v0.1
> 编写日期:2026-05-06
> 上下文:用户拍板 8 项决策(Q1-Q8)后 — L5-B 拆三子阶段后第二段。

---

## 0. 上下文

### 0.1 V1 marks/history/input-rules 调研结果

V1 装配位置:
- **marks 定义**:`src/plugins/note/registry.ts` 内 `marks: Record<string, MarkSpec>` — bold(strong)/ italic(em)/ code(code)/ underline(u)/ strike(s)/ link / textStyle / highlight / thought
- **input-rules**:`src/plugins/note/plugins/input-rules.ts` — 只 block-level(`# / ## / ### / [-*] / 1. / [] / [ ] / [x] / > / \`\`\` / ---`),**没 mark input-rule**
- **markKeymap + history**:`NoteEditor.tsx` — `Mod-b / Mod-i / Mod-u / Mod-Shift-s / Mod-e` + `Mod-z / Mod-Shift-z / Mod-y` + `history()` 装到 plugins 末尾
- **toggleMark 命令**:`prosemirror-commands.toggleMark`(标准用法)

### 0.2 V2 driver 现状(L5-A 装配)

- `schema-builder.ts` 第 41 行:`new Schema({ nodes, marks: {} })` — **marks 空**
- `editor-view-builder.ts` 第 49 行注释 "L5-A 装配清单(最小集)" — 只有 `keymap(baseKeymap)`,**无 history / inputRules / markKeymap**
- `text-block/spec.ts` 已支持 `attrs.level` h1/h2/h3,但**没 marks 配置**(textBlock content `inline*` — 加 marks 后 inline 自动支持)
- `undo-scope.ts` 是占位 noop
- L4 toolbarRegistry 无 view 注册项

L5-B2 升级清单基本就是把上面缺的全补上。

### 0.3 用户拍板的 8 项决策

| Q | 决策 | 含义 |
|---|---|---|
| Q1 | A | marks 严守 4 个:bold / italic / strike / code |
| Q2 | A | headings 严守 h1/h2/h3(对齐 L5-A 现有 spec) |
| Q3 | B | mark input-rules 加 markdown 风格(`**xx**` → bold 等) |
| Q4 | A | undo-redo driver 内实现,capability 协议保留 scope 注册但不真消费 |
| Q5 | B | Toolbar 加 heading dropdown + 4 mark 按钮 |
| Q6 | A | Toolbar 视觉简陋暗主题,L5-B2.5/B3 floating-toolbar 时深化 |
| Q7 | B | active state 走 selection capability(driver emit selection 时带 marks/blockType) |
| Q8 | B | view 命令 handler 通过 driver instance-registry 调 driver Host API |

---

## 1. 模块物理布局

### 1.1 driver 内部新增

```
src/drivers/text-editing-driver/
├── (已有)
├── marks/                                              ← 新建子目录
│   ├── README.md
│   ├── bold.ts                                         ← MarkSpec(parseDOM/toDOM)
│   ├── italic.ts
│   ├── strike.ts
│   ├── code.ts
│   └── index.ts                                        ← MARKS 列表导出
├── plugins/                                            ← 新建子目录
│   ├── README.md
│   ├── build-input-rules.ts                            ← block + mark 输入规则
│   ├── build-mark-keymap.ts                            ← Mod-b / Mod-i / Mod-Shift-s / Mod-e
│   ├── build-heading-keymap.ts                         ← Mod-1 / Mod-2 / Mod-3 / Mod-0(切回 paragraph)
│   └── build-history-plugin.ts                         ← history() + Mod-z / Mod-Shift-z / Mod-y
├── api.ts                                              ← 新建 — driver Host 暴露给 view 的 API(toggleMark / setHeading / undo / redo)
└── (其余文件升级)
```

### 1.2 driver 内部升级

| 文件 | 改动 |
|---|---|
| `schema-builder.ts` | 装 marks(从 marks/index.ts 收集);doc 节点 `content: 'block+'` 不变;textBlock content `inline*` 自动获得 marks 支持 |
| `editor-view-builder.ts` | plugins 序列加 `history / mark-keymap / heading-keymap / input-rules`;先后顺序按 PM 推荐(input-rules 在 history 后面,keymap 在 baseKeymap 前面) |
| `Host.tsx` | mount 时把 view 注入 instance-registry(L5-A 已做);新增:emit selection 时带 active marks / blockType / level(Q7) |
| `capability-integrations/selection-source.ts` | emitSelectionChanged 升级 — payload 加 `activeMarks: string[]` + `activeBlockType: string` + `activeLevel: number \| null` |
| `capability-integrations/undo-scope.ts` | 仍占位(协议形态保留 — driver 真做 history,scope 只声明) |
| `index.ts` | 导出 driver API(`textEditingDriver.api.toggleMark / setHeading / undo / redo`) |
| `types.ts` | SelectionPayload 不动(在 capabilities/selection 改);driver 内部 API 类型加 |

### 1.3 capability 层升级

| 文件 | 改动 |
|---|---|
| `src/capabilities/selection/index.ts` | SelectionPayload 加 3 字段:`activeMarks?: string[]` / `activeBlockType?: string` / `activeLevel?: number \| null`(仅 text 模式有意义,其他 kind 字段缺省) |

### 1.4 view 层升级

```
src/views/note/
├── (已有)
├── note-commands.ts                                    ← 升级 — 加 8+ 个新命令
├── toolbar-content.tsx                                 ← 新建 — Toolbar 接入(注册 heading dropdown + 4 mark 按钮)
├── index.ts                                            ← 加 registerToolbar() 调用
└── note.css                                            ← Toolbar 视觉样式
```

### 1.5 框架层升级

| 文件 | 改动 |
|---|---|
| `src/slot/toolbar-registry/toolbar-types.ts` | ToolbarItem 加 `kind?: 'button' \| 'dropdown' \| 'separator'`(默认 button) + `activeWhen?: (ctx) => boolean`(active 高亮) + `options?: DropdownOption[]`(dropdown 用) + `commandArg?: unknown`(button 也用得到) |
| `src/slot/frame-bindings/ToolbarBinding.tsx` | 渲染逻辑升级 — 按 kind 分支渲染 button / dropdown / separator;订阅 selection capability 实时计算 active 状态;不持有 view-specific 字段 |
| `src/slot/frame-bindings/toolbar-bindings.css` | 新建 — Toolbar 视觉(暗主题 + 按钮高亮态 + dropdown 弹层) |
| `src/workspace/workspace-instance/toolbar-frame/toolbar-frame.css` | Toolbar 容器高度/边框可能微调 |

---

## 2. 核心数据契约

### 2.1 driver 内部 API(api.ts)

```ts
// driver 暴露给 view command handler 的 API(view 不持有 EditorView,通过 instanceId 路由)
export const textEditingDriverApi = {
  toggleMark(instanceId: string, markName: 'bold' | 'italic' | 'strike' | 'code'): void;
  setHeading(instanceId: string, level: 1 | 2 | 3 | null): void;  // null = paragraph
  undo(instanceId: string): boolean;
  redo(instanceId: string): boolean;
  /** 仅供 ToolbarBinding 等渲染层用,不是命令路径 */
  getActiveMarks(instanceId: string): string[];
  getActiveBlockType(instanceId: string): { name: string; level: number | null };
};
```

### 2.2 SelectionPayload 升级

```ts
export interface SelectionPayload {
  source: string;
  isEmpty: boolean;
  kind: SelectionKind;
  // text 模式
  from?: number;
  to?: number;
  anchor?: number;
  head?: number;
  // L5-B2 新增 — 仅 text 模式有意义
  activeMarks?: string[];           // ['bold', 'italic']
  activeBlockType?: string;         // 'text-block'
  activeLevel?: number | null;      // null=paragraph, 1/2/3=heading
  // (其他模式 — block / multi-block / graph / tree)
  positions?: number[];
  nodeIds?: string[];
  treeNodeIds?: string[];
}
```

### 2.3 ToolbarItem 升级

```ts
export interface ToolbarItem {
  id: string;
  label: string;
  view?: string;
  group?: 'left' | 'center' | 'right';
  order?: number;
  /** 类型 — 默认 'button' */
  kind?: 'button' | 'dropdown' | 'separator';
  /** button / dropdown option 用 */
  command?: string;
  commandArg?: unknown;
  icon?: string;
  /** active 高亮判定(订阅 selection capability 计算)*/
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
  /** dropdown 选项列表 */
  options?: DropdownOption[];
  /** dropdown 当前显示的 label(动态)*/
  currentLabel?: (ctx: ToolbarItemContext) => string;
}

export interface DropdownOption {
  id: string;
  label: string;
  command: string;
  commandArg?: unknown;
  /** 当前选中态判定 */
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
}

export interface ToolbarItemContext {
  /** 当前 selection capability 的最新值(driver emit 的 SelectionPayload)*/
  selection: SelectionPayload | null;
}
```

---

## 3. driver 升级详细

### 3.1 marks 自治目录(对齐 BLOCK-SPEC 自治原则)

每个 mark 一个文件:

```ts
// src/drivers/text-editing-driver/marks/bold.ts
import type { MarkSpec } from 'prosemirror-model';

export const boldMark: MarkSpec = {
  parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null }],
  toDOM() { return ['strong', 0]; },
};
```

italic / strike / code 同款(各对应 em / s / code 标签)。

`marks/index.ts`:
```ts
export const MARKS: Record<string, MarkSpec> = {
  bold: boldMark,
  italic: italicMark,
  strike: strikeMark,
  code: codeMark,
};
```

schema-builder.ts 收集:`new Schema({ nodes, marks: MARKS })`。

### 3.2 plugins 子目录

#### build-input-rules.ts

```ts
import { inputRules, InputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { Schema } from 'prosemirror-model';

export function buildInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  // headings(block-level)
  rules.push(new InputRule(/^#\s$/, setBlockAttrsRule(schema, 'text-block', { level: 1 })));
  rules.push(new InputRule(/^##\s$/, setBlockAttrsRule(schema, 'text-block', { level: 2 })));
  rules.push(new InputRule(/^###\s$/, setBlockAttrsRule(schema, 'text-block', { level: 3 })));

  // marks(inline,markdown 风格)
  // **xx** → bold
  rules.push(markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.bold));
  // *xx* → italic(注意要避免吞掉 **bold**:正则用否定前瞻)
  rules.push(markInputRule(/(?<!\*)\*([^*]+)\*$/, schema.marks.italic));
  // `xx` → code
  rules.push(markInputRule(/`([^`]+)`$/, schema.marks.code));
  // ~~xx~~ → strike
  rules.push(markInputRule(/~~([^~]+)~~$/, schema.marks.strike));

  return inputRules({ rules });
}

function markInputRule(regex: RegExp, markType: MarkType): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    const [full, content] = match;
    const tr = state.tr;
    // 删除 markup chars(只保留中间 content)
    const contentStart = start + full.indexOf(content);
    const contentEnd = contentStart + content.length;
    tr.delete(contentEnd, end);
    tr.delete(start, contentStart);
    // 给中间 content 加 mark
    tr.addMark(start, start + content.length, markType.create());
    // 移除 stored mark(下一个字符不再带 mark)
    tr.setStoredMarks([]);
    return tr;
  });
}
```

#### build-mark-keymap.ts

```ts
export function buildMarkKeymap(schema: Schema): Plugin {
  const km: Record<string, Command> = {};
  if (schema.marks.bold) km['Mod-b'] = toggleMark(schema.marks.bold);
  if (schema.marks.italic) km['Mod-i'] = toggleMark(schema.marks.italic);
  if (schema.marks.strike) km['Mod-Shift-x'] = toggleMark(schema.marks.strike);  // 注意:不冲突 Cmd+Shift+S(保存)
  if (schema.marks.code) km['Mod-e'] = toggleMark(schema.marks.code);
  return keymap(km);
}
```

#### build-heading-keymap.ts

```ts
export function buildHeadingKeymap(schema: Schema): Plugin {
  const setLevel = (level: number | null) =>
    setBlockTypeWithAttrs(schema.nodes['text-block'], { level });
  return keymap({
    'Mod-Alt-0': setLevel(null),  // paragraph
    'Mod-Alt-1': setLevel(1),
    'Mod-Alt-2': setLevel(2),
    'Mod-Alt-3': setLevel(3),
  });
}
```

**注意**:用 `Mod-Alt-1/2/3`(不是 `Mod-1`)避免与系统/浏览器冲突 Cmd+1=切 tab。

#### build-history-plugin.ts

```ts
export function buildHistoryPlugin(): Plugin[] {
  return [
    history(),
    keymap({
      'Mod-z': undo,
      'Mod-Shift-z': redo,
      'Mod-y': redo,  // Windows 习惯
    }),
  ];
}
```

### 3.3 editor-view-builder.ts 升级 plugin 顺序

```ts
const plugins: Plugin[] = [
  ...buildHistoryPlugin(),                  // history 优先(分组事务)
  ...blockPlugins,                           // block 自带 plugins(L5-A 留)
  buildInputRules(schema),                  // input-rules
  buildMarkKeymap(schema),                  // marks keymap
  buildHeadingKeymap(schema),               // headings keymap
  keymap(baseKeymap),                       // PM 标准键盘最后兜底
];
```

PM 推荐:history 在最前(让 input-rules / keymap 改动都被 history 覆盖)。

### 3.4 driver api.ts 实现

```ts
// 都通过 instance-registry 路由到具体 EditorView
export const textEditingDriverApi = {
  toggleMark(instanceId, markName) {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const markType = inst.view.state.schema.marks[markName];
    if (!markType) return;
    toggleMark(markType)(inst.view.state, inst.view.dispatch);
    inst.view.focus();
  },
  setHeading(instanceId, level) {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const blockType = inst.view.state.schema.nodes['text-block'];
    setBlockType(blockType, { level })(inst.view.state, inst.view.dispatch);
    inst.view.focus();
  },
  undo(instanceId) {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return false;
    const ok = undo(inst.view.state, inst.view.dispatch);
    if (ok) inst.view.focus();
    return ok;
  },
  redo(instanceId) {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return false;
    const ok = redo(inst.view.state, inst.view.dispatch);
    if (ok) inst.view.focus();
    return ok;
  },
  getActiveMarks(instanceId): string[] {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return [];
    return computeActiveMarks(inst.view.state);  // 检查 selection 范围内每个 mark 是否激活
  },
  getActiveBlockType(instanceId): { name: string; level: number | null } {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return { name: '', level: null };
    const $from = inst.view.state.selection.$from;
    const node = $from.node($from.depth);
    return { name: node.type.name, level: node.attrs.level ?? null };
  },
};
```

### 3.5 selection-source.ts 升级 emit

```ts
export function emitSelectionChanged(view: EditorView, instanceId: string): void {
  const sel = view.state.selection;
  const isEmpty = sel.empty;
  const $from = sel.$from;
  const node = $from.node($from.depth);
  selection.emit({
    source: `text-editing-driver:${instanceId}`,
    isEmpty,
    kind: 'text',
    from: sel.from,
    to: sel.to,
    anchor: sel.anchor,
    head: sel.head,
    // L5-B2 新增
    activeMarks: computeActiveMarks(view.state),
    activeBlockType: node.type.name,
    activeLevel: (node.attrs.level as number | null) ?? null,
  });
}
```

---

## 4. view 层升级

### 4.1 note-commands.ts 加 8 个新命令

```ts
// L5-B2 新增 — 全部通过 driver instance-registry 路由(Q8=B)
'note-view.toggle-bold'         // 无参,从 active workspace + activeNoteId 推 instanceId
'note-view.toggle-italic'
'note-view.toggle-strike'
'note-view.toggle-code'
'note-view.set-heading-level'   // 参数:level (number | null)
'note-view.undo'
'note-view.redo'
```

每条命令 handler 模板:
```ts
commandRegistry.register('note-view.toggle-bold', () => {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  const noteState = getNoteWsState(ws);
  if (!noteState.activeNoteId) return;
  // L5-A 时 instanceId 用 workspaceId(driver Host config 写的);
  // L5-B2 不变,因为一个 workspace 只一个 NoteView 实例
  textEditingDriverApi.toggleMark(wsId, 'bold');
});
```

### 4.2 toolbar-content.tsx 注册 Toolbar 项

```tsx
import { toolbarRegistry } from '@slot/toolbar-registry/toolbar-registry';
import type { ToolbarItem } from '@slot/toolbar-registry/toolbar-types';

export function registerToolbar(): void {
  const items: ToolbarItem[] = [
    // heading dropdown
    {
      id: 'note-view.heading',
      view: 'note-view',
      kind: 'dropdown',
      label: 'Paragraph',
      group: 'left',
      order: 10,
      currentLabel: (ctx) => {
        const lvl = ctx.selection?.activeLevel;
        return lvl == null ? 'Paragraph' : `H${lvl}`;
      },
      options: [
        { id: 'p',  label: 'Paragraph', command: 'note-view.set-heading-level', commandArg: null,
          activeWhen: (ctx) => ctx.selection?.activeLevel == null },
        { id: 'h1', label: 'H1',        command: 'note-view.set-heading-level', commandArg: 1,
          activeWhen: (ctx) => ctx.selection?.activeLevel === 1 },
        { id: 'h2', label: 'H2',        command: 'note-view.set-heading-level', commandArg: 2,
          activeWhen: (ctx) => ctx.selection?.activeLevel === 2 },
        { id: 'h3', label: 'H3',        command: 'note-view.set-heading-level', commandArg: 3,
          activeWhen: (ctx) => ctx.selection?.activeLevel === 3 },
      ],
    },
    // separator
    { id: 'sep1', view: 'note-view', kind: 'separator', label: '', group: 'left', order: 20 },
    // marks
    { id: 'note-view.bold',   view: 'note-view', kind: 'button', label: 'B', icon: 'bold',
      command: 'note-view.toggle-bold',   group: 'left', order: 30,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('bold') },
    { id: 'note-view.italic', view: 'note-view', kind: 'button', label: 'I', icon: 'italic',
      command: 'note-view.toggle-italic', group: 'left', order: 31,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('italic') },
    { id: 'note-view.strike', view: 'note-view', kind: 'button', label: 'S', icon: 'strikethrough',
      command: 'note-view.toggle-strike', group: 'left', order: 32,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('strike') },
    { id: 'note-view.code',   view: 'note-view', kind: 'button', label: '<>', icon: 'code',
      command: 'note-view.toggle-code',   group: 'left', order: 33,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('code') },
  ];
  toolbarRegistry.register(items);
}
```

### 4.3 index.ts 接入

```ts
import { registerToolbar } from './toolbar-content';
// ...
registerToolbar();
```

---

## 5. 框架层 ToolbarBinding 升级

### 5.1 ToolbarBinding.tsx 渲染逻辑

```tsx
import { useSyncExternalStore, useState, useEffect } from 'react';
import { selection } from '@capabilities/selection';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type { SelectionPayload } from '@capabilities/selection';

export function ToolbarBinding({ viewId }: { viewId: string | null }) {
  // 订阅 toolbarRegistry 版本号
  useSyncExternalStore(
    (cb) => toolbarRegistry.subscribe(cb),
    () => toolbarRegistry.count,
  );

  // 订阅 selection capability(active 状态计算)
  const [sel, setSel] = useState<SelectionPayload | null>(selection.api.getCurrent());
  useEffect(() => {
    return selection.subscribe((payload) => setSel(payload));
  }, []);

  if (!viewId) return null;
  const items = toolbarRegistry.getItemsForView(viewId);
  const ctx: ToolbarItemContext = { selection: sel };

  return (
    <div className="krig-toolbar-binding">
      {items.map((item) => renderItem(item, ctx))}
    </div>
  );
}

function renderItem(item: ToolbarItem, ctx: ToolbarItemContext) {
  if (item.kind === 'separator') return <div className="krig-toolbar-sep" key={item.id} />;
  if (item.kind === 'dropdown') return <ToolbarDropdown item={item} ctx={ctx} key={item.id} />;
  // 默认 button
  const active = item.activeWhen?.(ctx) ?? false;
  return (
    <button
      key={item.id}
      type="button"
      className={`krig-toolbar-button${active ? ' active' : ''}`}
      onClick={() => commandRegistry.execute(item.command!, item.commandArg)}
      title={item.label}
    >
      {item.icon ? <Icon name={item.icon} /> : item.label}
    </button>
  );
}
```

### 5.2 toolbar-bindings.css

```css
.krig-toolbar-binding {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #1e1e1e;
  border-bottom: 1px solid #2a2a2a;
}

.krig-toolbar-button {
  background: transparent;
  border: 1px solid transparent;
  color: #ccc;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 13px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  min-width: 28px;
  height: 24px;
}
.krig-toolbar-button:hover { background: rgba(255,255,255,0.05); }
.krig-toolbar-button.active { background: rgba(74,144,226,0.25); color: #fff; }

.krig-toolbar-sep {
  width: 1px;
  height: 18px;
  background: #444;
  margin: 0 4px;
}

.krig-toolbar-dropdown { /* dropdown 容器 */ }
.krig-toolbar-dropdown-trigger { /* 点击展开 */ }
.krig-toolbar-dropdown-menu { /* 浮层 */ }
```

视觉简陋(Q6=A) — 暗主题 + 蓝色高亮态(对齐 NavSide selected 颜色)。

---

## 6. 完成判据(15 条)

| # | 判据 | 验证方式 |
|---|---|---|
| 1 | npm run typecheck + lint 全过 | 命令 |
| 2 | 选中文字 Cmd+B → 加 bold(toDOM `<strong>`)/ 再按 → 撤销 bold | 视觉 + DevTools |
| 3 | Cmd+I / Cmd+Shift+X / Cmd+E 同款 italic / strike / code | 键盘 |
| 4 | 输入 `**hello** ` → 自动变 bold | 输入 |
| 5 | 输入 `*hello* ` → italic / `` `hello` `` → code / `~~hello~~ ` → strike | 输入 |
| 6 | 行首输入 `# ` → 变 h1;`## ` → h2;`### ` → h3 | 输入 |
| 7 | Cmd+Alt+1/2/3 切 heading;Cmd+Alt+0 切回 paragraph | 键盘 |
| 8 | Toolbar 显 heading dropdown(Paragraph / H1 / H2 / H3 4 项)+ B/I/S/Code 4 个按钮 | 视觉 |
| 9 | Toolbar B 按钮:点 → toggle bold;选区在 bold 文字内时按钮高亮(蓝色) | 视觉 |
| 10 | Toolbar dropdown:点 H2 → 当前段变 h2;dropdown label 显 "H2" | 视觉 |
| 11 | Cmd+Z / Cmd+Shift+Z 真撤销重做(L5-A 占位 noop 替代) | 键盘 |
| 12 | undo/redo 不丢光标位置(prosemirror-history 标准行为) | 键盘 |
| 13 | 多 Workspace:每 Workspace 独立 history 栈(切回不串栈) | 切 Workspace 验证 |
| 14 | console `[L5] alive | view: note-view, blocks: 1, marks: 4, capabilities: 5+driver` | renderer 启动 |
| 15 | 重启 app 后 marks 内容(strong/em/s/code)正确反序列化 | 重启 |

L5-B2 不验证(留 L5-B3 / L5-C):
- bullet/ordered/task list 输入规则
- floating-toolbar 浮起
- link mark
- underline / highlight

---

## 7. 实施顺序(估算)

| Step | 内容 | 估算 |
|---|---|---|
| 1 | npm 装 prosemirror-history + prosemirror-inputrules | - |
| 2 | driver/marks/ 4 mark 文件 + index.ts | ~80 行 |
| 3 | schema-builder 装 marks | ~20 行 |
| 4 | driver/plugins/build-history-plugin.ts | ~25 行 |
| 5 | driver/plugins/build-input-rules.ts(headings + 4 marks) | ~120 行 |
| 6 | driver/plugins/build-mark-keymap.ts | ~25 行 |
| 7 | driver/plugins/build-heading-keymap.ts | ~30 行 |
| 8 | editor-view-builder 装 plugins | ~15 行 |
| 9 | driver/api.ts(toggleMark / setHeading / undo / redo / getActive*) | ~80 行 |
| 10 | selection-source.ts 升级 emit(activeMarks / activeBlockType / activeLevel) | ~50 行 |
| 11 | capabilities/selection 类型加字段 | ~10 行 |
| 12 | note-commands.ts 加 7 个新命令 | ~60 行 |
| 13 | toolbar-types.ts 升级(kind/activeWhen/options/commandArg/currentLabel + ToolbarItemContext + DropdownOption) | ~50 行 |
| 14 | ToolbarBinding.tsx 升级渲染 | ~120 行 |
| 15 | toolbar-bindings.css 视觉 | ~80 行 |
| 16 | toolbar-content.tsx 注册 6 个 Toolbar 项(1 dropdown + 1 sep + 4 button) | ~80 行 |
| 17 | index.ts 接入 + L5 alive 输出更新 | ~10 行 |
| 18 | 文档:driver DESIGN.md / BLOCK-SPEC.md / capabilities/selection 协议 同步升级版本号 | ~100 行 |

**合计 ~955 行**(L5-B2 量级,跟 L5-A 对等)。

---

## 8. 风险 + 开放问题

### 8.1 history 跨 Host 实例隔离

prosemirror-history 是 PM Plugin,每 EditorView 独立实例 — **天然按实例隔离**。L5-A driver 一个 workspace 一个 EditorView,所以 multi-Workspace 的 undo 栈天然独立。判据 #13 跟此契合。

### 8.2 ToolbarBinding 订阅 selection 频率

selection 每次 transaction 都 emit(L5-A 现状),Toolbar 每次都重渲。性能可能差(频繁高亮态闪烁)。

**应对**:
- 短期:接受(NoteView 单实例,渲染量小)
- 长期:selection emit 改为"真变才 emit"(L5-A DESIGN § 3.3 已注释 "L5-B 优化")— 顺手在 L5-B2 一起做

我加进 § 7 Step 10 内 — selection-source 升级 emit 时同时做"真变才 emit"过滤。

### 8.3 input-rule 与 IME(中文输入)冲突

V1 已踩坑:中文 IME 拼音字母会触发 `# ` 等 input-rule。

**V1 应对**:input-rules 默认行为是 IME composition 期间不触发(prosemirror-inputrules 标准)。但需要 verify。

L5-B2 实施时:跟 V1 同款依赖 inputRules 标准行为;实测踩坑再加 IME 检测。

### 8.4 Cmd+Alt+0 切 paragraph 与系统冲突

Mac 上 Cmd+Alt+0 没占用,可用。Windows Ctrl+Alt+0 也没占用。

### 8.5 Cmd+Shift+X 切 strike 是否合理

Notion / Tiptap 都用 Cmd+Shift+S 但 V2 跟用户 OS 的"保存"快捷键可能冲突(虽然 web 没保存)— V1 也是 Cmd+Shift+S。L5-B2 选 Cmd+Shift+X(VS Code 风格)避歧义。

如用户希望对齐 V1 用 Cmd+Shift+S,实施时改一行即可。

### 8.6 mark input-rule 的 setStoredMarks([]) 副作用

input-rule 触发后 `setStoredMarks([])` 让下一个字符不带 mark — 这是必要的(避免 `**bold** more` 中 "more" 也带 bold)。但用户期待是不是这样?Notion 是这样,Tiptap 也是这样,符合 markdown 心智模型。

### 8.7 ToolbarBinding 取数路径

每个 ToolbarItem 的 activeWhen 接收 `ctx.selection`(SelectionPayload) — 但 ctx.selection 是订阅 selection capability 拿的,这是 **L5-A 实施的协议第一次真消费**。如果 selection capability 协议有缺陷,L5-B2 会暴露出来 — 概率高。

**应对**:实施时如果发现 SelectionPayload 字段不够 / 时序问题,加协议字段(写进 capability 协议 v0.4 修订)。

### 8.8 driver 暴露 api 是否破坏分层

driver api 直接被 view command handler import + 调 — 像不像 view 接触 driver 内部?

**辨析**:driver api 是 driver **对外契约**,是 view 跟 driver 通信的边界(类似 Host 组件就是 driver 对外契约)。view 不接触 PM API(EditorView / state / dispatch / Schema),只调 driver api 的高阶动作 — 边界不破。

写进协议:driver 协议 v0.3 加 § 3.3 "driver API 契约"。

### 8.9 dropdown 浮层的视觉对齐

ToolbarBinding 的 dropdown 浮层应该用 ContextMenuPopover 复用?还是单独 ToolbarDropdownPopover?

**辨析**:
- ContextMenuPopover 设计为右键场景(锚点是鼠标位置)
- dropdown 浮层锚点是 trigger 按钮(下边缘)— 位置语义不同

**短期**:ToolbarBinding 内嵌 dropdown 视觉(简陋,Q6=A),不抽通用组件。
**长期**(L5-B2.5/B3):floating-toolbar 一起做时可能抽 `Popover` 通用组件容纳所有锚点浮层。

L5-B2 不投资抽象。

### 8.10 ToolbarItem.activeWhen 是函数 — 序列化?

ToolbarItem 包含函数(activeWhen / currentLabel)— 不能 JSON 序列化。如果未来要把 ToolbarItem 做"远程注册"(IPC 传过 boundary),就需要协议化(类似 commandArgFn 那样拆字段)。

**短期**:本地注册,函数 OK。
**长期**:有 IPC 跨边界注册需求时再拆。

### 8.11 ToolbarItemContext 只含 selection,够吗?

未来其他 view 可能需要更多 context(如 graph view 的当前 zoom level)。但 L5-B2 NoteView 只用 selection。

**应对**:ToolbarItemContext 是 interface,未来 view 加字段无破坏(activeWhen 函数可读 ctx 任何字段)。

---

## 9. L5-B3 增量预告(本阶段不实施)

### 9.1 L5-B3 范围(根据现拆分计划)

- block 类型:bullet-list / ordered-list / task-list(新 BlockSpec 自治目录,各自 inputRule + keymap + nodeView)
- block 类型:blockquote / horizontalRule / codeBlock(类似)
- input-rules 加 `[-*] / 1. / [] / > / --- / \`\`\`` 等
- driver dnd block-handle 拖动手柄(对应 capability drag-and-drop 真消费)
- multi-envelope clipboard + paste dispatcher(对应 capability clipboard 真消费)
- floating-toolbar(对应 L4 floatingToolbarRegistry / floating-toolbar capability 真消费)

### 9.2 L5-B3 后 L5-C 范围(更后)

- link mark + 行内链接 noteLink(L5-A DESIGN 提的 L5-C)
- underline / highlight mark
- 笔记搜索过滤(NavSide onSearch 真实现)

---

## 10. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-06 | v0.1 | 初稿;8 项决策(Q1-Q8)拍板锁定;实施清单 ~955 行;15 完成判据;L5-B 拆三子阶段后第二段 |
