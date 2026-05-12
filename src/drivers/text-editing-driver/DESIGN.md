# text-editing-driver 实施设计 v0.2

> **本 driver 的职责**:把 PM 框架 + block 集合 + 5 通用 capability 协议,**编织成可用的文本编辑器实例**,通过 React 组件暴露给 view。
>
> **协议依据**:
> - [drivers/COMMON-DRIVER-PROTOCOL.md](../COMMON-DRIVER-PROTOCOL.md) v0.2(driver 层根协议)
> - [capabilities/COMMON-PROTOCOL.md](../../capabilities/COMMON-PROTOCOL.md) v0.3(5 capability 协议)
> - [BLOCK-SPEC.md](./BLOCK-SPEC.md)(本 driver 内 block 注册子协议)
>
> **范围**:L5-A(只 textBlock + L5-A 必需基础设施)。L5-B/L5-C/L6+ 增量见 § 10。
>
> 文档版本:v0.2.1(P1 审计修复:Host 契约 + 单例命令 + 实例隔离;v0.2.1 复审同步 dispatchTransaction 示例双向 DriverSerialized + § 11.2 风险段已解决叙述)
> 编写日期:2026-05-05
> 上下文:L5-A 实施前的最终设计文档

---

> **L6 更新(2026-05-11)**: 文本流核心已从原"合一节点 text-block(attrs.level/isTitle)"
> 拆为 **paragraph + heading** 双节点(Decision 005)。本文档历史叙述保留 L5-A 阶段原文
> (textBlock 单节点),实际代码以拆分后两节点为准。详见:
> - [Decision 005](../../../docs/RefactorV2/data-model/atom/decisions/005-block-schema-decomposition.md)
> - [BLOCK-SPEC.md](./BLOCK-SPEC.md) 顶部 L6 更新段

---

## 0. 上下文 + 范围

### 0.1 driver 在 V2 架构中的位置

按 driver 协议 v0.2,本 driver:
- 是 view 必经的业务驱动层(NoteView / ThoughtView / EBookView 批注 / 等都通过本 driver 实现文本编辑)
- 不是 capability(不横切多种内容形态,专属"文本编辑"业务)
- 整体不可分拆(view 不能"装一半")

### 0.2 V1 学习参考(NoteEditor.tsx 装配)

V1 `src/plugins/note/components/NoteEditor.tsx`(864 行)做的事:
- 注册 30+ block 到 blockRegistry
- 用 blockRegistry.buildSchema() 拼装 PM Schema
- 装配 14 个 PM plugin(history / dropCursor / gapCursor / blockSelection / indent / slash / linkClick / containerKeyboard / pasteMedia / smartPaste / blockHandle / titleGuard / 等)
- 创建 EditorView,接管 dispatchTransaction
- 提供 `NoteEditorHandle`(命令式接口,L3.5 之前用)

V2 text-editing-driver 复用 V1 的**装配模式**(plugin 顺序 / Schema 拼装 / dispatch 处理),但:
- 不再绑死 30+ block(L5-A 只装 textBlock,其他增量加)
- 不再用命令式 handle(L3.5 之后走 capability channel + commandRegistry)
- 严格遵守 driver 协议铁律(命名空间 / scope / 序列化契约 / 等)

### 0.3 L5-A 范围

- **block**:textBlock(只此一个,paragraph + 标题 level=null/1/2/3)
- **marks**:无(L5-B 加 bold / italic / strike / code 等)
- **plugin**:最小集 — baseKeymap(Enter / Backspace / 光标)
- **capability 集成**:5 类全到位(selection / clipboard / undo-redo / dnd / insertion)
  - selection:emit 字符级 TextSelection
  - clipboard:走 PM 默认序列化(L5-B 加多 envelope dispatcher)
  - undo-redo:**不实施**(L5-B 加 prosemirror-history)
  - dnd:**不实施**(L5-B 加块拖动)
  - insertion:**不实施**(L5-B 加 safeguard)

  **L5-A 实际只需 selection + clipboard 集成**,其他注册接口位但不实施。

---

## 1. driver 整体形态

### 1.1 元数据 + 暴露接口(对照 driver 协议 § 3.1.2)

