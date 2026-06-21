# L5-G7 系统字体导入 + 嵌入内容(可移植)完成报告

> 阶段:L5-G7 — Graph 画板字体来源从「7 套打包」扩到「用户系统已装字体」,选了就**嵌进画板内容**(可移植)
> 分支:`feature/L5G7-system-font-import`(**不合 main**)
> 起草日期:2026-06-20
> 设计:[./L5G7-system-font-import-design.md](./L5G7-system-font-import-design.md) v0.2(4 拍板点全决 §10 + G7.0 前置 §11)
> 执行指令:[../../tasks/2026-06-20-L5G7-system-font-import-embed-prompt.md](../../tasks/2026-06-20-L5G7-system-font-import-embed-prompt.md)
> G7.0 兼容性清单:[./L5G7-G7.0-opentype-compat-report.md](./L5G7-G7.0-opentype-compat-report.md)

---

## 0. 一句话结论

✅ **全链路打通,墙 3 可移植成立。** 字体面板列本机系统字体(可搜索)→ 选一个 → 8MB 守卫 + license 确认 → 字体(.ttc 抽子字体)嵌进画板文档 → 渲染 / 导出 / 换机一致。CJK(含苹方 PingFang SC)经纯 JS ttc 拆解 shim 完整支持,**零额外依赖**(仍 opentype.js@1.3.4)。

6 个自包含绿 commit。tsc 0;eslint 与 main 基线持平(10 问题全为既有 baseline,本段新增 0);新单测 17 绿。真机视觉确认留用户(总指挥环境无 GUI)。

---

## 1. 完成清单(按 commit)

### Commit 0 — G7.0 opentype 兼容性清单([ca0d680](#))
开工第一步(设计 §11 前置)。本机 2611 真实系统字体实测:`.ttf/.otf` parse 99.9%/99.5%;`.ttc` 直 parse **0%**(`ttcf` 签名)——而 Mac 所有中文主力字体全是 .ttc。**纯 JS 拆解 shim 救回 47/49**,苹方/黑体/Hiragino `getPath('测')` 出真字形。结论:**无需换库**,首版即支持 .ttc(D1,用户拍板)。

### Commit 1 — G7.1 主进程系统字体扫描([543fa34](#),11 files +721)

| 文件 | 说明 | 状态 |
|---|---|---|
| `platform/main/fonts/ttc-extract.ts`(NEW) | 纯 JS 把 .ttc 子字体重组成独立 sfnt(救 CJK,零依赖) | ✅ |
| `platform/main/fonts/sfnt-name-reader.ts`(NEW) | 只读 name 表(平台优先级打分,苹方解析为 "PingFang SC");扫描 **26s→0.5s** | ✅ |
| `platform/main/fonts/system-font-scan.ts`(NEW) | 扫 Mac(含 AssetsV2 苹方)/Win → `{family,style,path,fontIndex,format,supported}`;.ttc 展开 per-subfont;readFontBinary 供嵌入 | ✅ |
| `platform/main/fonts/font-handlers.ts`(NEW) | IPC `FONT_LIST_SYSTEM` | ✅ |
| `ipc-bus.ts` / `preload` / `electron-api.d.ts` / `channel-names.ts` / `message-types.ts`(SystemFontEntryDTO) | IPC 接线 | ✅ |
| `tests/platform/ttc-extract.test.ts` + `sfnt-name-reader.test.ts`(NEW) | ttc 拆解 + 苹方 name 平台优先级回归 | ✅ |

### Commit 2 — G7.2 font-store 嵌入存储([08b3499](#),7 files +345)

| 文件 | 说明 | 状态 |
|---|---|---|
| `platform/main/fonts/font-store-impl.ts`(NEW,仿 media-store-impl) | `font://` 协议(default + per-ws session)+ `krig-data/fonts/` + SHA256 去重(基于抽出的单 sfnt,体积更小)+ `embed(path,fontIndex)` + 裸 fontId 前缀查找 | ✅ |
| `font-handlers.ts`(+FONT_EMBED) / preload / d.ts | IPC | ✅ |
| `capabilities/font-storage/index.ts`(NEW,仿 media-storage) | renderer IPC 封装 + capabilityRegistry.register | ✅ |
| `platform/main/index.ts` | registerSchemesAsPrivileged 加 `font` + registerProtocol + did-attach-webview 补注册 | ✅ |
| `platform/renderer/index.html` | CSP `connect-src` 加 `font:`(loadFont fetch 受 connect-src 管) | ✅ |

### Commit 3 — G7.3 loadFont 吃嵌入字体([8e75a73](#),5 files +144/-21)

