---
title: Wave 5 严格收尾 — install 严格校验 + 间接路由统一 + text-editing capability 化
date: 2026-05-08
ref:
  - docs/00-architecture/charter.md v0.4 § 1.1 / § 1.2 / § 1.3 / § 1.4
  - docs/RefactorV2/audit/2026-05-08-register-and-layer-audit.md
  - docs/RefactorV2/audit/wave4-design/W4.2-web-rendering-capability.md(过渡方案登记)
status: design v5 — v5 复审采纳:eslint prosemirror-* 加 allowTypeImports: true / 严格态边界明确为"定义 A:View 边界"(B/C 留 follow-up)/ 收尾状态命名 "charter v0.4 工程可执行严格态(View 边界,间接路由)"
risk: 高(R2 改动量与 W4.2 等量;view 直 import 清零涉及 20+ 处)
trigger: 用户复审反馈"严格遵守原则"(P1×2 + P2 ×1)+ v2 review 3 条修订
---

# Wave 5 严格收尾设计

> 用户复审(2026-05-08)指出 W4.1/W4.2 后仍有 3 处与 charter 严格口径不一致:
> - **P1-A**:install 只校验不装配,view 仍直接 import 能力实现
> - **P1-B**:install 仍允许 driver ID(text-editing-driver)
> - **P2**:view→@capabilities/* 直 import 残留(L5-alive / FileTab 等)
>
> 这些之前在 W4.x 文档里都登记为 "过渡方案 / charter v0.5+"。Wave 5 的目标是把
> 过渡方案兑现成最终方案 — **严格遵守** charter v0.4 § 1.2 line 88 / § 1.4 line 269。
>
> ## 边界澄清(v2 修订):"间接路由"vs"真装配"
>
> 用户 v2 review 指出原标题"install 真装配"措辞偏强。**Wave 5 不挑战"自动装配"
> 这个更高目标**,而是把"view 主动直 import 能力实现"的反模式改成"view 通过
> capabilityRegistry 间接路由 + install 严格校验"。
>
> | 模式 | view 行为 | 是否 W5 目标 |
> |---|---|---|
> | 直 import(W5 之前)| `import { foo } from '@capabilities/x'` | ❌ 反模式,W5 消除 |
> | **间接路由(W5 目标)** | `requireCapabilityApi<XApi>('x').foo()` | ✅ |
> | 自动装配(charter 终态)| view 通过 React Context 注入,无主动检索 | charter v0.5+ |
>
> 间接路由的语义价值:**view 跟 capability 模块解耦**(import 链不存在),capability
> 切实现 view 一行不改;但 view 仍主动通过 string id 查找,不算 charter line 88
> "声明依赖 + 自动装配"的字面终态。这是 W5 的明确边界,不再夸大。
>
> **W5 完工后的状态命名**(v5 钉死):**charter v0.4 工程可执行严格态(View 边界,间接路由)**
>
> "View 边界"明确范围:**view 端**0 处直 import capability/driver 运行时值。
> driver / slot / frame-bindings / triggers 等仍可直 import capability 模块级单例
> (charter line 88 主语是 View,不在禁列)。详见 audit § 5.2 "W5 严格态边界定义"
> 把 A(View 边界,W5 选)/ B(全局注册式)/ C(模块级 export 删除)三种可能严格态
> 区分,声明 W5 选 A,B/C 留 follow-up。
>
> 实施日志 / commit message / 收尾报告统一用此命名,避免"严格遵守 charter"被读者
> 误解为终态。

## 0.1 硬约束(v4 新增)

W5 实施全程,以下两条不再是"约定"或"建议",而是 **硬约束**:

### 硬约束 H1:业务路径必须 `requireCapabilityApi`

| 路径性质 | helper | code review 标准 |
|---|---|---|
| 业务路径(命令 handler / view render / 文件上传 / 编辑器命令)| `requireCapabilityApi` | **拒绝**任何 `getCapabilityApi(...)?.foo()` 形式 — `?.` short-circuit 静默化是 v3 review P2 已识别风险 |
| 诊断路径(L5-alive 读 sourceCount 等) | `getCapabilityApi` | 允许;capability 没注册时退化输出而非破坏诊断 |
| 跨可选 capability(未来某 view 可选增强) | `getCapabilityApi` | 允许;缺失退化是设计意图 |

### 硬约束 H2:ESLint 规则在 C1 commit 同步落地

W5 不接受"先改代码,完工后加 lint"路径——这意味 C1+C2+C3+C4 之间任何 commit 都没有强制力,view 偷偷回退到直 import 不会立刻被发现。

**改为**:**C1 commit 加 ESLint 规则的同时,必须把所有现有 view→capability 直 import 全部切掉**(原 C2 内容并入 C1)。lint 在 C1 commit 后立刻达到强约束态,后续 C3/C4 任何 view 想直 import 立刻爆 lint。

**实施层后果**:原"C1+C2 同 session"拆分 → C1+C2 **合并成一个不可分割的 commit**(中间的 lint 红 commit 不能合 main)。Wave 5 三 session 节奏调整为:

| Session | commit | 内容 |
|---|---|---|
| 1 | **C1+C2(合并)** | capability api 字段 + helpers + 7 capability 注册 api + types.ts + ESLint 规则 + L5-alive/FileTab 切换 |
| 2 | C3 | WebView/TranslateWebView 切 capability |
| 3 | C4 | text-editing 拆 capability + R2/R3 |

---

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

## 2. 设计目标

按 charter v0.4 line 88 / 269 + 用户 review 边界:

1. **install 列表 0 driver ID** — 严格 capability-only
2. **view 0 处直 import @capabilities/* 运行时值** — 全部走 `requireCapabilityApi(id)` 间接路由
3. **view 0 处直 import @drivers/* 运行时值** — 同上,走 capability api
4. **能力调用统一通过 capability api**,而不是模块级 export 单例
5. **`KNOWN_DRIVER_IDS` 白名单淘汰** — 整改完无遗留
6. **install 严格校验**(沿用 Wave 1 + 加强:driver id 不再有白名单豁免)

允许:
- ✅ view `import type` from `@capabilities/<id>/types`(纯类型,无运行时依赖,charter 容许)

非目标:
- ❌ **install 真装配 / 自动注入**(charter line 88 字面终态)— W5 仅做"间接路由统一",真装配需要为 view 引入 React Context / hook 体系,工作量翻倍且 capability 函数式调用(命令 handler 内调 mediaPutBase64)难以套入 React tree。留 charter v0.5+ 范围
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

### 3.3 view 端 helper(两版:软取 + 硬取)

每次 `capabilityRegistry.get(id)?.api as XApi` 太冗长。提供两个类型化辅助 — **业务路径**强制用硬取版本,避免 `?.` 静默化:

```ts
// src/slot/capability-registry/get-capability-api.ts

/**
 * 软取 — 缺失返回 undefined,适合诊断 / 可选场景(capability 没注册本身合理)
 */
