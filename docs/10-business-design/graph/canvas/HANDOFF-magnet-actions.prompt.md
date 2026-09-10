# 交接 prompt · 连接点操作点(magnet actions)

> 交给**新对话**。分工:**用户 = 决策者;你 = 执行者(写代码)**。
>
> ⚠️ 本轮动的是 **`canvas-rendering` 共享底座** —— 画板 / family-tree / diglot mind
> 都用它。**改坏了影响面很大**,务必守住 §5 的铁律。

---

## 0. 一句话:要做什么

> 让**每个图元的连接点(magnet)**变成可交互的操作点:
> **点它** → 触发回调(如折叠子树);**拖它** → 拉出一条连接到别的节点。

⭐ 这是 XMind / Figma 的核心手势 —— 连接点既是视觉锚点,也是操作入口。

---

## 1. ⭐⭐ 先读这些(别急着写)

| 文件 | 为什么必读 |
|---|---|
| ⭐⭐ `src/capabilities/canvas-rendering/interaction/InteractionController.ts` | **1930 行,画布交互核心**。手势优先级链在 `handleMouseDown`(§2.3) |
| ⭐ `src/capabilities/canvas-rendering/scene/HandlesOverlay.ts` | **可点圆圈的现成范例**(rotation handle 就是绿圆);⭐ 更重要的是它的 `ParamHandleProvider` 范式:**overlay 只画 + hitTest,业务数据由外部 provider 给** |
| ⭐ `src/capabilities/canvas-rendering/interaction/magnet-snap.ts` | `listMagnets` / `findClosestMagnet` —— **吸附已经实现,直接用** |
| `src/capabilities/shape-library/types.ts` | `MagnetPoint { id, x, y }`(归一化 0..1)—— 连接点的既有契约 |
| `src/capabilities/canvas-rendering/DESIGN.md` | ⚠️ **本 capability 是全仓唯一允许 import three 的位置**(ESLint 强制) |

---

## 2. ⭐ 现状(实测,可直接用)

### 2.1 已经有的 —— ⭐ 一半工作是白送的

| 能力 | 位置 | 说明 |
|---|---|---|
| **每个图元都有 magnets** | shape JSON | rect/ellipse/roundRect/text 都是 `[N,E,S,W]`;line 是 `[START,END]` |
| **magnet 世界坐标** | `listMagnets(node, instance)` | 归一化 → 世界坐标,已处理 rotation |
| **吸附** | `findClosestMagnet(x, y, candidates, maxDist, exclude)` | 拖到附近自动吸,**别重写** |
| **rewire** | `startRewire / updateRewire / tryFinishRewire` | 改连线端点,⚠️ 入口是「拖 line 的端点」 |
| **press-drag 画线** | `drawingLine` 状态机 | 已能拖出一条线并落地 |

### 2.2 ⚠️ 缺的

**连接点本身不可交互。** 现在要连线得先进 addMode 或选中线拖端点;
连接点只是「线的吸附目标」,不是「可点/可拖的操作点」。

### 2.3 ⚠️⚠️ 手势优先级链(必须插对位置)

`handleMouseDown` 里已有的顺序(注释里逐条编号):

```
0.   param 拖点(L5-G6c)
1.   HandlesOverlay(resize / rotate)
1.5  line endpoint handle → rewire
2.   命中节点 → 选中 + 拖动
…    marquee / drawingLine / addMode
```

⭐ **magnet action 应插在 1.5 与 2 之间**:比节点拖动优先(否则点连接点会变成拖节点),
但不该抢 resize/rotate/rewire 的既有手势。
⚠️ **务必实测这几个既有手势没被破坏** —— 它们是画板天天在用的。

---

## 3. ⭐ 本轮范围

### 3.1 做什么

**canvas-rendering 侧(通用机制,⚠️ 不认业务语义)**:

```ts
// Instance 上声明「这个连接点有操作点」
Instance.magnetActions?: {
  magnet: string;                    // ⭐ 复用既有 magnet id,不新造坐标语言
  icon: 'plus' | 'minus' | 'dot';
}[];

// Host props
onMagnetClick?: (instanceId: string, magnet: string) => void;
onMagnetDragOut?: (
  instanceId: string, magnet: string,
  target: { instanceId: string; magnet: string } | { world: { x: number; y: number } },
) => void;
```

