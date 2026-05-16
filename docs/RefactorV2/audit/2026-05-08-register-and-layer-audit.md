---
title: V2 注册原则 / 分层原则合规评估
date: 2026-05-08
scope: src/ 全量(L0~L5,所有 capability/view/driver)
ref:
  - docs/00-architecture/charter.md v0.4 § 1.1 / § 1.2 / § 1.3 / § 1.4
status: 待整改
---

# V2 注册原则 / 分层原则合规评估

> 本报告是 V2 重构期"字面合规但运行时违规"风险的一次系统性体检。
> 对照基准:[charter.md](../../00-architecture/charter.md) v0.4 § 1.1(分层)/§ 1.2(注册)/§ 1.4(视图归属)。
> 不修代码,只出诊断 + 整改清单。代码整改在另一份 plan 里推进。

---

## 0. 结论速览

| 维度 | 评估 | 关键证据 |
|---|---|---|
| 注册原则(§ 1.2) | ❌ 主承诺**未落地** | `install` 0 消费者;`capabilityRegistry.register()` 0 调用 |
| 分层原则(§ 1.1 / § 1.3) | ⚠️ **多处穿透** | view→view 1 处、view→storage 1 处、driver→storage 7 处、capability→slot 5 处 |
| § 1.4 视图归属 | ⚠️ **view 普遍超重** | NoteView 165 行(3.3×)、WebView 429 行(8.6×)|
| 自动化拦截 | ❌ **无内部边界 lint** | eslint 只管对外 npm 包,内部 alias 无规则 |
| 回归测试 | ❌ **无相关测试** | 全仓 0 个 `*.test.*` |

**整体判断**:V2 的"注册闭环"两端同时缺位,导致 § 1.4 强制的"view 是能力组合声明"在运行时无法兑现;eslint 只在对外屏障层面布防,内部层间穿透没有任何摩擦力,自然顺势发生。需要先把闭环点亮,再把内部边界焊死,view 瘦身才有立足点。

---

## 1. 评分卡

| 原则 | 承诺(charter 出处) | 现状 | 等级 |
|---|---|---|---|
| **R1** view 通过 install 列表声明能力依赖 | § 1.2 / § 1.4 / § 2.1 | install 字段存在,运行时无任何消费 | **P0 Critical** |
| **R2** capability 通过 registerCapability 注册到 Registry | § 1.2 | Registry 实现到位,**无任何调用方** | **P0 Critical** |
| **R3** view 不直接 import 能力实现(0 处) | § 1.2 / § 2.1 | view 直接 `import @drivers/*` 普遍存在(降级语义,可接受);但 view→view 直 import 1 处违规 | P1 High |
| **R4** view 文件 20~50 行,>100 行需审查 | § 1.4 / § 2.1 | NoteView 165、WebView 429 | P1 High |
| **R5** driver 不触达 storage(单向链路 View→Cap→Sem→Storage) | § 1.1 / § 2.1 | driver 直 import `@storage/media-store` 7 处 | P1 High |
| **R6** capability 不反依赖 slot/workspace 基础设施 | § 1.1 | 5 个 capability 全部 import `@slot/workspace-bus/channel` | P2 Medium |
| **R7** ESLint 拦截内部边界穿透 | § 1.3 末段 | 仅拦对外 npm 包,内部 alias 无规则 | P1 High |
| **R8** 注册装配有自动化回归 | § 1.2(隐含) | 全仓无测试 | P2 Medium |

---

## 2. 详细 Findings

### 2.1 [P0-1] `install` 是死代码 — 注册原则主承诺空转

**对应承诺**:charter.md:88 / 115 / 199 / 269

> View 通过 install 列表声明能力依赖,**0 处直接 import 能力实现**;能力调用通过 install 列表 + Registry **间接路由**。

**代码现状**:

