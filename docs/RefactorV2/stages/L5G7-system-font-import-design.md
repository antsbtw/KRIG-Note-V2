# L5-G7 设计 — 系统字体导入 + 嵌入内容(可移植)

> v0.2 · 2026-06-20 · 总指挥验收 + 用户拍板 4 点全决(§10),新增 G7.0 opentype 兼容性前置验证(§11);可开工
> v0.1 · 2026-06-20 · 设计先行(用户拍板:design-first,总指挥审过再动代码)
>
> 前置:[L5G5-node-floating-toolbar-design.md](./L5G5-node-floating-toolbar-design.md) 节点浮条 + L5-G6 字体打包已合 main。
>
> 执行指令:[../../tasks/2026-06-20-L5G7-system-font-import-embed-prompt.md](../../tasks/2026-06-20-L5G7-system-font-import-embed-prompt.md)
>
> 配套现状(已核实):
> - 渲染字体管线:[font-loader.ts](../../../src/lib/atom-serializers/svg/font-loader.ts)(`loadFont(key)` → `fetch(FONT_URLS[key]) → opentype.parse`)、[fonts/index.ts](../../../src/lib/atom-serializers/svg/fonts/index.ts)(`FONT_URLS` 打包清单)、[text-to-path.ts](../../../src/lib/atom-serializers/svg/text-to-path.ts)(`pickFontForChar` 按字符选字体)
> - 嵌入范式蓝本:[media-store-impl.ts](../../../src/platform/main/media/media-store-impl.ts)(`media://` 协议 + base64 落盘 + SHA256 去重)、[media-handlers.ts](../../../src/platform/main/media/media-handlers.ts)(IPC)
> - 文字字段:[node-toolbar/types.ts](../../../src/capabilities/node-toolbar/types.ts) `NodeSnapshot.text_font`、[sections/text/index.tsx](../../../src/capabilities/node-toolbar/sections/text/index.tsx)(Aa 面板,当前固定 5 项字体下拉)
> - 多消费者导出管线(墙 3 根据):`atomsToSvg` 被画板 [TextRenderer.ts](../../../src/capabilities/canvas-rendering/scene/TextRenderer.ts) + X 长图 [x-extraction/render-blocks-to-media.ts](../../../src/capabilities/x-extraction/render-blocks-to-media.ts) + graph 截图共用

**本文件用途**:把画板文字从"7 套打包字体"扩到"用户系统已装字体也能选",且**选了就把字体(子集)嵌进画板内容**——导出 PNG/SVG、换机打开、X 长图、graph 截图都字不乱(墙 3:可移植)。

---

## 0. 一句话目标

字体面板列出**用户系统已装字体**(可搜索)→ 选一个用到画板文字 → 该字体**子集嵌进画板文档**(像图片嵌进 note)→ 渲染 / 导出 / 换机一致。

> 本段是新 epic,不是"再加几套打包字体"。打包的 7 套是默认 + fallback,本段**叠加**一个运行时来源,不动它们。

---

## 1. 现状核实(已读代码确认)