1. **画**:在声明了 action 的 magnet 位置画一个小圆(`+`/`-`/`·`),
   ⭐ **像素恒定不随 zoom 缩放**(照抄 HandlesOverlay 的 `group.scale = 1/zoom` 那套)
2. **点击** → `onMagnetClick`
3. **拖出** → 拖动时画预览线、吸附到目标 magnet(`findClosestMagnet`)、
   松手 → `onMagnetDragOut`(落在节点上给 target,落在空白给 world 坐标)
4. **Esc 取消**(与既有 rewire/drawingLine 同款)

### 3.2 ⚠️ 不做什么

- ❌ **不在 canvas-rendering 里认识「折叠」** —— 它只知道「连接点上有个可点的圆」。
  折叠是 diglot mind 的业务语义,由调用方接 `onMagnetClick` 实现
- ❌ 不改既有的 rewire / drawingLine / addMode 手势
- ❌ 不动 shape JSON 的 magnets 定义(它们已经够用)

### 3.3 调用方示例(⭐ 本轮**可选**,机制立住即可)

diglot mind 会这样用(`src/views/graph-canvas-view/MindCanvas.tsx`):
- 有子节点的节点 → 在 `E`(右侧连接点)挂 `minus`/`plus`
- `onMagnetClick` → 发 `graphic.toggleCollapsed` action
- `onMagnetDragOut` → 将来用于「拖出一个新子节点」

---

## 4. ⭐ 建议实施顺序

```
① 断言先行 —— 「声明了才画」「点击回调带对 magnet id」「拖出吸附到最近 magnet」
                「Esc 取消不留残留」「既有手势未被破坏」
② 画:MagnetActionsOverlay(照 HandlesOverlay 的像素恒定 + hitTest 范式)
③ 点击:插进优先级链 1.5 与 2 之间
④ 拖出:复用 findClosestMagnet 吸附 + 预览线
⑤ 真机验:画板既有手势(resize/rotate/rewire/画线/框选)逐个过一遍
```

⚠️ ① 打头 —— 这个仓库的纪律是**断言先于交互代码**。

---

## 5. ⚠️ 铁律(违反即返工)

- ⚠️⚠️ **`tests/x/` 512 必须全绿** —— 红了 = 改变了行为;**改测试让它绿 = 违规**
- ⚠️ 全仓存量失败(7 文件 / 2 用例)**不要去修**,不是你弄坏的
- ⭐ **每条测试都必须验证过能真的失败** —— 写完守卫**故意注入违规看它变红**。
  自检问一句:「**如果被测逻辑是错的,这条断言还会成立吗?**」
- ⚠️⚠️ **canvas-rendering 是共享底座** —— 画板 / family-tree / mind 都用。
  加东西可以,**改既有行为要先问用户**
- ⚠️ **不要静默兜底**;fail loud / early
- ⚠️ **常驻 timer / 事件监听必须有停止调用**
- ⭐ three 只能在 `canvas-rendering/**` 内 import(ESLint 强制,别试图绕)

### 5.1 ⚠️ 真机验证的环境坑

```bash
env -u ELECTRON_RUN_AS_NODE npx electron-forge start
```
否则 `require('electron')` 命中 npm launcher 包,报 `Cannot find module 'electron'`
—— ⚠️ 与「Electron 装坏了」一模一样,极易误判。

**做实验改文件时用 `cp` 备份还原,绝不用 `git checkout`**(会丢未提交的工作)。

### 5.2 ⚠️ 画布文字只能用「CJK 或 ASCII」字符

若徽标要显示文字:打包字体按 `font-loader.isCjk` 分流,
**两者之外的符号(如 `⊕` U+2295)会渲染成空白宽度**(刚踩过)。
⭐ 建议**画几何**(圆 + 加减号线段),不走文字渲染,彻底避开。

---

## 6. 和用户协作的方式(顺着来效率高得多)

- **他会盯着数据要证据**。说「我觉得有问题」时通常是对的,**先查再答**
- ⭐ **他会推翻你的结论,而且往往对**。被纠正时**先查证再认**,别急着道歉也别硬撑
- ⚠️ **他明确讨厌的**:拿一个指标否定它没测的能力;把「库里没有」当「拿不到」;
  **用注释里的说明骗过守卫**
- ⭐ **先查既有实现再动手** —— 这个仓库里「你以为要做的事」常常已经做了一半。
  本轮就是活例:magnets、吸附、rewire **全都现成**,你要加的只是「操作点」这一层

