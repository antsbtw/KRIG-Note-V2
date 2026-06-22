# 实施指令 — L5-G7 系统字体导入 + 嵌入内容(可移植)

> 发令人:总指挥 · 2026-06-20 · 执行人:新对话实施者 · 验收人:总指挥
> 前置:L5-G5 节点浮条 + 字体打包已合 main。本段在其上扩字体来源。

---

## 0. 背景 + 一句话目标

**用户痛点**:画板自带 7 套字体太少,不符合用户习惯。用户问"能不能用操作系统字体"。

**技术结论(已核实)**:**能**。我们是 Electron,主进程 Node 可 `fs` 读系统字体二进制 → 喂现有 opentype.js 矢量管线(`getPath→ShapeGeometry`),**不破渲染架构**。纯网页"拿不到系统字体"的限制对 Electron 主进程不成立。

**唯一硬约束(墙 3,绕不过)**:系统字体不归画板内容所有 → 只记字体名的话,**导出 PNG/SVG / 换机打开 / X 长图 / graph 截图**(都共用 `atomsToSvg` 管线)字会乱。

**用户拍板**:**要可移植 —— 用户从系统字体库选字体,选了就把该字体嵌进画板内容**(像图片嵌进 note 那样)。导出/换机字体跟着内容走。这是 Canva/Figma 的正解。

**一句话目标**:**字体面板能列出用户系统已装字体 → 选一个用到画板文字 → 该字体(子集)嵌进画板文档 → 渲染/导出/换机都一致。**

> 本段是新 epic(非加几个字体)。实施前**先出设计文档** `docs/RefactorV2/stages/L5G7-system-font-import-design.md`,总指挥审过再动代码。

---

## 1. 已核实的关键事实 + 可复用范式