| 事实 | 出处 | 对本段的影响 |
|---|---|---|
| `loadFont(key: FontKey)` 在**渲染进程**跑,内部 `fetch(url) → opentype.parse(buffer)`,结果按 key 进 `Map` 缓存 | [font-loader.ts:13](../../../src/lib/atom-serializers/svg/font-loader.ts#L13) | **关键利好**:嵌入字体只要有一个可 `fetch` 的 URL(如 `font://<id>`)就能直接喂现有管线,**渲染架构零改**。要做的是给 `loadFont` 开一个"吃任意 url/buffer"的口子 + 缓存键扩展 |
| `pickFontForChar(ch, marks)` 据 `marks.fontFamily`(枚举)+ CJK + bold/italic 选 `FontKey` | [text-to-path.ts](../../../src/lib/atom-serializers/svg/text-to-path.ts) + [font-loader.ts:141](../../../src/lib/atom-serializers/svg/font-loader.ts#L141) | `fontFamily` 当前是 `'auto'|'sans'|'serif'|'mono'|'handwriting'` 枚举,要扩成"也能指向一个嵌入字体 id" |
| `media://` 协议 = 主进程 `protocol.handle` + base64 落盘 `{userData}/krig-data/media/` + SHA256 去重;IPC `MEDIA_PUT_BASE64` | [media-store-impl.ts](../../../src/platform/main/media/media-store-impl.ts) | **嵌入存储完全仿此**(见 §4 决策 G7-2) |
| 系统字体扫描:**全工程零现成**(grep 无 `queryLocalFonts`/`fc-list`/`fontList`),要新建主进程能力 | — | G7.1 从零做 |
| `atomsToSvg` 是画板 + X 长图 + graph 截图**共用**入口,`AtomsToSvgOptions.fontFamily` 透传 | [svg/index.ts](../../../src/lib/atom-serializers/svg/index.ts) | 嵌入字体接 `loadFont` 这一层,**三个消费者自动都拿到**——墙 3 在管线层一处收口 |
| 仅装了 `opentype.js@1.3.4`,无 subset/fontkit/harfbuzz 库 | package.json | 子集化要新引库(见 §4 决策 G7-3) |

---

## 2. 唯一硬约束(墙 3)与本段存在理由

系统字体**不归画板内容所有**。若只记字体名:导出 PNG/SVG、换机打开、X 长图、graph 截图(都过 `atomsToSvg`)在没装该字体的环境会丢字 / 乱掉。

**用户拍板:要可移植** —— 选系统字体即把字体(子集)**嵌进画板内容**,导出 / 换机字体跟着内容走。这是 Canva / Figma 的正解。

> 红线复述:**只记字体名 = 没做这个需求**。验收必须证明"换机 / 导出字不乱"。

---

## 3. 端到端数据流(目标态)

```
┌─ 主进程(Node fs,W5 边界内) ──────────────────────────────┐
│ fonts/system-font-scan.ts                                   │
│   扫 /System/Library/Fonts、/Library/Fonts、~/Library/Fonts │
│   (Win: C:\Windows\Fonts)→ [{ family, style, path, format }]│
│ fonts/font-store-impl.ts(仿 media-store)                    │
│   embed(path) → 读二进制 →(子集化?见 G7-4)→ SHA256 落盘   │
│     {userData}/krig-data/fonts/font-<hash>.ttf              │
│   注册 font:// 协议(default + 各 ws partition session)      │
└──────────────┬──────────────────────────────────────────────┘
   IPC: FONT_LIST_SYSTEM / FONT_EMBED / (font:// 协议)
┌──────────────┴──────────────────────────────────────────────┐
│ 渲染进程                                                      │
│ node-toolbar Aa 面板:打包分组 + "系统字体"分组(可搜索)      │
│   选系统字体 → IPC FONT_EMBED(path) → 拿回 { fontId }        │
│   → ctx.patchInstance({ text_font: 'embed:<fontId>' })       │
│                                                              │
│ 渲染:atomsToSvg(options.fontFamily = 'embed:<fontId>')       │
│   → pickFontForChar → loadFont 识别 embed: 前缀              │
│     → fetch('font://font-<id>.ttf') → opentype.parse        │
│ ↑ 画板 / X 长图 / graph 截图三消费者共用此路径(墙 3 收口)    │
└──────────────────────────────────────────────────────────────┘
```

**墙 3 收口点**:嵌入字体的 buffer 入口在 `loadFont`(渲染层),而三个导出消费者都过 `atomsToSvg → textToPath → loadFont`。只要 `font://` 协议在所有相关 session 都注册(仿 media-storage 的 `registerMediaForSession`),三条线自动一致。**无需各消费者各改**。

---

## 4. 决策记录(★ = 需总指挥/用户拍板,其余建议默认)

| # | 决策点 | 建议默认 | 说明 / 备选 |
|---|---|---|---|
| **G7-1** | 系统字体扫描实现 | **主进程自写目录扫描**(`fs.readdir` 字体目录 + opentype 读 name 表取 family/style) | 不引第三方扫描库(`font-list` 等多依赖系统命令、跨平台脆)。Mac 三目录 + Win `C:\Windows\Fonts`;Linux 暂不写死但留接口。**W5:纯主进程,渲染经 IPC** |
| ★ **G7-2** | 嵌入存储 | **复用 media-storage 范式,新建 `font-store-impl.ts`** | 仿 [media-store-impl.ts](../../../src/platform/main/media/media-store-impl.ts):新协议 `font://` + 新子目录 `krig-data/fonts/` + SHA256 去重 + IPC。**不直接塞进 media 桶**(字体是独立概念,索引/清理/license 标记都需独立);但代码结构 1:1 抄 media |
| ★★ **G7-3** | **嵌入体积 / 是否子集化(本 epic 最大坑)** | **首版全量嵌入 + 标 backlog 子集化** | 见 §5 专项。全量:简单可靠,但中文 5–20MB → 文档暴涨。子集化:理想,但要引 `subset-font`/`fontkit`、且"动态加字需重新子集"是硬骨头。**建议首版全量 + 加体积守卫(超阈值 warn/挡),子集化单列 backlog**。**需拍板** |
| **G7-4** | 首版字体格式范围 | **仅 .ttf / .otf 单字体** | `.ttc`(集合)/ 可变字体 / `.dfont` opentype.js 支持有限。首版扫描列出但 `embed` 时遇到不支持的 **`console.warn` 明确跳过 + UI 提示,不静默崩**(红线:fail loud) |
| **G7-5** | `text_font` 编码嵌入字体 | **字符串前缀 `embed:<fontId>`** | 现 `text_font` 已是 `string`([types.ts:57](../../../src/capabilities/node-toolbar/types.ts#L57)),枚举值是裸串。嵌入用 `embed:` 前缀区分,`pickFontForChar`/`loadFont` 判前缀分流。**不改字段类型,零迁移** |
| **G7-6** | 缓存键 | **`loadFont` 缓存键从 `FontKey` 扩成 `FontKey | `embed:${id}`` 字符串** | 打包/嵌入共用一个 Map,键互不撞 |
| ★ **G7-7** | **商业字体 license** | **嵌入面板加显著提示 + 文档标明,不做技术拦截** | 见 §6 专项。用户嵌入 Mac 苹方 / Win 微软雅黑再导出分发**可能侵权**。这不是技术问题,**单拎给总指挥/用户拍**:首版"提示即可"还是"对已知商业字体做 UI 警示/禁止" |
| **G7-8** | CJK fallback 保留 | **嵌入字体优先,但缺字仍走打包 CJK fallback** | 用户嵌入一个纯西文字体,CJK 字符仍要能显示 → `pickFontForChar` 中 `embed:` 分支:该字体有此字形则用,否则回退现有 CJK 逻辑(需 opentype `font.charToGlyphIndex(ch) !== 0` 探测)。**保证不丢字** |

---

## 5. ★★ 专项:嵌入体积 / 子集化(本 epic 最大坑,正面回答)

**问题**:中文字体 .ttf 普遍 5–20MB(思源黑 ~16MB)。全量嵌入 → 单画板文档可能几十 MB,保存 / 加载 / 同步全慢;一个画板用了 3 个中文系统字体 = 50MB+。

**两条路**:

| 方案 | 优点 | 代价 | 风险 |
|---|---|---|---|
| **A. 全量嵌入(首版建议)** | 实现简单(读二进制 → 落盘,完全复用 media base64 路径);可靠,无解析风险;动态加字零额外工作 | 体积大 | 文档暴涨;需体积守卫 |
| **B. 子集化(理想/backlog)** | 体积可降 90%+(只嵌画板实际用到的字符) | 引 `subset-font`(基于 harfbuzzjs,wasm)或 `fontkit`;**动态加字要重新子集**(用户编辑文字加了新字 → 旧子集缺字 → 要监听文字变化触发重嵌);子集后字体可能丢 hinting/OT 特性 | 复杂度跳一档;"何时重子集"是状态机,易留 bug |

**建议(待 ★★ 拍板)**:
1. **首版选 A 全量**,但加**体积守卫**:单字体 > 阈值(建议 8MB)时 `console.warn` + UI 提示"该字体较大(NMB),将增大文档体积,确认嵌入?",用户确认才嵌。**不静默吞大文件**。
2. **子集化列 backlog**(G7.x-后续),除非首版实测体积不可接受。
3. 去重:同一字体被多个节点/画板用 → SHA256 去重(media 范式自带),只存一份。

> 决策点 ★★:**首版全量 + 守卫**,还是**首版直接上子集化**?建议前者(子集化是独立硬骨头,不该卡住首版可移植性验证)。

---

## 6. ★ 专项:商业字体 license(非技术,需拍板)

**事实**:Mac 苹方(PingFang)、Win 微软雅黑(Microsoft YaHei)等系统预装字体**多为商业授权**,license 通常**禁止再分发 / 嵌入分发**。用户"嵌入即把字体二进制打进画板内容",导出 / 分享画板 = **分发该字体**,**可能侵权**。

**这不是技术能解决的**(我们无法可靠判定每个字体的 license)。**单拎给总指挥/用户拍**:

| 选项 | 说明 |
|---|---|
| **A. 仅提示(建议首版)** | 嵌入面板 / 确认弹窗显著文案:"嵌入即随画板分发该字体,商业字体(如系统预装中文字体)可能有 license 限制,请确认你有权分发"。文档同步标明。**不做技术拦截** |
| **B. 已知商业字体警示/禁止** | 维护一个"已知商业字体黑名单"(苹方/雅黑/…),命中时强警示或禁嵌。**名单维护成本高、必不全,易给假安全感** |

**✅ 已拍板:选 A(仅提示不拦截)。** 法律风险由用户承担,产品尽提示义务。

**锁定文案**(嵌入确认弹窗 + 字体面板系统字体分组下方常驻小字):

> ⚠️ 嵌入字体会随画板内容一起保存和分发。系统预装的商业字体(如苹方、微软雅黑等)可能限制再分发,导出 / 分享前请确认你拥有分发权利。

> 实施:此文案进 G7.4 的 FONT_EMBED 确认弹窗(与 8MB 体积守卫合用同一弹窗)+ 面板系统字体分组标题旁一个 ⓘ tooltip。不做黑名单、不做技术拦截。

---

## 7. 实施拆解(对齐 prompt §3,设计细化)

> 分支 `feature/L5G7-system-font-import`,不合 main。每 commit 自包含绿(tsc 0 / eslint 0 warn / 屏障 grep 0 / 相关单测)。

**G7.1 — 主进程系统字体扫描能力**(`src/platform/main/fonts/system-font-scan.ts`)
- 扫 Mac 三目录(+ Win),`fs.readdir` 收 `.ttf/.otf`(`.ttc/.dfont`/可变字体首版**列出但标 unsupported**,`embed` 时 warn 跳过)。
- 每文件 opentype 读 name 表取 `family` / `style`,失败的 warn 跳过。
- IPC `FONT_LIST_SYSTEM` → `[{ family, style, path, format, supported }]`。
- W5:纯主进程;渲染经 IPC,不直 import。

**G7.2 — 字体嵌入存储**(`src/platform/main/fonts/font-store-impl.ts`,仿 media-store)
- `font://` 协议注册(default + per-ws session,抄 `registerMediaForSession` 的 WeakSet 去重)。
- `embed(path)`:读二进制 →(G7-3 全量 / 守卫)→ SHA256 → 落 `krig-data/fonts/font-<hash>.<ext>` → 返回 `{ fontId, fontUrl: 'font://font-<hash>.ext', sizeKb, family }`。
- IPC `FONT_EMBED`。索引 JSON(可选,记 fontId→family/path 供 UI 回显,仿 media-index)。

**G7.3 — `loadFont` 吃嵌入字体**([font-loader.ts](../../../src/lib/atom-serializers/svg/font-loader.ts))
- 缓存键扩成 `FontKey | \`embed:${id}\``;`loadFont` 识别 `embed:` 前缀 → `fetch('font://...')`(URL 由 fontId 推或 IPC 查)→ `opentype.parse`。
- `MarkSet.fontFamily` / `FontFamily` 类型扩成可携 `embed:<id>`;`pickFontForChar` / `resolveFamilyFont` 加 `embed:` 分支(G7-8:缺字回退 CJK)。

**G7.4 — Aa 面板字体选择器**([sections/text/index.tsx](../../../src/capabilities/node-toolbar/sections/text/index.tsx))
- 现固定 5 项 → 改两分组:**打包字体**(原 5 项)+ **系统字体**(IPC `FONT_LIST_SYSTEM` 拉,可搜索)。
- 选系统字体 → IPC `FONT_EMBED(path)`(过 G7-3 守卫 / license 提示)→ `patchInstance({ text_font: 'embed:'+fontId })`。
- W5:node-toolbar 0 import three/pm/drivers(经 SectionContext + IPC bridge,沿用现有注入模式)。

**G7.5 — 导出管线兼容(墙 3 收口验证)**
- 因接在 `loadFont`,`atomsToSvg` 三消费者(画板 / X 长图 / graph 截图)自动拿到。**必须实测**:`font://` 在导出时所用 session 已注册;X 长图 / graph 截图回归无坏。

**G7.6 — 验收 + 真机**(见 §8)。

---

## 8. 验收(对齐 prompt §5)

- [ ] 字体面板列出本机系统字体(可搜索),选一个用到画板文字 → 文字按该字体渲染
- [ ] **该画板复制到没装此字体的机器(或清缓存模拟)→ 字体不乱**(墙 3 核心,可移植证明)
- [ ] 导出 PNG/SVG → 嵌入字体正确呈现
- [ ] X 长图 / graph 截图(共用 atomsToSvg)无回归
- [ ] 打包字体(auto/sans/serif…)仍正常,未被破坏
- [ ] 不支持格式(.ttc 等)fail loud 不静默崩
- [ ] CJK fallback 不丢字(嵌入纯西文字体时中文仍显示)
- [ ] tsc 0 / eslint 0 warn / 屏障 grep 0 / 单测绿
- [ ] 真机 npm start 视觉确认(总指挥环境无 GUI,留用户)

---

## 9. 红线对照(prompt §2)

| 红线 | 本设计落点 |
|---|---|
| W5 边界:扫描/读取是主进程,渲染经 IPC | §3 + G7.1/G7.2 主进程;G7.4 经 IPC bridge |
| 墙 3 不可破:必须嵌入,证明换机/导出不乱 | §2 + §3 收口点 + §8 验收 |
| 复用 media-storage 范式 | G7-2:1:1 仿 media-store-impl |
| 不破现有打包字体(叠加,不动) | G7-5:`embed:` 前缀分流,打包路径零改;§8 回归项 |
| 每 commit 自包含绿 | §7 每 G7.x 自包含 |

---

## 10. 拍板结果(总指挥验收 + 用户拍板,2026-06-20,已决,可开工)

| # | 决策 | 结论 |
|---|---|---|
| ★★ G7-3 体积 | **首版全量嵌入 + 8MB 守卫;子集化列 backlog** | ✅ 采纳建议 |
| ★ G7-7 license | **仅提示不拦截(A)** | ✅ 嵌入面板 + 确认弹窗显著文案;不做黑名单/技术拦截;法律风险由用户承担,产品尽提示义务。文案见 §6 |
| ★ G7-2 存储 | **新建独立 `font-store`,不塞 media 桶** | ✅ 采纳建议(字体需独立 license 标记/索引/清理)|
| 守卫阈值 + 弹窗 | **8MB;照搬 X 2.5-a popup 范式** | ✅ 采纳建议(对齐 [[project-x-integration-phase25a]] popupController 模式)|
| **★ 新增前置(总指挥审计补)** | **G7.0 先跑 opentype 兼容性验证脚本** | ✅ 见 §11 —— 开工 G7.1 前必做 |

> 偏差走"记录待总指挥确认",不默默偏离。可开 `feature/L5G7-system-font-import`,从 §11 G7.0 起步。

---

## 11. ★ G7.0 前置:opentype.js 兼容性验证(总指挥审计补,开工第一步)

**风险(审计发现)**:设计假设"读到系统字体 buffer → opentype.parse → getPath 就行",但 `opentype.js@1.3.4` 是老库,对系统字体常见的 **CFF2 / 可变字体 / 部分 OTF / 新版 TrueType** 解析可能失败或丢字形。**不能等 G7.3 实现时才发现"一半系统字体打不开"**。

**G7.0 动作**(写代码前,一次性验证脚本,非正式模块):
1. 写个离线 node 脚本,遍历本机 Mac 系统字体目录(`/System/Library/Fonts` + `/Library/Fonts`),逐个 `opentype.parse(fs.readFileSync(path))`。
2. 统计:成功 / 失败(记原因:格式不支持 / 解析异常)/ 各占比。对成功的再试 `font.getPath('测试Aa', 0, 0, 16)` 确认能出字形。
3. **输出一张"本机系统字体 opentype 兼容率"清单**,据此定 G7.1 扫描的 `supported` 判定逻辑(哪些格式直接标 unsupported)。
4. 若兼容率过低(如 < 50% 常用中文字体打不开)→ **回到总指挥**评估是否要换/补字体解析库(如 fontkit),再决定 G7.1 怎么做。

> 这步用完即弃(不进正式代码),但**它的结论直接决定 G7.1 的 supported 范围 + 是否需要额外解析库**。对齐项目铁律「别猜、看真实数据」([[feedback-dont-guess-look-at-real-data]])。
