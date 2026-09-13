# 交接 prompt · def 块 步骤 3 / 4(词法 API + mind 调用)

> 交给**新对话**。分工:**用户 = 决策者;你 = 执行者;另一对话 = 验收者**。
>
> ⭐ **步骤 1、2 已完成并真机验收通过**(def 块本体已是 note 的一等公民)。
> 本轮把它**接给 mind**,让联系线真正存得住。

分支 `feature/diglot-mind-v0`,HEAD = `90b4df5e`,工作树干净。

---

## 0. 一句话:现在在哪儿

> ⭐ **note 侧全通**:`defBlock` 是真块(spec + NodeView + `+++` 输入规则 +
> `/def` + markdown 双向 + 落库),43 条断言,真机验过。
> ⚠️ **diglot 侧零处理** —— `grep defBlock src/capabilities/diglot-model/` **零命中**,
> `noteDocToTree` 仍然**硬写 `edges: []`**(`note-projection.ts:319`)。

**所以联系线仍然存盘即丢** —— 底座装得下它了,还没接线。这就是本轮要做的。

---

## 1. ⚠️⚠️ 先看这个实测现象(本轮的直接动因)

离线探针(本 prompt 作者刚跑的,不是推测):在 mind 的 note tab 里放一个 def 块 →

```
节点数 = 2
n2.content 块数 = 2
⭐ n2 正文里含 def 文本? = true      ← def 文本被当成了**正文**
往返后还在? = true                    ← 数据没丢,但位置错了
```

⚠️ **后果**:画布上那个主题框会**显示 `id: A`** —— 因为按 `03 §5.5`
「无 indent 的块并入上一节点当正文」,`defBlock` 也被并进去了。

⭐ 好消息:**没有数据丢失**(往返仍收敛),所以这是显示层的错位,不是毁数据。
⚠️ 但它必须在步骤 4 里一并修掉 —— def 块要**摘出正文**,变成语义。

---

## 2. ⭐ 已有的东西(别重造)

`src/drivers/text-editing-driver/blocks/def-block/lexicon.ts` **已实现且测过**:

```ts
DEF_FENCE                       // '+++'
type DefLine                    // kv | rel | other
interface DefBlock
classifyDefLine(raw): DefLine   // ⭐ 六种行形态(含无标签 `-.->`,上一轮踩过的坑已修)
parseDefText(text): DefBlock
serializeDefText(block): string // ⭐ 写 raw,不重新格式化(逐字节往返的关键)
defValue(block, key): string|undefined
defRelations(block): {source,target,label?}[]
nextDefAlias(used): string      // A,B,…,Z,A2… 取第一个没被占的
buildDefSkeleton(alias): string
```

⚠️ **它现在没有对外暴露** —— `grep lexicon src/capabilities/text-editing/types.ts` 零命中。
⭐ **这就是步骤 3。**

**块在 doc 里的形态**(`spec.ts`,已定):

```
defBlock  content:'text*'  code:true  defining:true
  attrs.id    ULID(auto-block-id 按 `'id' in attrs` 自动注入,落库靠它)
  attrs.for   null = 定义上一个块;显式 blockId = 定向绑定(⭐ 用户拍的甲为主+乙可选)
  attrs.open  默认 false(折叠)
```
⭐ **def 文本就是块的 text 内容**,逐行;不在 attrs 里。

---

## 3. ⭐ 本轮要做什么

### 步骤 3:词法 API 对外暴露

⚠️ 现在 lexicon 埋在 driver 的 blocks 目录里,capability 外拿不到。
⭐ 按仓库的分层惯例(W5 边界:view 只能 `requireCapabilityApi`,**0 import driver 深路径**)
把它挂到 `text-editing` capability 的公开面上。

⚠️ **别顺手加宽公开面** —— 只暴露 diglot 真正要用的那几个
(`parseDefText` / `defValue` / `defRelations` / `nextDefAlias` 够不够,自己核)。
⭐ 上一轮的教训:为了省事往 capability 上加方法,是**归属腐蚀**的开始。