```ts
interface TextEditingDriver {
  readonly id: 'text-editing-driver';
  readonly version: '0.1.0';                          // L5-A 起始版本

  /** 主入口:React 组件,view 装到自己业务里 */
  Host: React.FC<TextEditingHostProps>;

  /** 序列化:PM doc → DriverSerialized 信封 */
  serialize(doc: PMDoc): DriverSerialized<PMDocJSON>;
  /** 反序列化:不识别 format/version 返 null */
  deserialize(data: DriverSerialized): PMDoc | null;

  // 元信息查询(L5-A 极简,L5-B+ 加 listAvailableBlocks 等)
  // 当前 v0.1 不暴露元信息查询 API
}
```

序列化信封格式(driver 协议 § 3.1.1):
```ts
{
  format: 'pm-doc-json',
  version: '0.1',           // driver 内部 schema 版本
  payload: <PM doc JSON>
}
```

### 1.2 物理目录结构

```
src/drivers/text-editing-driver/
├── DESIGN.md                   ← 本文件
├── BLOCK-SPEC.md               ← block 注册子协议
├── README.md                   ← driver 总览(L5-A 实施时建)
├── index.ts                    ← driver 单例 + 公开 API export
├── Host.tsx                    ← 主 React 组件(view 装这个)
├── schema-builder.ts           ← Schema 拼装逻辑
├── editor-view-builder.ts      ← EditorView 装配逻辑
├── plugins/                    ← driver 自己的 PM plugin(L5-A 极少)
│   └── (L5-A 暂空,L5-B+ 加 input-rules / container-keyboard 等)
├── capability-integrations/    ← 跟 5 capability 的整体集成
│   ├── selection-source.ts     ← selection.registerSource + emit 桥接
│   ├── clipboard-handlers.ts   ← clipboard.registerSerializer + commands
│   ├── undo-scope.ts           ← undoRedo.registerScope(L5-B 实施)
│   ├── dnd-targets.ts          ← dnd.registerDropTarget(L5-B 实施)
│   └── insertion-safeguards.ts ← insertion.registerSafeguard(L5-B 实施)
└── blocks/                     ← block 自治模块(driver 内部)
    └── text-block/             ← L5-A 唯一 block
        ├── spec.ts             ← PM nodeSpec + nodeView(必需)
        └── README.md           ← block 设计 + 演化记录
```

### 1.3 driver 单例 + view 用法

driver 是模块级单例:

```ts
// src/drivers/text-editing-driver/index.ts
export const textEditingDriver: TextEditingDriver = { ... };
```

view 用法:

```tsx
// src/views/note/NoteView.tsx
import { textEditingDriver } from '@drivers/text-editing-driver';

function NoteView({ workspaceId, payload }: ViewComponentProps) {
  const [doc, setDoc] = useState(initialDoc);
  return (
    <textEditingDriver.Host
      config={{ undoScope: 'note-view.pm', /* L5-B+ 加更多 */ }}
      doc={doc}
      onChange={setDoc}
    />
  );
}
```

---

## 2. Host 组件接口

### 2.1 Props 形态(v0.2 修订:Host 吃 DriverSerialized,不吃 PMDoc)

**关键契约**(P1.1 修复):view 不接触 PM 内部对象,Host 跟 view 之间用 DriverSerialized 信封作数据契约。**driver 内部** 把 DriverSerialized.payload 解包成 PMDoc 用,发出 onChange 时再封装回 DriverSerialized。

```ts
interface TextEditingHostProps {
  /** view 配置 */
  config: TextEditingConfig;
  /** 受控:当前文档(DriverSerialized 信封,view 不接触 PM 内部对象)*/
  doc: DriverSerialized;
  /** doc 变化回调(同样是 DriverSerialized 信封)*/
  onChange: (newDoc: DriverSerialized) => void;
  /** 只读模式(L5-A 默认 false)*/
  readOnly?: boolean;
  /** 自定义样式 */
  className?: string;
}

interface TextEditingConfig {
  /** **实例 ID,必填**(P1.3 修复):driver 用此区分多 Host 实例,
   *  source/scope 等命名带此前缀实现实例隔离。view 通常用 workspaceId */
  instanceId: string;           // 如 workspaceId

  /** view 提供的 undo scope 名(铁律 6b:view-id.purpose 格式)*/
  undoScope: string;            // 如 'note-view.pm' / 'thought-view.pm'

  // L5-B+ 加:
  // enabledBlocks?: string[];   // 启用哪些 block(默认全启用)
  // pasteHandlers?: ...;        // view 自定义 paste handler 注册
  // 其他配置
}
```

