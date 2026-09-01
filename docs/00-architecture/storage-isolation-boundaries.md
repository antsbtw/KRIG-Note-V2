# 存储隔离边界:哪些模块该分独立库,哪些不该

> v0.1 · 2026-09-01 · **分析结论,未开工**
>
> 起因:X 模块拍板走独立 database(见
> [x/persistent-tracking-and-profiling.md §4.1(3.5)](../10-business-design/x/persistent-tracking-and-profiling.md))后,
> 用户提问:note / pdf / web 等工作空间是否也都该用独立表空间?
>
> 相关:[charter.md](charter.md)、[relations/spec.md §11.2](../90-archive/refactor-v2/data-model/relations/spec.md)

---

## 0. 结论先行

**不是"都该独立",而是有一条清晰的分界线:**

> **共享知识图谱的模块必须同库;外部采集的数据该分库。**

| 模块 | 归属 | 理由 |
|---|---|---|
| note / pdf / ebook / web剪藏 / thought / folder / graph | **同一个库(现状不动)** | 它们**共享 atom + edge**,彼此有真实的跨域边 |
| X | **独立库 `krig_x`**(已拍板) | 外部采集,与知识图谱零关联 |
| mail | **建议独立库** | 同上 |

---

## 1. 关键实测:note 系模块之间有真实的跨域边

这是判断的**决定性证据**。查库实测(2026-09-01):

### 1.1 atom 的域分布

```
pm              102918   ← note 正文(块)
bookmark           256   ← web 书签
folder              59
thought              8   ← 读书想法
ebook                4
reading-state        4
graph-canvas         1
graph-instance       1
```

**它们全都住在同一张 `atom` 表里**,靠 `payload.domain` 区分。

### 1.2 边确实跨域连接

实测把边的两端 atom 解析出域:

| 边 | subject 域 | object 域 | 含义 |
|---|---|---|---|
| `user:krig:thoughtOf` | **thought** | **ebook** | 这条想法是关于这本书的 |
| `user:krig:hasReadingState` | **ebook** | **reading-state** | 这本书的阅读进度 |
| `user:krig:hasReadingThought` | **ebook** | **pm(note)** | 这本书关联的笔记 |
| `user:krig:hasNoteView` | pm | — | note 视图 |
| `user:krig:inFolder` | folder | folder/pm | 文件夹树 |

**`ebook → pm`、`thought → ebook` 这些边是真实存在的跨模块关系。**

如果把 ebook 分到独立库、note 留在原库:

- 这条边的两端**分属两个 database**
- SurrealDB **无法跨库 JOIN**
- "这本书关联的笔记"这个功能**直接断掉**

> 用户提问里说"包括数据边的建立会更好" —— 实测结论恰恰相反:
> **对这些模块,分库会让边无法建立。**

---

## 2. 判据:什么样的模块该分库?

不看"是不是不同功能",看**三个客观属性**:

| 判据 | 该同库 | 该分库 |
|---|---|---|
| **是否共享实体/边** | 有跨域边 → 必须同库 | 零关联 → 可分 |
| **数据来源** | 用户创作的知识 | 外部采集(抓取/同步) |
| **生命周期** | 与笔记同生命周期 | 独立过期/清理策略 |

按此判据:

**note / pdf / ebook / web / thought / graph —— 同库**

它们本质是**同一个知识图谱的不同视图**:一本书(ebook)可以关联笔记(pm)、
产生想法(thought)、记录进度(reading-state);一个 PDF 导入后就是 note 的块。
**"模块"是 UI 层的划分,不是数据层的划分。**

**X / mail —— 分库**

- 外部采集,不是用户创作
- 与 atom/edge 零关联(实测 X 的 `tweet_inbox` 与 atom 表无任何外键)
- 有独立的过期策略(X 7 天 TTL、mail 按账号同步)
- schema 演进节奏与笔记无关

---

## 3. 那"后期数据维护"的诉求怎么满足?

用户的担心是合理的 —— 都挤在一个库里,维护确实有压力。但**解法不是分库**:

| 担心 | 分库能解决吗 | 更合适的解法 |
|---|---|---|
| 表太多、看不清归属 | ✗ 分库后要跨库查,更难 | **命名规范** + schema 文件分节(现状已按模块分段) |
| migration 互相阻塞 | 部分能 | migration 按模块分文件、独立编号(不必分库) |
| 误删风险 | ✓ | 备份策略 + 删除前校验(edge 的孤儿清理已有先例) |
| 查询变慢 | ✗ | **改写查询**。实测一次跨表 `INSIDE` 子查询耗时 **15.3 秒**(见 §4),是写法让索引失效,与分库无关 |
| 数据边混乱 | ✗ **反而更糟** | 边的命名空间分层(`user:krig:*` / `ai:*`)已在 §11.2 确立 |

> **关键**:上表里只有"误删风险"是分库真能解决的,而它对 note 系模块并不突出
> (它们本来就该一起备份、一起恢复)。

---

## 4. 一个真实的性能信号

实测中一条跨表子查询跑了 **15.3 秒**:

```sql
SELECT VALUE payload.domain FROM atom
WHERE <string>id INSIDE (SELECT VALUE 'atom:' + object.atomId FROM edge WHERE ...)
```

10 万行 atom + 全表扫描 + 字符串拼接比较。**这说明真正的瓶颈是查询写法,
不是"表里东西太多"。** 分库不会让这条查询变快 —— 它在任何一个库里都一样慢。

**注**:`edge` 的索引其实是齐的(实测 [schema.ts:70-80](../../src/storage/surreal/schema.ts#L70):
`predicate` / `subject.atomId` / `object.atomId` / `subject.atomId+predicate` 都有)。
所以这条慢查询不是缺索引,而是**查询写法**的问题 ——
`'atom:' + object.atomId` 这种字符串拼接后再 `INSIDE` 比较,
使得索引无法命中,退化成全表扫。

**结论不变**:瓶颈在查询写法,分库同样解决不了。真要优化,
方向是改写这类查询(用 record link 而非字符串拼接),而不是拆库。

---

## 5. 建议

1. **note / pdf / ebook / web / thought / graph 维持同库** —— 它们共享知识图谱,
   分库会切断真实存在的跨域边
2. **X 按已定方案分出 `krig_x`**
3. **mail 建议同样分出** —— 判据与 X 完全一致(外部采集、零关联、独立生命周期);
   可与 X 的 client 多连接改造一并做,边际成本低
4. **图查询慢的真因是写法不是分库** —— `edge` 索引已齐备;
   慢在字符串拼接式的跨表比较使索引失效。要优化就改写查询,分库无助于此
5. **不做"每个 view 一个库"** —— 那是把 UI 划分误当数据划分,
   会把一个完整的知识图谱切碎

---

## 6. 未决

- mail 分库的时机:与 X 同期,还是等 X 验证完再做?
- 若图查询体感变慢,单独做一轮查询写法审计(非索引问题),**不依赖任何分库决定**