---

## 7. 开场建议

别一上来就写代码。建议:

> 「我先读 `InteractionController` 的手势优先级链、`HandlesOverlay` 的
>  像素恒定 + hitTest 范式、`magnet-snap` 的吸附实现,确认理解。
>  ⭐ 实测发现 magnets / 吸附 / rewire 都是现成的,我要加的是**连接点操作点**这一层:
>  点它触发回调、拖它拉出连接。
>  ⚠️ canvas-rendering 不会认识『折叠』—— 那是调用方的语义。
>  我打算**先写断言**(声明才画 / 回调带对 magnet id / 拖出吸附 / Esc 取消 /
>  既有手势未被破坏),再做画 → 点击 → 拖出。这个顺序你认吗?」

---

## 8. 实施结果(2026-09-10)

**机制 + diglot mind 调用方均已落地。真机验证未做 —— 见下方「待验」。**

### 8.1 落在哪

| 层 | 文件 | 说明 |
|---|---|---|
| 纯逻辑 | `src/capabilities/canvas-rendering/interaction/magnet-actions.ts`(新) | 声明解析 / 命中判定 / 落点分流 —— **0 import three** |
| 画 | `src/capabilities/canvas-rendering/scene/MagnetActionsOverlay.ts`(新) | 像素恒定圆 + `+`/`-`/`·` 记号(**画几何,不走文字渲染**) |
| 手势 | `InteractionController` 新增 **1.7 段** | 插在 rewire(1.5)之后、节点拖动(2)之前 |
| 契约 | `types.ts` | `Instance.magnetActions` + `onMagnetClick` / `onMagnetDragOut` |
| 装配 | `Host.tsx` | 建 overlay + provider(扫 instances 的声明,经既有 `listMagnets` 解世界坐标) |
| 调用方 | `project-to-canvas.ts` + `MindCanvas.tsx` | 有子节点的节点在 `E` 挂圆;点它 → `graphic.toggleCollapsed` |

⭐ **一半工作确实是白送的**:magnets / 吸附(`findClosestMagnet`)/ 预览线
(`renderLine` + `updateLineGeometry`)全部复用,没有重写任何几何。

### 8.2 ⚠️ 一个必须交代的偏差:断言落在哪

交接 §4 要求「断言先行」,已做,但**落点与预期不同**,原因是实测出来的约束:

> **本仓库没有任何测试 import 过 three** —— vitest 跑 node 环境,无 DOM / WebGL。

所以断言分成两半(此决定已与用户确认):

1. **真行为断言**(`tests/capabilities/canvas-magnet-actions.test.ts`,13 条)——
   判定逻辑抽进纯模块后直测:声明才画 / 拼错 id 丢弃+warn / **命中按屏幕像素恒定**
   (同一屏幕距离在 zoom 0.25~8 下结果一致)/ 重叠取最近 / 落空白给 world 坐标。
2. **结构断言**(`tests/capabilities/canvas-magnet-actions-gesture-chain.test.ts`,8 条)——
   守「顺序」与「必有停止调用」这类**会被改动悄悄破坏、且不会报错**的不变量:
   操作点在 rewire 之后 / 节点命中之前、Esc 与 dispose 都有取消、
   预览线真被 `dispose` 而非只置 null、overlay 常驻 RAF 有 `cancelAnimationFrame`、
   底座不出现 `toggleCollapsed` 这类调用方语义。
3. **投影断言**(`tests/capabilities/diglot/project-to-canvas.test.ts`,+4 条)——
   有子节点才挂 / 叶子不挂 / 图标反映「点了会发生什么」/ 树连线不挂。

⚠️ **结构断言不是行为断言**,守不住「点下去真的会折叠」——那一半只能真机验。

### 8.3 验红台账

**25 条新断言,逐条注入违规实跑验红**(明细见各测试文件末尾的台账表):
纯逻辑 9 项注入、手势链 8 项注入、投影 4 项注入,**全部由对应断言捕获**。
实验用 `cp` 备份还原,未用 `git checkout`。

### 8.4 测试状态

