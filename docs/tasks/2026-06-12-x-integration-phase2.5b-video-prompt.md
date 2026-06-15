# 实施 Prompt：X 集成 阶段 2.5-b（视频上传，承接图片）

> ★★ 现状更新(2026-06-15,总指挥)：本 prompt 方案仍有效(路线B喂文件+复用 feedFilesToInput+视频要 poll X 转码)，但**前置已变**——X 集成核心(读/写/媒体图片/Articles)**已全部合进 main**(merge `098d3d52`)：
> - **从最新 main 切新分支做**：`git checkout main && git pull && git checkout -b feat/x-video`(不再用旧的 docs/x-integration-design)。
> - `feedFilesToInput`(`web-service-base/webview-file-input.ts`)、图片上传链路都已在 main，现成可复用。
> - 测试基线以当前 main `npx vitest run` 实际数为准(bulk-delete 8 个 pre-existing flaky 单列)。
> 下方原文(2026-06-12)的方案/红线/视频差异分析全部仍适用，只「分支/前置」按此更新。

> 交接日期：2026-06-12（方案）｜交接人：总指挥｜验收人：总指挥
> 蓝图：[`roadmap`](./2026-06-10-x-integration-roadmap.md) §2.A / §7（"视频 X 要 poll 转码完成"已点）
> 前置：图片上传 + Articles 已合 main（见上方现状更新）。本期在其上加**视频**。

---

## 0. 目标

让"发文字推 / 回复"能带 **note 里的本地视频**作为推文视频附件（路线 B，喂文件给 X 上传控件）。
图片已完成；本期补视频，复用图片那套喂文件原语，处理视频特有的差异。

---

## 1. 红线（沿用图片那期，不变）

> **路线 B**：喂文件给 X 自己的上传控件，**绝不碰官方 API / OAuth / media/upload**。
> **写方向最高红线**：喂完视频**绝不程序点发布**，用户手动点。
> **fail loud**：取不到本地文件 / selector 失效 / X 没接住 / 转码超时 → 提示用户手动 + 明示降级，不静默假装成功。

---

## 2. 视频 ≠ 图片：4 个必须处理的差异（已核实现状）

### ① 序列化器目前不吐视频清单 —— 要先补
- `SerializeResult` 只有 `images: string[]`（`src/drivers/text-editing-driver/serializers/pm-to-markdown.ts:22-25`），**没有 videos**。注释明说"videoBlock 序列化成占位不进 images"。
- **第一步**：让序列化器收集 video block 的本地源，加 `videos`（或类似）到 `SerializeResult`。注意 `sliceToMarkdown` / `docNodeToMarkdown` 两个入口都要补。

### ② 视频来源分叉 —— 只有本地视频能喂
video block 的 `src` / `embedType`（`src/drivers/text-editing-driver/blocks/video-block/spec.ts:34-51`）：
- `embedType: 'direct'` + `src` 是 `media://`，**或** `localFilePath`（ytdlp 下载完成的本地路径）→ **有本地文件，能喂 X** ✅
- `embedType: 'youtube' / 'vimeo' / 'generic'`（嵌入链接，无本地文件）→ **喂不了**。降级：保留链接文本 / 提示用户"该视频是外链无法作附件"。fail loud 说明，不静默。

### ③ X 视频上传要 poll 转码完成 —— 比图片久
- 图片喂完 poll 等"缩略图出现"即可（秒级）。
- **视频喂完，X 要转码**，得 poll 等"转码完成 / 可发布"的信号（X 上传后有进度条 → 完成态）。判据 selector + 超时**都和图片不同**：超时要给足（视频大、转码慢，建议 60s+，spike 定），判据是"转码完成"而非"缩略图出现"。
- selector 待 spike：上传中进度、转码完成、移除按钮。

### ④ X 媒体互斥规则 —— 1 推最多 1 视频，且图视频不能混
- X 限制：一条推文 **要么最多 4 图，要么 1 个视频**，**不能同时带图和视频**。
- 编排要处理：若 note 选区同时有图和视频 → 按规则取舍（建议：有视频则优先视频、忽略图并提示；或反之。**§4 决策点，你定**）。

---

## 3. 可复用的现成资产

