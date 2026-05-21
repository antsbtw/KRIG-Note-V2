# 任务：block 独立化设计文档第二轮审计修订

> **任务性质**：纯文档修订，**不写代码、不动 src/**
> **触发日期**:2026-05-21
> **触发依据**:第二轮审计报告(本对话)发现的 4 类残留偏差 + 4 项设计细节补登记
> **前置文档**:
> - [`docs/RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md`](../RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md)
> - [`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md)
> - [`docs/RefactorV2/stages/block-atomization-implementation-plan.md`](../RefactorV2/stages/block-atomization-implementation-plan.md)

---

## 0. 工作目录纪律

所有 cwd 敏感命令(git/grep/find 等)每次 Bash 调用都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 显式指定。

---

## 1. 任务边界(严格)

**纯文档级修补任务。**

- ✅ 你要做:按本清单逐项修补 3 份文档的字面残留偏差 + 补登 4 项设计细节
- ❌ 你不该做:重新讨论已拍板的设计决定 / 写代码 / 改其他无关文档 / 跨范围扩展
- ❌ 你不该做:自作主张引入新决议或新方案

最终交付:3 份文档修订完成,跑一遍交叉一致性 grep 验证,给用户简短汇报(<300 字)。

---

## 2. 必读文档

按顺序读完(每读一份建立心智模型,**不要边读边动手**):

1. [`docs/RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md`](../RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md)(290 行)
2. [`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md)(867 行)
3. [`docs/RefactorV2/stages/block-atomization-implementation-plan.md`](../RefactorV2/stages/block-atomization-implementation-plan.md)(965 行)

读完后看本任务 §3 修补清单。

---

## 3. 修补清单(共 9 项)

### R1 — "24" 字面历史残留(3 处)

decision 026 第一轮审计修订时已把 §10.1 的"24+ blocks"改为"28 个 blocks 目录",但**还有 3 行残留**未同步,需字面替换:

#### R1.1 — 026 §4.2 行 262

**当前字面**(替代方案 A 缺点描述):
```
| **A. PM schema attrs.id**(沿用现有 6 个媒体 block atomId 占位模式) | PM 层 | PM tr 自然携带 id;copy/paste/split/merge 在 PM 层直接定语义 | 增加 PM schema 表面积(24+ blocks 每个加 id 字段) | 用户原选选项 1,后被反问触发架构讨论 |
```

**改为**:
```
| **A. PM schema attrs.id**(沿用现有 6 个媒体 block atomId 占位模式) | PM 层 | PM tr 自然携带 id;copy/paste/split/merge 在 PM 层直接定语义 | 增加 PM schema 表面积(叶子+叶子级容器约 18 个 block 加 id 字段,详 §3.1.1)| 用户原选选项 1,后被反问触发架构讨论 |
```

#### R1.2 — 026 §11.4 行 758

**当前字面**:
```
| PM schema 改造影响所有 24 blocks,潜在 bug 面大 | Stage 1 改完先 typecheck 全绿 + 各 block 渲染冒烟测试 |
```

**改为**:
```
| PM schema 改造影响 28 个 blocks 目录(按 §3.1 实际加 id 约 18 个叶子+叶子级容器),潜在 bug 面大 | Stage 1 改完先 typecheck 全绿 + 各 block 渲染冒烟测试 |
```

#### R1.3 — 026 §11.4 行 761

**当前字面**:
```
| 24 PM block.attrs.bookAnchor 现有数据迁移路径不变 | bookAnchor 字段 schema 保留;迁移仅拆 block 颗粒度,不动 bookAnchor 字段 |
```

**改为**:
```
| 约 24 种 PM block.attrs.bookAnchor 现有数据迁移路径不变(实施前 grep `bookAnchor` 字面位置复核数字)| bookAnchor 字段 schema 保留;迁移仅拆 block 颗粒度,不动 bookAnchor 字段 |
```

---

### R2 — blockquote 分类错误(2 份文档同步错)

**事实根据**(grep 验证):
```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -A2 "blockquoteSpec\|blockquote.*NodeSpec\|content:" src/drivers/text-editing-driver/blocks/blockquote/spec.ts | head -10
```

→ blockquote 在 PM schema 字面是 `content: 'block+'`(容器),与 callout 同性质(可含子段)。
→ 字面归类应为**叶子级容器**,不是"叶子文本块"。

#### R2.1 — 026 §3.1.1 行 135 修正

**当前字面**:
```
| paragraph / heading / blockquote / horizontalRule / hardBreak | 叶子文本块 | 用户标注 / 引用直接命中 |
```

**改为(把 blockquote 从这行移走)**:
```
| paragraph / heading / horizontalRule / hardBreak | 叶子文本块 | 用户标注 / 引用直接命中 |
```

然后在 §3.1.1 callout 那一行(行 141)**之后或之前**追加一行:
```
| **blockquote** | 叶子级容器(引用块) | blockquote 可含多 paragraph;用户标注引用块整体 attach 在 blockquote 层(同 callout 模式)|
```

#### R2.2 — 实施计划 §2.2 行 98 同步修正

**当前字面**(Step 1.2 "加 id" 清单):
```
- paragraph / heading / blockquote / horizontalRule / hardBreak
```

**改为**:
```
- paragraph / heading / horizontalRule / hardBreak
```

然后在行 104 "callout" 那一行之后追加:
```
- blockquote(叶子级容器)
```

---

### R3 — 026 §3 节号重复

decision 026 §3 下有两个 §3.3 子节:
- 行 185 `### 3.3 childOf 边拼装规则(跨层处理)`
- 行 205 `### 3.3 字面颗粒度规则`

**修正**:把行 205 的 `### 3.3 字面颗粒度规则` 改为 `### 3.4 字面颗粒度规则`。

**额外检查**:同时看 §3.3 之后是否还有 §3.4 / §3.5 也需要顺延。先 grep:
```bash
grep -n "^### 3\." docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md
```

若 §3 下原有 §3.4 / §3.5 等,字面顺延为 §3.5 / §3.6。**实测可能没有,因 §4 紧跟 §3.4**。

---

### R4 — 026 §3.3 末尾"用户拍板:方案 B"残留

decision 026 行 203 字面:
```
**用户拍板**:**方案 B**(本对话 AskUserQuestion 1,2026-05-21)。
```

但 §3.2 替代方案对比表已把 B 标 ❌,最终拍板是 **D**。

**注意**:行 203 实际位于 §3.3(`childOf 边拼装规则`)末尾,但**指向 §3.1 颗粒度拍板**,所以应该改为指向 D:

**改为**:
```
**用户拍板**:**方案 D**(审计后修订,2026-05-21;详 §3.2 对比表 + §12.2 第二轮拍板)。
```

---

### N1 — 补登 Open Question 13.7 tableHeader 拆分确认

decision 026 §3.1.2 注 1 字面提到 tableHeader 临时与 tableCell 同模式,实施时 verify。**应字面补登到 §13 Open Questions**,避免未来 Stage 1 实施时遗忘。

在 decision 026 §13.6 之后追加:

```markdown
### 13.7 tableHeader 拆 atom 的最终确认(2026-05-21 审计后新增)

§3.1.1 / §3.1.2 注 1 字面拍板"tableHeader 临时与 tableCell 同模式拆 atom,tableRow 不拆"。但 tableHeader 在 PM schema 字面介于"行"与"单元格"之间,可能存在字面歧义。

**临时默认**(§3.1.1):tableHeader 加 id 字段,与 tableCell 同处理。

**实施任务设计 Stage 1 验证项**:
1. grep `src/drivers/text-editing-driver/blocks/table/header.spec.ts`(或对应文件)确认 tableHeader 的 PM `content` 规则
2. 若 tableHeader.content === 'tableCell+' 或类似,确认 childOf 边目标:tableHeader 内的 tableCell.childOf → table atom(跳过 tableRow 和 tableHeader)?还是 tableCell.childOf → tableHeader atom?
3. 决议:Stage 1 实施时若发现矛盾,回头修订 decision 026 §3.1 / §6.1

**留实施任务设计 verify 阶段处理**。
```

---

### N2 — 补登 Open Question 13.8 中间层重建硬编码扩展机制

decision 026 §6.1 行 425 字面"重建规则用代码硬编码常见模式(table / list / columnList);未识别模式 fallback 走 PM schema content rule autofill"。**这是未来扩展面**,应字面登记。

在新增 §13.7 之后追加 §13.8:

```markdown
### 13.8 中间层重建的硬编码扩展机制(2026-05-21 审计后新增)

§6.1 字面拼装规则"代码硬编码常见模式 + fallback PM schema autofill"。

**潜在未来约束**:未来引入新的结构性容器 block 类型(如 grid / flexbox / layout)时,需要同步更新 capability 层硬编码重建规则,否则 fallback 路径可能 autofill 出错。

**实施任务设计要登记**(留 Stage 2 实施):
1. 把硬编码规则抽到一个集中可扩展的位置(如 `assemble-pm-doc.ts` 顶部的 `STRUCTURAL_REBUILD_RULES` 常量)
2. 未来引入新结构性容器 block 时,**必须**在 commit message 或决议字面登记同步更新该常量
3. 当前 v1 字面登记 3 类(table / 3 list / columnList)的规则

**留实施任务设计 Stage 2 处理**。
```

---

### N3 — column 字面歧义清理

decision 026 §3.1.1 行 142 字面**自相矛盾**:
```
| **columnList / column** | 结构性容器中的 column | column 持有用户语义("第二列");columnList 是父结构性,**不拆** |
```

→ 把"columnList / column"写一行但结论不同(column 拆、columnList 不拆),读者可能误解。

**改为**(把 column 单独一行,放在 §3.1.1 内):
```
| **column** | 叶子级容器(多列布局中的列)| column 持有用户语义("第二列");用户标注"第二列内容"attach 在 column 层 |
```

(然后删除原"columnList / column"那一行,columnList 已在 §3.1.2 结构性容器表登记,不重复)

---

### N4 — undo merge "thought 永久失效"补登风险表

decision 026 §5.6 行 376 字面承认"用户感知:doc 内容字面回滚,但 A2 上原有的 thought 标注永久失效"。**这是语义不对称风险**,应在 §11.4 风险表登记。

在 §11.4 风险表追加一行:

```
| undo merge 后 A2.id 重建,但 A2 原有的 thought 标注 / 跨 note 引用**永久失效** | §5.6 字面承认;用户拍板接受。可在 UI 层弹 toast"撤销后部分标注不可恢复",提示用户;留实施任务设计 Stage 7 测试场景 T6 验收 |
```

---

## 4. 工作流要求

### 4.1 顺序

1. **读 §2 必读文档**(全部 3 份;每读一份给用户 80 字汇报关键发现)
2. **按 §3 顺序修补**(R1.1 → R1.2 → R1.3 → R2.1 → R2.2 → R3 → R4 → N1 → N2 → N3 → N4)
3. **每修一项 Edit 工具一次**,不要批量打包(便于回查)
4. **修完所有项**后跑一次交叉一致性 grep 验证(见 §5)
5. **给用户最终汇报**(<300 字),列每项修补结果 + grep 验证通过

### 4.2 工具用法

- 用 Edit 工具按 §3 字面替换;不要重写整个文件
- 修改 Markdown 表格时,**保留原表格列分隔符 / 行排版**
- 修改前先 Read 那段验证字面没漂移(因前置对话可能已动过)

### 4.3 不要做的事

- ❌ 不要重新讨论已拍板的设计决定(全部由用户第一/二轮 AskUserQuestion 拍板)
- ❌ 不要扩展范围(如发现"我觉得 §X 还应该改",**不在本清单中的改动一律先 AskUserQuestion**)
- ❌ 不要写代码 / 改 src/ / 改测试
- ❌ 不要改其他无关文档(memory / vision.md / 等)
- ❌ 不要把"我推测的可能性"包装成新决议

### 4.4 边界情况

- 若 §3 某项字面与文件当前内容**不匹配**(如行号变了 / 已被修过),先 Read 周围 20 行确认,然后向用户汇报"R 的 X 项当前字面与清单不符,建议 ..."不要擅自修
- 若发现 §3 之外的新问题,**记下来给用户汇报**,不直接修

---

## 5. 修补后交叉一致性 grep 验证清单

修完后跑这些 grep,确认无残留:

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2

# 1. "24+ blocks" 残留(应全部消失)
grep -n "24+ blocks\|24 blocks\|24+ block" docs/RefactorV2/

# 2. blockquote 应只在叶子级容器位置出现(不再算"叶子文本块")
grep -n "blockquote" docs/RefactorV2/data-model/persistence/decisions/026*.md docs/RefactorV2/stages/block-atomization-implementation-plan.md

# 3. §3 节号检查(应不再有 §3.3 重复)
grep -nE "^### 3\." docs/RefactorV2/data-model/persistence/decisions/026*.md

# 4. 方案 B 拍板残留(应已改为方案 D)
grep -n "方案 B\|方案 D\|拍板:.*B\|拍板:.*D" docs/RefactorV2/data-model/persistence/decisions/026*.md

# 5. Open Questions 计数(应新增 13.7 + 13.8 共 8 个)
grep -nE "^### 13\." docs/RefactorV2/data-model/persistence/decisions/026*.md

# 6. 风险表行数(应新增 undo merge 风险一行)
grep -c "^|" docs/RefactorV2/data-model/persistence/decisions/026*.md  # 表格行变化前后对比
```

---

## 6. 不在本次任务范围(避免越界)

- ❌ 不修位置记忆 feature 代码(等本次 sub-phase 立项后再决定)
- ❌ 不动 memory 文件
- ❌ 不动 V1 仓库
- ❌ 不重新设计任何已拍板的议题
- ❌ 不实施 decision 025 §6 / decision 026 §10 列出的"未来反向更新"项(那是 sub-phase 实施后才做)

---

## 7. 完成判据

- ✅ R1-R4 共 6 处字面修补完成(R1 三处 + R2 两处 + R3 一处 + R4 一处)
- ✅ N1-N4 共 4 项 Open Question / 风险表登记追加完成
- ✅ §5 grep 验证全部通过
- ✅ 给用户 < 300 字汇报

完成后用户拍板:**立即 commit + merge main**,启动下一对话设计 sub-phase 实施分支。