- `tests/x/` **512 全绿**(铁律)
- diglot 147 全绿(142 + 新 4 + 1)
- 全仓 1868 passed / 2 failed(7 文件)—— **已 stash 改动实跑对照,与基线逐条一致**:
  2 个失败用例都在 `tests/views/slot-resource-guard.test.ts`(slotBinding 已知债),
  另 6 个文件是 `electron` 在 node 环境 import 失败的收集错误(scenarios / bookmark /
  create-notes-batch);**没有一个碰到 canvas-rendering 或 diglot**
- `tsc` 仅剩 `XInboxView.tsx:881` 的存量错误(改动前后一致,非本轮引入)
- `eslint` 改动文件零错误

### 8.5 ⚠️ 待验 / 未做

1. **真机验证一条没做** —— 交接 §4 ⑤ 要求「画板既有手势逐个过一遍
   (resize / rotate / rewire / 画线 / 框选)」,以及 mind 上点圆真能折叠。
   结构断言只能证明**代码顺序**没错,证明不了**点下去的效果**。
2. `onMagnetDragOut` **机制已通但无人消费** —— diglot mind 只接了 click。
   「拖出一个新子节点」按 §3.3 是将来的事。
3. 拖出预览线固定用 `krig.line.straight`;真机看观感若不合适可换 `curved`。

---

## 9. ⚠️ 真机第一轮反馈 & 修复(2026-09-10)

用户真机截图指出两点:「收起来时应该是 `-` 吧?怎么收起来和展开都一样?」
「连接点应该在最上层吧,而不是被线条挡住?」

### 9.1 ⭐ 两个问题是**同一个根因**

图标逻辑没错(截图里折叠的「分支A(5)」画的正是 `+`)。
「看起来一样」的真因 = **记号被树连线糊掉**:父节点的 `E` 点正是所有子树连线的
汇聚点,四条线压在圆上,`-` 就看不见了。所以第一个问题是第二个问题的表征。

### 9.2 ⚠️⚠️ 只调 Z 没用 —— 两件事缺一不可

| 坑 | 事实 |
|---|---|
| 线**不看 Z** | `LineRenderer` 的材质是 `depthTest:false`,纯按 `renderOrder` 排(它是 1)。把操作点 Z 抬到 0.06 对它毫无作用 |
| `renderOrder` **不继承** | three 的排序看每个可渲染对象**自己**的 renderOrder。设在 root Group 上等于没设,子 mesh 仍是 0 —— 输给线的 1 |

修法:**逐 mesh** 设 `renderOrder`(20+,高于线的 1)+ 材质 `depthTest:false`
(与线同一套规则)。圆内部三层(边框/底/记号)也靠 renderOrder 分先后,
因为关掉 depthTest 后 Z 不再参与排序。

⚠️ **同族隐患**:`HandlesOverlay` 也是把 renderOrder 设在 Group 上(第 114 行)。
它没暴露只是因为 handle 长在 bbox 边缘、离连线远。**别照抄那处写法。**

### 9.3 ⚠️⚠️ 一条守卫「用注释骗过了自己」—— 必须记下来

新加的 3 条层级守卫注入验红时,**`depthTest:false` 那条第一次是绿的**:
守卫拿源码全文做文本匹配,而文件注释里到处写着「depthTest:false」的解释文字,
于是**删掉真代码它照样匹配得上**。这正是 §6 列的「用注释里的说明骗过守卫」。

修法 = 加 `stripComments()` 先剥注释再匹配,重新注入确认变红。
⭐ **教训**:文本型守卫必须先问一句「**被守的字符串会不会也出现在注释里**」。
本轮另外几条(`cancelMagnetAction` / `cancelAnimationFrame` /
`disposeLineGroup` / `tryStartMagnetAction`)已逐个核过 —— 注释里 0 次出现,
之前的红是真的。

### 9.4 状态

- 新增 3 条层级守卫(共 28 条断言),**逐条注入验红**(含上面那条修好后重验)
- `tests/x/` 512 全绿;capabilities+views 882 passed / 2 failed(存量 slotBinding 债)
- tsc / eslint 状态同 §8.4
- ⚠️ **仍未真机复验** —— 这次改的是渲染层排序,必须真机看一眼记号是否露出来

---

## 10. ⚠️⚠️ 真机第二轮:一个症状,四次误判(2026-09-10)

用户报「折叠圆里有个黑点/脏点」。**我从代码猜了四次,前三次全错**,
最后靠用户三条实测观察才定位。这段值得后来者读,因为踩的是**方法**的坑。

### 10.1 误判过程(反面教材)

