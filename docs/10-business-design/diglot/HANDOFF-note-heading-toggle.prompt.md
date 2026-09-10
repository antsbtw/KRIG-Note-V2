# 交接 prompt · note 标题折叠三角(h1~h6 行内 toggle)

> 交给**新对话**。分工:**用户 = 决策者;你 = 执行者(写代码)**。
>
> 本轮只做 **note 本体**的折叠交互。⚠️ **不碰 mind** —— 那是下一轮的事(见 §6)。

---

## 0. 一句话:要做什么

> 在 note 编辑器里,给 **h1~h6 标题左侧加一个可点的三角(▸/▾)**,
> 点它折叠/展开该标题下的整段内容。

⭐ **核心能力已经有了,缺的只是「行内可点的入口」。**

---

## 1. ⭐⭐ 先读这些(别急着写)

| 文件 | 为什么必读 |
|---|---|
| ⭐⭐ `src/drivers/text-editing-driver/plugins/build-heading-collapse-plugin.ts` | **折叠逻辑已完整实现**(351 行)。范围推导、状态管理、decoration 全都有 |
| ⭐ `src/drivers/text-editing-driver/plugins/build-block-handle-plugin.ts` | **行内 widget 的现成范例** —— ⋮⋮ 手柄就是这么画的,照它做三角 |
| `src/capabilities/text-editing/ui/handle-menu/items.tsx` | 现有的「折叠」菜单项(`createHeadingCollapseItem`),命令名从这里取 |
| `src/views/note/toc/toc.css` | 已有 `.heading-collapsed` 样式(虚线下划线) |
| `src/capabilities/COMMON-PROTOCOL.md` | capability/driver 分层规程 |

---

## 2. ⭐ 现状(实测,可直接用)

### 2.1 已经有的

```
buildHeadingCollapsePlugin()   ← 已挂在 editor-view-builder.ts:174
  ├─ toggleHeadingCollapse(view, pos)   ⭐ 折叠/展开,直接可调
  ├─ isHeadingCollapsed(state, pos)     ⭐ 查状态
  ├─ expandToLevel(view, level)         按级别批量展开
  └─ decoration:'heading-collapsed-hidden'(藏内容) + 'heading-collapsed'(虚线)
```

**折叠范围推导**(已实现):`H1` 到下一个 H1 或文末;`H2` 到下一个 H2/H1;以此类推。

### 2.2 ⚠️ 缺的只有一样

**没有行内可点的入口。** 现在只能从 ⋮⋮ 菜单里点「折叠」——
藏得深、看不出哪些标题被折叠了、也不符合「一眼可见」的直觉。

### 2.3 ⚠️⚠️ 一条必须尊重的既有决议

```
折叠状态存哪:
  仅存活在 plugin state 里(Set<headingPos>),不写 heading.attrs,不持久化。
  切笔记 / 重启即重置(用户明确决议:不污染 schema)。
```

⚠️ **本轮不要改这条。** 它是用户明确定过的。
若你认为该改(比如为了 mind 的持久折叠),**先问用户**,不要自作主张。
→ 下一轮 mind 映射时会重新讨论(§6)。

---

## 3. ⭐ 本轮范围

### 3.1 做什么

1. **h1~h6 左侧渲染一个三角**(▸ 折叠态 / ▾ 展开态)
2. **点击切换** —— 调既有的 `toggleHeadingCollapse(view, pos)`
3. **无内容的标题不显示三角**(下面没东西可折,显示了是骗人)
4. **hover 才显形**(参考 ⋮⋮ 手柄的做法),避免常驻干扰阅读

### 3.2 ⚠️ 不做什么

- ❌ 不改折叠状态的持久化策略(§2.3)
- ❌ 不碰 mind / diglot 任何代码
- ❌ 不改 `heading` 的 schema(不加 attr)
- ❌ 不动 TOC 面板(那是另一套入口,已存在)

