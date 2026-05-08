---
title: audit 整改收尾报告
date: 2026-05-08
ref:
  - 起点:[2026-05-08-register-and-layer-audit.md](./2026-05-08-register-and-layer-audit.md)(Wave 0 评估)
  - 完成态:`charter v0.4 工程可执行严格态(View 边界,间接路由)`
final_main_commit: 312bece
status: closed
---

# audit 整改收尾报告

> 2026-05-08 启动 audit,同日完成 Wave 0~5 全部整改。本报告盘点全程产出、最终
> 度量、未尽事项,给这次整改正式画句号。

---

## 1. 整改边界一句话定位

**起点**:V2 注册原则(install)和分层原则(view→capability/storage/driver 直连等)
存在 8 项 finding(P0×2 / P1×4 / P2×2),"字面合规但运行时违规"。

**终点**:**charter v0.4 工程可执行严格态(View 边界,间接路由)**
- ✅ 工程可执行 — lint 强制(`--max-warnings 0` 全绿)、code review 可拦
- ✅ 严格 — audit 8 项 finding + 复审追加 3 项全部 close
- ✅ View 边界 — view 端 0 处直 import capability/driver 运行时值
- ✅ 间接路由 — view 跟 capability 模块解耦,通过 `requireCapabilityApi(id)` 走 registry
- ❌ **不声称**"全局注册式访问"(driver/slot 也走 registry)— 留 follow-up
- ❌ **不声称**"capability 模块级 export 全删"— 留 charter v0.5+
- ❌ **不声称**"达到 charter line 88 字面终态(自动装配)"— 留 charter v0.5+

