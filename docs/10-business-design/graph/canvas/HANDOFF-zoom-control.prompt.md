# 交接 prompt · 画板缩放控件(显示 + 放大/缩小)

> 交给**新对话**。分工:**用户 = 决策者;你 = 执行者(写代码)**。
>
> 本轮只做 **canvas-rendering + 画板 toolbar**。
> ⚠️ **不碰 mind / diglot** —— 导图会在你完成后**继承使用**(见 §6)。

---

## 0. 一句话:要做什么

> 画板上加一个**缩放控件**:显示当前百分比,能放大/缩小/回到 100%/适应窗口。
> 做成**画板共用能力**,导图后续直接继承。

⭐ **大部分底座已经有了**,缺的主要是 UI 和快捷键(见 §2)。

---

## 1. ⭐⭐ 先读这些(别急着写)

| 文件 | 为什么必读 |
|---|---|
| ⭐⭐ `src/capabilities/canvas-rendering/Host.tsx` | `zoomTo(percent)` / `fitToContent(padding)` / `setViewport` **已实现**(245-260 行) |
| ⭐ `src/capabilities/canvas-rendering/interaction/InteractionController.ts` | 滚轮/pinch 缩放已实现;`MIN_ZOOM=0.1` `MAX_ZOOM=20`(70-73 行) |
| ⭐ `src/views/graph-canvas-view/GraphCanvasToolbar.tsx` | 控件要加在这里。⚠️ **画板与导图共用同一个 toolbar** |
| `src/views/graph-canvas-view/GraphCanvasView.tsx` | `handleViewportChange`(315 行)→ 防抖保存;视口**已持久化**到 `doc_content.view` |
| `src/capabilities/canvas-rendering/types.ts` | `Viewport{centerX,centerY,zoom}`(161-166)、`onViewportChange`(203)、Host API(243-258) |

---

## 2. ⭐ 现状(实测,可直接用)

### 2.1 已经有的

```
Host API(types.ts 243-258,Host.tsx 已实现):
  ├─ zoomTo(percent)          ⭐ 100 = zoom 1;内部夹 10~2000
  ├─ fitToContent(padding)    ⭐ 适应窗口(padding 是**比例**不是像素!)
  ├─ setViewport(vp)          直接设
  └─ onViewportChange(vp)     ⭐ pan/zoom 时回调 —— **缩放显示就读它**

InteractionController:
  ├─ 滚轮 / pinch → zoom-to-cursor   ✅ 已实现
  └─ MIN_ZOOM=0.1  MAX_ZOOM=20       ✅ 已有上下限
```

⚠️ `zoomTo` 的注释直接写着「**view 端 toolbar zoom 滑块用**」—— 这个 API 当初就是为本轮准备的。

### 2.2 ⚠️ 缺的

1. **没有任何缩放显示** —— 全仓 grep `zoom` 在 toolbar 里**零命中**
2. **没有 `Cmd+` / `Cmd-` / `Cmd0` 快捷键** —— InteractionController 里没接
3. ⚠️ `zoomTo` 内部夹 `10~2000`,而滚轮夹 `MIN_ZOOM=0.1 ~ MAX_ZOOM=20`(即 10%~2000%)
   —— **两处口径一致,但写了两遍**。做的时候统一到一处常量

### 2.3 ⚠️⚠️ 一条必须尊重的既有事实

```
GraphCanvasToolbar 是**画板与导图共用**的同一个组件
(它已有 mindPinnedCount / onMindReleaseAll 这类导图专属 prop)。
```

⭐ 所以你加的缩放控件**两边都会出现** —— 这正是用户想要的(「大家共用」)。
⚠️ 但**别在里面写任何 mind 专属逻辑**,导图的事下一轮再说。

---

## 3. ⭐ 本轮范围

### 3.1 做什么

1. **缩放百分比显示** —— 读 `onViewportChange` 的 `vp.zoom`,显示 `Math.round(zoom*100)%`
2. **放大 / 缩小按钮** —— 调 `zoomTo`。⭐ 建议按**档位**走,不要线性加减:
   `[10, 25, 50, 75, 100, 150, 200, 400, 800, 1600]` —— 点一下跳下一档,手感比 `+10%` 好
3. **点百分比 → 下拉菜单**:各档位 + `适应窗口`(调 `fitToContent`)+ `100%`
4. **快捷键**:`Cmd/Ctrl +` 放大、`Cmd/Ctrl -` 缩小、`Cmd/Ctrl 0` 回 100%
   ⚠️ 接在 InteractionController 的键盘处理里(与既有快捷键同处),别散在 view

### 3.2 ⚠️ 不做什么

- ❌ **不碰 mind / diglot 任何代码**(下一轮继承时再接)
- ❌ 不改滚轮/pinch 的既有手感(`WHEEL_ZOOM_SENSITIVITY` 不动)
- ❌ 不做缩放滑块(先按钮+下拉,滑块等用户提)
- ❌ 不改视口持久化(画板**已经存了**,见 §2)