### 2.2 生命周期(v0.2 修订:P1.2 + P1.3 修复)

**两层生命周期**(关键修正):

#### 2.2.1 driver 模块加载时(应用启动一次)

driver 模块 import 触发 side-effect,**单例注册**协议级 capability handler 跟所有 Host 实例无关:

```
driver 模块加载(应用启动):
  1. capability-integrations 模块 import 触发:
     - 注册 commandRegistry handler 一次(单例,生命周期 = 应用)
       * 'clipboard.copy' handler(L5-A 实施)
       * 'clipboard.paste' / 'clipboard.cut' handler(L5-B+)
       * 'undo-redo.undo' / 'redo' handler(L5-B+)
       * 'insertion.insert' handler(L5-B+)
     - 这些 handler 内部 focus-aware:通过 selection.api.getCurrent() 拿当前焦点 source,
       根据 source 路由到对应 Host 实例(实例注册表)
  2. selection.registerSource(模块级 source,L5-A 不需要;
       具体每个 Host 实例的 source 在 § 2.2.2 注册)
  3. clipboard.registerSerializer 一次(serializer 不绑实例,通用)
```

**关键**:capability 命令 handler **永不 unregister**(应用关闭才卸,正常情况持续整个生命周期)。

#### 2.2.2 Host 实例 mount 时(每个 view 实例一次)

Host 实例只 register/unregister **实例 specific** 资源,带 instanceId 隔离:

```
Host 实例 mount(per-workspace per-view):
  1. instanceId = config.instanceId(view 通过 props 传,如 workspaceId)
  2. 把自己注册到 driver 内部"实例注册表"(让模块级命令 handler 能路由到本实例)
     instanceRegistry.set(instanceId, { editorView, ... });
  3. 调 schema-builder 拼装 PM Schema(每实例独立 EditorView)
  4. 调 editor-view-builder 装配 EditorView + plugin 列表
  5. capability 集成(实例 specific):
     - selection.registerSource({ source: `text-editing-driver:${instanceId}` })
     - undoRedo.registerScope(config.undoScope)        (L5-B 实施)
     - dnd.registerDropTarget(实例 specific dropTarget,L5-B 实施)
     - insertion.registerSafeguard(实例 specific safeguard,L5-B 实施)
  6. mount EditorView 到 DOM

Host 实例 unmount:
  1. 销毁 EditorView
  2. 卸载实例 specific capability 注册:
     - selection.unregisterSource(`text-editing-driver:${instanceId}`)
     - undoRedo.unregisterScope(config.undoScope)
     - dnd.unregisterDropTarget(实例 dropTarget id)
     - insertion.unregisterSafeguard(实例 safeguard id)
  3. instanceRegistry.delete(instanceId);
  
  ⚠️ 不卸载 commandRegistry 命令 handler(那是模块级单例,跟实例生命周期无关)
```

**关键**:Host 实例 unmount 不影响其他实例(命令 handler 单例,实例 specific 资源带 instanceId 隔离)。

### 2.3 dispatchTransaction 处理

```ts
new EditorView(container, {
  state,
  dispatchTransaction(tr) {
    if (view.isDestroyed) return;
    const newState = view.state.apply(tr);
    view.updateState(newState);

    // 1. doc 变化:封装回 DriverSerialized 信封后通知 view(P1.1 契约一致)
    if (tr.docChanged) {
      const serialized: DriverSerialized = {
        format: 'pm-doc-json',
        version: '0.1',
        payload: newState.doc.toJSON(),    // PMDoc → JSON,封装进信封
      };
      onChange(serialized);                 // ← 永远传 DriverSerialized,不是 PMDoc
    }

    // 2. selection 变化 emit channel
    if (!tr.selection.eq(prevSelection)) {
      selectionIntegration.emitChanged(view, instanceId);   // 带实例 ID
    }
  },
});
```

**对应反方向**:Host props 收到 `doc: DriverSerialized` 时,driver 内部解包:
```ts
// Host 内部:DriverSerialized → PMDoc
function deserializeDoc(data: DriverSerialized, schema: Schema): PMNode | null {
  if (data.format !== 'pm-doc-json') return null;
  // 检查 version,不识别返 null(driver 协议铁律 9 Result 风格)
  if (data.version !== '0.1') return null;
  return PMNode.fromJSON(schema, data.payload);
}
```

