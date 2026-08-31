# Stage 5 EM5 验收报告

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **commits**:`aea2b05c` driver / `2bac3c65` view + D-12 偏离登记
> **验收依据**:实施计划 §6.3 EM5 4 条
> **状态**:✅ 静态 PASS / 手动 URL Copy + 旧 URL 检测**留 Stage 7** 兑现

---

## 静态检查(claude 自验,PASS)

### EM5.1 ✅ getBlockIdAt 字面取代 getBlockAnchorAt

`src/drivers/text-editing-driver/api.ts`:
```ts
getBlockIdAt(instanceId: string, pos: number): string | null {
  const inst = instanceRegistry.get(instanceId);
  if (!inst) return null;
  const found = findBlockIdAtPos(inst.view.state.doc, pos);
  return found?.blockId ?? null;
}
```

字面**复用** Stage 4 已字面提取的 `findBlockIdAtPos` helper(沿 PM 树最近 group='block' + 带 attrs.id 的祖先)。grep 确认 `getBlockAnchorAt` 字面已**0 实现引用**(仅注释引用)。

### EM5.2 ✅ scrollToBlockAnchor 字面按 blockId 精确定位

`src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts`:
- `doc.descendants` 字面找 `attrs.id === blockId` 的 node
- DOM 字面 `nodeDOM(pos)` + `parentElement` 兜底(沿 [feedback_pm_dom_at_pos_text_node])
- 找不到字面 `console.warn` 静默(数据不一致 / 已删 block)

### EM5.3 ⚠ 旧 URL 字面检测仅 console.warn,无 UI toast(D-12 字面妥协)

`isV1LegacyAnchor` 字面识别三种 V1 格式:
1. 含 `:` 字符(V1 `<idx>:<text>`)
2. 长度 ≠ 26(V1 `<heading text>`)
3. 26 字符但非 Crockford Base32(`/^[0-9A-HJ-KM-NP-TV-Z]{26}$/`)

字面命中 → driver 字面 `console.warn` 提示;`LinkClickHandler.onLegacyBlockAnchor?` 字面预留 hook,view 端字面**不注册**(V2 字面无 toast capability)。

**字面留 future sub-phase**:引入 toast capability 后字面 wire callback(详 [D-12 偏离登记](./block-atomization-deviations-2026-05-21.md#d-12))。

### EM5.4 ✅ note-commands + LinkPanel 字面生成新 URL

- `note-commands.ts` Copy Link 字面 `krig://block/${noteId}/${blockId}`(blockId 字面 26 字符 ULID)
- `LinkPanel.tsx`:
  - `HeadingItem` 字面加 `id: string | null` 字段(从 heading.attrs.id 字面读)
  - Enter / onClick 字面用 `${drillNote.id}/${h.id}`(取代旧 `encodeURIComponent(h.text)`)

### EM5.5 ✅ typecheck + lint(0 新增 warning)

```
$ npm run typecheck  → 全绿
$ npm run lint       → 3 个 main 起点遗留 warning(D-05),本 Stage 0 新增
```

---

## 手动测试(留 Stage 7 兑现,用户拍板模式)

**EM5 字面 4 条对照(实施计划 §6.3)**:
- ⏳ 创 note + 多 paragraph → handle Copy Link → URL 字面是 `krig://block/<noteId>/<26字 ULID>`(Stage 7 T1 字面 verify ULID 格式)
- ⏳ 点击新 URL → 字面精确滚到目标 block(Stage 7 T2 编辑后字面仍工作 = 不漂移)
- ⏳ 字面手工构造旧 URL `krig://block/x/12:hello` → 字面 console 出 `[link-click] V1 旧格式 anchor 字面失效` warning(无 toast,D-12 妥协)
- ⏳ LinkPanel drill 字面选 heading → URL 字面 ULID 格式

字面**全部留 Stage 7 兑现**(沿 EM2 / EM3 / EM4 模式)。

---

## 后续步骤

✅ EM5 字面静态 PASS,推进 Stage 6(一次性 migration script + 备份 round-trip)。

字面 Stage 5 commits 数 = 2(driver 1 + view+UI+D-12 1),总累计 17 commits 在 feature/L7-block-atomization。

---

*EM5 verify · 2026-05-21*
