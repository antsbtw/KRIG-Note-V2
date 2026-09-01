# L5-G5 node-toolbar(Graph 节点浮条)完成报告

> 阶段:L5-G5 — V1 → V2 graph 迁移收尾段(节点属性浮条)
> 分支:`feature/L5G5-node-floating-toolbar`(从 main 切,**未合 main**,待总指挥验收)
> 起草日期:2026-06-20
> 权威设计:[./L5G5-node-floating-toolbar-design.md](./L5G5-node-floating-toolbar-design.md) v0.3
> 执行指令:[../../tasks/2026-06-20-L5G5-node-floating-toolbar-prompt.md](../../tasks/2026-06-20-L5G5-node-floating-toolbar-prompt.md)

---

## 0. 一句话结论

「选中画板节点 → 选中框正下方居中浮出 Freeform 风格 pill 工具条 → 按节点类型注册声明哪几个属性面板(Fill / Line / Text / Type)→ 改属性节点实时更新」**已做出**,且这条浮条是 **view-agnostic 的共享 capability**,容器零硬编码 section 清单,任何 Graph view 都能复用(已用 mock 节点类型单测硬验收通用性)。

9 子段全过;typecheck 0 / lint(改动文件)0 warn / 屏障 grep 0 命中 / 新增 21 例单测全绿 + 全套(除 1 个**与本段无关的预存** storage perf 测试)392 例绿。

---

## 1. 交付物

### 1.1 分支与提交(5 commit,逻辑分组;**未合 main**)

| commit | 内容 | 对应子段 |
|---|---|---|
| `feat(node-toolbar): view-agnostic 节点浮条 capability` | 整个 `src/capabilities/node-toolbar/`(types/registry/容器/4 section/index/styles/DESIGN) | G5.1/3/5/7/8 |
| `feat(node-toolbar): renderer 副作用 import + view install 接入` | platform/renderer + graph-canvas-view/index 注册接入 | G5.1 |
| `feat(text-editing): runNodeStyleCommand 前置(headless 整 doc 改 note mark)` | enabled-blocks 抽出 + node-style-command + driver api + test | G5.4 |
| `feat(atom-serializers): 字体管线扩展(baseFontSize 透传 + fontFamily 覆盖)` | atomsToSvg/font-loader/textBlock/list + test | G5.6(渲染管线半) |
| `feat(canvas-rendering): 浮条锚定接入 + instance 字段 + 删 dead code` | Host.getSelectedScreenAABB + view 接入 + Instance 字段 + 删 floating-inspector + 通用性 test | G5.2/6/8/9 |

> **为何不是逐子段 9 commit**:实施中按子段推进并每段自包含验证(typecheck+lint+屏障+测试),但
> 收尾整理 git 历史时把同目录 / 同关注点的改动合并成 5 个连贯 commit(prompt §4 允许"合理合并")。
> 一个早期 commit 曾用 `git add -A` 误纳工作区里**预存的无关 untracked 文档**(web/bookmark/x 等
> docs/tasks 草稿)+ 一个会话级 `.claude/settings.json`,已重建历史剔除,分支现**只含 `src/` + `tests/`**。

### 1.2 新增文件

