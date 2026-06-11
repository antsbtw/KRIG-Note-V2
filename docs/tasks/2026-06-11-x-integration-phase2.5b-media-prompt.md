# 实施 Prompt：X 集成 阶段 2.5-b（文字推的图片/视频媒体上传）

> 交接日期：2026-06-11
> 交接人：总指挥
> 验收人：总指挥
> 蓝图：[`docs/tasks/2026-06-10-x-integration-roadmap.md`](./2026-06-10-x-integration-roadmap.md) §2.A / §3 阶段 2.5-b
> 前置（均已合 main、补审通过）：阶段 0/1/2、2.5-a 确认弹窗、拖拽发推/回复、ws 实例隔离统一收口、partition per-ws 化。当前 main `0c2c5aab` 干净，typecheck/lint/vitest 全绿。

---

## 0. 目标

让"发文字推 / 回复"时能**带上 note 里的图片/视频作为推文媒体附件**（最多 4 图 + 视频，X 的限制）。
现状：阶段 2 只发纯文字（markdown 里的 `media://` 图被降级成 URL 文本）。本期让真实图片**作为媒体附件**上传到推文。

---

## 1. 红线：走「路线 B」，绝不碰官方 API（蓝图 §2.A 已拍板）

> **【路线 B = 喂文件给 X 自己的上传控件】**
> 在 X 真实发推框里，把 note 的图/视频文件**喂给 X 网页自己的文件上传控件**
> （`<input type=file>` / 拖放区，selector 待 spike），让 **X 前端自己完成 INIT/APPEND/FINALIZE 上传**。
> 我们只负责"把文件塞进 input"，上传与发布仍由 X / 用户完成。

> **【否决·路线 A】** X 官方 `media/upload` API + OAuth = 程序直接发布，**撞反自动化红线 + 收费限额。不走。**

> **【写方向最高红线（贯穿）】** 依然「填充内容（含媒体），用户点发布」。喂完文件**绝不程序点发布**。

> **【fail loud】** 喂文件任一步不可靠（selector 失效 / 文件解析失败 / X 没接住）→ 退「提示用户手动拖图 + 文字已填入」+ 弹窗明示降级，不静默假装成功。

---

## 2. 已核实的现成资产（照着接，别造轮子）

| 要用什么 | 在哪 | 说明 |
|---|---|---|
| **media:// → 真实磁盘路径** | `resolveMediaPath(mediaUrl)` `src/platform/main/media/media-store-impl.ts:567` | **路线 B 关键**：`<input type=file>` 要真实文件路径，这个函数把 `media://x` 解析成磁盘绝对路径 |
| 公共注入底座 | `src/platform/main/web-service-base/webview-input.ts`（`focusInputBox`/`pasteTextToWebview`/`locateSendButton`） | **喂文件原语加在这**（AI/X 共用底座，但喂文件目前只 X 用，加通用原语即可） |
| X 注入目标 wc（按 ws） | `requireXWebContents`（`src/platform/main/x/x-webcontents.ts`，带 poll） | 喂文件也要打到本 ws 的 X 实例（ws 隔离已收口，复用） |
| 取 note 内容 | `getSelectionMarkdown(instanceId)`（已用于发推，`send-to-x.ts:79`） | markdown 里的图是 `media://` URL，可正则提取出图清单 |
| 发推编排 | `src/views/x/send-to-x.ts`、`src/platform/main/x/x-write.ts` | 在现有 pasteTweet/pasteReply 链路里**加"先喂文件再填文字"** |
| 确认弹窗 | `src/views/x/send-confirm-popup/`（2.5-a） | **媒体缩略图应在确认弹窗里展示**（让用户发前看到带哪几张图） |
| X profile selectors | `src/shared/types/x-service-types.ts`（**目前无 fileInput 字段**） | 加 `fileInput` selector（待 spike） |

---

## 3. 工作分解

### 3.1 spike：X 文件上传控件 selector（动手前先做，蓝图 §4 方法论）
- 参考蓝图 §5 开源库的 selector 起点（如 `[data-testid="fileInput"]`），在我们自己的 X webview 里验证。
- 找到：发推框的文件 input selector、拖放区（若用拖放）、上传后缩略图/移除按钮 selector（用于校验"X 接住了"）。
- 结论填进 `x-service-types.ts` 的 profile（加 `fileInput?` 字段）。失效 fail loud。