**关键契约**:Host 边界**全程 DriverSerialized**,driver 内部封装/解包。view 永不接触 PMDoc / EditorState / EditorView 任何 PM 对象。

---

## 3. Schema 拼装机制(L5-A)

### 3.1 输入

L5-A 阶段只有 textBlock。Schema 由 schema-builder 收集所有启用 block 的 spec 拼装:

```ts
function buildSchema(blocks: BlockSpec[]): Schema {
  const nodes: Record<string, NodeSpec> = {
    doc: { content: 'block+' },
    text: { group: 'inline' },
  };

  for (const block of blocks) {
    nodes[block.id] = injectFrameworkAttrs(block.spec);
  }

  // L5-A 无 marks(L5-B 加 bold / italic / etc.)
  return new Schema({ nodes, marks: {} });
}
```

### 3.2 框架强制 attrs 注入

承袭 V1 模式(`registry.ts:69-79`),所有 group='block' 节点自动注入通用 attrs:

```ts
function injectFrameworkAttrs(spec: NodeSpec): NodeSpec {
  if (spec.group !== 'block') return spec;
  return {
    ...spec,
    attrs: {
      ...(spec.attrs || {}),
      indent: spec.attrs?.indent ?? { default: 0 },
      // L5-B+ 加:fromPage / frameColor / frameStyle / frameGroupId / frameThoughtId
    },
  };
}
```

L5-A 只注入 indent,其他 V1 attrs(fromPage / frame*)留 L5-B+ 真有需求时加。

---

## 4. EditorView 装配机制(L5-A)

### 4.1 plugin 装配清单(L5-A 最小集)

按 V1 NoteEditor.tsx 经验,plugin 顺序敏感。L5-A 装配清单:

```ts
function buildPlugins(schema: Schema): Plugin[] {
  return [
    keymap(baseKeymap),                  // PM 标准键盘(Enter / Backspace / 光标)
    // L5-B+ 加:
    // history()                          (undo-redo capability)
    // dropCursor() / gapCursor()         (拖放视觉)
    // keymap(markKeymap)                 (Cmd+B / Cmd+I 等)
    // 各 block 自己的 plugin             (block.spec.plugin 收集)
  ];
}
```

L5-A **极简装配** — 用户能输入文字 + 换段就够。其他特性 L5-B+ 增量加。

### 4.2 plugin 顺序铁律

参考 V1 NoteEditor.tsx 第 233-238 行教训(smart-paste 必须在 blockPlugins 之前):

```
[L5-B+ 加]:
  1. blockSelection / indent / slash / linkClick / containerKeyboard      (高优先级,优先拦截)
  2. pasteMedia / smartPaste                                                (粘贴接管,在 blockPlugins 之前)
  3. ...blockPlugins                                                        (block 自带 plugin)
  4. buildInputRules(schema)                                                (input-rules)
  5. keymap({ Mod-z: undo, Mod-Shift-z: redo })                            (mark/history keymap)
  6. keymap(markKeymap)
  7. keymap(baseKeymap)                                                     (兜底,最低优先级)
  8. blockHandle / renderBlockFocus / etc.                                  (装饰类)
  9. history()                                                              (history,最后)
  10. dropCursor / gapCursor                                                 (视觉)
```

L5-A 只装第 7 步(baseKeymap),其他逐步加。

---

## 5. 跟 5 capability 的整体集成

每个集成模块 1 文件,独立可测试。

### 5.1 selection-source.ts(L5-A 必实施;v0.2 修订:实例隔离)

```ts
// src/drivers/text-editing-driver/capability-integrations/selection-source.ts
import { selection } from '@capabilities/selection';

/** 每个 Host 实例的 source ID 格式(P1.3 修复)*/
export function buildSourceId(instanceId: string): string {
  return `text-editing-driver:${instanceId}`;
}

/** 每个 Host 实例 mount 时调,注册自己的 source */
export function registerSelectionSource(instanceId: string): () => void {
  const source = buildSourceId(instanceId);
  selection.registerSource({ source });
  return () => selection.unregisterSource(source);
}

/** Host 在 dispatchTransaction 时调,emit 当前选区(带实例 source)*/
export function emitSelectionChanged(view: EditorView, instanceId: string): void {
  const sel = view.state.selection;
  selection.emit({
    source: buildSourceId(instanceId),
    isEmpty: sel.empty,
    kind: 'text',
    from: sel.from,
    to: sel.to,
    anchor: sel.anchor,
    head: sel.head,
  });
}
```