---

## 4. ⭐ 建议实施顺序

```
① 断言先行 —— 档位跳转正确 / 夹在上下限内 / 百分比取整 / 快捷键映射
② 统一上下限常量(现在 zoomTo 和滚轮各写一遍)
③ toolbar UI:显示 + 按钮 + 下拉
④ 快捷键接进 InteractionController
⑤ 真机验:滚轮缩放时显示跟着变 / 点档位生效 / 适应窗口 / Cmd0
```

⚠️ ① 打头 —— 这个仓库的纪律是**断言先于交互代码**。

---

## 5. ⚠️ 铁律(违反即返工)

- ⚠️⚠️ **`tests/x/` 512 必须全绿** —— 红了 = 改变了行为;**改测试让它绿 = 违规**
- ⚠️ 全仓存量失败(**7 文件 / 2 用例**)**不要去修**,不是你弄坏的
- ⭐⭐ **每条测试都必须验证过能真的失败** —— 写完守卫**故意注入违规看它变红**。
  ⚠️ 两个真实教训:
  - 断言写成 `toContain('mesh.scale.y = -1')`,而**注释里也有这句话** → 删掉真代码测试照样绿。
    **守卫必须只看会执行的代码**(剥掉注释行再比)。
  - 守卫照抄实现的公式 → 只能验证「实现和自己一致」,**验不出漏项**。
    要按**真正要的效果**列全条件。
  - ⚠️ 注入没红时先分清:是**守卫失效**,还是**注入没造出目标场景**(踩过)。
- ⚠️ **不要静默兜底**;fail loud / early
- ⚠️ **常驻 timer / 事件监听必须有停止调用**
- ⭐ **canvas-rendering 是共用 basic**:**增**功能可以,**改既有行为**要先问用户

### 5.1 ⚠️ 真机验证的环境坑

```bash
env -u ELECTRON_RUN_AS_NODE npx electron-forge start
```
否则 `require('electron')` 命中 npm launcher 包,报 `Cannot find module 'electron'`
—— ⚠️ 与「Electron 装坏了」一模一样,极易误判。

**做实验改文件时用 `cp` 备份还原,绝不用 `git checkout`**(会丢未提交的工作)。

### 5.2 ⚠️ grep 可能"看不见"某些文件

仓库里有几个源码文件含**裸 NUL 字节**,`grep` 会**静默跳过整个文件**
(exit 1、零输出,与「真没有」无法区分)。
判据:`file x.ts` 报 `data`;解法:`grep -a`。
⭐ **搜不到时先验搜索工具本身是否生效**,别直接断言「功能不存在」。

---

## 6. ⏳ 下一轮预告(本轮**不做**,但影响你的设计)

导图(diglot mind)会**继承**这套控件。用户口径:

> 「启动时默认上一次关闭前的比例;创建新的 mind 时,默认 100%。」

⭐ **对你的要求**:
- 缩放显示/控制**只依赖 `onViewportChange` + `zoomTo`**,不要依赖画板独有的存储
- 别把「视口存在哪」写死进控件 —— 画板存 `doc_content.view`,
  导图将来存 G 层;**控件不该知道这件事**

⚠️ 本轮**不要**去实现「记住上次比例」—— 画板已经存了视口,mind 那边是下一轮的事。

---

## 7. 和用户协作的方式(顺着来效率高得多)

- **他会盯着数据要证据**。说「我觉得有问题」时通常是对的,**先查再答**
- ⭐⭐ **他会推翻你的结论,而且往往对**。被纠正时**先查证再认**,别急着道歉也别硬撑
- ⚠️ **他明确讨厌的**:拿一个指标否定它没测的能力;把「库里没有」当「拿不到」;
  **用注释里的说明骗过守卫**
- ⭐ **先查既有实现再动手** —— 这个仓库里「你以为要做的事」常常已经做了一半
  (本轮就是:`zoomTo` / `fitToContent` 早就实现好了)
- ⚠️ **别靠读代码脑补**:定位问题时加诊断日志 / 写离线探针 / 查真实数据。
  上一轮有人拿截图像素反推尺寸(没算缩放),据此提的三个方案全是治症状,白费两轮

---

## 8. 开场建议

别一上来就写代码。建议:

> 「我先读 `Host.tsx` 的 zoomTo/fitToContent 和 `GraphCanvasToolbar`,确认理解。
>  **底座已经有了**(zoomTo/fitToContent/onViewportChange 都实现好了),
>  我要做的是 toolbar 上的显示+按钮+下拉,再把 Cmd±/Cmd0 接进 InteractionController。
>  ⚠️ 我注意到 toolbar 是画板与导图**共用**的,所以控件两边都会出现 —— 这是你要的吧?
>  我打算**先把断言写出来**(档位跳转/上下限/百分比取整),再做 UI。
>  这个顺序你认吗?」