| 复用 | 在哪 | 说明 |
|---|---|---|
| 喂文件原语 | `feedFilesToInput`（`web-service-base/webview-file-input.ts`） | 对文件类型无硬限制，喂视频同样走 `setFileInputFiles`。**但 uploadedThumbSelector 要换成视频的"转码完成"判据 + 更长超时** —— 建议加参数或新函数 `feedVideoToInput`（带转码 poll），别硬塞进图片原语 |
| media:// → 磁盘路径 | `resolveMediaPath`（`media-store-impl.ts:567`） | 视频同样用它解析 |
| 按 ws 定向 | `requireXWebContents`（`x-webcontents.ts`） | 复用 |
| 发推编排 | `x-write.ts` 的 pasteTweet/pasteReply（已有 mediaPaths） | 扩展支持视频路径 + 互斥逻辑 |
| 图清单收集 | `collectNoteImages`（`send-to-x.ts:63`） | 仿它写 `collectNoteVideos`（取 direct+本地的） |
| 确认弹窗 | `send-confirm-popup/`（已有图缩略图栏） | 加视频项展示（缩略图/文件名 + 可移除） |
| profile selectors | `x-service-types.ts`（已有 fileInput/uploadedMediaThumb） | 加视频上传完成判据 selector |

---

## 4. 需你定的决策点（拿不准列出来问总指挥）

1. **图 + 视频同时存在时**：X 不允许混。取视频弃图？取图弃视频？建议"有视频优先视频，提示图被忽略"。
2. **视频文件来源优先级**：`localFilePath`（ytdlp 下载的）vs `src` 是 media://，哪个优先？建议 localFilePath 优先（明确是本地文件），无则试 src 的 media://。
3. **转码超时**：给多久 fail loud？建议 60~90s，spike 看 X 实际转码时长定。
4. **大文件**：X 有视频大小/时长上限。超限怎么办？建议喂之前不预判（难拿到准确限制），靠 X 自己拒 + 我们 poll 转码失败 → fail loud 提示。

---

## 5. 验收清单（自检，总指挥据此审计）

**质量门禁**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增（基线 10 个 pre-existing，本期不得新增）
- [ ] `npx vitest run` **全量跑、如实报数**。基线 233 passed（含图片期 5 个 media:// 测试）。已知 `bulk-delete-perf-verify` 8 个 order-dependent flaky（与本期无关，单跑全过），报数时与真实结果分开写，不得笼统"全绿"。补视频相关单测（如 collectNoteVideos 的来源筛选、图视频互斥取舍）。
- [ ] 应用启动无新增控制台报错

**功能自检**（无 GUI 则列出待总指挥实机验）：
- [ ] 发推带 1 个本地视频（direct + media://）：视频作附件上传、等转码完成
- [ ] YouTube/外链视频：fail loud 提示"外链无法作附件"，不静默
- [ ] 图 + 视频同存：按 §4 决策取舍 + 提示
- [ ] 回复也能带视频
- [ ] 转码超时 / X 没接住 → fail loud 降级提示
- [ ] 确认弹窗显示视频项、可移除
- [ ] **喂完视频无任何程序自动点发布**（写方向红线）
- [ ] 纯文字推 / 带图推（上一期）均不回归

**架构自检**：
- [ ] 走路线 B，零官方 API
- [ ] 视频喂文件复用 feedFilesToInput 思路但转码 poll 判据/超时独立（别污染图片原语）
- [ ] 序列化器 videos 收集两个入口都补
- [ ] 图视频互斥逻辑正确
- [ ] selector 进 profile，失效 fail loud
- [ ] 没改坏图片上传 / 纯文字推 / 2.5-a 弹窗

**交回总指挥时请附**：
1. 改动文件清单（+ 一句话职责）
2. spike 结论：X 视频上传完成判据 selector + 转码 poll 怎么做的 + 超时定多少
3. §4 决策点的决定
4. 回归怎么保证 + 必须总指挥实机验的点（列清）
5. 如实测试报数（真实通过数 + 8 flaky 单列）

---

## 6. 红线

- ❌ 走官方 API / OAuth / media/upload
- ❌ 喂完视频程序自动点发布
- ❌ 转码没完成就当成功 / 外链视频静默丢（违反 fail loud）
- ❌ 同时喂图+视频给 X（违反 X 互斥规则，会报错）
- ❌ 把视频的"转码 poll/超时"硬塞进图片原语污染图片路径
- ❌ 改坏图片上传 / 纯文字推 / 2.5-a 弹窗（回归）
- ❌ 凭记忆写 X 视频 selector / 转码判据 —— 先 spike

有架构判断拿不准（feedVideoToInput 怎么拆、图视频互斥取舍、转码判据）——**停下来在交付说明里列问题**让总指挥定。
