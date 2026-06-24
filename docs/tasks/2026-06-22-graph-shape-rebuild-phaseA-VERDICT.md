# 总指挥审计裁决 — 阶段 A 拆解

> 审计人:总指挥 · 2026-06-22 · 对象:[2026-06-22-graph-shape-rebuild-phaseA-breakdown.md](./2026-06-22-graph-shape-rebuild-phaseA-breakdown.md)
> 结论:**拆解质量高,准予开工——但带 3 条强制修正(其中 1 条是会炸别处的雷)。**

---

## 0. 总评

勘探扎实、岔路识别清楚、逐 commit 自包含绿、红线自核到位。**两项自决(P-store 拆边 / P-textframe 全清空)方向对,认可。** 准予开工,但下面 M1 是**硬纠正**(实施者建议会引入跨 capability 回归),M2/M3 是裁决补强。

---

## 1. 强制修正(开工前必须纳入)

### ⛔ M1 —— `HAS_CONTENT_PREDICATE` / `hasContent` 边**绝不能删**(雷,否决实施者倾向)

实施者 A3 写"`HAS_CONTENT_PREDICATE` 若仅此处用则删"。**总指挥已 grep 核实:前提不成立。**

`user:krig:hasContent` 是**跨 capability 通用语义边**,7 文件共用:
`canvas-store.ts` / `x-extract-tweet.ts` / `ThoughtCard.tsx` / `storage/surreal/schema.ts` / `storage/health/cardinality-check.ts` / `semantic/types/atom.ts` / `semantic/types/atom-entity.ts`。
且 `cardinality-check.ts`(decision 014 自愈扫描)+ `schema.ts`(orphan pm 清理)**主动扫这条边**。

**裁决**:
- A3 **只拆 graph canvas-store 对 hasContent 的使用**(5 处:read/create/update/delete/duplicate),把 doc 改走 `payload.doc` 内联属性。
- **`HAS_CONTENT_PREDICATE` 常量、predicate 本身、x/thought/storage/semantic 那 6 处一律不碰。**
- `TEXT_LABEL_REF` 常量在 canvas-store 内随 graph 拆边删除可以(它是 graph 专属);但删它前 grep 确认 canvas-store 外无引用。

### ⚠️ M2 —— D2 改判:**选 (b) 一次性清理孤儿边,不选"不管"**

实施者建议 D2=(a) 不管。**总指挥否决**:graph 旧画板留下的 hasContent 边会成为 `cardinality-check`/`schema` 扫描的**悬空对象 → 健康检查持续报噪音**。"存量可丢" ≠ "可留脏边"。

**裁决**:
- 不做"读时兼容拼回"(那是 (b) 原义,无谓包袱)。
- 改做**最小一次性清理**:A3 里(或单独小 commit)清掉 graph 实例的孤儿 hasContent 边 + 对应 pm atom。若本机无在用画板(实施者确认),可直接清库表;有则写一段一次性 sweep。**fail loud 记录清了多少条。**
- 若清理成本高于价值(实测孤儿边为 0 或极少),退回 (a) 但**必须在完成报告记录"留 N 条孤儿边,cardinality-check 会报 warn"**,不许默默留。

### ✅ M3 —— A2 真机验证代价:**接受单测 + fixtures,不留 textframe 占位**

P-textframe 全清空我已拍。A2 文字层"本阶段无真机验"是 P-textframe 的**必然代价,非偷工**——认可实施者方案:
- 离线单测(文字层方法给定 doc+textBox → mesh 结构)+ `__fixtures__` 临时带 doc 几何 def(不进 definitions/、不进 Picker)。
- **完成报告必须明记**:A2 真机文字层验证**顺延到阶段 C**(有真 shape 可挂 doc 时补真机)。这是欠条,要还。

---

## 2. 待确认项裁决

| 编号 | 裁决 | 说明 |
|---|---|---|
| **D1** geometry 字段摆法 | ✅ **(b) 只放 kind + 顶层保留载荷** | 同意实施者建议。地基阶段改动最小最稳;载荷归位(a)留阶段 B/C 真做 SVG 时一并重构。**记为偏差:范式未完全收口,阶段 B 补。** |
| **D2** 旧 doc 边存量 | ⚠️ 见 **M2**(改判 b-清理) | 不许"不管"留脏边 |
| **D3** A4 范围 | ✅ **确认 = px unit 求值地基 + 单测,无真箭头 def** | 真箭头 def 留阶段 C;A4 只证"求值器支持 px 不归一化" |
| commit 顺序 | ✅ **A1→A2→A3→A4→A5 准** | A5 清库放最后正确(前序借现有 def 验);**但 A2 真机验依赖已被 P-textframe 抽走,A2 靠 fixtures——确认 A5 不影响 A2 单测** |

---

## 3. 补强红线(并入 prompt §3)

- **R8 不删通用 predicate**:任何"删边/删常量"动作,先 grep 全仓消费点;跨 capability 共用的(hasContent/inCanvas 等)只拆本 capability 用法,不碰定义。违者作废。
- **R9 健康检查零新噪音**:本阶段后 `cardinality-check` 不许新增 warn（孤儿边清净或在报告挂账）。

---

## 4. 准予开工

**裁决:同意开工。** 按 A1→A5 逐 commit,纳入 M1(不删 predicate)/M2(清孤儿边)/M3(单测+欠条)/D1(b)/D3(确认)。

每 commit 自包含绿;偏差走"记录待总指挥确认";完成报告 `L5G6c-phaseA-completion.md`,**M3 欠条 + D1 范式未收口 + M2 清理结果**三项必记。**不合 main。**