---

## 4. ⭐ 建议实施顺序

```
① 断言先行 —— 「有子内容才显三角」「点击切换状态」「折叠范围正确」
② decoration widget:在 heading 左侧插三角(照抄 block-handle 的 createElement 模式)
③ 点击处理 → toggleHeadingCollapse
④ CSS:hover 显形、▸/▾ 随状态切换
⑤ 真机验:折叠 → 内容藏起 → 展开 → 回来;多级嵌套;h4~h6 也要有
```

⚠️ ① 打头 —— 这个仓库的纪律是**断言先于交互代码**。

---

## 5. ⚠️ 铁律(违反即返工)

- ⚠️⚠️ **`tests/x/` 512 必须全绿** —— 红了 = 改变了行为;**改测试让它绿 = 违规**
- ⚠️ 全仓存量失败(7 文件 / 2 用例)**不要去修**,不是你弄坏的
- ⭐ **每条测试都必须验证过能真的失败** —— 写完守卫**故意注入违规看它变红**。
  自检问一句:「**如果被测逻辑是错的,这条断言还会成立吗?**」
- ⚠️ **不要静默兜底**;fail loud / early
- ⚠️ **常驻 timer / 事件监听必须有停止调用**
- ⭐ **改动集中在 driver 层**(`text-editing-driver`),别扩散到 view

### 5.1 ⚠️ 真机验证的环境坑

```bash
env -u ELECTRON_RUN_AS_NODE npx electron-forge start
```
否则 `require('electron')` 命中 npm launcher 包,报 `Cannot find module 'electron'`
—— ⚠️ 与「Electron 装坏了」一模一样,极易误判。

**做实验改文件时用 `cp` 备份还原,绝不用 `git checkout`**(会丢未提交的工作)。

---

## 6. ⏳ 下一轮预告(本轮**不做**,但影响你的设计)

用户的完整意图是:**note 的折叠 ⇄ mind 导图的折叠打通**。

⚠️ 两边现在的语义**不一致**:

| | note 折叠 | mind 折叠 |
|---|---|---|
| 存哪 | plugin state | G 层 `collapsed` |
| 持久 | ❌ 重启即重置 | ⭐ **持久**(规格 `01-mind-spec` §3.1 明写) |
| 性质 | 视图状态 | **图的一部分** |

⭐ **对你的要求**:把折叠的**读/写做成可替换的接口形态**,
别把「状态只能来自 plugin state」写死 —— 下一轮要能注入外部状态源。

但 ⚠️ **本轮不要提前实现那个注入**,只要别堵死路。

---

## 7. 和用户协作的方式(顺着来效率高得多)

- **他会盯着数据要证据**。说「我觉得有问题」时通常是对的,**先查再答**
- ⭐ **他会推翻你的结论,而且往往对**。被纠正时**先查证再认**,别急着道歉也别硬撑
- ⚠️ **他明确讨厌的**:拿一个指标否定它没测的能力;把「库里没有」当「拿不到」;
  **用注释里的说明骗过守卫**
- ⭐ **先查既有实现再动手** —— 这个仓库里「你以为要做的事」常常已经做了一半。
  上一轮的教训:嵌 note 编辑器时踩了 4 个坑,**每个的答案都写在 NoteView 的注释里**

---

## 8. 开场建议

别一上来就写代码。建议:

> 「我先读 `build-heading-collapse-plugin.ts` 和 `build-block-handle-plugin.ts`,
>  确认理解。**折叠逻辑已经完整实现**,我要做的只是加一个行内三角当入口,
>  照 ⋮⋮ 手柄的 widget 模式做。
>  ⚠️ 我不会改折叠状态的持久化策略(那条『不污染 schema』是你明确定过的)。
>  我打算**先把断言写出来**(有子内容才显三角 / 点击切换 / 折叠范围正确),
>  再做 widget → 点击 → 样式。这个顺序你认吗?」