export function getCapabilityApi<T>(id: string): T | undefined {
  return capabilityRegistry.get(id)?.api as T | undefined;
}

/**
 * 硬取 — 缺失立即 throw,适合业务路径(命令 handler / view render)
 *
 * 设计动机(v2 review P2):
 * - getCapabilityApi(...)?.foo() 的 ?. 会 short-circuit,foo 没跑用户感觉是
 *   "按钮没反应",console 0 warn,极难 debug
 * - require 路径在启动期 / 首次调用时立即抛错,问题立刻暴露
 */
export function requireCapabilityApi<T>(id: string): T {
  const api = capabilityRegistry.get(id)?.api as T | undefined;
  if (api === undefined) {
    throw new Error(
      `[capabilityRegistry] capability '${id}' has no api;` +
      ` view 须在 install 列表声明,且 capability 须 register({ id, api })`,
    );
  }
  return api;
}
```

view 调用约定(强制):

| 场景 | helper | 理由 |
|---|---|---|
| 命令 handler 业务调用(`note-view.toggle-bold` 等)| `requireCapabilityApi` | 缺失立刻抛错,不静默 |
| view render 取组件(`Host` / `TranslateHost`)| `requireCapabilityApi` | 缺失抛错可被 React error boundary 捕获 |
| 诊断(L5-alive 读 sourceCount)| `getCapabilityApi` | 软取,capability 没注册时不破坏诊断输出 |
| 跨可选 capability(未来某 view 可选增强)| `getCapabilityApi` | 软取,缺失退化 |

**约定写进 capability-registry README**,code review 时 `requireCapabilityApi` 优先。

view 调用示例:
```ts
const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
textEditing.toggleMark(instanceId, 'bold');   // 直接调,不用 ?.
```

→ 没有 `?.` short-circuit 风险,业务失败立即暴露。

### 3.4 backward compat 期间的兜底 + 模块级 export 边界

R1 实施期间不能一次性把 8 处 view import 全切——会有半截状态。允许 capability 模块**同时**:
- export 模块级单例(老消费者用)
- 在 register 时把单例**包**进 api 字段(新消费者用)

```ts
// capabilities/selection/index.ts
class SelectionCapability { /* ... */ api = { /* methods */ } sourceCount: ... }
export const selection = new SelectionCapability();   // 老路径(driver/slot 仍可用)
capabilityRegistry.register({ id: 'selection', api: selection });   // 整个实例当 api
```

**C4 实施时发现的边界**(v4 后修订):charter line 88 主语是 **View** —
> View **不直接 import 能力实现**

driver/slot/frame-bindings 等 capability 实现侧 / L4 基础设施层**不在禁列**。
W5 严格态 = **view 端 0 处直 import capability 运行时值**,不要求 driver/slot
也走 registry 间接路由(后者本来就比 view 离 capability 近,直 import 是合规的 capability 实现协作)。

实施层面:
- ✅ **view 端**:lint 强制走 registry(W5 ESLint 规则)
- ✅ **driver / slot / frame-bindings / triggers**:仍可直 import capability 模块级 export
- ✅ **capability 模块级 export 保留**(给 driver/slot 内部消费者用,而非"过渡兜底")
- 仅**无内部消费者的 capability**(C4 完工后:web-rendering)模块级 export 删除,作为"零消费者就清扫"的纯洁化

修订理由:原 v4 § 3.4 "R3 完成后删模块级 export"过严,会破坏 driver/slot 内部
合规消费链路。W5 严格态本就只指 view 边界,不应推广到所有层。

R3 把所有 view 切完后,删除模块级 export(`export const selection`),只留 register。这是"严格"状态。

---

## 4. 实施计划(分 3 个 commit:**C1+C2 合并** / C3 / C4)

### C1+C2(合并,原子)— 基础设施 + ESLint 规则 + 简单 view 切换

**v4 调整理由**:硬约束 H2 要求 lint 规则在 C1 同步落地,这意味着 C1 commit 完成的瞬间 lint 立刻报现有 view 直 import 违规——必须同步把所有违规切掉。原 C2 内容(L5-alive / FileTab 切换)并入 C1,**确保 C1 commit lint 一次性绿**。

**改动**(按依赖顺序):

1. **registry 基础设施**:
   - `CapabilityDefinition` 加 `api?: unknown` 字段
   - 新增 `src/slot/capability-registry/get-capability-api.ts`
     - `getCapabilityApi<T>(id)` 软取(诊断)
     - `requireCapabilityApi<T>(id)` 硬取(业务,缺失 throw)
   - 更新 capability-registry README 写明 H1 用法约定

2. **7 个 capability 注册时带 api + 提供 types.ts**:
   - selection / clipboard / undo-redo / drag-and-drop / insertion / media-storage / web-rendering
   - 每个 capability `register({ id, api: <instance/object> })`
   - 每个 capability 提供 `types.ts` 子模块(D4 强制),公开类型集中

3. **view 端切换(L5-alive + FileTab)**:
   - `views/L5-alive.ts` 5 处 capability import 改走 **`getCapabilityApi`**(诊断软取)
   - `views/note/link-panel/FileTab.tsx` 改走 **`requireCapabilityApi('media-storage').mediaPutBase64`**(业务硬取)

4. **WebView/TranslateWebView 临时使用 require**:
   - C3 才完整切 Host 组件,但 C1 加 lint 规则后这两文件的现有 `import { Host } from '@capabilities/web-rendering'` 立刻违规
   - **C1 同步**改这两文件的 Host 引用走 `requireCapabilityApi`(useMemo 缓存)
   - 类型走 `import type from '@capabilities/web-rendering/types'`
   - C3 范围实际上提前到 C1 完成了大半;C3 重命名为"二次审视 + react identity 验证 + 余留细化"

5. **ESLint 规则同步落地**(`eslint.config.js` `views/**` 块新增):
   ```js
   { group: ['@capabilities/*'],
     message: 'view 不直接 import capability 运行时值,走 requireCapabilityApi(id)' +
              '(若需类型,改用 import type 或 from @capabilities/<id>/types)',
     allowTypeImports: true },
   ```
   - 同时给 `drivers/*` 加规则(view 不直 import driver,allowTypeImports: true)— 但 C4 才把 NoteView 切完;C1 阶段先**不**给 drivers 加规则(否则 NoteView 立刻爆),drivers 规则在 C4 同步落地

6. **验证**:`npm run lint --max-warnings 0` 必须通过(0 新增违规)

**风险**:中(改动范围比 v3 C1+C2 大,但消除了"中间状态可绕过 lint"的真实风险,净收益正向)

### ~~C2~~(已并入 C1)

### C3:WebView/TranslateWebView 二次审视 + react identity 验证

C1 已经把 Host/TranslateHost 切到 `requireCapabilityApi + useMemo`。C3 范围收窄为:

- 完整功能回归(webview 浏览 / 双栏翻译 / Google Translate 注入 / 同步)
- 检查 React identity 是否稳定(多次 render Host 引用是否同一)— 若有问题用更强的 module-level cache
- 整理 `web-rendering/types.ts`(若 C1 没完整迁完)
- 移除 capability 模块级 export 兜底(`export const Host`,如果 C1 阶段为兼容保留)

**风险**:低(C1 已做主要工作)

### C4:text-editing 拆 capability + R2 + R3 + drivers/* lint 规则

**改动**(C4 是 Wave 5 的硬骨头,独立 session):

**C4a:新建 `src/capabilities/text-editing/`**
- `index.ts`:`capabilityRegistry.register({ id: 'text-editing', api: { ... } })` —
  api 内部 re-export driver 的 textEditingDriver / textEditingDriverApi /
  setLinkClickHandler / Host 组件 / createEmptyDoc / extractFirstParagraphText /
  instanceRegistry 等
- `types.ts`:对外类型 (`TextEditingApi`)
- `DESIGN.md`

**C4b:11 处 view 文件改 import**(对齐 H1 业务/诊断分流)
- 类型 import 改 `from '@capabilities/text-editing/types'`(D4 路径强制)
- 运行时值:
  - 业务路径(NoteView render / note-commands 20+ 命令 / link-click-integration / link-panel / data-model 编辑器初始化等)→ **`requireCapabilityApi`**
  - 诊断路径(L5-alive 读 instanceRegistry.count)→ `getCapabilityApi`

**C4c:install 改 `['text-editing']` + 删 KNOWN_DRIVER_IDS + 加 drivers/* lint 规则**
- `note/index.ts` install 列表中 `text-editing-driver` → `text-editing`
- `known-driver-ids.ts` 整文件删除(整体淘汰)
- `validateInstall` / `install-coverage` 删除 driver 白名单分支
- `install-coverage` web-view + note-view 行 drivers 列消失(仅 capabilities 列)
- ESLint `views/**` 块加 `{ group: ['@drivers/*'], allowTypeImports: true }` 规则
  (C4 完工后 view 0 处直 import driver,规则成立无违规)

**C4d:capability 模块级 export 删除**
- `selection/index.ts` 等删 `export const selection`(只留 `register`)
- `platform/renderer/index.tsx` 加显式 side-effect import 触发 capability 注册
  (见 § 6 风险 1)
- 此时 R1+R2+R3 全部进入"v0.4 工程可执行严格态":
  - 0 处 view 直 import @capabilities/* 运行时值
  - 0 处 view 直 import @drivers/* 运行时值
  - 0 capability 模块级 export
  - install 列表 0 driver id

**风险**:高(R2 改动面 + 删模块级 export 容易遗漏 + 启动副作用迁移)

---

## 5. 验收标准

W5 完工时:

### 5.1 自动化(eslint 规则,而非 grep)

v2 review P1-B 指出原 5.1 grep 跟 5.2 自相矛盾(grep 一刀切打死纯类型 import)。改用 eslint 精准分流:

**新增 eslint 规则**(`eslint.config.js` views/** 块):
```js
// W5 新增 — view 不能 import @capabilities/* 运行时值,只允许纯类型
{
  group: ['@capabilities/*'],
  message: 'view 不直接 import capability 运行时值,走 requireCapabilityApi(id)' +
           '(若需类型,改用 import type 或 from @capabilities/<id>/types)',
  allowTypeImports: true,   // 关键 — 允许 import type / import type {} / import { type X }
}
```

`allowTypeImports: true` 是 eslint `no-restricted-imports` 8.x+ 的精确控制:
- ✅ `import type { TextEditingApi } from '@capabilities/text-editing/types'`(纯类型)→ 通过
- ✅ `import { type TextEditingApi } from '@capabilities/text-editing'`(inline type)→ 通过
- ❌ `import { textEditingDriverApi } from '@capabilities/text-editing'`(运行时值)→ 拦下
- ❌ `import { Host } from '@capabilities/web-rendering'`(运行时值)→ 拦下

driver 同理,views/** 块加:
```js
{ group: ['@drivers/*'], message: 'view 不直接 import driver,走 capability api', allowTypeImports: true }
```

### 5.2 强制 types 子模块(capability 设计纪律)

每个 capability **必须**提供 `types.ts` 子模块,公开类型集中在那里。理由:
- view 端 `import type { XApi } from '@capabilities/<id>/types'` 路径明确
- 防止 view 误用 inline type from index.ts(虽然 inline type 是合规的,但路径不清晰会让审计困难)
- types.ts 是纯类型,即使被运行时 import 也不引入运行时副作用(types only TS 文件 vite 转译产物为空)

W5 实施时 7 capability 全部要补 types.ts(若现有 index.ts 已 export type,迁移即可)。

### 5.3 客观度量(W5 完工时)

| 项 | 标准 | 校验方法 |
|---|---|---|
| view 直 import capability 运行时值 | **0 处** | `npm run lint --max-warnings 0` 通过(W5 新规则触发) |
| view 直 import driver 运行时值 | **0 处** | 同上 |
| view 类型 import | 允许 | eslint allowTypeImports: true 显式放行 |
| `grep -rn "export const " src/capabilities/*/index.ts` | **0 命中**(模块级单例 export 全删)| 直接 grep |
| install 列表 driver id | **0 处** | 启动 console `[install-coverage]` 表 drivers 列全部 `—` |
| `KNOWN_DRIVER_IDS` | **整文件删除** | `ls src/slot/view-type-registry/known-driver-ids.ts` no such file |
| `validateInstall` driver 白名单分支 | 删除 | code review |
| capability `api` 字段 | 7/7 capability 全部填写 | `grep "api:" src/capabilities/*/index.ts` 7 命中 |
| typecheck / lint --max-warnings 0 / vite build | 全过 | npm scripts |
| 功能回归 | 笔记编辑 / web 浏览 / 双栏翻译 / 媒体粘贴 / Cmd+K/[/] / 翻译注入 全部 OK | 手测 |
| audit § 6 度量 | 完全合规(8/8 行通过 ✅)| 对照 audit 报告 |

### 5.4 验收结论用词(v5 钉死)

W5 完工后**只声称达到**:**charter v0.4 工程可执行严格态(View 边界,间接路由)**

- ✅ 工程可执行 — lint 强制、code review 可拦
- ✅ 严格 — audit 报告 P1+P2 全部 close,且复审 P1-A(prosemirror type import lint 矛盾)v5 已修
- ✅ View 边界 — view 端 0 处直 import capability/driver 运行时值
- ✅ 间接路由 — view 跟 capability 模块解耦,通过 string id 走 registry
- ❌ **不声称**"全局注册式访问"(定义 B)— driver/slot 直 import capability 模块级单例的现状保留
- ❌ **不声称**"capability 模块级 export 删除"(定义 C)
- ❌ **不声称**"达到 charter line 88 字面终态" — 自动装配留 charter v0.5+

实施日志、commit message、收尾报告全部使用此命名约束。详见 audit § 5.2 "W5 严格态边界定义"对 A/B/C 三种严格态的区分。

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

### 风险 3(✅ v2 review 采纳缓解 P2):require 硬取避免静默化

v2 review P2 指出 `?.` short-circuit 静默化问题。**已采纳**:`note-commands.ts` 等业务路径强制 `requireCapabilityApi`(见 § 3.3)。

```ts
// 旧设计(v1):静默
getCapabilityApi<TextEditingApi>('text-editing')?.toggleMark(...)
// → ?. short-circuit,api 没拿到 toggleMark 不跑,console 0 warn

// 新设计(v2):立即抛错
const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
textEditing.toggleMark(...)
// → 启动期 / 首次调用时 capability 没注册立刻 throw,React error boundary 捕获
```

**额外缓解**:
- `TextEditingApi` 类型严格定义,所有 method 强制类型化
- W5 新增 lint 规则拦截遗留 import(view 误写 `from '@drivers/...'` 立刻 lint 红)
- 完整功能回归(笔记编辑 / 加粗 / heading / 颜色 / undo / Turn Into 12 种 / Slash 插入)

### 决策点 1(✅ v2 review 采纳):capability api 单一字段

`api: unknown`(实际类型 `api: XApi`)单一字段。view 只需记一个字段名,简单。capability 内部把组件和函数都塞同一对象 — 由 capability 自己组织对象结构。

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

### 决策点 4(v2 新增):types 子模块强制

§ 5.2 提议每个 capability **必须**提供 `types.ts` 子模块,公开类型集中在那里。view 端 `import type { XApi } from '@capabilities/<id>/types'` 路径明确。

替代:不强制 types.ts,允许 view 用 `import type { XApi } from '@capabilities/<id>'`(从 index.ts 拿类型 + inline type)。

我倾向**强制 types.ts**:
- 路径明确,审计 `grep "from '@capabilities/.*/types'" src/views/` 一行得知 view 用了哪些 capability 类型
- 防止 view 误用 inline type(虽然合规但不易识别)
- capability 自己也获益:types.ts 是稳定接口,index.ts 是实现入口,边界清晰

代价:每个 capability 多 1 个文件(很多 capability 现在已经在 index.ts 里 export type,迁移成本低)。

**问 user**:同意强制 types.ts?

### 决策点 5(v2 新增):间接路由是否最终态

§ 1 边界澄清表:
- 间接路由(W5 目标):`requireCapabilityApi('x').foo()`
- 自动装配(charter 终态):view 通过 React Context 注入,无主动检索

W5 不挑战自动装配。但 charter line 88 字面要求是"声明依赖 + 自动装配",间接路由仍要求 view 主动通过 string id 查找 — **未到 charter 终态**。

是否将"自动装配"列为 charter v0.5+ 范围,还是 W5 加做?

我建议**留 charter v0.5+**:
- 自动装配需要为每个 view 引入 React Context Provider / hook 体系,额外 200~300 行基础设施
- capability 函数式调用(命令 handler 内调 mediaPutBase64)不在 React tree 内,需要给 hook 之外的路径再做一套 — 复杂度翻倍
- 间接路由已经把"view 跟 capability 模块解耦"做到了(import 链不存在,capability 切实现 view 一行不改)— 80% 价值

**问 user**:接受间接路由作为 W5 终点?

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