| 文件 | LOC | 说明 |
|---|---:|---|
| `src/capabilities/node-toolbar/types.ts` | 160 | SectionDef / SectionContext / NodeSnapshot / NodeToolbarApi / ToolbarAnchor / TextNodeStyleCommand |
| `src/capabilities/node-toolbar/registry.ts` | 60 | sectionRegistry + nodeBindingRegistry(first-match-wins,数量无上限) |
| `src/capabilities/node-toolbar/NodeToolbar.tsx` | 143 | 容器:锚定 + button 排布 + 面板互斥 + ESC + 点外收(零硬编码 section) |
| `src/capabilities/node-toolbar/sections/palette.ts` | 36 | 共享 14 色板 + normalizeHex |
| `src/capabilities/node-toolbar/sections/fill/index.tsx` | 85 | Fill:14 色 + 无填充 + 取色;trigger 显当前填充色 |
| `src/capabilities/node-toolbar/sections/line/index.tsx` | 130 | Line:5 dashType + pt 粗细 + 色 |
| `src/capabilities/node-toolbar/sections/text/index.tsx` | 111 | Text:B/I/U/对齐/列表/文字色(纯复用 note) |
| `src/capabilities/node-toolbar/sections/type/index.tsx` | 84 | Type:字体族下拉 + 自由字号(画板专属) |
| `src/capabilities/node-toolbar/index.ts` | 84 | 双导出 + register + 内置 4 section + 节点绑定 + alive |
| `src/capabilities/node-toolbar/styles.css` | 234 | Freeform 风格 pill + 面板,--krig-* token 兜底 |
| `src/capabilities/node-toolbar/DESIGN.md` | ~60 | 能力地图 |
| `src/views/graph-canvas-view/GraphCanvasNodeToolbar.tsx` | 166 | canvas view 侧接入(RAF 锚定 + 快照 + 落地回调) |
| `src/drivers/text-editing-driver/enabled-blocks.ts` | 77 | ENABLED_BLOCKS 单一来源(从 Host.tsx 抽出) |
| `src/drivers/text-editing-driver/node-style-command.ts` | 189 | headless 整 doc 改样式(deserialize → 选中 → 命令 → serialize) |
| `tests/drivers/node-style-command.test.ts` | 129 | G5.4 headless 改样式 7 例 |
| `tests/drivers/font-family-override.test.ts` | 44 | G5.6 字体族覆盖 + CJK fallback 8 例 |
| `tests/capabilities/node-toolbar-registry.test.ts` | ~80 | G5.9 通用性硬验收 6 例 |

node-toolbar capability 本体 **893 行**(含 styles.css)。

### 1.3 改动文件

| 文件 | 改动 |
|---|---|
| `src/capabilities/canvas-rendering/Host.tsx` | +38:`getSelectedScreenAABB()` + 接 useImperativeHandle |
| `src/capabilities/canvas-rendering/types.ts` | +`getSelectedScreenAABB` 签名;Instance +`text_size`/`text_font`;删 FloatingInspector api/Props |
| `src/capabilities/canvas-rendering/scene/NodeRenderer.ts` | render 文字节点透传 baseFontSize(兜底 14)/fontFamily |
| `src/capabilities/canvas-rendering/scene/TextRenderer.ts` | render options +baseFontSize/fontFamily → atomsToSvg |
| `src/capabilities/canvas-rendering/interaction/InteractionController.ts` | 新建文字节点默认 `text_size=16`(§5.4b) |
| `src/capabilities/canvas-rendering/index.ts` | 删 FloatingInspector import/export/api 字段 |
| `src/lib/atom-serializers/svg/index.ts` | AtomsToSvgOptions +baseFontSize/fontFamily,透传 + 缓存 key |
| `src/lib/atom-serializers/svg/font-loader.ts` | MarkSet +fontFamily;FontFamily 类型;pickFontForChar 覆盖(CJK 强制中文) |
| `src/lib/atom-serializers/svg/blocks/textBlock.ts` | renderTextBlock +baseFontSize/fontFamily,注入每 run marks |
| `src/lib/atom-serializers/svg/blocks/list.ts` | renderList/renderIndentedTextBlock 透传 |
| `src/drivers/text-editing-driver/Host.tsx` | ENABLED_BLOCKS 改 import(去内联重复) |
| `src/drivers/text-editing-driver/api.ts` | +`runNodeStyleCommand(doc, cmd)` |
| `src/platform/renderer/index.tsx` | +`import '@capabilities/node-toolbar'` |
| `src/views/graph-canvas-view/index.ts` | install 列表 +`'node-toolbar'` |
| `src/views/graph-canvas-view/GraphCanvasView.tsx` | body 内挂 `<GraphCanvasNodeToolbar>` |