### 3.2 底座加「喂文件」原语
在 `webview-input.ts` 加一个通用原语，例如：
```
feedFilesToInput(webContents, fileInputSelector, filePaths: string[]): Promise<{ok, error?}>
```
- 实现思路（路线 B 喂文件的标准做法，spike 时确认对 X 有效）：
  - 优先：用 Electron 能力把真实文件塞进 `<input type=file>`（注意 `<input>` 的 `.files` 只读，需用 DataTransfer 构造 + dispatch change/input 事件，或用 Electron 的 debugger/`Input.dispatchDragEvent` 往拖放区投递）。**具体哪种对 X 有效，spike 实测后定**，prompt 不锁死实现。
  - 校验：喂完 poll 等 X 的缩略图出现（证明 X 接住了），没出现 → fail loud。

### 3.3 从 note 收集图清单 → 解析成磁盘路径
- 从选区/整篇 markdown 提取 `media://` 图（最多取 4 张，超出提示用户）。视频取 1 个。
- 每个 `media://` → `resolveMediaPath` → 真实磁盘路径。
- 解析失败的图 fail loud 跳过并提示（不静默丢）。

### 3.4 编排：发推链路加「先喂文件，再填文字」
- 在 `x-write.ts` 的 pasteTweet/pasteReply 里：focus 发推框 → **feedFilesToInput 喂图** → 等缩略图出现 → 再 pasteTextToWebview 填文字 → 停（用户点发布）。
- 回复路径同理。
- 顺序很重要：图先上传（X 要时间转码/生成缩略图），文字后填，避免竞态。

### 3.5 确认弹窗展示媒体
- 2.5-a 的确认弹窗加一栏：缩略图预览 + "将带 N 张图"，让用户发前确认。可移除某张（只影响本次发送）。

---

## 4. 需你定的决策点（拿不准列出来问总指挥）

1. **视频要不要本期做**？视频 X 要 poll 转码完成，比图复杂。**倾向：本期先只做图片（最多4张），视频留到下一小步**，把图跑通。由总指挥定。
2. **图来源范围**：只取选区里的图？还是整篇？建议跟随 send-to-x 现有"选区优先、否则整篇"的逻辑。
3. **喂文件技术手段**（DataTransfer 注入 vs Electron 拖放事件）——spike 后定，若两种都不稳，fail loud 降级"请手动拖图"。

---

## 5. 验收清单（自检，总指挥据此审计）

**质量门禁**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增（基线 10 个 pre-existing，本期不得新增）
- [ ] `npx vitest run` **全量跑、如实报数**。已知 `tests/storage/bulk-delete-perf-verify.test.ts` 8 个 order-dependent flaky（与本期无关，单跑全过）；真实结果与 flaky **分开写**，不得笼统"全绿"。
- [ ] 应用启动无新增控制台报错

**功能自检**（无 GUI 则列出待总指挥实机验）：
- [ ] 发推带 1～4 张 note 图：图作为媒体附件出现在 X 发推框（不是 URL 文本）
- [ ] 超过 4 张：提示用户、只带前 4 张（不静默丢）
- [ ] 回复也能带图
- [ ] 确认弹窗显示缩略图，可移除某张
- [ ] selector 失效 / 喂文件失败 → fail loud 降级提示（文字仍填入）
- [ ] **喂完文件没有任何程序自动点发布**（写方向红线）
- [ ] 纯文字推（不带图）仍如旧（回归基线）

**架构自检**：
- [ ] 走路线 B（喂 X 上传控件），无任何官方 API / OAuth / media/upload 调用
- [ ] 喂文件原语加在 web-service-base 底座，复用 requireXWebContents 按 ws 定向
- [ ] selector 进 profile，失效 fail loud
- [ ] 没改坏 2.5-a 确认弹窗 / 纯文字发推链路

**交回总指挥时请附**：
1. 改动文件清单（+ 一句话职责）
2. **spike 结论**：X fileInput selector + 喂文件用了哪种技术手段、为什么
3. §4 决策点的决定（视频做没做、图来源范围）
4. 回归怎么保证 + 必须总指挥实机验的点（列清）
5. 如实测试报数（真实通过数 + 8 flaky 单列）

---

## 6. 红线

- ❌ 走官方 API / OAuth / media/upload（违反路线 B，撞反自动化红线）
- ❌ 喂完文件程序自动点发布（写方向最高红线）
- ❌ 喂文件失败静默吞掉 / 假装成功（违反 fail loud）
- ❌ 改坏纯文字发推 / 2.5-a 确认弹窗（回归）
- ❌ 凭记忆写 X selector / 喂文件手段 —— 先 spike 实测
- ❌ 超范围做阶段 3（article 注入）/ 阶段 4（预览）

有架构判断拿不准（喂文件技术手段、视频做不做、selector）——**停下来在交付说明里列问题**让总指挥定，别闷头改。
