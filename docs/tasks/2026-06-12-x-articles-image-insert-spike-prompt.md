# 调研 Prompt：X Article 怎么接受图片（落位策略前置研究，纯调研不写实现）

> 交接日期：2026-06-12
> 交接人：总指挥｜验收人：总指挥
> 缘起：总指挥实机验证 **X Article 粘贴只吃文字富格式、不吃图**（`<img src=media://>` 粘进去变 📷 占位符）。文字走 HTML 粘贴已定；**图必须走 feedFilesToInput 旁路单独喂**。但「图喂进去后怎么落到正文对的位置」总指挥拍板「先研究清楚再下结论」，不急着定策略。
> 当前分支 `docs/x-integration-design`（含 Articles 纯逻辑层 `9a16fa20`）。
> **本任务：纯调研，不写实现代码。** 产出调研报告，停下来交总指挥（X 真实交互行为部分留总指挥实机确认）。

---

## 0. 已知事实（别重复验）
- X Article 文字/标题/列表/链接/加粗 → 粘贴保留 ✅
- X Article 图片 → 粘贴**不保留**（变 📷 占位符）❌ → 图得走 feedFilesToInput
- 2.5-b 发推喂图：`feedFilesToInput`（`web-service-base/webview-file-input.ts`，CDP `DOM.setFileInputFiles`）靠 `fileInput` selector（`x-service-types.ts:128`，`input[data-testid="fileInput"]`）—— **但这是为发推 compose 框设的，Article 编辑器是否同一个 input 未知**。

## 1. 要查清的（代码侧能查的先查，X 真实行为标「待总指挥实机」）

**A｜代码侧（你能查）**：
1. `feedFilesToInput` 整条链路是否与"哪个编辑器"无关 —— 只要给对 fileInput selector + 目标 wc，就能喂？还是隐含了 compose 框的假设？（读 `webview-file-input.ts` 全文）
2. profile 现有 `fileInput` selector（`input[data-testid="fileInput"]`）—— 在 X Article 页面是否可能命中？X 官方 testid 惯例（查开源库 / 已有注释线索），Article 的插图 input 大概率 testid 是什么？
3. `uploadedMediaThumb` selector（喂图后的校验）在 Article 场景是否还适用？
4. 粘贴留下的 📷 占位符：从 X DOM 角度它是什么元素（查开源库/惯例推测）？它是否暗示「X 想要这张图但没拿到本地 media://」（即喂文件可能补上）？还是纯死占位？

**B｜X 真实交互（标「待总指挥实机」，你列出让用户验的清单）**：
1. **Insert ▾ 插图流程**：点 Insert → 选图片 → 是弹文件框（`<input type=file>`）还是拖拽区？选图后图插在**光标处**还是**末尾/固定处**？
2. **图能否插在段落中间**：光标放两段之间插图 → 图嵌在那里，还是被 X 挪走？
3. **Article 的 fileInput testid** 到底是不是 `fileInput`（与发推同）？还是 Article 专属？
4. **图数量上限**：Article 是否像发推那样限 4 张？还是不限？
5. 📷 占位符喂图后能否被「补上」？

## 2. 据调研给出「图落位策略」候选 + 推荐
基于 A/B 结论，评估这几条落位路线的可行性，给推荐（拿不准列权衡给总指挥）：
- **路线甲**：图统一放文末（最简，不依赖光标定位）
- **路线乙**：逐图定位到原文位置插入（要控 X 编辑器光标/段落定位，重）
- **路线丙**：本期不嵌图，纯文字+格式先发（最小范围）
- 其他你发现的更优路线

## 3. 不做实现
只读代码 + 推测 + 列实机清单 + 出落位策略候选。**不改源码、不写喂图编排。** 报告末尾「待总指挥拍落位策略 + 实机清单结果后开工」。

## 4. 交付
产出 `docs/tasks/2026-06-12-x-articles-image-insert-spike.md`：
1. A 代码侧结论（feedFilesToInput 可复用性 / Article fileInput selector 假设 / 占位符性质）
2. B「待总指挥实机」清单（5 项，对真实 X Article 逐项验）
3. 落位策略候选 + 推荐 + 权衡
4. 复用面（feedFilesToInput / 2.5-b 喂图管道在 Article 能复用多少）
5. 不写实现，停。

## 5. 红线
- ❌ 写实现代码（本期纯调研）
- ❌ 凭记忆断言 X Article 的 fileInput testid / 插图行为（标「待实机」，别当事实）
- ❌ 假设 Article fileInput == 发推 fileInput（要验，可能不同）
- ❌ 急着下落位策略结论（总指挥明确「先研究清楚」）