### 1.4 删除文件

| 文件 | LOC | 理由 |
|---|---:|---|
| `src/capabilities/canvas-rendering/ui/floating-inspector/index.tsx` | 521 | dead code,被 node-toolbar 选中框跟随浮条取代,view 早已不引用(commit 5833c17e);设计 §8 要求删 |

---

## 2. 逐子段:实际 LOC + 与设计的偏差(照搬 / 微调 / 未做)

| 子段 | 状态 | 实际做法 vs 设计 |
|---|---|---|
| **G5.1** 骨架 + registry + 空容器 | ✅ 照搬 | 物理结构完全对齐设计 §4.1;registry 三件套契约对齐 §4.2 |
| **G5.2** Host.getSelectedScreenAABB + view 锚定 | ✅ 微调 | `getSelectedScreenAABB` 按 §5.1 加;**view 端用 RAF 循环持续拉 AABB 重定位**(而非只在 onSelectionChange/onViewportChange 时拉)—— 一把覆盖 拖/缩/转节点 + pan/zoom,节点拖动不触发 viewportChange,RAF 更稳。只在 AABB 变化时 setState 避免每帧 re-render |
| **G5.3** Fill + Line | ✅ 微调 | Fill 14 色(设计 §3.2 两排 6 + 扩展;实迁为 14 格 grid)+ 无填充 + 取色;Line 5 dashType(复用 shape-library DashType)+ pt + 色。直迁 V1 色板视觉非重写 |
| **G5.4** runNodeStyleCommand 前置 | ✅ **签名偏差**(见 §3.1) | headless 整 doc 改 mark;**入参 `(doc, cmd)` 而非设计 §5.3 的 `(instanceId, cmd)`** —— 非编辑画板文字节点无挂载 EditorView,instanceId 路由对它是空,改 doc 入参更诚实。**未走退化预案**(prompt §4 风险预案未触发,完整态做成了) |
| **G5.5** Text section | ✅ 照搬 | B/I/U + 对齐 + 列表 + 文字色,全走 runTextCommand;面板内**无字号无字体**(note 复用零污染红线) |
| **G5.6** 字体管线 | ✅ 微调 | ① baseFontSize 透传 ✅;② chooseFontKey(本仓实为 `pickFontForChar`)加 fontFamily 覆盖 ✅(CJK 强制中文字体不变量已单测锁);④ Instance 字段 + canvas-text-node 展示态读取 ✅;**③ 打包新字体见 §3.2(用户拍板本期只上已装字体)** |
| **G5.7** 打包字体 + Type section | ⚠️ **部分**(见 §3.2) | Type section ✅(字体族下拉 + 自由字号 + 默认 16);**新字体未打包**(用户拍板:本期只上已装 Inter/Noto Sans SC/JetBrains Mono),fontFamily 覆盖管线已接好,serif/手写体待后续打包 |
| **G5.8** 全量接入 + 互斥/ESC/键盘 + 删 dead code | ✅ 照搬 | 面板互斥 + ESC + 点外收;删 ui/floating-inspector 521 行 |
| **G5.9** 通用性硬验收 | ✅ 微调 | 设计想用 family-tree;**family-tree view 尚未立项**,改用 mock 节点类型(`g59-person` 等)单测 registry 契约(6 例),证明任意节点类型注册任意 section 组合容器零改动正确渲染。真 family-tree 接入待该 view 立项,registry 契约已锁 |

---

## 3. 决策变更(实施中发现设计某点需调整,记录改了什么 + 为什么)

### 3.1 G5.4 签名:`runNodeStyleCommand(instanceId, cmd)` → `runNodeStyleCommand(doc, cmd)`

**设计原文(§5.3)**:`runNodeStyleCommand(instanceId, cmd)` —— 内部全选 + apply mark + 写回 instance.doc。