| # | 我的判断 | 依据 | 结果 |
|---|---|---|---|
| ① | magnet 提示点盖住了 | 提示点画在同一个 magnet 上 | ❌ 提示点画在**所有** magnet 上,不会只挑折叠节点 |
| ② | 数字画太大顶满圆边 | 算出墨迹 5.4px / 圆内径 6px | ❌ 是真 bug,但**不是这个症状**的因 |
| ③ | 纹理缺 sRGB 边缘发黑 | TextRenderer 有、我漏抄 | ✅ **是真 bug**(数字从糊成一坨变清晰),但症状仍在 |
| ④ | `e` resize handle 与操作点重合 | 位置确实完全重合 | ❌ handle 是白圆蓝边且**正中**边缘;那个点是灰色、在圆**外面** |
| ⑤ | **用户判断:是画布网格点** | 截图里底部那排灰点同样大小同色 | ✅ **正确** |

⭐ **决定性线索全部来自用户的实测观察**,不是代码:
「只有折叠节点有」→ 排除提示点;「**和数字大小无关**」→ 排除 ②;
「**放大一点就没有了**」→ 指向世界坐标的东西(网格点固定在世界坐标,缩放会挪位)。

⚠️ **教训**:纯视觉问题**先问现象特征**(颜色/大小/位置/什么时候消失),
再读代码。反过来做就是我这四次 —— 每次都能从代码里"讲通",但全是错的。

### 10.2 真因与处理

那个点是 **DotGrid 背景网格点**(`#888888`,半径 1.4 **世界单位**,间距 48),
恰好落在圆旁边。**它不是缺陷** —— 节点外面本来就该有网格点,平移/缩放就挪走。

⚠️ 用户问「不是可以用不透明覆盖吗」—— **不行**:圆本来就是不透明的,
那个点在**圆外面**(离圆心约 22px),不在覆盖范围内;要盖住得把圆撑到半径 20px。

⭐ 采纳方案 = **呼吸区外环**(`ACTION_HALO`):圆最外面套一圈**与画布同色**
(`#1e1e1e`)的环,宽 3.5px。这是**通用解**(操作点在任何背景上都有干净边界),
不是针对"那一个点"打补丁。

⚠️⚠️ 外环色与 `SceneManager.scene.background` 是**跨文件隐式耦合**,
改背景色漏改这里 → 外环显形成灰圈(比原来的脏点更糟)。已由守卫钉住:
守卫**实读** SceneManager 的背景色再比对,不写死期望值。

### 10.3 这一轮真正修掉的 bug

| 改动 | 是真问题吗 |
|---|---|
| 数字纹理补 `colorSpace = SRGBColorSpace` | ✅ **真凶之一**,数字从黑斑变清晰(canvas 是 sRGB,不声明按线性处理→边缘压暗) |
| 字号 0.62 → 0.82 | ✅ 用户实测「太小看不清」 |
| 方片改为**内接于圆**(直径/√2) | ✅ 原来边长=直径,四角伸出圆外 2.5px |
| 数字纹理补 `depthWrite:false` | ✅ 对齐 TextRenderer 同款做法 |
| 提示点排到操作点之下 | ✅ 第一轮截图里数字确实被盖过 |
| **呼吸区外环** | ⭐ 本轮新增 |

### 10.4 ⚠️ 我自己写坏的两条守卫(都已修)

1. **尺寸守卫卡了「墨迹 < 圆内径 × 0.8」** —— 那个 0.8 是我**自己发明的**假设。
   用户要求调大字号后它把正确的改动判红了。已改成只卡上界(装得进圆/方片),
   并在注释里写明「**守的是不顶边,不是越小越好**;用户反馈过太小看不清」。
2. **命中范围守卫匹配了过时的表达式** —— 代码已演进成按 action 实际半径算
   (`r + slop`),守卫还在匹配旧的常量写法,一加就红。已按现状修正。

⭐ 两条都说明:**守卫也会写错**,而且错法是「把我的假设当成约束」。
写完必须注入验红,红了还要看**是不是该红的那条**。

### 10.5 状态

- 新增 3 条外环守卫(共 **19 条**结构断言),全部注入验红
- `tests/x/` 512 全绿;700 全绿;tsc / eslint 干净
- ⚠️ **外环效果未经真机确认** —— 这是纯视觉改动,单测只能证明颜色与背景一致