### 步骤 4:mind 调用 def → 联系线进 S 层

在 `src/capabilities/diglot-model/note-projection.ts`:

| 方向 | 要做的 |
|---|---|
| **正向** `noteDocToTree` | ① def 块**摘出正文**(⚠️ 否则画布显示 `id: A`,见 §1)②建别名表 `id: X → NodeId`(撞车自动加序号)③`role:` **显式优先**,不写回落隐式规则 ④关系行 → `s.edges`(⭐ 确定性 id `deterministicEdgeId`,重复连同一对 = 覆盖非新增)⑤⚠️ 悬空引用**丢弃但原文照留** |
| **反向** `treeToNoteDoc` | 把 def 块**原样吐回**(⚠️ 含注释行与不认识的行);⚠️ 无内容**不 emit 空块** |

⚠️ **`attrs.for` 要认**:`null` = 定义上一个块;有值 = 定向绑定到那个 blockId。

⭐ **词表归 mind,词法归 note**(`00 §2.5.9`):
`role:` 是什么、`-.->` 是联系线 —— 这些判断写在 diglot 侧;
拆行/分类/序列化调 lexicon,**不重写一套**。

---

## 4. ⚠️ 断言必须钉住的(M6,`01 §7.7.3` / `01 §8`)

| # | 断言 | 为什么 |
|---|---|---|
| 1 | ⭐⭐ **联系线存得住**:连线 → `snapshotToFile` → `fileToSnapshot`,edges 不丢 | 本轮的**全部意义**;现在**注定红** |
| 2 | ⭐⭐ **往返逐字节收敛**:`doc → 树 → doc` 与原 doc 一致 | ⚠️ 样本**必须含注释行 + 不认识的行**,否则「原样保留」验不出来 |
| 3 | def 块**不进正文** | §1 那个现象 |
| 4 | `role:` 显式优先 | ⚠️ 见下「假绿」警告 |
| 5 | 悬空引用不造边、原文不删 | ⚠️ 见下 |
| 6 | `attrs.for` 定向绑定生效 | 甲/乙两条路都要覆盖 |

### ⚠️⚠️ 两条**必然假绿**的陷阱(上一轮踩过,原样会再踩)

1. **`role: floating`**:若样本用「第二个顶层」,**隐式规则本来就给 floating**
   → def 块压根没被读,测试照样绿(探针实证过)。
   ⭐ 正解:让**首个顶层**写 `role: floating`(隐式说它是 root),**与隐式相反**才有区分力。
2. **悬空引用**:若样本只有一条悬空行,`edges === []` 在**解析器不存在时也成立**。
   ⭐ 正解:**一真一悬空** —— 真边必须在、悬空必须丢,两个条件同时满足才证明解析器在工作。

⭐⭐ **写完先跑一遍,逐条问「如果功能不存在,这条还绿吗」** —— 上一轮 6 条里有 2 条假绿。

---

## 5. ⚠️ 铁律(违反即返工)

- ⚠️⚠️ **`tests/x/` 512 必须全绿**;红了 = 改变了行为,**改测试让它绿 = 违规**
- ⚠️ 全仓存量失败 **7 文件 / 2 用例**(含 `slot-resource-guard`)**不要去修**
- ⭐⭐ **每条断言都要注入验红**,且:
  - 源码守卫**剥注释再比**(踩过:注释里也有那句话)
  - ⚠️ 注入没红时**先分清**:守卫失效,还是**注入没造出目标场景**?
    (验收者刚踩过:Python 转义报错导致文件根本没改,"全绿"是假的)
- ⚠️ **不要静默兜底**;fail loud / early
- ⭐ **只增不改**:`note-projection` 是 mind 的核心投影,
  ⚠️ 动它要保证**没有 def 块的老文档行为完全不变**(必须有断言钉住)
- ⚠️ **别猜 API 名** —— 上一轮猜了 `api.getFocusedInstanceId()` / `api.getDocJSON()`,两个都不存在

---