**实地核验发现**:画板文字节点**平时只渲染成 SVG mesh,没有挂载的 EditorView** —— `text-editing` 的 `instanceRegistry` 只在 Host mount(双击进编辑态)时注册实例。对一个仅"被选中、未编辑"的文字节点,`instanceRegistry.get(instanceId)` 是空,走 instanceId 路由改不了它。这正是设计 §8 / prompt §4 预判的风险点。

**采用做法(完整态,非退化)**:driver 内做 **headless 纯 doc 变换** —— `applyNodeStyleCommand(doc, cmd)`:`deserializeDoc(用 ENABLED_BLOCKS 等价 schema)→ 无 view 的 EditorState → 整 doc 选中 → 跑命令 → serializeDoc → 新 DriverSerialized`。view 拿到新 doc 后走 `host.updateInstance(id, { doc })` 落地 + SVG 重渲染。

**为何改入参**:既然不靠 instanceId 找 view,命令的真实输入就是 doc 本身;view 已持有 `getInstance(id).doc`,直接传 doc 更诚实、更可测(纯函数,7 例单测验证 bold 开关 / 色 / 对齐 / 列表包解 / 坏 doc)。**PM 机械全关在 `@drivers` 层**,node-toolbar 只调 capability API,W5 边界不破。

> **请总指挥确认**:此签名偏差是否接受。功能上比设计更强(不需先进编辑态即可对任意未编辑文字节点整 doc 改样式),但 API 形态与设计字面不同。

### 3.2 G5.7 字体打包:本期只上已装 3 字体(用户拍板)

**设计 §5.4 / prompt §2.4**:打包 Noto Serif SC + 西文 Serif + 西文手写 + 中文手写(~+20MB,中文手写须核 SIL OFL license)。

**实施前与用户确认**(本对话):**本期只上已装字体**(Inter / Noto Sans SC / JetBrains Mono),新字体延后。原因:① 环境无法抓取字体二进制入库;② 中文手写体须先核 license 再选型,不宜实施者擅自拍板。

**采用做法**:fontFamily 覆盖管线**已完整接好**(`pickFontForChar` 按 family 选 + CJK 强制中文字体 fallback);Type section 下拉**本期只列「默认/Sans/Mono」**(有专属字体文件、选了有视觉变化的);`serif`/`handwriting` 已建模 + 在 `resolveFamilyFont` 优雅回退已装字体(不丢字不报错),字体文件落地后只需:① `fonts/index.ts` 加 `?url` import;② `resolveFamilyFont` 改回退分支为真字体;③ Type 下拉加选项。

> **遗留:** 新字体打包(尤其中文手写体 license 核查 + 选型)留后续,见 §6。

### 3.3 G5.9 通用性:family-tree → mock 节点类型单测

family-tree view 尚未立项,无法真接入。改以 mock 节点类型(模拟 family-tree person)单测 registry 契约,等价证明"容器零硬编码、注册式组合数量无上限"。真 view 接入待 family-tree 立项。

---

## 4. G5.4 退化预案:**未走**

prompt §4 / 设计 §8 的退化预案("点 Text 组 → 自动进入该节点编辑态 + 全选 → 走既有聚焦命令")**未触发**。实地评估后采用了 headless 纯 doc 变换的**完整态**(§3.1),Text 面板点 B/I/U/对齐/列表**不需先双击进编辑态**即对整节点 doc 生效,符合设计 §7 验收"不需先双击进编辑"。

---

## 5. 自检输出

```
[node-toolbar] alive | sections: fill/line/text/type, registry ready      ← index.ts 模块加载即打印

install-coverage:graph-canvas-view install 列表已加 'node-toolbar'         ← views/graph-canvas-view/index.ts
renderer 副作用 import:platform/renderer/index.tsx 已加 @capabilities/node-toolbar

typecheck:  npx tsc --noEmit            → 0 error
lint(改动文件):npx eslint <changed>    → 0 error / 0 warning
                (项目级 npx eslint . 有 10 处预存问题,全在本段未触碰文件:
                 pdf-viewer / note views / shared/ipc / thought,非本段引入)
屏障 grep:   grep -rn "from 'three'|from 'prosemirror|@drivers/" src/capabilities/node-toolbar/  → 0 命中
测试:        新增 21 例(G5.4×7 + G5.6×8 + G5.9×6)全绿
             全套 vitest(除 1 预存无关 storage perf 测试)392 例绿
```