| 文件 | 说明 | 状态 |
|---|---|---|
| `lib/atom-serializers/svg/font-loader.ts` | `FontCacheKey = FontKey \| embed:${id}`;loadFont 识别 embed: → `fetch('font://<id>')`;`FontFamily` 扩 embed;pickFontForChar 返回 embed key;新增 pickPackagedFallbackForChar(G7-8 兜底) | ✅ |
| `lib/atom-serializers/svg/text-to-path.ts` | splitByFont 改异步:嵌入字体 `charToGlyphIndex===0` 缺字 → 回退打包字体(CJK 不丢) | ✅ |
| `capabilities/canvas-rendering/types.ts` | `text_font` 扩 `embed:<id>` | ✅ |
| `tests/drivers/font-family-override.test.ts`(+4) | embed 前缀路由 + 缺字打包兜底 | ✅ |

### Commit 4 — G7.4 Aa 面板选择器 + 嵌入确认弹窗([b56cd95](#),17 files +631/-7)

| 文件 | 说明 | 状态 |
|---|---|---|
| `capabilities/node-toolbar/sections/text/index.tsx` | 打包字体下拉 + 「系统字体」折叠分组(懒加载/可搜索/family 去重)+ license 常驻小字 + ⓘ | ✅ |
| `capabilities/node-toolbar/types.ts` + `NodeToolbar.tsx` + `index.ts` + `styles.css` | SectionContext/Props 扩 listSystemFonts / embedSystemFont(view 注入,保 W5 view-agnostic) | ✅ |
| `views/graph-canvas-view/font-embed-confirm-popup/*`(NEW 4 files) | 仿 X 2.5-a popupController:8MB 守卫警示 + license 文案(设计 §6 锁定);pending 带 resolve 回调(await 友好) | ✅ |
| `views/graph-canvas-view/GraphCanvasNodeToolbar.tsx` | 接 font-storage(requireCapabilityApi):probe 体积 → showFontEmbedConfirm → fontEmbed → text_font='embed:<id>' | ✅ |
| `views/graph-canvas-view/index.ts` | registerFontEmbedConfirmPopup + install 加 font-storage | ✅ |
| `font-handlers.ts`(+FONT_PROBE_SIZE) / preload / d.ts / font-storage | 嵌入前预估子字体真实大小(8MB 守卫,不落盘) | ✅ |
| `platform/renderer/index.tsx` | `import '@capabilities/font-storage'`(side-effect 自注册) | ✅ |

### Commit 5 — G7.5 导出可移植性不变量([284b953](#),1 file +69)

| 文件 | 说明 | 状态 |
|---|---|---|
| `tests/lib/embed-font-export-invariant.test.ts`(NEW) | 证明 atomsToSvg 输出**纯 `<path>`**,无 `<text>`/font-family/@font-face/font:// 引用;embed key 经 loadFont 发 `font://font-deadbeef` 仍输出纯 path | ✅ |

---

## 2. 墙 3 收口(可移植性证明)

**端到端数据流**(目标态全部落地):

```
主进程:扫描(name-only,0.5s)→ 选中 → embed(ttc 抽子字体 + SHA256 落盘 font://)
渲染:text_font='embed:<id>' → atomsToSvg → pickFontForChar(embed key)
     → loadFont fetch('font://<id>') → opentype.parse → getPath → <path>
```

**收口点 = `loadFont`(渲染层一处)。** 三消费者(画板 TextRenderer / X 长图 render-blocks-to-media / graph 截图)全过 `atomsToSvg→textToPath→loadFont`,自动一致,无需各改。