## 6. ⚠️ 排查纪律

- ⭐⭐ **加诊断日志 / 写离线探针 / 直接查库**,别读代码脑补
- ⭐ **每层都对但结果不对 → 查数据经过的格式**
  (踩过两次:正文存盘即丢、联系线存盘即丢,**都是存储格式装不下**)
- ⚠️ **grep 零命中 ≠ 不存在**:仓库有含裸 NUL 的文件,grep 静默跳过;
  判据 `file x.ts` 报 `data`,解法 `grep -a`
- 查库(app 跑着时):
  ```bash
  CRED="$HOME/Library/Application Support/KRIG Note V2/.db-credentials"
  U=$(python3 -c "import json;print(json.load(open('$CRED'))['username'])")
  P=$(python3 -c "import json;print(json.load(open('$CRED'))['password'])")
  curl -s -X POST "http://127.0.0.1:8533/sql" -H "Accept: application/json" \
    -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" -u "$U:$P" \
    -d "SELECT title, semantic FROM mind_doc;"
  ```
  ⚠️⚠️ **先核对 app 与 DB 的启动时间**(`ps aux | grep -i surreal` / `electron`)——
  上一轮 app 比 DB 早起 86 分钟,查出来的「没保存」是**环境错位不是 bug**,
  差点据此改没坏的代码。

### 6.1 环境

```bash
env -u ELECTRON_RUN_AS_NODE npx electron-forge start
```
⚠️ 5173 可能被用户既有实例占 → forge 直接退出。**不要 kill 用户进程,问他。**
⚠️ 实验改文件用 `cp` 备份还原,**绝不用 `git checkout`**(会丢未提交的工作)。

---

## 7. ⭐ 真机验收点(做完让用户验这个)

1. 导图 note tab 里两个标题各插一个 def 块(`/def`),别名应是 `A`、`B`
2. 在**任意一个** def 块里写 `A -.支撑.-> B`
3. ⭐ 画布主题框**不该**显示 `id: A` 这种文本(§1 那个 bug)
4. ⭐⭐ **关掉导图重开,那条关系还在**(这是本轮的核心验收点)

⚠️ **画布上仍然看不到那条线** —— 联系线的**渲染**不在本轮范围
(交互矩阵 `01 §7.0`:磁吸点拉线 / 右键 / Cmd+L 都还没接)。
⭐ 本轮验的是「**存得住、读得回、不污染正文**」,别把「看不见线」当失败。

---

## 8. 和用户协作的方式

- **他会盯着数据要证据**;说「我觉得有问题」时**通常是对的**,先查再答
- ⭐⭐ **他会推翻你的结论,而且往往对**。被纠正时**先查证再认**
  - 已被他推翻过的:①Tab 该跟随 note ②别名用 A/B/C 不用标题文字
    ③**def 归属在 note 不在 diglot**(整整两个 commit 返工)
- ⚠️ **他明确讨厌的**:拿一个指标否定它没测的能力;把「库里没有」当「拿不到」;
  用注释骗过守卫;⭐ **替他做架构决策**
- ⭐ **规格与实现相反时,就地标注作废** —— 用户原话:
  「规格留着和实现相反的话比没写还危险,下一个人会照着改回去」
  ⚠️ 更正要**贴在过时文字处**,不能只写在别处(验收时刚补过一次)

---

## 9. 开场建议

> 「我先读 `00 §2.5`(尤其 §2.5.8b 现行形态、§2.5.9 归属)与 `01 §7.7` mind 词表,
>  确认:**note 侧已全通,diglot 侧零处理**,`noteDocToTree` 仍硬写 `edges: []`。
>  ⚠️ 探针实测 def 文本现在会被并进节点正文(画布会显示 `id: A`),步骤 4 要一并修。
>  我打算**先把 M6 断言写出来看着它红**,再动实现;
>  ⭐ 并特别留意 role/悬空 那两条**已知会假绿**的样本设计。
>  做完先给你真机验「重开后关系还在」。这个顺序你认吗?」
