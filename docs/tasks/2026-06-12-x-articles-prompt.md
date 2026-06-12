# 实施 Prompt：X Articles — 经「Article 呈现态」发布长文

> 交接日期：2026-06-12（阶段 A 调研完成后，总指挥重构方向）
> 交接人：总指挥｜验收人：总指挥
> 依据：调研报告 [2026-06-12-x-articles-format-matrix.md](./2026-06-12-x-articles-format-matrix.md)（note×X 格式矩阵，已审，可信）；技术可行性调研（note 多实例/readOnly/render-blocks-to-media 现状）
> 当前分支 `docs/x-integration-design`（已含逐block成图零件 `2b337d4e`）。

---

## ★★ 实测更新（2026-06-12，总指挥亲自 spike X Article，覆盖下方 §2.2/§3 的注入方式）

总指挥在真实 X Article 编辑器实测了矩阵 #7/#8：
- **#8 粘 markdown → ❌ 不认**（`#`/`**`/`-`/`>` 原样裸奔成纯文本）
- **#7 粘网页富文本 → ✅ 保留格式**（标题/无序列表/链接/加粗 都正确转成 X 富文本）

**→ 发布方式拍板：`note → HTML → 写剪贴板 → 在 X Article 正文合成 paste`，放弃「逐块点 X 工具栏注入」**（实测证明没必要，且粘贴不依赖 X selector、最稳）。

**复用面（已核实，几乎零新渲染代码）**：
- note→HTML：`api.ts:908` 已有 `DOMSerializer.fromSchema(...)` → outerHTML（本是为复制做的）。扩成「整篇/选区 doc → HTML，过滤成 X 支持标签」。
- 不支持的块（公式/代码/Mermaid/table）→ 仍走 `render-blocks-to-media` 转图，HTML 里以 `<img src=media://>` 占位。
- 写剪贴板：`ClipboardItem({'text/html': ...})`（项目已用）。
- 进 X：`pasteTextToWebview`（发推注入原语）扩成支持 text/html 粘贴；`requireXWebContents` 按 ws 定向。

**呈现态（发前预览）拍板：保留，但简化为「预览为主」** —— 用户点「发 X 文章」→ 弹呈现态看「转成 HTML/图后的样子」（所见即所得=粘贴结果）→ 确认 → 才写剪贴板+粘贴。table 可调仍在呈现态做（见 §2.3，发布瞬间截图）。

下方 §0–§8 的设计仍有效（格式映射三分类、table 可调、§5 那些 ⚠️ 默认值都照用），**只把「注入方式」从逐块工具栏改成 HTML 粘贴**。标题层级（#1）粘贴时 X 自己映射 `<h1><h2>`，不必逐级点。

---

## 0. 方向（总指挥拍板，已从「直接块序列注入 X」改为「呈现态」）

用户核心痛点：note 长文一键发 X Article。**新路径不再"逐块点 X 工具栏注入"（最脆弱、最易被 X 改版搞崩），而是：**

> **note → 转成「Article 呈现态」（同一份内容的预览视图：X 支持的格式正常显示，X 不支持的（公式/代码/表格/Mermaid）当场渲成图片就地组织）→ 用户在呈现态里做小调整核验（所见即所得，看到的 == 发出去的）→ 从这个干净结构发布到 X。**

为什么这条更优（调研证实）：
- **所见即所得**：呈现态里公式/表格已经是图，用户看到的就是 X 上的样子，零意外。
- **避开最脆弱环节**：发布时输入已是「只含 X 支持格式 + 图」的干净 doc，注入大幅简化（甚至可能直接粘贴，见 §4 待核 #7/#8）。
- **几乎全复用**（调研证实）：note 多实例 ✅、image block 吃 media:// ✅、render-blocks-to-media ✅；只需补 `readOnly` 实现 + doc 转换 + table→图。
- **同源未来能力**：与 Canvas 长图、问 AI 都是「note→呈现/视觉态」，是「先复用后抽象」要长出的第二消费者。

---

## 1. 三阶段

> **阶段 1：Article 呈现态（本期核心）** — note → Article 兼容 doc → 只读呈现 + 用户小调
> **阶段 2：从呈现态发布到 X** — 把呈现态内容送进 X Article（spike 后定注入 vs 粘贴）
> **阶段 3（增强，可后做）**：完善降级细节