**可移植的硬证据(G7.5 单测)**:`textToPath` 输出是**纯 `<path d="...">` 矢量轮廓**——字体在 `getPath` 阶段就栅格成 path,输出 SVG **不含任何字体引用**(`<text>`/font-family/@font-face/font://)。所以:
- 导出 PNG/SVG = 自包含轮廓,换机/清缓存打开字不乱(墙 3 成立)
- SVG→PNG canvas 不被 `font://` 污染(`render-blocks-to-media` 的 tainted-canvas 风险不触发)
- `font://` 仅在 `loadFont` 内出现(取字节),从不进输出

---

## 3. 验收对照(prompt §5 / 设计 §8)

| 验收项 | 状态 | 证据 |
|---|---|---|
| 字体面板列本机系统字体(可搜索),选一个渲染 | ✅ 代码就位 | G7.1 扫描(实测苹方等 779 family)+ G7.4 UI;真机视觉留用户 |
| **换机/清缓存 → 字不乱**(墙 3 核心) | ✅ 证明 | G7.5 纯 path 不变量单测 + §2 收口分析 |
| 导出 PNG/SVG 嵌入字体正确 | ✅ 同管线 | atomsToSvg 输出轮廓,§2 |
| X 长图 / graph 截图(共用 atomsToSvg)无回归 | ✅ | 接在 loadFont,三消费者零改;font-family-override 9 回归绿 |
| 打包字体仍正常未破坏 | ✅ | embed: 前缀分流,打包路径零改;原 9 单测全绿 |
| 不支持格式 fail loud 不静默崩 | ✅ | scan/embed/probe 均 console.warn 跳过 + UI 提示 |
| CJK fallback 不丢字(嵌纯西文字体中文仍显) | ✅ | G7-8:splitByFont 缺字探测回退打包,单测覆盖 |
| tsc 0 / eslint 0 warn / 屏障 grep 0 / 单测绿 | ✅ | §4 |
| 真机 npm start 视觉确认 | ⏳ 留用户 | 总指挥环境无 GUI |

---

## 4. 质量门(与 main 基线对齐)

- **tsc**:`npx tsc --noEmit` → **0 error**。
- **eslint**:`npm run lint` → **10 问题(4 err / 6 warn),与 clean main 完全一致**。这 10 个全是既有 baseline(`electron-api.d.ts` 的 `@capabilities/note/types`、`react-hooks/exhaustive-deps was not found` 规则未配、若干 view 既有 unused 等),**本段新增 0 问题**(逐 commit 单独 lint 新增文件均 0)。
- **屏障**:无独立 grep 脚本(= eslint no-restricted-imports 通过)。W5:主进程能力(fs/opentype/electron)纯 main;node-toolbar 0 import three/pm/drivers,系统字体经 SectionContext 注入 + view 的 requireCapabilityApi 路由;capability 间不互 import 运行时。
- **单测**:`npx vitest run` → **407 passed**;8 failed = `tests/storage/bulk-delete-perf-verify.test.ts`(**既有环境性失败,clean main 同样 8 红**,需 SurrealDB,与本段无关)。本段新增 17 测全绿。

---

## 5. 偏差记录(待总指挥确认)

| # | 偏差 | 处置 |
|---|---|---|
| **D1** | 设计 §10/G7-4 把 `.ttc` 列为"首版 unsupported, fail loud"。G7.0 实测:`.ttc` 是 CJK 唯一格式,标 unsupported = 中文系统字体全废。**已拍板采纳 D1:首版即支持 .ttc(纯 JS shim),标识 `{path, fontIndex}`,font-store 存抽出的单 sfnt**。 | ✅ 用户/总指挥已拍板(2026-06-20);增强非缩减,不破红线 |
| **D2(实施侧自决,记录待确认)** | 扫描全量 `opentype.parse` 实测 **26s 卡主进程**。改为**只读 name 表**(新 `sfnt-name-reader.ts`,平台优先级打分),降到 0.5s;完整 parse 推迟到 embed。`supported` 语义从"opentype 全量可解析"放宽为"name 表可读",真正字形可解析性在 embed/probe 时校验(fail loud)。 | 性能缺陷修复,非产品决策;按铁律「别猜看真实数据」实测定位 |
| **D3(实施侧自决)** | 设计未覆盖"嵌入前如何拿体积做 8MB 守卫"。新增 `FONT_PROBE_SIZE` IPC(嵌入前预估抽出子字体真实大小,不落盘),供确认弹窗判阈值。 | 守卫所需的最小补充 |

---

## 6. Backlog(设计明列,本段未做)

- **子集化**(G7-3 备选 B):首版全量嵌入 + 8MB 守卫(已决);子集化(`subset-font`/`fontkit` + 动态加字重子集)是独立硬骨头,单列 backlog。当前 .ttc 已只嵌选中子字体(非整 collection),体积已比"整包嵌入"小很多。
- **可变字体 / .dfont**:首版按 unsupported 处理(本机样本占比极低)。
- **Win/Linux 真机**:扫描目录已留 Win 分支 + Linux 接口,未在 Win/Linux 实测。
- **行内公式 embed**:不涉及本段(沿用既有)。

---

## 7. 交付物

- 设计 v0.2(已存)+ **G7.0 兼容性清单**(本段产出)+ **本完成报告**
- 分支 `feature/L5G7-system-font-import`,6 commit,**不合 main**
- 等总指挥验收 + 用户真机视觉确认(npm start → 画板文字节点 → Aa 面板 → 系统字体 → 选苹方 → 确认弹窗 → 渲染 → 导出验证)
