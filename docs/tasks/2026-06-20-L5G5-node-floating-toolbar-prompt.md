# 实施指令 — L5-G5 Graph 节点浮条(node-toolbar capability)

> 发令人:总指挥(本对话)· 2026-06-20
> 执行人:你(新对话实施者)
> 验收人:总指挥(回到本对话验收)
> 权威设计:**[docs/RefactorV2/stages/L5G5-node-floating-toolbar-design.md](../RefactorV2/stages/L5G5-node-floating-toolbar-design.md) v0.3 —— 一切以它为准,本 prompt 只是执行约束 + 交接事实**

---

## 0. 你的任务一句话

把"选中画板节点 → 选中框下方浮出一条 Freeform 风格 pill 工具条 → 按节点类型注册声明哪几个属性面板(Fill / Line / Text / Type)→ 改属性节点实时更新"做出来,且**这条浮条是 view-agnostic 的共享 capability,任何 Graph view 都能复用**。

完整规格、决策、契约、字体清单、分阶段、验收、风险 **全在设计文档**。开工前**通读 L5G5 设计文档 v0.3 全文**,本 prompt 不重复它,只补"执行纪律 + 已核实的交接事实 + 验收对接"。

---

## 1. 不可逾越的红线(违反即作废重来)

1. **W5 严格态 A 边界**:`node-toolbar` capability **0 直接 import** `@drivers/*` 运行时、`prosemirror-*`、`three`。改 instance 走 `requireCapabilityApi('canvas-rendering')` 的 Host;改文字 mark 走 `requireCapabilityApi('text-editing')`。eslint 已在 [eslint.config.js:32](../../eslint.config.js#L32) 对 capabilities 默认禁 three/prosemirror —— 你新建的 capability 自动被覆盖,**不要加任何例外**。
2. **note 复用菜单零污染**(用户核心诉求,设计 G5-4/G5-4b):**Text section 只复用 note 既有 mark/命令**(B/I/U/对齐/列表/文字色),**绝不**在 Text 里加字号/字体 —— note 原生没有这两样。字号/字体是**独立的 Type section**,走 instance 新字段 `text_size`/`text_font`,与 Text 物理分离。
3. **registry 通用性是本段灵魂**:容器(NodeToolbar)**零硬编码 section 清单**,有哪几个 button 完全由 `nodeBindingRegistry` 按节点类型声明,**数量无上限**。任何"if node.kind === 'shape' 就显示 Fill"写死在容器里的代码 = 设计违背。
4. **减量≠重写,直迁优先**(charter §6.5,G3/G4 血泪教训):凡能复用 V1/现有实现的(色板、取色器、字体管线),直迁 + 改接口,**不重写极简版**。
5. **每个 commit 自包含**:`npx tsc --noEmit` 0 error + `npx eslint .` 0 warn + 屏障 grep 0 命中(`grep -rn "from 'three'\|from 'prosemirror" src/capabilities/node-toolbar/` 必须空)。不过不提交。

---

## 2. 已核实的交接事实(省你二次踩点,但仍要自己确认未列项)

### 2.1 数据层已就绪(Fill/Line 白拿)
- `Instance` 类型:[canvas-rendering/types.ts:62](../../src/capabilities/canvas-rendering/types.ts#L62);`style_overrides.fill/line/arrow` 字段在 :86
- `FillStyle`(type/color/transparency)/ `LineStyle`(type/color/width/**dashType** 已含 solid/dash/dot/dashDot/longDash 5 值)/ `ArrowStyle`:[shape-library/types.ts:105-121](../../src/capabilities/shape-library/types.ts#L105)
- **改 style 的现成入口**:`CanvasHost.updateInstance(id, patch)` —— **已内置 style_overrides 嵌套合并**(fill/line/arrow 各自 merge,见 [Host.tsx:286](../../src/capabilities/canvas-rendering/Host.tsx#L286))。Fill/Line section 直接 `host.updateInstance(id, { style_overrides: { fill: {...} } })` 即可,Undo 复用 G4 快照栈,你**什么都不用新造**。

### 2.2 锚定已有投影工具(不要自己写投影数学)
- `SceneManager.projectMeshToScreenAABB(obj)` → 返回 `{minX,minY,maxX,maxY}`(已是容器内 CSS 像素,已处理旋转 OBB):[SceneManager.ts:273](../../src/capabilities/canvas-rendering/scene/SceneManager.ts#L273)
- `NodeRenderer.byId: Map<string, RenderedNode>`(:74)持有每个节点的 mesh group;`getInstance(id)`(:243)
- **你要新增** `CanvasHost.getSelectedScreenAABB(): {x,y,w,h}|null`:内部取选中 id → NodeRenderer 拿 mesh group → `projectMeshToScreenAABB` → 转 {x,y,w,h}。加进 [Host.tsx](../../src/capabilities/canvas-rendering/Host.tsx) 的 `useImperativeHandle` 清单 + [canvas-rendering/types.ts](../../src/capabilities/canvas-rendering/types.ts) `CanvasHostHandle`。
- view 端订阅 `onSelectionChange` + `onViewportChange`(props 已存在,[Host.tsx:165-169](../../src/capabilities/canvas-rendering/Host.tsx#L165))时拉一次 AABB 重定位浮条。

### 2.3 字体管线大半就绪(Type section 的重点在这)
- 字号渲染:`text-to-path.ts` 的 `font.getPath(text,x,y,fontSize)` **本就吃任意 fontSize**(矢量);当前写死 `FONT_SIZE = 14` 在 [svg/index.ts:14](../../src/lib/atom-serializers/svg/index.ts#L14)
- 字体选择:`chooseFontKey`(按 CJK/bold/italic 自动选)在 [svg/font-loader.ts](../../src/lib/atom-serializers/svg/font-loader.ts);已装 Inter / Noto Sans SC / JetBrains Mono([svg/fonts/index.ts](../../src/lib/atom-serializers/svg/fonts/index.ts))
- **Type section 要做的 4 件**(设计 §5.4):① `atomsToSvg(doc, {baseFontSize})` 把节点 `text_size` 透传到 textToPath;② `chooseFontKey` 加 `fontFamily` 入参覆盖(CJK 字符仍强制 fallback 中文字体,西文字体没中文字形);③ 打包新字体(见 §2.4);④ `Instance` 加 `text_font`/`text_size` 字段 + canvas-text-node 展示态读取
- **字号默认值**(设计 §5.4b,用户拍板):新建文字节点 **16**(对齐 note 正文 16px,[pm-host.css:9](../../src/drivers/text-editing-driver/pm-host.css#L9));老画板无字段 sanitize 兜底 **14**(视觉不变)

### 2.4 字体打包清单(设计 §5.4,用户拍板全装)
| 字体 | 状态 | license 要求 |
|---|---|---|
| Inter / Noto Sans SC / JetBrains Mono | ✅已装 | — |
| Noto Serif SC(中文宋) | 🆕打包 ~10MB | OFL |
| 西文 Serif 衡线体(如 Source Serif/Lora) | 🆕打包 | OFL |
| 西文手写体(如 Caveat) | 🆕打包 | OFL |
| **中文手写体**(LXGW 文楷 或同等) | 🆕打包 ~10MB | **必须 SIL OFL 或同等可商用,选型前核 license** |

字体走 `?url` 懒加载(font-loader 已是按需 `loadFont`),不占启动内存。

### 2.5 capability 注册范式(照抄)
- 双导出 + `capabilityRegistry.register` 范式:抄 [graph-library-store/index.ts](../../src/capabilities/graph-library-store/index.ts)
- `requireCapabilityApi` 来自 `@slot/capability-registry/get-capability-api`(见 [NodeRenderer.ts:24](../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L24))
- renderer 入口注册:`src/platform/renderer/index.tsx` 加 `import '@capabilities/node-toolbar'`
- view install:`src/views/graph-canvas-view/index.ts` install 列表加 `'node-toolbar'`

---

## 3. 物理结构(设计 §4.1,照建)

```
src/capabilities/node-toolbar/
├── types.ts          SectionDef / SectionContext / NodeToolbarApi / ToolbarAnchor / NodeSnapshot
├── registry.ts       sectionRegistry + nodeBindingRegistry(数量无上限)
├── NodeToolbar.tsx   容器:锚定 + button 排布 + 面板互斥 + ESC/键盘(零硬编码 section)
├── sections/
│   ├── fill/index.tsx   色板(直迁 V1 色板视觉,14 色 + No Fill + 取色器)
│   ├── line/index.tsx   线型(5 dashType)+ pt + 色
│   ├── text/index.tsx   B/I/U + 对齐 + 列表 + 文字色(纯走 text-editing,无字号字体)
│   └── type/index.tsx   字体族下拉(中英文分组)+ 自由字号(走 instance text_font/text_size)
├── index.ts          双导出 + register + 内置 4 section 注册 + alive 行
├── styles.css
└── DESIGN.md
```

`SectionContext` 契约见设计 §4.2(含 `patchStyle` / `patchInstance` / `runTextCommand` / `close`)。

---

## 4. 分阶段实施(设计 §6,共 9 子段,单分支多 commit,全过再合 main)

分支:`feature/L5G5-node-floating-toolbar`(从 main 切)。

```
G5.1  node-toolbar 骨架 + registry + 空容器
G5.2  Host.getSelectedScreenAABB + view 接入,浮条贴选中框下方居中跟随(假 button 验锚定)
G5.3  Fill section + Line section(纯 UI + patchStyle,数据层就绪)
G5.4  text-editing.runNodeStyleCommand 前置(对指定文字节点整 doc 改 note mark)
G5.5  Text section(B/I/U/对齐/列表/文字色,走 5.4)
G5.6  字体管线扩展(atomsToSvg baseFontSize 透传 + chooseFontKey fontFamily 入口 + Instance text_font/text_size 字段 + 默认值)
G5.7  打包新字体(§2.4)+ Type section(字体下拉 + 字号)
G5.8  canvas view 全量接入 + 互斥/ESC/键盘 + 视觉对齐 Freeform + 删除 dead code ui/floating-inspector
G5.9  family-tree(或 mock 节点类型)接入跑通 registry —— 通用性硬验收
```

> G5.4/G5.5(Text 线)与 G5.6/G5.7(Type 线)互不依赖,可并行。
> **G5.4 风险预案**(设计 §5.3 + §8):若 text-editing.Host 当前只能操作"已聚焦的活跃实例"、无法对任意 instance 的 doc 改 mark,**不要硬上、不要违规 import**——退化为"点 Text 组 → 自动进入该节点编辑态 + 全选 → 走既有聚焦命令",并在 completion 报告里标明退化,留完整态后续。

---

## 5. 验收对接(完成后交回总指挥)

### 5.1 你要交付的产物
1. 代码:`feature/L5G5-node-floating-toolbar` 分支,9 子段 commit(或合理合并),**不要合 main**(等总指挥验收)
2. **完成报告**:`docs/RefactorV2/stages/L5G5-node-floating-toolbar-completion.md`,对齐 [L5G3-completion](../RefactorV2/stages/L5G3-canvas-rendering-completion.md) 格式:
   - 每子段实际 LOC + 与设计的偏差(照搬 / 微调 / 未做,逐条)
   - 决策变更(若实施中发现设计某点不可行,记录改了什么 + 为什么,**不要默默偏离**)
   - G5.4 是否走了退化预案
   - 自检输出:`[node-toolbar] alive` 行 + install-coverage + typecheck/lint/屏障 grep 结果
   - 遗留 / 待优化项

### 5.2 总指挥会按设计 §7 验收清单逐条核(你自测时也按这个)
关键硬验收(任一不过 = 打回):
- [ ] 普通 shape 显 `Fill+Line`;line 显 `Line+Arrow`(无 Fill);文字节点显 `Fill+Text+Type` —— **registry 生效,容器无硬编码**
- [ ] 浮条贴选中框正下方居中,拖/缩/转节点 + pan/zoom 实时跟随
- [ ] Fill 14 色+No Fill+取色 / Line 5 线型+pt+色 → 节点立即变
- [ ] **Text 面板内无字号无字体**(note 复用边界,这条专门防污染)
- [ ] Type:换字体(中黑/宋/手写;西 Sans/Serif/Mono/手写)→ SVG 按字体重渲染;调字号(自由 pt)→ 立即缩放
- [ ] 中文节点选西文字体 → 中文字符仍走中文字体不丢字
- [ ] 新建文字节点默认 16px;老画板节点保持原视觉(14)
- [ ] **通用性证明(G5.9)**:family-tree/mock 注册不同 section 组合,容器零改动渲染正确
- [ ] typecheck 0 / lint 0 warn / 屏障 grep 0 命中 / `node-toolbar` alive

### 5.3 有疑问怎么办
- 设计文档已覆盖的:**以设计为准**,别自行发挥。
- 设计没覆盖、且影响架构的(如 text-editing API 扩展形态、字体选型 license):**记录在完成报告"待总指挥确认"区**,继续做不阻塞的部分,别擅自拍板架构。
- 纯实现细节(命名、CSS 像素、面板圆角):自己合理决定,对齐 Freeform 视觉 + V2 既有样式变量(`--krig-*`)。

---

## 6. 开工前 checklist

- [ ] 通读 L5G5 设计文档 v0.3 全文(§1~§9)
- [ ] 确认在 `feature/L5G5-node-floating-toolbar` 分支(从 main 切)
- [ ] 跑一次 `npm start` 确认当前 graph canvas 能开、能选中节点(基线)
- [ ] 按 §4 顺序逐子段推进,每子段 typecheck+lint+屏障 grep 过再 commit

执行完毕回到总指挥对话,交分支 + completion 报告。开始吧。