**实例隔离的意义**:多个 Host 实例(NoteView 在 Workspace A / Workspace B 各一个)各自的选区独立 emit,UI 旁观者(FloatingToolbar)能区分"哪个实例的选区"。

### 5.2 clipboard-handlers.ts(v0.2 修订:模块级单例 + serializer 通用)

按 P1.2 修复,clipboard 命令 handler 是 **模块级单例**,不绑实例;serializer 也是通用的(任何实例 copy 都用同一个 serializer)。

```ts
// src/drivers/text-editing-driver/capability-integrations/clipboard-handlers.ts
import { clipboard } from '@capabilities/clipboard';
import { selection } from '@capabilities/selection';
import { commandRegistry } from '@slot/command-registry';
import { instanceRegistry } from '../instance-registry';

// ── 模块级单例(driver 模块加载时注册一次,生命周期 = 应用)──

/** Serializer 通用(不绑实例)*/
clipboard.registerSerializer({
  contentType: 'text-editing-driver.pm-doc',
  format: 'pm-json',
  serialize: (doc: PMDoc) => JSON.stringify(doc.toJSON()),
});

/** 'clipboard.copy' 模块级单例 handler(focus-aware,通过 instance-registry 路由)*/
commandRegistry.register('clipboard.copy', async () => {
  const current = selection.api.getCurrent();
  if (!current?.source.startsWith('text-editing-driver:')) return; // 不在焦点,让位

  // 解析实例 ID:'text-editing-driver:<instanceId>'
  const instanceId = current.source.slice('text-editing-driver:'.length);
  const instance = instanceRegistry.get(instanceId);
  if (!instance) return; // 实例已 unmount,无视

  // 路由到对应实例的 EditorView(L5-A 走 PM 默认 copy)
  document.execCommand('copy');

  clipboard.emit('clipboard.copied', {
    source: current.source,
    envelopes: ['plain', 'html'],
    selectionKind: current.kind,
  });
});

// L5-B+ 加: clipboard.paste / clipboard.cut handler 同款模式
```

**关键变化**:
- handler 注册在模块顶层(import 时执行一次),不在 Host 实例的 register 函数内
- handler 内部通过 `selection.api.getCurrent().source` 解析当前焦点实例 ID
- 通过 `instanceRegistry.get(instanceId)` 拿到具体 EditorView 路由
- Host 实例 unmount **不触发** `commandRegistry.unregister`

### 5.3 undo-scope.ts(L5-B 实施,L5-A 占位)

```ts
// L5-A 只占位,真实施留 L5-B(加 prosemirror-history)
export function registerUndoScope(view: EditorView, scope: string): () => void {
  // L5-A:noop 占位,返回空 unregister
  return () => {};
}
```

### 5.4 dnd-targets.ts / insertion-safeguards.ts(L5-B 实施,L5-A 占位)

同 5.3,L5-A 占位 noop,L5-B+ 实施。

---

## 6. commandRegistry 命令注册(L5-A)

按 driver 协议铁律 7,driver 注册 capability 命名空间命令的 handler:

```ts
// L5-A 实施
commandRegistry.register('clipboard.copy', focusAwareCopyHandler);

// L5-B+ 加
commandRegistry.register('clipboard.paste', focusAwarePasteHandler);
commandRegistry.register('clipboard.cut', focusAwareCutHandler);
commandRegistry.register('undo-redo.undo', focusAwareUndoHandler);
commandRegistry.register('undo-redo.redo', focusAwareRedoHandler);
commandRegistry.register('insertion.insert', focusAwareInsertHandler);
```

driver 命名空间命令(view 命名空间):
```ts
// L5-B+ 加(view 自己注册,driver 不预设)
// 例如 NoteView 注册:
commandRegistry.register('note-view.toggle-bold', ...);
commandRegistry.register('note-view.set-heading-level', ...);
```

L5-A 不实施 driver 特有命令(只 textBlock 没什么特殊命令)。

---

## 7. L5-A 完成判据

