# 变更指令 — L5-G7b 字体策略转向:记名不嵌入 + 唯导出时嵌入

> 发令人:总指挥 · 2026-06-21 · 执行人:新对话实施者 · 验收人:总指挥
> 前置:L5-G7(嵌入方案)已实现,分支 `feature/L5G7-system-font-import` 10 commit 未合 main,**已通过总指挥代码层验收**(tsc 0 / 23 测试绿 / 屏障干净)。
> **本指令是方向转向,不是从头做**——大部分 L5-G7 代码保留,改的是"字体如何随内容走"这条策略线。

---

## 0. 为什么转向(用户拍板)

L5-G7 原方案 = **选系统字体即把字体二进制嵌进画板文档**(墙 3 可移植)。用户复盘后改主意,新策略:

- **平时存画板:只记字体名,不嵌入字体本体** → 文档小、**无商业字体 license 风险**、不会乱码(对方没装就回退打包默认字体,打包字体字符全覆盖)
- **唯独导出 PNG/SVG 时:把用到的字体读出来 outline 进产物** → 导出绝对一致
- **取舍**:放弃"换机/分享时字体一致"(对方没装该系统字体 → 回退默认字体,字能读、不乱码、但长相变)。用户已知此代价并接受。

> 用户原话:"上传时就不打包字体,而是分开,表明是什么字体,对方没有就加载默认字体" + "唯独导出时嵌入" + 确认"不会乱码(回退打包字体)"。

---

## 1. 关键技术现实(已核实,决定改动量)

1. **本机渲染仍要读字体 outline**:WebGL 那道墙没变——即使"只记名",渲染时仍要"按字体名 → 找系统字体文件 → 读 buffer → opentype.getPath"。所以**系统字体扫描/读取能力全部保留**,只是结果**不落盘进文档**。
2. **导出天然就一致**:`atomsToSvg`/`textToPath` 输出是 `<path d="..." fill="..."/>` **纯矢量,字已 outline 进 path,产物零字体引用**([text-to-path.ts:46](../../src/lib/atom-serializers/svg/text-to-path.ts#L46))。且跑在渲染进程(本机)。**所以"导出时嵌入"几乎免费**:只要导出在本机、按名读到字体,产物就自带字形,不需额外存字体二进制。
3. **G7.0 兼容性成果保留**:.ttc 拆解 shim(苹方等)、sfnt-name-reader —— 记名方案"按名读 buffer"仍要用,**不废**。

---

## 2. 改动盘点(保留 > 废 > 改 > 新增)

### ✅ 保留(原样不动)
- `system-font-scan.ts`(扫系统字体列出 family + path)—— 记名也要列字体给用户选
- `sfnt-name-reader.ts` / `ttc-extract.ts` —— 还要读 family 名 + 本机渲染时按名读 buffer(含 .ttc 抽子字体)
- Aa 面板字体列表 UI(`sections/text/index.tsx` 的 FontList)—— 选字体交互不变
- license ⓘ tooltip / 零守卫弹窗 —— **用户已拍板接受这两个终态(D4/D5),保留**

### ❌ 废掉(嵌入专属,记名不需要)
- `font-store-impl.ts` 的**落盘 + SHA256 去重 + `font://` 协议**这套"嵌入存储"——记名不往文档塞字体二进制,不需要。
  - ⚠️ 但其中"按 path/fontIndex 读字体 buffer"(`readFontBinary`)的能力要**搬出来保留**(本机渲染 + 导出嵌入都要按名读 buffer)。别把读取逻辑一起删了。
- `font-storage` capability 的 `font://` fetch 路径(`loadFont` 里 `embed:` → `fetch('font://...')`)
- 嵌入相关 IPC `FONT_EMBED`、确认 invoke

### 🔧 改
- **`text_font` 编码**:`'embed:<fontId>'` → 改成记名,如 `'sysname:<family>'`(记字体 family 名,不是嵌入 id)。canvas-rendering/types.ts + node-toolbar/types.ts + font-loader 的 FontFamily 类型同步。
- **`loadFont` / `pickFontForChar`**:`embed:` 分支 → `sysname:` 分支。本机渲染时:按 family 名 → IPC 问主进程要该字体 buffer(主进程按名查 scan 结果的 path → readFontBinary)→ opentype.parse。**读不到(对方没装)→ 回退打包默认字体**(pickPackagedFallbackForChar 已有,复用)。
- **CJK 缺字回退**:原 G7-8 逻辑保留(系统字体缺字 → 打包 CJK fallback)。
- **墙 3 测试**:`embed-font-export-invariant.test.ts` 改语义 → 测"记名 + 对方没装回退默认不乱码" + "导出产物纯 path"。

### 🆕 新增
- **导出时嵌入**:导出 PNG/SVG 路径上,确认用到的 `sysname:` 字体在本机被正确 outline 进 path(因 atomsToSvg 天然 outline,主要是确认"导出时按名读到了本机字体",读不到则回退 + 可选 warn)。X 长图/graph 截图同理(它们已 outline,本机跑即一致)。

---

## 3. 红线(沿用 + 新增)
1. **W5 边界**:系统字体扫描/读取仍主进程,渲染经 IPC。
2. **不会乱码是新卖点**:回退必须落到**打包字体**(字符全覆盖),不能回退到"无字体/豆腐块"。验收要测。
3. **不破打包字体 + 不破 G5/G6 已交付**。
4. **fail loud**:按名读字体失败 → 回退 + console.warn,不静默崩。
5. 每 commit 自包含绿(tsc 0 / eslint 0 warn / 屏障 grep 0 / 单测)。

---

## 4. 验收(总指挥逐条核 + 真机)
- [ ] 选系统字体 → 本机渲染正确(按名读 buffer outline)
- [ ] **该画板"记的是字体名"**:存盘内容里 text_font = `sysname:<family>`,**文档不含字体二进制**(对比嵌入方案,文档应显著变小)
- [ ] **对方没装该字体(清缓存/换机模拟)→ 回退打包默认字体,字正常显示不乱码不豆腐块**(新卖点核心)
- [ ] 导出 PNG/SVG → 本机字体 outline 进产物,呈现正确
- [ ] X 长图 / graph 截图无回归
- [ ] CJK 缺字仍回退不丢字
- [ ] 打包字体 / G5/G6 功能无回归
- [ ] tsc 0 / eslint 0 warn / 屏障 grep 0 / 单测绿
- [ ] 真机 npm start 视觉确认

---

## 5. 衔接 + 交付
- 继续在 `feature/L5G7-system-font-import` 分支(转向 commit 接在后面;**不要 rebase 抹掉已验收的 10 commit**,新加转向 commit,完成报告记策略变更)。
- **不合 main**。
- 完成报告新增一节"L5-G7b 策略转向:嵌入→记名+导出嵌入",写清废了什么(font-store 落盘/font://)、保留什么、为什么(用户拍板取舍)。
- 偏差走"记录待总指挥确认"。

## 6. 开工前
- [ ] 读本指令 + L5-G7 完成报告(了解现状)+ 设计 §2(原嵌入方案,现被本指令部分取代)
- [ ] 确认在 feature/L5G7 分支,git log 看到原 10 commit
- [ ] 先想清"按 family 名 → 主进程查 path → 读 buffer → 渲染进程 opentype"这条 IPC 链(替代原 font:// fetch)