- 类型声明:[view-definition.ts:36](../../../src/slot/view-type-registry/view-definition.ts#L36) `install: string[]`
- 真实填写:[views/note/index.ts:25-34](../../../src/views/note/index.ts#L25-L34)
  ```ts
  install: ['selection','clipboard','undo-redo','drag-and-drop','insertion','text-editing-driver']
  ```
- 注册分发:[view-type-registry.ts:96-112](../../../src/slot/view-type-registry/view-type-registry.ts#L96-L112) 的 `distributeToRegistries` 只读 `contextMenu / toolbar / slash / handle / floatingToolbar`,**对 `install` 没有任何处理**

**反向验证**:
```
$ grep -rn "\.install" src/slot src/views src/capabilities | grep -v ".md:"
(0 行)
```

**影响**:
- 改 `install` 列表对运行时无任何效果(增删都不报错、不装配、不卸载)
- charter.md:11 自己点名要避免的失败模式("字面合规但运行时违规")命中
- view 如果"忘了 install"也无人提醒,因为根本没人检查

**修复思路**(指引,非本报告交付):
- `registerView()` 内部对每个 `install[i]` 调 `capabilityRegistry.has(id)`,缺失则 `console.error` 或抛错
- 保留 install 的"声明性",装配仍由 view 自己决定时机(避免引入复杂的 createInstance 生命周期),但**让违规可见**

---

### 2.2 [P0-2] `capabilityRegistry.register()` 0 调用 — 注册原则另一半缺失

**对应承诺**:charter.md:90-107

> Capability 实现注册时携带元数据,由 Capability Registry 统一管理。

**代码现状**:

- Registry 实现:[capability-registry.ts:18](../../../src/slot/capability-registry/capability-registry.ts#L18) — `register()` 入口齐备,且会自动把 `commands` 挂到 commandRegistry
- Capability 实现:5 个 capability 全部走**模块级单例 export**,绕过 Registry
  - [capabilities/insertion/index.ts:97](../../../src/capabilities/insertion/index.ts#L97) `export const insertion = new InsertionCapability()`
  - [capabilities/selection/index.ts:93](../../../src/capabilities/selection/index.ts#L93) `export const selection = new SelectionCapability()`
  - clipboard / undo-redo / drag-and-drop 同模式

**反向验证**:
```
$ grep -rn "capabilityRegistry\.register\|registerCapability" src/
src/slot/README.md:38       (文档)
src/slot/DESIGN.md:144      (文档)
(代码 0 处)
```

**影响**:
- `capabilityRegistry.has('insertion')` 永远返回 false
- 即便 P0-1 修复(install 校验启用),所有 view 全部 fail —— 因为没有 capability 在 Registry 里
- 命令路由(charter § 1.2 末段:"命令实现走 CommandRegistry,菜单项 `command: string` 是字符串引用")的"能力命令自动挂载"路径未跑通

**修复思路**:
- 每个 capability 的 `index.ts` 末尾追加 `capabilityRegistry.register({ id, commands: ..., ... })`
- 模块级单例 `export const xxx` 可保留(向后兼容),但 Registry 必须先有
- 等 P0-1 + P0-2 都接通后,view 通过 `capabilityRegistry.get(id).api` 取代直接 import 模块单例(渐进迁移)

---

### 2.3 [P1-3] View 远超 § 1.4 红线

**对应承诺**:charter.md:200 / 246 / 280 三处

> view 文件长度通常 20~50 行,**超过 100 行需要审查**(可能违反原则)。
> View **不存在独立实现**,0 UI 实现代码。

**代码现状**:

| view | LOC | 红线倍数 | 主要超量内容 |
|---|---|---|---|
| [NoteView.tsx](../../../src/views/note/NoteView.tsx) | **165** | 3.3× | 全局 keymap (Cmd+K/[/])、setTimeout 滚动、临时 DOM anchor 制造、useEffect 编排(4 个) |
| [WebView.tsx](../../../src/views/web/WebView.tsx) | **429** | 8.6× | `WebviewElement` 接口声明、SyncDriver 编排、translate 流程编排、生命周期守门 |

**反向验证**:
```
$ wc -l src/views/note/NoteView.tsx src/views/web/WebView.tsx
     165 src/views/note/NoteView.tsx
     429 src/views/web/WebView.tsx
```

**影响**:
- WebView 8.6× 超量;切底层(electron `<webview>` → BrowserView / Tauri webview / iframe)时,view 内的编排代码会一起烂掉,违反"换底层零成本"承诺(charter.md:160)
- NoteView 把"键盘命令路由"硬编码进来,而不是通过 commandRegistry + 全局 keymap registrar

**修复思路**(纲要,详方案另立):
- WebView:把 webview 操作 + SyncDriver/TranslateDriver 编排下沉为 capability `web-rendering` 的 `createInstance`,WebView 退化成 `<WebRenderingHost />` 单组件挂载
- NoteView:Cmd+K / Cmd+[ / Cmd+] 走 commandRegistry + 全局 keymap registrar(L4 加薄一层),view 只剩 install + Driver Host 的纯组合

注:本项与 P0-1 强相关。在 install 装配机制不工作的现状下,view 不得不就地写编排——P0 不修,P1-3 不可能持续合规。

---

### 2.4 [P1-4] View 间直连(破坏分层隔离)

**对应承诺**:charter § 1.1 单向调用 + § 1.4 view 平等

**代码现状**:
- [link-click-integration.ts:21](../../../src/views/note/link-click-integration.ts#L21):
  ```ts
  import { setWebUrl } from '@views/web/data-model';
  ```

**反向验证**:
```
$ grep -rn "from '@views/" src/views/
src/views/note/link-click-integration.ts:21:import { setWebUrl } from '@views/web/data-model';
(全仓唯一一处)
```

**影响**:
- note view 当 web view 的客户,note 想做"打开网页"必须知道 web view 内部 store 形状
- 如果 web view 切底层(Q-N1=B 描述的"换底层零成本")或 web 改 store 字段名,note 跟着碎
- 违反 § 1.4 "view 平等,无 variant" + § 1.1 "纵向单向调用"的精神

**修复思路**:
- 引入 capability `routing` 或在 `slot/workspace-bus` 上加一个语义 channel `route.open`,note 发 `{ kind: 'web', url }`,web view 自己订阅
- 或者把"打开 URL"做成 commandRegistry 上的命令 `web-view.openUrl`,note 通过 `commandRegistry.execute('web-view.openUrl', { url })` 调用(命令路由是 § 1.2 已经认可的间接调用机制)

---

### 2.5 [P1-5] Driver 直接触达 Storage(7 处)+ View 直接触达 Storage(1 处)

**对应承诺**:charter § 1.1 单向调用链 `View → Capability → Semantic → Storage`

**代码现状**(driver 层):
```
src/drivers/text-editing-driver/blocks/file-block/node-view.ts:16
  → import { mediaPutBase64, mediaResolvePath } from '@storage/media-store'
src/drivers/text-editing-driver/blocks/file-link/node-view.ts:16
src/drivers/text-editing-driver/blocks/video-block/node-view.ts:16
src/drivers/text-editing-driver/blocks/image/node-view.ts:19
src/drivers/text-editing-driver/blocks/audio-block/node-view.ts:18
src/drivers/text-editing-driver/plugins/build-paste-media-plugin.ts:28
src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts:20
```

**代码现状**(view 层,更越界):
- [views/note/link-panel/FileTab.tsx:18](../../../src/views/note/link-panel/FileTab.tsx#L18):
  ```ts
  import { mediaPutBase64 } from '@storage/media-store';
  ```

**影响**:
- driver 是 capability 的实现细节,理论上只该通过 capability 暴露的 API 跟外部说话;现在 driver 直接握住 storage 的私有函数
- view 直接读 storage 是更严重的越界,绕过了"能力层是唯一中间层"(charter.md:286)
- 切 storage(SurrealDB → SQLite / 远端 API)时,这 8 处全部要改

**修复思路**:
- 把 `@storage/media-store` 包装为 capability `media-storage` 的 API(`media.put / media.resolve / media.download`)
- driver 与 view 都改走 capability,storage 模块从能力外部不可见
- ESLint 加规则:`drivers/**` 与 `views/**` 禁 import `@storage/*`

---

### 2.6 [P2-6] Capability 反向依赖 Slot 基础设施(5 处)

**对应承诺**:charter § 1.1 纵向单向 + § 2.1 能力层"被 L5 view 调用"

**代码现状**:
```
src/capabilities/undo-redo/index.ts:10        → @slot/workspace-bus/channel
src/capabilities/drag-and-drop/index.ts:9     → @slot/workspace-bus/channel
src/capabilities/insertion/index.ts:9,10      → @slot/workspace-bus/channel + bus-types
src/capabilities/clipboard/index.ts:9         → @slot/workspace-bus/channel
src/capabilities/selection/index.ts:13        → @slot/workspace-bus/channel
```

5 个 capability **全数中招**。

**性质判断**:
- `ChannelHub` 本身是纯内存 pub/sub 原语(见 [channel.ts](../../../src/slot/workspace-bus/channel.ts)),没有 react/workspace/slot 语义
- 它**不应该**位于 `slot/`——应该在 `shared/`(或 capability 内部各自实现一份)
- 当前位置导致"能力层依赖 L4 基础设施"的反向调用关系,违反纵向分层

**影响**:
- 后续抽离 capability 成独立包(charter.md:201 暗示的 OWL 扩展)时,`@slot/workspace-bus/channel` 会一起被拖进去
- 短期影响低(capability 已稳定),但属于结构性债务

**修复思路**(两选一):
- **A. 物理迁移**:把 [channel.ts](../../../src/slot/workspace-bus/channel.ts) 迁到 `src/shared/event-bus/channel.ts`,`slot/workspace-bus` re-export,capability 改 import `@shared/event-bus/channel`
- **B. 接口约束**:capability 自带 `EventBus` 接口,由 view 注入实现(过度设计,与 charter Q5=B "避免过度" 冲突)

推荐 **A**,改动局部可控。

---

### 2.7 [P1-7] ESLint 缺内部边界规则

**对应承诺**:charter § 1.3 末段提供了 eslint 规则示意,但只针对对外 npm 包

**代码现状**:[eslint.config.js](../../../eslint.config.js) 共 5 个 `no-restricted-imports` 块,**全部针对 npm 包**:
- views/shell 禁 `prosemirror-* / three / pdfjs-dist / electron`
- drivers 禁 driver 互相 import + `electron`
- workspace/slot 禁业务 npm
- storage 禁业务 npm + react
- semantic/shared 禁所有业务 npm + 跨层 alias

**缺失规则**:
- `views/**` → 禁 `@storage/*`(P1-5 视图越界没人拦)
- `views/**` → 禁 `@views/<other>/*`(P1-4 跨 view 直连没人拦)
- `drivers/**` → 禁 `@storage/*`(P1-5 driver 越界没人拦)
- `capabilities/**` → 禁 `@slot/* / @workspace/*`(P2-6 反依赖没人拦)

**影响**:写代码时 0 摩擦,所有越界都"合法"通过 lint —— 这是 P1-4 / P1-5 / P2-6 在仓库自然发生的根因。

**修复思路**:在现有 5 个块里追加内部 alias 的 patterns。整改路径见 § 4。

---

### 2.8 [P2-8] 无注册装配 / 边界回归测试

**代码现状**:
```
$ find src -name "*.test.*" -o -name "*.spec.*"
(0 个)
```

**影响**:
- P0-1 修复后,如果某 view 的 install 列表写了不存在的 capability,只能等到运行时白屏
- 边界穿透在 lint 加规则后会拦住增量,但**存量 8 处穿透**没有测试压顶,后续可能反复

**修复思路**:
- L4 加一个 `__dev__/install-coverage.ts` 启动自检:遍历 `viewTypeRegistry.getAll()`,对每个 install id 跑 `capabilityRegistry.has()`,缺失即 throw
- 不必引入 vitest/jest;用 `npm start` 时 dev-only 启动校验即可(对齐 charter Q5=B "避免过度设计")

---

## 3. 根因分析

8 个问题归为两类根因:

### 根因 A — 注册闭环未浇筑(P0-1 + P0-2)

`install` 与 `capabilityRegistry` 是 § 1.4 "view 是能力组合声明"的承重墙。两端同时缺位时,view 没有"声明 → 装配"的物理通道,业务逻辑只能就地写在 view 里 —— 这直接催生了 P1-3(view 超重)。

```
        声明端(R1)              装配端(R2)
        ┌──────────┐           ┌──────────┐
view ── │ install: │ ─?─?─?─── │ Registry │ ──→ capability
        └──────────┘           └──────────┘
              ✗ 死代码           ✗ 0 调用

导致:
  ➜ view 不得不内嵌业务编排   → P1-3 view 超重
  ➜ 命令路由不工作            → view 写 keymap → 进一步加重 P1-3
```

### 根因 B — 内部边界无 lint 摩擦(P1-7)

eslint 只布防"对外 npm 屏障",对内部 alias 零规则。开发时直 import 任何路径都通过,自然产生:

```
P1-4(view→view 直连)
P1-5(view/driver→storage 直连)
P2-6(capability→slot 反依赖)
```

这三条都是"写起来太顺手"的结果,而非"明知故犯"。lint 一旦覆盖,新增违规会被卡住;存量违规则需要主动整改。

---

## 4. 整改优先级与顺序

按"先点亮闭环 → 再焊死边界 → 最后瘦身"的顺序:

### Wave 1(P0,先做)
| # | 动作 | 涉及文件 | 风险 |
|---|---|---|---|
| W1.1 | 5 个 capability 末尾加 `capabilityRegistry.register({...})` | `src/capabilities/*/index.ts` | 低(只加一行,模块单例保留) |
| W1.2 | `registerView()` 内对 install 跑 `capabilityRegistry.has()` 校验,缺失 console.error | `view-type-registry.ts` | 低(不抛错,只警告) |
| W1.3 | 加 dev-only 启动自检 `install-coverage.ts` | 新增 `__dev__/` 文件 | 低 |

**验收标准**:`npm start` 后 console 不出现 install 校验警告;手动改 install 加个不存在的 id,启动应当 console.error。

### Wave 2(P1,边界焊死)
| # | 动作 | 涉及文件 | 风险 |
|---|---|---|---|
| W2.1 | eslint 加 `views/** → @storage/* / @views/*` 禁 import | `eslint.config.js` | 中(会暴露存量违规) |
| W2.2 | eslint 加 `drivers/** → @storage/*` 禁 import | `eslint.config.js` | 中 |
| W2.3 | eslint 加 `capabilities/** → @slot/* / @workspace/*` 禁 import | `eslint.config.js` | 中 |

**注**:W2 加规则会让 P1-4 / P1-5 / P2-6 全部 lint 红 —— 必须配合 W3 同期解决。

### Wave 3(P1,存量边界违规清理)
| # | 动作 | 工作量 |
|---|---|---|
| W3.1 | 把 `@storage/media-store` 升级为 capability `media-storage`,7 处 driver + 1 处 view 改走 capability API | 中(改 import + 接口设计) |
| W3.2 | view→view 直连改走 commandRegistry 命令路由(`web-view.openUrl`)| 小 |
| W3.3 | `ChannelHub` 物理迁移到 `src/shared/event-bus/`,5 处 capability 改 import | 小(re-export 兜底) |

### Wave 4(P1,view 瘦身)
| # | 动作 | 工作量 |
|---|---|---|
| W4.1 | NoteView 全局 keymap → commandRegistry + keymap registrar | 中 |
| W4.2 | WebView 编排 → capability `web-rendering` createInstance | 大(本质是把 WebView 大半下沉) |

**目标**:NoteView ≤ 80 行,WebView ≤ 80 行。20~50 行红线作为 Stretch Goal,允许 § 1.4 规定的"超过 100 行需审查"作为短期妥协线。

### Wave 5(P2,长期)
- W5.1 注册装配测试体系(若引入 vitest 才做)

---

## 5. 不在本次整改范围

为避免 scope creep,以下问题登记但不在本次整改:
- v1 → v2 数据模型迁移(已有 [v1-note-migration-audit.md](../v1-note-migration-audit.md))
- 命令体系(commandRegistry)的全局 keymap registrar 设计 —— W4.1 触发时再单独立 design
- Capability `media-storage` 的完整 API 设计 —— W3.1 触发时单独立 design
- charter v0.4 → v0.5 的修订 —— 视整改进展决定是否需要补充设计澄清

### 5.1 W4.2 Session 1 验证期间发现的预存 bug(2026-05-08)

跟分层/注册原则整改无关,但既然在主分支上重现成功,登记跟进:

- **WebView 访问 google.com 时闪屏 + 菜单点击立刻收起** —— Google 反爬挑战页(`/sorry/index?...&q=EhAm...`)频繁切 URL,WebView 的 `did-navigate` handler 持久化每次 URL 又触发新 navigate,大量 `ERR_ABORTED (-3)`。**main 与 W4.2 Session 1 分支同症,确认是预存 bug**,跟 driver 物理迁移无因果
- **`useSyncExternalStore` getSnapshot 警告** —— 启动时 React DevTools 报 `The result of getSnapshot should be cached to avoid an infinite loop`,触发点疑似 `WebView.tsx:65` 或 `:74` 的两个 useSyncExternalStore;data-model.ts 已有 cache 机制(memory 里 `feedback_use_sync_external_store_stable_ref`),但本警告在 main 同样可见,**预存 bug**

**处置**:**不在 audit Wave 4.x 整改范围**(audit 关注分层/注册原则,这两条是 Electron webview / React hook 维度问题)。后续单独立 issue 跟进,优先级看是否影响用户感知。

### 5.2 W5 严格态边界定义(2026-05-08 复审钉死)

W5 完工后用户复审提"capability 模块级单例 + driver/slot 直 import 链路是否仍违反注册原则"。澄清 W5 严格态有 3 个可能定义,W5 实际选了其中之一:

| 定义 | 范围 | 工作量 |
|---|---|---|
| **A:View 边界严格态**(W5 选此) | view 0 处直 import @capabilities/* 或 @drivers/* 运行时值;driver/slot 仍可直 import capability 模块级单例(charter line 88 主语是 View) | 已完成 |
| B:全局注册式访问 | A + driver/slot/frame-bindings/triggers 也走 registry;capability 模块级 export 不删但所有消费链路改造 | charter 未明文要求,**留 follow-up** |
| C:模块级 export 完全删除 | B + 所有 capability 删 `export const`,任何消费者必须经 registry | 最严格,**留 charter v0.5+** |

#### W5 选 A 的理由

1. **charter line 88 字面主语是 View**:"View **不直接 import 能力实现**"。driver/slot 不在禁列
2. **driver 是 capability 内部实现细节**(charter § 1.3 表格 capability 封装 driver),它们跟 capability 协作天然紧密;走 registry 反而设了一层冗余
3. **slot 是 L4 基础设施**,跟 capability 在层次上几乎平级(同属 V2 工程实施基础),互相 import 不构成跨层穿透

#### W5 不选 B/C 的理由

1. charter v0.4 没明文要求"全局注册式访问"
2. driver 端走 registry 间接路由会让 capability-integrations / build-block-handle-plugin 等关键文件变得啰嗦,工程价值低
3. capability 模块级 export 当前是 driver/slot 内部消费者用,不是"过渡兜底"
4. 升级到 B/C 工作量大(driver 端尤其敏感,clipboard-handlers / selection-source 等都要改;capability 模块级 export 删除涉及全部老消费者)

#### 已知边界

- **W5 完工后仍存在的现状**(用户复审 P1-B 指出):
  - 5 老 capability 模块级 `export const selection / clipboard / undoRedo / dnd / insertion`
  - media-storage 模块级 `export function mediaPutBase64 / mediaDownload / mediaResolvePath`
  - driver 内部(text-editing-driver)直 import 上述 capability 单例
  - slot/frame-bindings(ToolbarBinding / FloatingToolbarBinding)直 import selection
  - slot/triggers(use-context-menu-trigger)直 import selection
- **W5 严格态(定义 A)允许这些**——它们都是合规 capability 协作链路

#### Follow-up(若需升级到 B/C)

- 启动 W6 严格态:driver/slot 全切 registry 间接路由
- 启动 W7 严格态:capability 模块级 export 删除,renderer side-effect import 兜底注册
- charter v0.5 修订时**首先需要明确**A/B/C 选哪个作为字面终态

**W5 完工状态命名**(commit message / 收尾报告统一用):
> charter v0.4 工程可执行严格态(View 边界,间接路由)

---

### 5.3 popup 认清为第六交互 Registry(2026-05-15 emoji-picker sprint 复审)

emoji-picker sprint 期间用户复审"capability 字面 import @slot/triggers/popup-controller + @slot/interaction-registries/popup-registry/* 是否违反分层"。澄清:

**字面性质**:
- charter § 1.2 字面列出"五大交互各自 Registry":ContextMenuRegistry / ToolbarRegistry / SlashRegistry / HandleRegistry / FloatingToolbarRegistry
- popup-registry / popup-controller 是 V2 后期(L5-B3.4)补加的**同型基础设施** — capability 注册 popup Component,view/floating-toolbar/keymap 通过 popupController.show 触发
- charter § 1.2 字面 capability 自注册到 Registry **是合规向上调用**(capability-registry / command-registry 已在 audit § 5.2 字面认清)
- popup 性质完全同 capability-registry / command-registry — capability 提供内容 + 触发 popup,L4 收集 + 渲染

**认清结果**:
- popup-registry / popup-controller 作为**第六交互 Registry**,capability 字面允许 import
- eslint.config.js capability 主块 `no-restricted-imports` 字面把 `@slot/interaction-registries/popup-registry/*` 和 `@slot/triggers/popup-controller` 从禁列**移出**(与 capability-registry/command-registry 同型例外)
- charter v0.5 修订时**字面追加** popup 入 § 1.2 "五大交互"列表 → 改为"六大交互"

**Follow-up(本 sprint 未做)**:
- charter v0.5 字面追加 popup 描述
- 已有 popup integration 文件(emoji-picker / link-panel / color-picker / note-link-search 4 处 + popups.ts + register-pm-commands.ts)字面无需改 import 路径(本来就 import 对的位置,只是 eslint 字面误禁)

### 5.4 ESLint config block 互覆盖 bug 登记(2026-05-15 emoji-picker sprint 发现)

emoji-picker sprint 审计期间发现 V2 eslint.config.js 字面**两个 capability block 互覆盖**让规则失效:

**字面证据**:
- eslint.config.js line 141-174 字面定义 capability 主块(`no-restricted-imports` patterns 含 9 个禁/例外条目)
- eslint.config.js line 182-193 字面 "P1-1 严格版屏障 — three 单点屏障" 块 ignores 字面 `canvas-rendering/`,对其他 `capabilities/**` 设了 `no-restricted-imports` 只含 `three / three/*`
- **ESLint flat config 字面行为**:同一 rule 在多个 config block 之间**相互覆盖**(`{ rule: [...] }` 是替换不是合并),后块字面覆盖前块
- `npx eslint --print-config src/capabilities/<any>.ts` 字面输出 `no-restricted-imports` 只剩 `three / three/*` patterns

**实证**:
```
$ echo "import {x} from '@slot/triggers/popup-controller';" > src/capabilities/__test.ts
$ echo "import {y} from '@workspace/foo';" >> src/capabilities/__test.ts
$ echo "import {z} from '@views/note/x';" >> src/capabilities/__test.ts
$ npx eslint src/capabilities/__test.ts
exit 0(0 错误 - 应该全报 error)
```

**影响**:
- audit § 2.6 [P2-6] 字面声明 "Wave 3.3 已修 capability 反依赖 slot",**实际只做了物理迁移(channel.ts → @shared/event-bus),lint 拦截层一直没生效**
- audit § 5.2 W5 字面 capability 不互拉 / 不向上拉 view 等多条规则字面写了**全部不工作**
- **任何**违反 capability 主块 patterns 的新增字面**都不会被 lint 拦**

**严重程度**: **P0 Critical**(影响整个 V2 lint 屏障可信度)

**修法(独立 sub-phase,不本 sprint 动)**:
- 把 P1-1 three 屏障字面**合入** capability 主块的 patterns 数组(line 141-174 内追加 one entry),删第二个 block
- 或两个 block 字面用**不同的 rule id**(如 一个用 `no-restricted-imports`,一个用某 custom rule)避免覆盖
- 配合 W5/Wave 3 字面规则一并启用 + 清理被暴露的存量违规(预计 10+ 处)

**Follow-up sub-phase**:`fix/eslint-capability-block-merge`(待启动)

---

## 6. 度量

整改完成后需要满足的可观测指标:

| 指标 | 目标 |
|---|---|
| `grep -rn "\.install" src/` 的消费点 | ≥ 1(注册侧) |
| `grep -rn "capabilityRegistry.register" src/` 的注册点 | ≥ 5(每个 capability 一个) |
| `grep -rn "from '@views/" src/views/` | 0 |
| `grep -rn "from '@storage" src/views/ src/drivers/` | 0 |
| `grep -rn "from '@slot" src/capabilities/` | 0 |
| eslint `--max-warnings 0` 全过 | ✅ |
| NoteView LOC | ≤ 100 |
| WebView LOC | ≤ 100(Stretch ≤ 80) |

---

## 7. 风险与回滚

- **W1 风险**:几乎没有,只是新增注册调用。回滚 = 删掉 register 调用即可
- **W2 风险**:lint 升级会让 CI 红,必须与 W3 同期落地。建议在同一 PR 内或同一分支内连续推进
- **W3.1 风险**(driver→storage):涉及 7 处 driver 文件,改动面较大。建议分两步:先在 capability 层加 wrapper(等价转发),再批量改 import,**两步互不耦合**
- **W4.2 风险**(WebView 重构):大改动,建议作为独立分支(如 `refactor/web-view-thinning`),与 W1~W3 隔离
- **回滚原则**:每个 Wave 都自带可回滚边界(单独 commit / 单独分支)