| # | 判据 | 验证 |
|---|---|---|
| 1 | npm install(prosemirror-state / view / model / keymap / commands)| `npm ls prosemirror-state` 等 |
| 2 | textEditingDriver export 单例 + 必需接口齐全 | typecheck 通过 |
| 3 | Host 组件能 mount | 用户测:`<Host config={{undoScope: 'note-view.pm'}} doc={emptyDoc} onChange={...} />` |
| 4 | 用户能输入文字 + Enter 换段 | 视觉 + 输入测试 |
| 5 | doc 变化触发 onChange,view 拿到新 doc | console.log 验证 |
| 6 | selection 变化触发 channel emit | DevTools `__krig.bus` channel 订阅观察 |
| 7 | 'clipboard.copy' command 走 driver 注册的 handler | DevTools 调用验证 |
| 8 | unmount 时**实例 specific** capability 注册清理(P1.2/P1.3 验证)| DevTools 检查 `selection` 注册表只剩活跃实例 source |
| 9 | 多 Workspace(2 个 NoteView)各自独立 source / undoScope,互不冲突 | DevTools 观察 selection.changed channel |
| 10 | typecheck + lint 全过 | npm run typecheck / lint |

L5-A **不验证**(留 L5-B 实测):
- undo-redo 实际功能(scope 注册了但 noop)
- dnd 实际功能
- insertion safeguard 实际功能
- 多 envelope clipboard
- block 切换 / 复杂场景

---

## 8. 实施清单(估算 ~11 文件)

| 文件 | 作用 | L5-A 行数估算 |
|---|---|---|
| `index.ts` | driver 单例 + export | ~30 |
| `Host.tsx` | 主 React 组件(管 instance-registry 注册/卸载)| ~170 |
| `instance-registry.ts` | **新增**:Host 实例注册表(模块级单例命令 handler 路由用)| ~30 |
| `types.ts` | DriverSerialized / TextEditingHostProps / TextEditingConfig 类型 | ~40 |
| `schema-builder.ts` | Schema 拼装 | ~50 |
| `editor-view-builder.ts` | EditorView + plugin 装配 | ~60 |
| `capability-integrations/selection-source.ts` | selection 集成(实例隔离 source)| ~40 |
| `capability-integrations/clipboard-handlers.ts` | clipboard 集成(模块级单例 + 实例路由)| ~60 |
| `capability-integrations/undo-scope.ts` | 占位 noop | ~10 |
| `capability-integrations/dnd-targets.ts` | 占位 noop | ~10 |
| `capability-integrations/insertion-safeguards.ts` | 占位 noop | ~10 |
| `blocks/text-block/spec.ts` | textBlock spec | ~80 |
| `blocks/text-block/README.md` | 设计说明 | ~30 |
| `README.md` | driver 总览 | ~50 |

合计 ~570 行代码 + 文档。Step 4 实施时按本清单执行。

---

## 9. 不做的事(L5-A 范围严格)

- ❌ 其他 block(math / code / table / image / list / 等留 L5-B/L5-C/L6+)
- ❌ marks(bold / italic / link / 等留 L5-B)
- ❌ undo-redo 实际功能(scope 占位,L5-B 加 prosemirror-history)
- ❌ dnd 实际功能(占位,L5-B 加块拖动)
- ❌ insertion safeguard 实际功能(占位,L5-B 加)
- ❌ 多 envelope clipboard / paste dispatcher(L5-B 加)
- ❌ input-rules(L5-B 加)
- ❌ container-keyboard / 块拖动手柄 / Slash 触发(L5-B+ 加)
- ❌ 行内链接 noteLink(L5-C 加)

---

## 10. L5-B/C 增量预告(便于 v0.1 留接口位)

| 阶段 | 增量内容 |
|---|---|
| L5-B | 加 marks(bold / italic / strike / code)/ undo-redo(prosemirror-history)/ heading 变体 / 基础 list / blockquote / dnd 块拖动手柄 / multi-envelope clipboard / paste dispatcher / input-rules |
| L5-C | 加 noteLink inline atom node / image 块 / horizontalRule(行内链接服务跨笔记互动)|
| L6 | 加 table / math-block / code-block(嵌 CodeMirror)/ callout / toggle-list / column-list / etc. |
| L7+ | 媒体块(audio / video / file)/ 跨内容形态 dropTarget / 用户自定义 block |

每阶段实施时升级本 DESIGN.md 到 v0.X。

---

## 11. 风险 + 开放问题

### 11.1 view 切换时 driver 资源是否会泄漏?