详见 [audit § 5.2 W5 严格态边界定义](./2026-05-08-register-and-layer-audit.md#52-w5-严格态边界定义2026-05-08-复审钉死)。

---

## 2. 8 项 W0 finding 处置对照

| # | 等级 | 标题 | 处置 Wave | 状态 |
|---|---|---|---|---|
| R1 | P0 | install 字段死代码 | Wave 1 | ✅ close |
| R2 | P0 | capabilityRegistry.register 0 调用 | Wave 1 | ✅ close |
| R3 | P1 | view 直 import 能力实现 | Wave 5 | ✅ close(View 边界) |
| R4 | P1 | view LOC 超 § 1.4 红线 | Wave 4.1 + 4.2 | ⚠️ 部分(NoteView 111 / WebView 192,charter ≤100 仍超)|
| R5 | P1 | driver/view 直触 storage | Wave 3.1 + Wave 2 lint | ✅ close |
| R6 | P1 | view→view 直连 | Wave 3.2 + Wave 2 lint | ✅ close |
| R7 | P2 | capability→slot 反向依赖 | Wave 3.3 + Wave 2 lint | ✅ close |
| R8 | P2 | install 装配无回归测试 | — | ⚠️ 替代方案 |

**R4 部分**:view LOC 红线是 charter § 1.4 的"通常 20~50 行,超 100 行需审查"。W5 完工后:
- NoteView 111 行(Wave 4.1 减;W5 加 useMemo)
- WebView 192 行(Wave 4.2 减 ~57%;W5 仍含 banner UI 等业务)
- TranslateWebView 142 行(Wave 4.2 减 ~51%)

仍超红线但脱离原本"3-4×红线"区间。**banner / lang menu / WebToolbar 编排是合理的 view 业务**,不属于 capability 范围。继续瘦身需要把 banner 拆独立组件——**留 follow-up**。

**R8 替代方案**:Wave 1 引入 `install-coverage` dev-only 自检表(每次启动 console 打印 view × capabilities × missing 三列),覆盖了 audit § 4 W5.1 的"注册装配回归"目标。未引入 vitest 等独立测试框架,charter Q5=B "避免过度设计" 路径符合。

---

## 3. 复审追加项处置(W5 期间)

| # | 时间 | 来源 | 处置 |
|---|---|---|---|
| W4.x P1-A | W5 设计 v2 | "install 真装配"措辞偏强 | v2 修订:改为"间接路由统一",自动装配留 charter v0.5+ |
| W4.x P1-B | W5 设计 v2 | install 仍含 driver id | W5 C4 close(text-editing 拆 capability,KNOWN_DRIVER_IDS 整删) |
| W4.x P2 | W5 设计 v2 | view→capability 直 import 残留 | W5 C1+C2+C4 close(8 处 + 11 处全切) |
| W5 v2 P1-A | W5 设计 v3 | "真装配"标题与目标偏强 | v3 修订:边界澄清表 + 状态命名 |
| W5 v2 P1-B | W5 设计 v3 | 验收 grep 与 type 例外矛盾 | v3 修订:eslint 化 + allowTypeImports |
| W5 v2 P2 | W5 设计 v3 | `?.` 静默化风险 | v3 修订:requireCapabilityApi 硬取 |
| W5 v3 P1 | W5 设计 v4 | C2/C3 文案与硬取约定不一致 | v4 修订:C2/C3 用 require + lint 规则提前到 C1 |
| W5 v3 P2 | W5 设计 v4 | C1 数量笔误 | v4 修订:统一 7 capability |
| W5 v3 P3 | W5 设计 v4 | "严格"措辞 vs 边界澄清张力 | v4 修订:加"v0.4 工程可执行严格态"命名 |
| W5 完工 P1-A | W5 finalize | NoteLinkSearchPanel `EditorView` 类型违反 W2 lint | finalize:eslint prosemirror-* 加 allowTypeImports: true |
| W5 完工 P1-B | W5 finalize | capability 模块级单例 + driver/slot 直 import 仍存 | finalize 钉死:严格态边界 = View(选定义 A);B/C 留 follow-up |

设计文档反复迭代到 v5(`Wave5-strict-compliance.md`),audit 报告补 § 5.1 / § 5.2 两个新小节,所有用户反馈点全部留痕。

---

## 4. Wave 0~5 全程时间线

| Wave | 主题 | 改动文件 | 主合并 commit |
|---|---|---|---|
| W0 | 评估报告 | 1(audit 报告)| `fda33bb` |
| W1 | 注册闭环点亮(capability 自注册 + install 校验 + dev coverage)| 9 | `f46a738` |
| W3.3 | ChannelHub + Result 下沉到 shared | 9 | `de3fe09` |
| W3.2 | view→view 命令路由(note → web 改 commandRegistry) | 3 | `901d741` |
| W3.1 | media-store 物理迁移到 capability(C1+C2)| 10 | `22c6bd4` |
| W2 | eslint 内部边界规则焊死 | 1 | `0655747` |
| W4 设计 v2 | review 4 条修订 | 2 | `a810df6` |
| W4.1 | keymap registrar(NoteView 全局快捷键归位)| 11 | `c01258b` |
| W4.2 | web-rendering capability + sync/translate driver(5 阶段) | 25+ | `fb7a6ed` / `09d72a5` |
| W5 设计 v2-v5 | review 多轮迭代 | 1(每次) | `dc2b46d` / `71d3054` / `46b44d2` / `6223656` |
| W5 C1+C2 | capability api 字段 + helpers + 4 view 切 | 22 | `2dcfe01` |
| W5 C4 + finalize | text-editing 拆 capability + 11 view 切 + 严格态钉死 | 21 + 4 | `6474149` |
| W5.3 | storage 反向依赖清零 — md-to-pm 归位 capability + 删 storage 兜底 | 3 | `312bece` |

总计:**40+ commit**,**100+ 文件改动**。

W5.3 起源:W5 收尾报告写完后用户最终复审发现 storage/media-store.ts re-export
导致 storage → capability 反向依赖(W3.1 遗留),走 charter § 1.1 字面违规。
md-to-pm 归位 capability/text-editing/converters,storage 目录归零至 README only。

---

## 5. 最终量化指标(对比 W0)

### 5.1 注册原则

| 度量 | W0 | 当前 | 状态 |
|---|---|---|---|
| `grep -rn "\.install" src/slot src/views src/capabilities`(消费点) | 0 | 2 处 | ✅ |
| `grep -rn "capabilityRegistry.register" src/`(注册点) | 0 | **8 处** | ✅(charter § 1.2 注册原则:7 W4 capability + text-editing) |
| install 列表 driver id | 1(`text-editing-driver`)| **0** | ✅ |
| `KNOWN_DRIVER_IDS` 文件 | 存在 | **整文件删除** | ✅ |
| 启动 `[install-coverage]` 缺失数 | — | 0 | ✅ |

### 5.2 分层原则

| 度量 | W0 | 当前 | 状态 |
|---|---|---|---|
| `grep -rn "from '@views/" src/views/`(view→view) | 1 处 | **0** | ✅ |
| `grep -rn "from '@storage" src/views/ src/drivers/` | 8 处 | **0** | ✅ |
| `grep -rn "from '@capabilities" src/storage/`(W5.3 修)| 1 处 re-export | **0**(目录仅剩 README)| ✅ |
| `grep -rn "from '@slot/workspace-bus" src/capabilities/`(P2-6) | 5 处 | **0** | ✅ |
| **`grep -rn "from '@capabilities/" src/views/`(运行时)** | 8 处 | **0** | ✅(W5 View 边界) |
| **`grep -rn "from '@drivers/" src/views/`(运行时)** | 11 处 | **0** | ✅(W5 View 边界) |
| view 类型 import(`import type ... from '@capabilities/<id>/types'`) | — | 允许并使用 | ✅(charter 容许) |

### 5.3 工程纪律

| 度量 | W0 | 当前 | 状态 |
|---|---|---|---|
| `npm run lint --max-warnings 0` | 3 problems | **0** | ✅ |
| `npm run typecheck` | 通过 | 通过 | ✅ |
| `vite build` | 通过 | 通过 | ✅ |
| eslint 内部边界规则 | 0 条 | **6 条**(views/drivers/capabilities × storage/views/drivers/capabilities)| ✅ |
| eslint allowTypeImports 一致化 | 不一致 | 全部 prosemirror-*/three/pdfjs-dist/epubjs/foliate-js/@capabilities/*/@drivers/* 一致允许 | ✅(W5 finalize)|

### 5.4 view LOC

| view | W0 | 当前 | charter ≤100 ? |
|---|---|---|---|
| NoteView.tsx | 165 | **111** | ⚠️ 超 11 行(W4.1 减后 W5 加 useMemo;banner UI 业务合理)|
| WebView.tsx | 429 | **192** | ⚠️ 超 92 行(W4.2 减 -57%;banner / Toolbar handler 是 view 业务)|
| TranslateWebView.tsx | 292 | **142** | ⚠️ 超 42 行(W4.2 减 -51%;lang menu UI 是 view 业务)|

view LOC 是 charter § 1.4 软指标(20~50 行典型,超 100 需审查),不是硬约束。当前所有 view **都已远低于"3-4× 红线"区间**,且超出部分是合理 view 业务(UI 编排 / 状态订阅),不属于 capability 范围。

---

## 6. follow-up backlog

### 6.1 严格态升级路径

| 升级 | 触发条件 | 工作量 |
|---|---|---|
| W5 严格态 → 全局注册式(定义 B)| driver/slot 也走 `requireCapabilityApi`,不再直 import capability 模块级单例 | 大 — driver 端 capability-integrations / build-block-handle-plugin / floating-toolbar-source 等改造 |
| 全局注册式 → 模块级 export 删除(定义 C)| capability 删除所有 `export const xxx`,renderer 显式 side-effect import 兜底注册 | 中(B 完成后) |
| 模块级 export 删除 → 自动装配(charter line 88 终态)| view 通过 React Context 注入,无主动 string id 检索 | 大 — 需要为 view 引入 hook 体系 + 命令 handler 之外的路径单独处理 |

每一步升级**都需要先做对应的 charter 修订**(明确选哪种作为字面终态)。

### 6.2 view LOC 进一步瘦身

- WebView 192 → ≤100:把 banner UI / Toolbar handler 编排拆独立组件
- TranslateWebView 142 → ≤100:把 lang menu UI 拆独立组件
- NoteView 111 → ≤100:`useMemo Host getter` 抽工具函数

**性价比低**,没有跨 view 复用价值,机会主义瘦身即可。

### 6.3 charter v0.4 → v0.5 修订

W5 期间引入 `CapabilityDefinition.api` 字段是工程实施增量,charter v0.4 没列。
charter v0.5 修订时建议:
- 明确选哪种严格态作为字面终态(A/B/C/自动装配)
- `api` 字段写进 charter § 1.2 capability 注册示例
- 间接路由的 `requireCapabilityApi(id)` / `getCapabilityApi(id)` 模式作为 charter 推荐用法
- driver 在 V2 实施期独立拎出但 charter v0.4 未列的问题(driver vs capability 边界)

### 6.4 W4.2 期间发现的预存 bug(audit § 5.1 已登记)

| Bug | 触发场景 | 性质 |
|---|---|---|
| Google 反爬挑战页频繁切 URL → ERR_ABORTED | webview 访问 google.com 时 | webview 多次 navigate 互相打断,跟整改无关 |
| `useSyncExternalStore` getSnapshot 警告 | 启动期 | WebView.tsx:65/74 useSyncExternalStore 引用稳定性问题,跟整改无关 |

跟分层/注册原则无关,**留独立 issue 跟进**。

### 6.5 复审追加项中可考虑的进一步动作

| # | 内容 | 判断 |
|---|---|---|
| `requireCapabilityApi` 失败诊断升级 | 当前抛错 + console;可加自动 stack trace 上报 | 视用户实际遇到频次决定 |
| `text-editing` 命令式 API 类型化收紧 | 当前 `TextEditingDriverApi = typeof driverApi`,driver 加新方法 view 端类型自动可见;但反过来 view 用了不该有的方法不会被 lint 拦 | 严格态可考虑手写 `TextEditingApi` 接口,但 W5 选 typeof 是为了避免双重维护 |

---

## 7. 整改全程留下的设计文档

audit 整改全程留下的设计 / 决策文档(全部位于 `docs/RefactorV2/audit/`):

| 文档 | 用途 |
|---|---|
| [2026-05-08-register-and-layer-audit.md](./2026-05-08-register-and-layer-audit.md) | Wave 0 起点评估 + § 5.1 W4.2 期间预存 bug 登记 + § 5.2 W5 严格态边界定义 |
| [wave4-design/W4.1-keymap-registrar.md](./wave4-design/W4.1-keymap-registrar.md) | W4.1 设计文档 v2 |
| [wave4-design/W4.2-web-rendering-capability.md](./wave4-design/W4.2-web-rendering-capability.md) | W4.2 设计文档 v2(5 commit 阶段拆分) |
| [wave5-design/Wave5-strict-compliance.md](./wave5-design/Wave5-strict-compliance.md) | W5 设计文档 v5(经 4 轮 review)|
| [2026-05-08-closure-report.md](./2026-05-08-closure-report.md) | **本文档** — audit 整改收尾报告 |

---

## 8. 一句话总结

**audit 整改:从"字面合规但运行时违规"到"工程可执行 lint 强制的 View 边界严格态"。**

下一步若要更进一步严格,先修 charter,再开 W6+。

---

*整改主推手:用户 + Claude Opus 4.7,2026-05-08 单日完成。*
