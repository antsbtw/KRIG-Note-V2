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