> **预存 storage 测试失败说明**:`tests/storage/bulk-delete-perf-verify.test.ts`(8 例)因 SurrealDB
> `AlreadyExistsError: atom:blk_0 already exists`(测试 DB 种子/隔离问题)失败。本分支**0 改动 storage 文件**,
> 隔离运行该文件同样失败 → 预存环境问题,与 L5-G5 无关。

---

## 6. 遗留 / 待优化项

1. **新字体打包(G5.7 部分)**:Noto Serif SC / 西文 Serif / 西文手写 / 中文手写待打包(~+20MB)。中文手写体须先核 SIL OFL/同等可商用 license 再选型。管线已就绪,落地点见 §3.2。**待总指挥/用户拍字体选型 + license。**
2. **family-tree 真接入(G5.9)**:registry 契约已用 mock 单测锁;真 family-tree view 立项时接入跑通。
3. **G5.4 签名偏差确认(§3.1)**:`runNodeStyleCommand(doc, cmd)` 与设计 `(instanceId, cmd)` 不同,**待总指挥确认**接受。
4. **arrow section**:设计 §4.2 line 节点绑定 `['line', 'arrow']`,本期 line 只绑 `['line']`(arrow 端点样式 section 未做);ArrowStyle 数据层已就绪,后续补 arrow section + 改绑定即可,容器零改动。
5. **运行时实机回归**:typecheck/lint/单测全绿,但浮条的视觉锚定 / 拖缩转跟随 / 各面板实时改样式的**真机 GUI 回归**未在本环境跑(需 Electron 窗口)。建议总指挥验收时 `npm start` 实测设计 §7 清单。
6. **行内公式字号**:Type 字号对行内公式(mathInline)的缩放未单独验证(沿用 baseFontSize 估宽),复杂文字节点真机回归时一并看。

---

## 7. 设计 §7 验收清单自测对照

| 验收项 | 自测 |
|---|---|
| 普通 shape 显 Fill+Line;line 显 Line(无 Fill);文字节点显 Fill+Text+Type | ✅ registry 生效,容器无硬编码(G5.9 单测 + 内置绑定) |
| 浮条贴选中框正下方居中,拖/缩/转 + pan/zoom 实时跟随 | ✅ 逻辑就绪(RAF 拉 AABB);**真机视觉待验** |
| Fill 14 色+No Fill+取色 / Line 5 线型+pt+色 → 节点立即变 | ✅ patchStyle → updateInstance(数据层就绪);真机待验 |
| **Text 面板内无字号无字体** | ✅ 物理保证(Text section 不含字号字体控件) |
| Type 换字体 → SVG 重渲;调字号 → 立即缩放 | ✅ 管线就绪(本期 Sans/Mono 有视觉差;serif/手写待字体) |
| 中文节点选西文字体 → 中文字符仍走中文字体不丢字 | ✅ **单测锁定**(font-family-override.test.ts) |
| 新建文字节点默认 16px;老画板节点保持 14 | ✅ 创建写 16 + 渲染兜底 14 |
| 通用性证明(G5.9) | ✅ mock 节点类型单测(family-tree 真接入待立项) |
| typecheck 0 / lint 0 warn / 屏障 grep 0 / node-toolbar alive | ✅ 全过 |
| 同时只展开一个面板;ESC / 点空白收;多选不出 | ✅ 容器互斥 + ESC + 点外收 + 单选才出 |

---

*执行完毕,交分支 `feature/L5G5-node-floating-toolbar` + 本报告回总指挥验收。*
