---
title: Wave 5 严格收尾 — install 真装配 + text-editing capability 化 + view 直 import 清零
date: 2026-05-08
ref:
  - docs/00-architecture/charter.md v0.4 § 1.1 / § 1.2 / § 1.3 / § 1.4
  - docs/RefactorV2/audit/2026-05-08-register-and-layer-audit.md
  - docs/RefactorV2/audit/wave4-design/W4.2-web-rendering-capability.md(过渡方案登记)
status: design draft — 待 user review
risk: 高(R2 改动量与 W4.2 等量;view 直 import 清零涉及 20+ 处)
trigger: 用户复审复审反馈"严格遵守原则"(P1×2 + P2 ×1)
---

# Wave 5 严格收尾设计

> 用户复审复审(2026-05-08)指出 W4.1/W4.2 后仍有 3 处与 charter 严格口径不一致:
> - **P1-A**:install 只校验不装配,view 仍直接 import 能力实现
> - **P1-B**:install 仍允许 driver ID(text-editing-driver)
> - **P2**:view→@capabilities/* 直 import 残留(L5-alive / FileTab 等)
>
> 这些之前在 W4.x 文档里都登记为 "过渡方案 / charter v0.5+"。Wave 5 的目标是把
> 过渡方案兑现成最终方案 — **严格遵守** charter v0.4 § 1.2 line 88 / § 1.4 line 269。

---

## 1. 现状审计

### 1.1 R1 范围:install 装配 + view 直 import 清零

**view → @capabilities/* 直 import 现状(8 处)**:

| 消费者 | import | 用途 | 复杂度 |
|---|---|---|---|
| views/L5-alive.ts | selection / clipboard / undoRedo / dnd / insertion(5 处)| 读 .sourceCount / .serializerCount 等诊断字段 | 低 — 改走 registry.get(id).api |
| views/note/link-panel/FileTab.tsx | mediaPutBase64 | 上传文件 | 低 — 函数式 API |
| views/web/WebView.tsx | Host, HostHandle | React 组件 + 类型 | 中 — Host 是组件不是 api |
| views/web/translate-view/TranslateWebView.tsx | TranslateHost | React 组件 | 中 |

**capability 当前 export 形态**:全部"模块级 export 单例 / 函数 / 组件",没有统一的 api 入口。

**charter line 88 + 269 严格要求**:
> View **不直接 import 能力实现**——只通过 install 列表声明依赖能力 ID。
> 能力调用通过 install 列表 + Registry **间接路由**。

→ 当前 0/8 合规。Wave 5 R1 目标 8/8 合规。

### 1.2 R2 范围:text-editing 拆 capability

**view → @drivers/text-editing-driver 直 import 现状(11 处文件)**:

```
views/L5-alive.ts                     — instanceRegistry(诊断)
views/note/NoteView.tsx               — textEditingDriver / textEditingDriverApi / DriverSerialized
views/note/note-store.ts              — DriverSerialized(类型)
views/note/note-commands.ts           — textEditingDriverApi / MarkName(20+ 命令调用)
views/note/data-model.ts              — createEmptyDoc / extractFirstParagraphText
views/note/link-click-integration.ts  — setLinkClickHandler
views/note/link-panel/LinkPanel.tsx   — textEditingDriverApi
views/note/note-link-search/...       — driver api(查询用)
views/note/color-picker/...           — driver api(颜色选择器)
```

**driver 现状**:`src/drivers/text-editing-driver/`,7902 行,封装 prosemirror-* 全套。`text-editing-driver` 在 install 列表里也直接出现(note/index.ts L25)。

**charter § 1.3 表格**:
> | `prosemirror-*` | capability.text-editing |

charter 期望的是 **`capability.text-editing`** —— 不是 `text-editing-driver`。当前命名 + 结构都跟 charter 不对齐。

**目标**:仿 web-rendering 三层模式
- 新建 `capabilities/text-editing/`:对外面孔(api / Host / 类型 / 注册到 capabilityRegistry)
- 现有 `drivers/text-editing-driver/` 保留,作为 capability 内部实现(不改内部代码)
- view install 改 `['text-editing']`,view 不再直 import driver
- 11 个 view 文件改 import 路径

→ 这是 R2 的真规模:**跟 W4.2 同等量级**(W4.2 view 改 4 文件;R2 view 改 11 文件,但 driver 内部不动,capability 仅是门面层)。

### 1.3 R3 范围:install driver ID 清零

`note/index.ts` install 列表当前:
```ts
install: ['selection','clipboard','undo-redo','drag-and-drop','insertion','text-editing-driver']
```

R2 完成后改为:
```ts
install: ['selection','clipboard','undo-redo','drag-and-drop','insertion','text-editing']
```

`KNOWN_DRIVER_IDS` 白名单整体淘汰(0 driver id,严格 capability-only)。

→ R3 是 R2 完成后的自然结果,不需要单独工作。

---

## 2. 设计目标(严格)

按 charter v0.4 line 88 / 269 严格口径:

1. **install 列表 0 driver ID** — 严格 capability-only
2. **view 0 处直 import @capabilities/* 实现** — 全部走 `capabilityRegistry.get(id).api` 间接路由
3. **view 0 处直 import @drivers/* 实现** — 同上,走 capability api
4. **能力调用统一通过 capability api**,而不是模块级 export 单例
5. **`KNOWN_DRIVER_IDS` 白名单淘汰** — 整改完无遗留

非目标:
- ❌ 改 driver 内部代码(driver 是 capability 内部实现细节,W5 只动门面)
- ❌ 重新设计 capability api 字段命名(沿用现有模块级 export 名称)
- ❌ charter v0.4 → v0.5 文档修订(W5 仅工程实施;若 v0.4 措辞不清,留 follow-up)

---

## 3. 设计选择

### 3.1 capability api 暴露形态

charter line 92-105 capability 注册示例:
```ts
registerCapability({
  id: 'text-editing',
  schema: ...,
  converters: ...,
  createInstance: ...,
  commands: ...,
});
```

但 charter 的 `createInstance` 是为"有 host + options 的实例化"设计(对齐 PM EditorView 这种生命周期对象)。当前 V2 的 capability 既有"实例工厂型"(text-editing 的 driver Host 组件)也有"纯函数型"(media-storage 的 mediaPutBase64)、还有"诊断型"(selection.sourceCount 只读字段)。

**统一 api 接口设计**:每个 capability 暴露一个 `api: object`,内部按需放方法 / 组件 / 字段引用。

```ts
interface CapabilityDefinition {
  id: string;
  /** 能力对外 API — view 通过 capabilityRegistry.get(id).api 拿到 */
  api?: unknown;
  // 既有 createInstance / commands / schema / converters 留 backward compat
  createInstance?: (host: HTMLElement, options: unknown) => unknown;
  commands?: Record<string, CommandHandler>;
  schema?: unknown;
  converters?: unknown;
}
```

view 端调用模式:
```ts
import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { TextEditingApi } from '@capabilities/text-editing/types';   // 仅类型 import,允许