本期目标 = **阶段 1 跑通 + 阶段 2 能发出**。

---

## 2. 阶段 1：Article 呈现态（复用为主，别造新轮子）

### 2.1 doc → Article 兼容 doc（新增转换，核心新代码）
新增 `doc-to-article-doc.ts`（serializers 下）：遍历 note doc，按**调研矩阵 A-3**逐 block 转换：
- **原生映射**（X 支持）：paragraph / heading / bold·italic·strike / link / list / blockquote / image → 原样保留
- **文本降级**（X 无对应）：underline·highlight·字色·thought 丢格式留字；callout→引用+emoji；toggle 展开；task→☐☑；多列拍平；audioBlock/fileBlock/noteLink→文字
- **③ 内嵌图**（视觉即内容）：codeBlock / mathBlock / mermaid / mathInline / mathVisual / **table** → 调 `render-blocks-to-media` 得 media:// → **替换成 image block(src=media://)**
- 转换产出一个新 doc（不改原 note），供呈现态渲染。

### 2.2 「布局可调态」呈现（不是纯只读 —— 总指挥拍板）
呈现态**不是只读预览**，是**「布局/尺寸可调态」**：
- **文字内容不可改**（要改去 note 改完再转）——避免与 note 本体编辑职责重叠
- **可调的是布局/尺寸**：① **table 行列宽高、表格宽高**（总指挥明确要求）② 图片大小/顺序 ③ 删掉不想要的块
- 实现：用 note 现有 Host **第二个实例**（instance-registry 支持，edit-overlay 是先例）渲染 Article 兼容 doc；**不是 `editable:false` 全锁**，而是「锁文字编辑、放开布局/尺寸交互」——具体怎么做（受限 plugin 组合 / 自定义交互层）spike 时定，拿不准列给总指挥。
- `readOnly` 属性（`types.ts:74`）已定义未实现，可参考其落点，但本期要的是「半受限」非「全只读」。

### 2.3 ★★ table → 图：呈现态里 table 是「活的可调真表格」，发布瞬间才截图（总指挥拍板，关键约束）
> **table 不能转换时就变成图**（位图改不了行列宽高）。正确流程：
> **呈现态里 table = 真实可调表格**（复用 note table 的行列宽高调整能力，tableCell 有 `colwidth` attr）→ 用户拖调行列宽高/表格尺寸 → **点发布的那一刻，才 `capturePage` 截「用户调好的那个真实 table DOM」成图** → 喂 X。

- **这否决了 atomsToSvg 手搓表格那条路**（数据→svg 绕过真实 DOM，用户没法在上面拖拽调整）。
- **选型锁定：Electron `capturePage` 截呈现态真实 table DOM**（pdf-viewer `capturePageRect` 是先例，无需引 html2canvas）。截的是"调好之后"的 DOM → 所见即所得。
- 所以 table→图 是**发布时（阶段 2）做**，不是转换时（阶段 1）做；阶段 1 的 table 保持真实可调表格。
- `render-blocks-to-media` 加 `table` kind 时注意：它走 capturePage 而非 svg 路（与 math/code 的 svg 路不同），可能要独立函数。

> 注：公式/代码/Mermaid 这类**用户不需要调布局**的，仍可转换时(阶段1)就成图（走现有 render-blocks-to-media svg 路）；唯 table（及将来类似可调元素）走"发布时截真实 DOM"。

### 2.4 「用户小调整」范围（总指挥拍板：仅布局类）
- ✅ table 行列宽高/表格宽高、图片大小/顺序、删块
- ❌ 不改文字内容（去 note 改）
- 不追求全功能编辑。

### 2.4 其余内嵌图缺口（render-blocks-to-media 扩展）
调研指出当前不收 mathInline / mathVisual / htmlBlock：
- mathInline → 按矩阵建议**降级 `$latex$` 文本**（行内成图打断文字流，本期不做图，留 TODO）
- mathVisual → 有 `thumbnail`(SVG) attr **直接用**，省重渲
- htmlBlock → 本期降级"标题+提示文字"，截图留 TODO

---

