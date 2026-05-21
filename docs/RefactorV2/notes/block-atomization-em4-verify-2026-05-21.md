# Stage 4 EM4 验收报告

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **commits**:`0bea1b20` Stage 4 完整(类型+driver+使用点+UI 单 commit)
> **验收依据**:实施计划 §5.4 EM4 4 条
> **状态**:✅ 静态 PASS / 手动锚点不漂移测试**留 Stage 7** 兑现(用户拍板模式,EM2/EM3 同)

---

## 静态检查(claude 自验,PASS)

### EM4.1 ✅ NoteLocator 类型字面升级

`src/shared/ipc/thought-types.ts:67-80`:
```ts
export interface NoteLocator {
  blockId: string;
  offset?: { from: number; to: number };
  preview?: string;
}
```

字面取代 V1 `{ pmPos, anchorType, text }`。

### EM4.2 ✅ driver API 三个 addThought* + scrollToThoughtAnchor 字面升级

`src/drivers/text-editing-driver/api.ts`:
- `findBlockIdAtPos(doc, pos)` — 沿 PM 树最近 group='block' + 带 attrs.id 的祖先
- `findBlockNodeById(doc, blockId)` — 反向 blockId → {pos, nodeSize}(导出供 future caller 复用)
- `addThoughtMark` 返 `{ blockId, offset, preview }`
- `addThoughtBlockFrame` / `addThoughtNodeAttr` 返 `{ blockId, preview }`
- `scrollToThoughtAnchor(instanceId, blockId, offset?)` 字面按 blockId 在当前 doc 找 block

### EM4.3 ✅ 4 处使用点字面同步

| 文件 | 字面修改 |
|---|---|
| `add-from-note.ts` | 3 个 resolveLocator 路径用新字段 |
| `ask-ai.ts` | locator 字段 + docstring |
| `scroll-to-source.ts` | scrollToThoughtAnchor 新签名 + docstring |
| `ThoughtPanel.tsx` | 排序 `getAnchorSortKey` 复合 key([numKey, strKey])|
| `ThoughtCard.tsx` | anchorPreviewText 读 `locator.preview`(取代 `locator.text`)|

### EM4.4 ✅ typecheck + lint(0 新增 warning)

```
$ npm run typecheck  → 全绿
$ npm run lint       → 3 个 main 起点遗留 warning(D-05),本 Stage 0 新增
```

---

## 字面策略 / 偏离登记

### 1. `preview` 字段(用户 2026-05-21 拍板)

**决议字面**(decision 026 §10.1):`NoteLocator { blockId, offset? }` — 字面"取代旧的 pmPos + 冗余 text"

**实施扩展**:加 `preview?: string` 字段:
- 字面**仅 UI 显示用**(ThoughtCard 卡片预览,沿 V1 100 字截断)
- 字面**不参与定位**(blockId + offset 字面是定位 SSOT)
- 字面**不自动同步**(创建瞬间快照,PM 编辑后不更新 — 接受陈旧)
- 替代方案 B(完全删 text,UI 异步 batch resolve)字面被排除 — 复杂度高 + ThoughtCard 字面变异步组件

字面留 Stage 9 反向更新 decision 026 §10.1 字面登记此扩展。

### 2. Step 4.4 字面跳过新建 anchor-resolver.ts

**决议字面**(实施计划 §5.3 Step 4.3):新建或改 `src/views/thought/anchor-resolver.ts` 字面提供 `resolveNoteLocator`

**实施字面**:跳过新建文件:
- `findBlockNodeById` 字面已在 driver api.ts 内导出 + `scrollToThoughtAnchor` 字面内部 encapsulate
- view 层调用方(scroll-to-source.ts)字面直接调 `textEditing.api.scrollToThoughtAnchor(instanceId, blockId, offset?)`,**无需**额外 helper 层
- 避免 dead-code 文件(YAGNI)

字面登记**不计为 deviation**(沿决议 §5.3 字面"新或改" → 字面理解为"必要时新增" — 当前 driver API 已 cover 需求,字面不强制新文件)。

### 3. ThoughtPanel 排序字面用 ULID 字典序近似时间序

**字面背景**:V1 字面用 `pmPos` 排(PM doc 内当前位置序),L7 升级后 `pmPos` 字面不可用。

**实施字面**:用 `blockId` 字典序排:
- ULID 字面前 48-bit = 时间戳 → 字典序 ≈ 时间序 ≈ 创建顺序
- 字符串字面用 `>` / `<` 直接比(无需 charCode 计算)
- 复合 key `[numKey, strKey]`:book locator 用 `pageNum`(numKey),note locator 用 `Number.MAX_SAFE_INTEGER + blockId`(numKey 大常数 + strKey 字典序)

**字面妥协**:不是 PM doc 内"当前位置"序 — 若用户**在 note 中段插入新 thought**,新 thought 字面排在最后(创建时间晚),不是按出现位置插中段。Stage 7 字面 verify 用户体感;若反馈不符,Stage 7 字面**改为** resolver 路径(getNote → 找 pos → 排)。

---

## 手动测试(留 Stage 7 兑现,用户拍板模式)

**EM4 字面 4 条对照(实施计划 §5.4)**:
- ⏳ 创 thought 标注 note 段 A(attrs.id = X)
- ⏳ note 头部插 100 paragraph → A 的 PM pos 下移但 attrs.id 字面不变,X 保留
- ⏳ thought NoteLocator.blockId = X(不变);卡片点击 → driver 字面按 X 查 PM node → 精确滚到段 A(不漂移)
- ⏳ 对比 V1 旧 NoteLocator 同场景下漂移失败 — 字面验证新模型根治性

字面**全部留 Stage 7 兑现**(沿 EM2 / EM3 模式)。

---

## 后续步骤

✅ EM4 字面静态 PASS,推进 Stage 5(URL 协议演化:`getBlockAnchorAt` → `getBlockIdAt`,旧 URL 错误提示)。

字面 Stage 4 commits 数 = 1(原子聚合 7 文件,因类型 + driver + 使用点字面无法独立 typecheck)。

---

*EM4 verify · 2026-05-21*