1. **嵌入范式现成**:图片嵌进内容走 `media-storage` capability + [platform/main/media/media-store-impl.ts](../../src/platform/main/media/media-store-impl.ts)(`media://` 协议 + base64 落盘)。**字体嵌入完全可仿此**——新建 `font-storage` + `font://` 或复用 media-storage 存字体二进制。
2. **渲染管线吃 buffer**:`font-loader.loadFont(key)` 现在只认打包 `FONT_URLS[key]` → `fetch(url) → opentype.parse(buffer)`([font-loader.ts:13](../../src/lib/atom-serializers/svg/font-loader.ts#L13))。要扩一个"吃运行时任意 ArrayBuffer/url"的口子(嵌入字体走这条)。
3. **系统字体扫描:零现成**,要新建主进程能力(grep 全工程无 queryLocalFonts/fontList/fc-list)。
4. **文字字段已有**:画板文字节点 `instance.text_font`(L5-G5 已建模,现是 'auto'|'sans'|'serif'|'mono'|'handwriting' 枚举)—— 本段要扩成"也能指向一个嵌入字体 id"。
5. **多消费者导出管线**(墙 3 的根据):`atomsToSvg` 被画板 + X 长图 + graph 截图共用(见 memory「block 序列化分层」「X 不支持格式转图」)——嵌入字体必须让这条管线也能拿到 buffer,否则导出仍乱。

---

## 2. 红线

1. **W5 边界**:系统字体扫描/读取是**主进程**能力(Node fs);渲染进程经 IPC/capability 拿,不直 import 主进程。canvas-rendering 仍是 three 唯一位置;node-toolbar 0 import three/pm/drivers。
2. **墙 3 不可破**:嵌入是本段的存在理由。**只记字体名不嵌入 = 没做这个需求**。验收必须证明"换机/导出字不乱"。
3. **复用 media-storage 范式**:别从零造嵌入存储,仿图片那套(或直接复用)。
4. **不破现有打包字体**:7 套打包字体(auto/sans/serif/mono/handwriting)是默认与 fallback,本段是**叠加**系统字体来源,不动它们。
5. 每 commit 自包含绿(tsc 0 / eslint 0 warn / 屏障 grep 0 / 相关单测)。

---

## 3. 实施拆解(建议;设计文档里定细节 + 决策点)

**G7.1 — 主进程系统字体能力**
- 新建 `src/platform/main/fonts/`:扫描系统字体目录(Mac `/System/Library/Fonts` + `/Library/Fonts` + `~/Library/Fonts`;Win `C:\Windows\Fonts`)→ 列出 { family, style, path };按 family+path 读 .ttf 二进制的 IPC。
- **难点**:`.ttc`(字体集合,一个文件多字体)、可变字体、`.dfont` —— opentype.js 不一定全吃。设计里定:首版只支持 .ttf/.otf 单字体,.ttc 解析/可变字体降级或后续。**用 `console.warn` 明确跳过不支持的,不静默。**

**G7.2 — 字体嵌入存储(仿 media-storage)**
- 用户选系统字体用到画板 → 读二进制 → 存进画板内容关联的字体库(`font://<id>` 或复用 media-storage)。
- **核心难点——体积**:中文字体 5–20MB,整个嵌入会让画板文档暴涨。设计里定方案:
  - 首版可"全量嵌入"(简单但大),或
  - **子集化**(只嵌画板里实际用到的字符 —— 理想,但要引入 subset 库如 subset-font/fontkit,技术活)。
  - 决策点:首版全量还是子集化?子集化是独立硬骨头,建议首版全量 + 标 backlog 子集化,除非体积不可接受。

**G7.3 — font-loader 吃嵌入字体**
- `loadFont` 扩展:除打包 FontKey 外,支持"按嵌入字体 id 从 font-storage 取 buffer → opentype.parse"。缓存键区分打包/嵌入。
- `text_font` 字段扩成可指向嵌入字体 id;`resolveFamilyFont`/`pickFontForChar` 加分支(嵌入字体优先;CJK fallback 逻辑保留)。

**G7.4 — 字体选择器 UI(浮条 Aa 面板)**
- 当前 Aa 面板字体下拉是固定 5 项(auto/sans/serif/mono/handwriting,见 [type→text section](../../src/capabilities/node-toolbar/sections/text/index.tsx))。扩成:打包字体分组 + "系统字体"分组(列 G7.1 扫描结果,可搜索)。
- 选系统字体 → 触发 G7.2 嵌入 + 写 text_font 指向嵌入 id。

**G7.5 — 导出管线兼容(墙 3 收口)**
- 确认 `atomsToSvg`(X 长图/graph 截图共用)渲染嵌入字体时也能从 font-storage 取 buffer。这是"可移植"的最后一公里,**必须测**。

**G7.6 — 验收 + 真机**

---

## 4. 必须警惕的真实难点(别低估,设计里逐条回应)

| 难点 | 说明 |
|---|---|
| **嵌入体积** | 中文字体几 MB~20MB,全量嵌入 → 画板文档巨大、保存/加载慢。子集化是正解但是硬骨头(需 subset 库 + 处理动态加字时重新子集)。**这是本 epic 最大的坑,设计必须正面回答。** |
| **.ttc / 可变字体 / .dfont** | 系统里大量非单 .ttf 格式,opentype.js 支持有限。首版范围要划清,不支持的 fail loud。 |
| **跨平台扫描差异** | Mac/Win 字体目录、命名、格式都不同;Linux 暂可不管但别写死 Mac。 |
| **字体 license** | 用户嵌入系统商业字体(如 Mac 苹方、Win 微软雅黑)再导出分发,**可能有 license 风险**——这不是技术问题但要在设计里**标明并提示用户**(嵌入即分发,商业字体慎用)。这条单独拎出来给总指挥/用户拍。 |
| **导出一致性回归** | X 长图/graph 截图共用 atomsToSvg,嵌入字体接入后要回归这俩没坏。 |

---

## 5. 验收对接

- 分支 `feature/L5G7-system-font-import`,**不合 main**,交设计 + 完成报告(对齐 G5 格式)。
- 偏差走"记录待总指挥确认",别默默偏离。
- 硬验收:
  - [ ] 字体面板列出本机系统字体(可搜索),选一个用到画板文字 → 文字按该字体渲染
  - [ ] **该画板复制到另一台没装此字体的机器(或清缓存模拟)→ 字体不乱**(墙 3 核心,可移植证明)
  - [ ] 导出 PNG/SVG → 嵌入字体正确呈现
  - [ ] X 长图 / graph 截图(共用 atomsToSvg)无回归
  - [ ] 打包字体(auto/sans/serif...)仍正常,未被破坏
  - [ ] 不支持的字体格式(.ttc 等)fail loud 不静默崩
  - [ ] tsc 0 / eslint 0 warn / 屏障 grep 0 / 单测绿
  - [ ] 真机 npm start 视觉确认(总指挥环境无 GUI,留用户)

---

## 6. 开工前 checklist

> ⚠️ 设计文档已出并经总指挥验收 + 用户拍板:[L5G7-system-font-import-design.md](../RefactorV2/stages/L5G7-system-font-import-design.md) **v0.2**。4 个拍板点已决(§10),**以设计 v0.2 为准开工**,不要重新设计。

- [ ] 通读设计 v0.2 全文(尤其 §10 拍板结果 + §11 G7.0 前置 + §6 license 锁定文案)
- [ ] **第一步做 G7.0(§11):opentype 兼容性验证脚本** —— 拿本机真实系统字体验 parse+getPath,出兼容率清单。兼容率过低则回总指挥评估换库,**别直接进 G7.1**
- [ ] G7.0 过后,按 §7 G7.1→G7.6 推进
- [ ] 确认在 `feature/L5G7-system-font-import` 分支
- [ ] 跑 npm start 确认基线:当前字体面板只有固定 5 项

## 7'. 已决参数(照设计 v0.2 §10,免得再问)
- 体积:全量嵌入 + **8MB** 守卫弹窗(超阈值才弹确认);子集化 backlog
- 存储:**新建 font-store**(不塞 media 桶);仿 media-store-impl 1:1
- license:**仅提示不拦截**,文案见设计 §6(进确认弹窗 + 面板 ⓘ)
- 弹窗:照搬 X 2.5-a popupController 范式
- text_font:`embed:<fontId>` 前缀分流,不改字段类型

完成回总指挥对话,交设计 + 分支 + completion。