## 3. 阶段 2：从呈现态发布到 X
- 呈现态内容已是「X 支持格式 + image(media://)」干净结构。
- spike X Article 编辑器后定注入方式（见 §4）。复用 `webview-input` 原语 + `requireXWebContents` 按 ws 定向 + 图走 Insert/fileInput 喂。
- **写方向红线：注入完不自动点 Publish**，用户在 X 检查后手动发。

---

## 4. spike（动手前，对真实 X Article 编辑器，调研报告 A-2 列了 11 项）
重点优先验（**#7/#8 若为真，阶段 2 可极大简化**）：
- **#7 粘贴富文本是否保留格式** / **#8 粘 markdown 是否自动解析** → 若是，呈现态 doc→markdown/HTML 一粘即可，省逐块注入
- #1 标题层级数、#2 列表嵌套、#4 链接交互、#6 Insert 能插什么 + fileInput
- 入口：怎么 new 一篇 Article / 导航到 compose/articles
- 结论填 profile（`x-service-types.ts` 加 Article selector 段），失效 fail loud

---

## 5. 那 9 个 ⚠️ 的处理（呈现态让大部分降为「默认值，用户可调」）

总指挥裁定：**有了呈现态用户可调，多数 ⚠️ 给默认转换即可，不必现在拍死**。默认值：
- heading 超 X 层级 → 降到 X 最低标题级（spike 定层级数；若只到 H3，note H4–H6→H3）
- 多层列表/引用 → spike 定 X 是否支持嵌套；不支持则拍平
- **codeBlock → 内嵌图**（你之前已认可截图兜底；好看优先）
- mathInline → `$latex$` 文本（行内不做图）
- highlight/underline/字色 → 丢格式留字
- 行内 code → 反引号包裹
- callout 非 emoji 图标 → 忽略图标留正文
- video/tweet/html → 本期降级文字（tweet 可试注入 URL 让 X 自嵌，spike 定）
- **table → 图（§2.3）**

**仍需总指挥拍的（默认值不够明确的）见 §8 提问。** 其余按上面默认值实现，用户在呈现态不满意可调。

---

## 6. 红线
- ❌ 注入完程序自动点 Publish（写方向最高红线）
- ❌ 重新造渲图/注入（复用 render-blocks-to-media / webview-input / atomsToSvg）
- ❌ table→图 盲目引重依赖（先评估 capturePage 那条）
- ❌ 改坏发推/回复/媒体/呈现态以外的链路（回归）
- ❌ 凭记忆写 X selector / table 渲图手段 —— 先 spike / 先评估
- ❌ 顺手做 Canvas 长图（独立大工程，见 `2026-06-12-x-note-to-longimage-design.md`）

## 7. 验收清单
**门禁**：typecheck 0 / lint 无新增（基线10）/ vitest 全量如实报数（基线 257；bulk-delete 8 flaky 单列）+ 补单测（doc→article-doc 转换映射）/ 启动无新增报错。
**功能**（无 GUI 列待实机验）：note→呈现态各类 block 正确转换；公式/代码/表格→图就地显示；呈现态==发布结果；用户能小调；从呈现态发 X；不自动 Publish；发推/回复不回归。
**架构**：readOnly 真实现；doc 转换复用 render-blocks-to-media；table→图选型有理由；按 ws 定向；没造重复渲图/注入。
**交付附**：改动清单 / table→图选型理由 / spike 结论(#7#8 等) / readOnly 实现方式 / §8 决策 / 回归与实机验点 / 如实测试报数 / atomsToSvg·render-blocks-to-media 复用与扩展说明（抽象素材）。

## 8. 需总指挥拍板（默认值不够明确的）
> 已拍板（写死，别再问）：小调范围=仅布局类（table行列宽高/图大小顺序/删块，不改文字）；table→图走「呈现态真实可调表格 + 发布时 capturePage 截图」。
1. **入口 + 来源**：note 命令「预览为 X 文章」整篇 → 呈现态。选区暂不做。确认？
2. **标题/封面**：note isTitle 首块 → Article 标题；封面本期不自动设。确认？
3. **呈现态是独立 view 还是 note 内的预览 tab/弹层**？建议弹层/侧栏预览（轻），不新建顶层 view。你定。
4. **「半受限」实现方式**（锁文字、放开 table/图布局调整）spike 后给方案 —— 这是阶段 1 的技术难点，拿不准列出来。

拿不准的（呈现态半受限怎么实现、capturePage 截 table 时序）—— **停下来在交付说明列问题**让总指挥定。