const textEditing = capabilityRegistry.get('text-editing')?.api as TextEditingApi;
textEditing?.toggleMark(instanceId, 'bold');
```

**关键约束**:
- view 可以 import capability 的**类型**(纯类型 import,不引入运行时依赖,charter 容许)
- view **不能** import capability 的运行时值(api 实例 / 函数 / 组件)
- 运行时值统一走 `capabilityRegistry.get(id).api`

### 3.2 view 用 React 组件(Host)怎么办

WebView 当前 `import { Host } from '@capabilities/web-rendering'` —— Host 是 React 组件,不是 api 字段。

选项 A:`Host` 也放 `api`:`api: { Host, TranslateHost }`,view 通过 `capabilityRegistry.get('web-rendering').api.Host` 拿到。

选项 B:capability 暴露"渲染槽"机制——view 不直接拿组件,而是通过 `capabilityRegistry.get(id).api.render(props)` 返回 ReactElement。

**选 A**(简单):组件作为 api 字段是合规的"通过 registry 间接拿运行时值"。view 拿到 Host 后正常 JSX:
```tsx
const Host = capabilityRegistry.get('web-rendering')?.api.Host;
return Host ? <Host {...props} /> : null;
```

view 端写法稍变,但语义清晰。

### 3.3 view 端 helper(避免重复 boilerplate)

每次 `capabilityRegistry.get(id)?.api as XApi` 太冗长。提供类型化辅助:

```ts
// src/slot/capability-registry/use-capability.ts
export function getCapabilityApi<T>(id: string): T | undefined {
  return capabilityRegistry.get(id)?.api as T | undefined;
}
```

view 调用:
```ts
const textEditing = getCapabilityApi<TextEditingApi>('text-editing');
textEditing?.toggleMark(instanceId, 'bold');
```

更短。仍是 registry 间接路由。

### 3.4 backward compat 期间的兜底

R1 实施期间不能一次性把 8 处 view import 全切——会有半截状态。允许 capability 模块**同时**:
- export 模块级单例(老消费者用)
- 在 register 时把单例**包**进 api 字段(新消费者用)

```ts
// capabilities/selection/index.ts
class SelectionCapability { /* ... */ api = { /* methods */ } sourceCount: ... }
export const selection = new SelectionCapability();   // 老路径(R3 完成后删)
capabilityRegistry.register({ id: 'selection', api: selection });   // 整个实例当 api
```

R3 把所有 view 切完后,删除模块级 export(`export const selection`),只留 register。这是"严格"状态。

---

## 4. 实施计划(分 4 个 commit)

### C1:capability registry api 字段 + getCapabilityApi helper + 6 capability 注册时带 api

**改动**:
- `CapabilityDefinition` 加 `api?: unknown` 字段
- `capabilityRegistry.register` 已有(不动)
- 新增 `src/slot/capability-registry/get-capability-api.ts` 类型化辅助
- 6 capability(selection / clipboard / undo-redo / drag-and-drop / insertion / media-storage / web-rendering)的 `register({...})` 调用加 `api: <instance/object>`
- 7 capability 全部加 api 字段(包括 web-rendering)

**对外行为零变化** — view 仍走老路径直 import,新 api 字段只是可选并行存在。

**风险**:低(纯增量)

### C2:6 处低复杂度 view 切到 registry.get(L5-alive + FileTab)

**改动**:
- `views/L5-alive.ts` 5 处 capability import 全改走 `getCapabilityApi`(读 sourceCount / serializerCount 等)
- `views/note/link-panel/FileTab.tsx` 改走 `getCapabilityApi('media-storage').mediaPutBase64`

**验证**:典型场景手测(诊断 + 文件上传)

**风险**:低

### C3:WebView / TranslateWebView 改走 capability api

**改动**:
- WebView 端:`import { Host, HostHandle } from '@capabilities/web-rendering'` → 类型留(纯类型 import 合规),`Host` 通过 `getCapabilityApi('web-rendering').Host` 取
- TranslateWebView 同款
- 验证:webview 浏览 / 双栏翻译 仍 work

**风险**:中(组件通过 registry 取,可能有 React identity 问题)

### C4:text-editing capability 化 + R2 + R3

**改动**(C4 是 Wave 5 的硬骨头,独立 session):

**C4a:新建 `src/capabilities/text-editing/`**
- `index.ts`:`registerCapability({ id: 'text-editing', api: { ... } })` — api 内部 re-export driver 的 textEditingDriver / textEditingDriverApi / setLinkClickHandler / DriverSerialized 类型 / Host 组件 / createEmptyDoc / extractFirstParagraphText / instanceRegistry 等
- `types.ts`:对外类型 (`TextEditingApi`)
- `DESIGN.md`

**C4b:11 处 view 文件改 import**
- 类型 import 改 `from '@capabilities/text-editing/types'`
- 运行时值改走 `getCapabilityApi<TextEditingApi>('text-editing')`
- 关键文件:NoteView / note-commands(20+ 命令调用)/ data-model / link-click-integration

**C4c:install 改 `['text-editing']` + 删 KNOWN_DRIVER_IDS**
- `note/index.ts` install 列表中 `text-editing-driver` → `text-editing`
- `known-driver-ids.ts` 删除(整体淘汰)
- `validateInstall` / `install-coverage` 不再有 driver 白名单分支
- `install-coverage` web-view + note-view 行 drivers 列消失(仅 capabilities 列)

**C4d:capability 模块级 export 删除**
- `selection/index.ts` 等删 `export const selection`(只留 register)
- 此时 R1 进入"严格"状态:0 处 view 直 import @capabilities/* 模块级值

**风险**:高(R2 改动面 + 删模块级 export 容易遗漏)

---

## 5. 验收标准

W5 完工时:

| 项 | 标准 |
|---|---|
| `grep -rn "from '@capabilities/" src/views/` | **0 命中**(view 0 处直 import capability 运行时值)|
| `grep -rn "from '@capabilities/.*types" src/views/` | 允许(纯类型 import)|
| `grep -rn "from '@drivers/" src/views/` | **0 命中**(driver 完全 capability 内部) |
| `grep -rn "export const " src/capabilities/*/index.ts` | **0 命中**(模块级单例 export 全删) |
| install 列表 driver id | **0 处**(全部 capability id) |
| `KNOWN_DRIVER_IDS` | **整文件删除** |
| capability `api` 字段 | 7/7 capability 全部填写 |
| typecheck / lint --max-warnings 0 / vite build | 全过 |
| 功能回归 | 笔记编辑 / web 浏览 / 双栏翻译 / 媒体粘贴 / Cmd+K/[/] / 翻译注入 全部 OK |
| audit § 6 度量 | 完全合规(8/8 行通过 ✅)|

---

## 6. 风险与决策点(请 user review)

### 风险 1:capability 模块级 export 删除会引发"启动副作用消失"

5 个 Wave 1 capability 的 `register()` 调用是放在文件末尾的 side-effect。L5-alive 通过 `import { selection } ...` 触发模块加载 → register 跑。

C4d 删 `export const selection` 后,**谁来 import 触发模块加载**?

**解决**:[platform/renderer/index.tsx](src/platform/renderer/index.tsx) 加显式 import:
```ts
import '@capabilities/selection';
import '@capabilities/clipboard';
import '@capabilities/undo-redo';
import '@capabilities/drag-and-drop';
import '@capabilities/insertion';
import '@capabilities/media-storage';
import '@capabilities/web-rendering';
import '@capabilities/text-editing';   // C4 新加
```

8 行显式 side-effect import,启动时确保所有 capability 注册。L5-alive 改成只读 registry。

### 风险 2:view 通过 registry.get 拿组件可能有 React identity 问题

`Host` 组件每次 `getCapabilityApi('web-rendering').Host` 取出来引用是稳定的(指向同一个 forwardRef 函数)——React 不会因 identity 失效重 mount。但**保险起见 view 端用 useMemo 缓存一次**:

```ts
const Host = useMemo(() => getCapabilityApi<WebRenderingApi>('web-rendering')?.Host, []);
```

如果实测真有问题,这是 fallback。

### 风险 3:R2 文件改动多,容易在 NoteView 命令注册某条遗漏

`note-commands.ts` 有 20+ `textEditingDriverApi.<method>` 调用。改成 `getCapabilityApi<TextEditingApi>('text-editing')?.<method>` 是机械替换,但 `?.` 操作符的 short-circuit 会让漏改的 method 静默 noop——**用户感觉是"某个命令不工作"**而不是 typecheck 红。

**缓解**:
- `TextEditingApi` 类型严格定义,所有 method 强制类型化
- 改完 lint 检查没有遗留 `textEditingDriverApi` 引用
- 完整功能回归(笔记编辑 / 加粗 / heading / 颜色 / undo / Turn Into 12 种 / Slash 插入)

### 决策点 1:capability api 单一字段 vs 拆分(api / Host / commands)

我设计的 `api: unknown`(`api: TextEditingApi` 实际类型)是单一字段。

替代:`CapabilityDefinition` 拆 `api / components / commands` 多字段。

我倾向**单一字段**:简单,view 只需记一个字段名。tradeoff:capability 内部要把组件和函数都塞同一对象。

**问 user**:同意 A?

### 决策点 2:Wave 5 一次性做完还是分 session

按文档 § 4 拆分:
- C1 + C2 :低风险 + 中等改动,可一个 session 做完
- C3 :中风险,1 个 session
- C4 :高风险 + 大改动 + 功能回归严格,**独立 session**

**问 user**:接受这个 3-session 节奏?C4 完成前会有"半截状态"(部分 view 走新 api,部分仍走老路径)——这期间任何 commit 都通过 typecheck 但 runtime 行为不一致风险存在。

### 决策点 3:charter v0.4 是否需要修订

charter v0.4 line 92-105 的 `registerCapability` 示例有 `createInstance / commands / schema / converters` 字段,**没有 api 字段**。Wave 5 引入 api 字段相当于**增量扩展 charter**。

是否需要 charter v0.5 文档修订?

我建议**不动 charter,Wave 5 实施日志里说明 api 是 V2 工程实施增量**。charter v0.4 的 `createInstance` 在 V2 没全面用上(只 web-rendering 的 Host 组件勉强对应,但走 ref API 不是 createInstance 模式),这是 charter 自己的留白,V2 实施按需扩展合理。

**问 user**:接受不动 charter?

---

## 7. follow-up(明确不在 W5 范围)

- charter v0.5 文档修订(若需要)
- capability `createInstance` 字段是否启用(用于 driver 实例化时的 host + options 传入)
- driver 协议铁律 5 是否需要扩展(driver 之间事件总线 — 当前 SyncDriver/TranslateDriver 互不依赖,未来若有需求再说)
- audit P2-8 注册装配测试体系(若需要,引入 vitest)

---

## 8. 跟之前 Wave 的关系

- 本 Wave 是 W4.x 过渡方案的兑现:
  - W4.2 § 2 "view 通过 registry.get 间接拿 capability"(标过渡) → R1 兑现
  - W4.2 § 9 follow-up "text-editing-driver 拆 capability"(标 charter v0.5+) → R2 兑现
  - W2 / W4.x 一直留的 KNOWN_DRIVER_IDS 白名单 → R3 整体淘汰
- W5 完工后 audit § 6 度量表 8 项全部合规
- W4.2 设计文档 § 2 的两条非目标可以删除("过渡方案"已结束)