view unmount 时,capability 注册需要全部清理(铁律 12 错误隔离 + 卫生)。

**推荐**:Host 用 useEffect cleanup 保证清理。每个 capability-integration 的 register 函数返回 unregister 闭包,Host 集中调用。

### 11.2 多个 view 同时打开 text-editing 时的实例隔离(v0.2 已解决)

**已在 v0.2 通过 § 5.1 + § 2.2 修复**(P1.3):
- selection source 命名 `'text-editing-driver:<instanceId>'`,instanceId 由 view 通过 config 提供(NoteView 用 workspaceId)
- 每个 Host 实例 mount 时 `registerSelectionSource(instanceId)`,emit 时带相同 source
- capability 命令 handler 是模块级单例,通过 `selection.api.getCurrent().source` + `instance-registry` 路由到具体 EditorView

**L5-A 完成判据 § 7 #9 验证**:2 个 NoteView 在 2 个 Workspace,各自独立 source / undoScope,互不冲突。L5-A 阶段就要实测,不留 L5-B。

### 11.3 PM 5 个包的 npm 屏障?

按 charter § 1.3,driver 内合法 import PM(基础设施 npm)。但 ESLint barrier 当前规则可能拦截。

**推荐**:Step 4 实施前先调整 eslint.config.js — 让 `src/drivers/` 跟 `src/capabilities/` 一样允许 import prosemirror-*。

### 11.4 Schema 演化(L5-B 加新 block 时已存 doc 怎么办)?

PM Schema 加节点不影响已存 doc(parseDOM 不识别新节点会跳过)。改 attrs default 也不破。

**推荐**:L5-A 阶段保守 — 只加节点和 attrs,不删除不重命名。L7+ 真有 schema 大改需求时设计 migration 机制。

### 11.5 view 切换 doc 时,EditorView 重建还是复用?

例:NoteView 切笔记 A → 笔记 B,EditorView 该重建吗?

**推荐**:**复用 EditorView**,通过 `view.updateState(newState)` 切换 doc。重建会丢失光标 / scroll / 等内部状态。L3.5 SlotArea 已有"按 viewId 缓存,React 实例不重建"机制,Host 内部 EditorView 也跟随。

### 11.6 L5-A 不实施 undo-redo 会不会用户体验差?

PM 默认带基础 undo(浏览器 undo 栈),但跟 PM history plugin 的 undo 行为不一致 — Cmd+Z 可能扰乱 PM 内部状态。

**推荐**:L5-A 接受这个限制(测试时用户尽量不用 Cmd+Z)。L5-B 优先级最高(加 prosemirror-history)。

---

## 12. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;L5-A 范围(只 textBlock + selection/clipboard 部分集成 + 占位 undo/dnd/insertion);driver 单例 + Host 组件接口 + Schema 拼装 + EditorView 装配 + 5 capability 集成模块 + commandRegistry handler + 完成判据 9 条 + 实施清单 10 文件 + L5-B/C 增量预告 + 6 个风险/开放问题。 |
| 2026-05-05 | v0.2 | **AI 审计后 P1 修复**: (P1.1 Host 契约) Host props 改 `doc: DriverSerialized` / `onChange: (DriverSerialized) => void`,view 不接触 PMDoc;(P1.2 命令 handler 多实例冲突) 重写 § 2.2 生命周期分两层 — 模块级单例 capability handler(应用启动注册一次,永不卸)+ 实例级 specific 资源(selection source / undoScope / dropTarget 等带 instanceId 隔离);(P1.3 selection source 实例隔离) source 命名 `text-editing-driver:<instanceId>`,Host 通过 config.instanceId(view 传 workspaceId)区分;新增 `instance-registry.ts` 模块文件让单例命令 handler focus-aware 路由到具体 EditorView 实例。 |
| 2026-05-05 | v0.2.1 | **AI 复审 P1/P2 闭环**: (P1.1 双向契约)§ 2.3 dispatchTransaction 示例改成 `onChange(DriverSerialized)`(原写 `onChange(newState.doc)` PMDoc),封装/解包逻辑显式化;(P2 文档内部冲突)§ 11.2 风险段从"L5-B 多 Workspace 验证时确定"改成"v0.2 已解决,L5-A 完成判据 #9 实测",消除"已修复+未修复并存"的状态漂移。L5-A 完成判据加 #9(2 NoteView 多 Workspace 实例隔离)。 |
