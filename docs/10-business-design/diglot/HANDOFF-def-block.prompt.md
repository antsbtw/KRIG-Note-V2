# 交接 prompt · def 块(note 的定义块)

> 交给**新对话**。分工:**用户 = 决策者;你 = 执行者(写代码);
> 另一个对话 = 验收者**(写这份 prompt 的人,会逐条核你的产出)。
>
> ⚠️ 上一轮**已经写过一版并整体回退** —— 不是代码坏,是**归属错了**。
> 先读 §1 搞清楚错在哪,别重蹈。

---

## 0. 一句话:要做什么

> 给 **note** 加一个一等公民块:**def 块(定义块)**。
> ⭐ **note 提供「块 + 词法」**;graph(mind / 画板 / BPMN)只是**调用者**,
> 各自定义「词表 + 含义」。

分支 `feature/diglot-mind-v0`,HEAD = `5ff12900`,工作树干净。

---

## 1. ⚠️⚠️ 上一轮错在哪(最重要的一节,别跳)

`c8475b55` / `588df07e` 把 def 的**块与词法**全建在
`src/capabilities/diglot-model/def-block.ts`,只让 mind 用。**已整体回退。**

用户原话:

> 「**def 是 note 的能力,然后才是 graph 这个大的模块调用。这是大的设计。**」

⭐ **那是把地基盖在二楼。**

⚠️ 更该记的教训:上一轮**用一条正确的纪律为错误方向辩护** ——
援引「不预建通用能力、等第二个使用者再抽象」。
⭐ 那条纪律防的是**过早抽象**(从一个用例硬抽共性),
而 def **一开始就是 note 的能力**,不是从 mind 抽出来的共性。**纪律没错,用错了地方。**

⚠️ 同样问反的还有「note 要不要为图种能力买单」——
⭐ 不是买单:def 是 note 自己的能力(给块加定义、写关系),graph 只是第一个调用者。

**正确分层:**

```
note(底座)
  └─ ⭐ def block —— note 的一等能力:给块写「定义」
       ├─ graph 调用(mind/画板/BPMN)→ 解释成节点 / 关系 / 样式
       ├─ note 自己用                → 元数据、引用关系
       └─ 将来别的模块调用            → 各自解释
```

> **note 定义「块 + 词法」,调用方定义「词表 + 含义」。**
> ⭐ 与 `00 §2.5.5`「**共用解析器可以,共用含义不行**」同一条线。

---

## 2. ⭐⭐ 开工前必须找用户拍板的第一件事

> ⚠️ **别自己定,也别猜** —— 上一轮返工的成因就是替用户做了归属决策。

**def 块「定义」的是谁?**

| | 形态 | 说明 |
|---|---|---|
| **(甲)** | 紧跟在**它前面那个块**之后,定义那个块 | 符合直觉、好写。⚠️ 靠**位置约定**,块本身不知道自己属于谁 |
| **(乙)** | 块自带 `attrs.for = <blockId>` | 显式绑定,挪动不失联。⚠️ 手写时要知道 id |

⭐ 写 prompt 的人倾向 **(甲) 为主 + (乙) 可选**(默认定义上一个块,
`attrs.for` 留给程序化场景,不强制),⚠️ **但这是用户的决定,不是我的。**

⚠️ 之所以必须先问:def 现在是 **note 的能力**,
得先说清「普通笔记里写一个 def 块,它定义的是谁」,才能设计 schema。

**顺带问清楚(同一次问完,别挤牙膏):**
1. `+++` 还要不要留作**输入规则**(打 `+++` 变 def 块,像 ` ``` ` 变代码块)?
   ⭐ 建议留 —— 手写体验不变,但**存储是真块**,不再靠记号硬凑。
2. def 块在 note 里**默认折叠还是展开**?(用户此前说过用 toggle 折叠)

---

## 3. ⭐ 先读这些(按顺序)

| 文件 | 为什么必读 |
|---|---|
| ⭐⭐ `docs/10-business-design/diglot/00-diglot-core.md` **§2.5** | def 块的**完整规格**:记法、别名、方案丙、共用边界、⭐ **§2.5.9 归属** |
| ⭐ 同上 **§3.5** | 可发现性通则:每个修饰键手势都要有右键菜单项 |
| ⭐ `01-mind-spec.md` **§7.7** | mind 的**词表**(只是调用者的那一半) |
| `01-mind-spec.md` **§7.0** | 交互矩阵(用户逐条拍板过) |
| `03-projection-map.md` §5.9 | 完成度盘点 |
| ⚠️ `git show c8475b55` / `588df07e` | **上一轮的实现**(归属错了,但**词法逻辑是对的**,可搬) |

⭐ **上一轮不是全废**:分类/别名/骨架/往返 的**逻辑**都验证过,
只是住错了地方。**搬到 note 侧即可,别从零重写。**

---

## 4. ⭐ 要动的地方(实测清单,照 htmlBlock 的先例)

加一个 note 块要碰这些(grep `htmlBlock` 得到的实际清单):

```
src/drivers/text-editing-driver/blocks/def-block/spec.ts        ← 新建
src/drivers/text-editing-driver/blocks/def-block/node-view.ts   ← 新建
src/drivers/text-editing-driver/enabled-blocks.ts               ← 登记
src/drivers/text-editing-driver/pm-host.css                     ← 样式
src/drivers/text-editing-driver/serializers/pm-to-markdown.ts   ← 序列化
src/drivers/text-editing-driver/keyboard/default-keyboard-meta.ts ← 键盘行为
src/capabilities/text-editing/converters/md-to-pm.ts            ← markdown 往返
src/capabilities/text-editing/ui/slash-menu/items.ts            ← /def 项
src/capabilities/text-editing/commands/register-pm-commands.ts  ← 命令
```

⚠️ **别漏落库这条路**:`src/platform/main/note/dissect-pm-doc.ts` /
`diff-block-tree.ts` —— 新块要能 dissect/assemble。
⭐ 仓库有血泪教训:块缺 `attrs.id` → dissect throw → **改动静默不保存**
(见 memory「table cell 块 id」「导入note缺id不保存」)。

⚠️ 另有一道闸:`src/lib/atom-serializers/svg/index.ts` 的 `RENDERABLE_ATOM_TYPES`
—— 画布渲染态认不认它。⭐ 硬约束(`slash-render-gate.ts`):
**编辑态能插的块 ⊆ 渲染态能渲的块**,否则出「功能黑洞」。
def 块在画布节点里大概率**不该能插**,请确认闸门行为。

---

## 5. ⭐ 词法契约(note 侧,图种无关)

def 块内每行归一类(`01 §7.7.1`):

| # | 形态 | 归类 |
|---|---|---|
| ① | `id: A` | kv(别名声明) |
| ② | `shape: 菱形` / `color: red` | kv |
| ③ | `role: floating` / `marker: p1` | kv |
| ④ | `A -.支撑.-> C` / `A -.-> C` | rel(关系行) |
| ⑤ | `# 注释` | other(忽略但**保留**) |
| ⑥ | 其它任何东西 | ⭐ other(**原样保留**) |

⚠️ **note 不解释这些 key 的含义** —— 它只负责「拆成行、认出形态、原样存住」。
`role:` 是什么意思是 **mind 的事**;bpmn 可以有完全不同的词表。

⚠️ 上一轮踩过的坑(探针定位,**别再踩**):
正则 `-\.([^.]*)\.->` **匹配不上无标签的 `-.->`**(它只有两个点、两侧共用)
→ 无标签写法被归成 other,边根本没造出来。正解 `-\.(?:([^.]*)\.)?->`。

**别名分配**:取**第一个没被占的**(A,B,…,Z,A2,B2…),
⚠️ 不是按个数递增(用户删掉中间节点后那个字母该能重用);
⚠️ 26 个用完不许塌缩成重复;真耗尽 throw,不静默返空串。

---

## 6. ⚠️ 铁律(违反即返工)

- ⚠️⚠️ **`tests/x/` 512 必须全绿**;红了 = 改变了行为,**改测试让它绿 = 违规**
- ⚠️ 全仓存量失败 **7 文件 / 2 用例**(含 `slot-resource-guard`)**不要去修**
- ⭐⭐ **每条断言都必须注入验红** —— 写完**故意注入违规看它变红**
  - ⚠️ 源码守卫必须**剥掉注释再比**(踩过:注释里也有那句话,删掉真代码照样绿)
  - ⚠️ 守卫别照抄实现公式(只能验证「实现和自己一致」,验不出漏项)
  - ⚠️ 注入没红时**先分清**:守卫失效,还是**注入没造出目标场景**?
  - ⭐⭐ **写完先跑一遍看哪些是假绿** —— 上一轮 6 条里有 **2 条假绿**
    (样本让隐式规则给出相同答案 → 功能不存在也过),探针查出来才发现
- ⚠️ **不要静默兜底**;fail loud / early
- ⚠️ 常驻 timer / 事件监听必须有停止调用
- ⭐⭐ **这次是真的改 note 本体** —— 但**只许增能力,不许改既有行为**。
  ⚠️ `buildInputRules` 是「**始终开**」的共用层,`---` 已被 horizontalRule 占用,
  **别动它**(用 `+++`)
- ⭐ **先查既有实现再动手** —— 这仓库里「你以为要做的事」常常已经做了一半

---

## 7. ⚠️ 排查纪律(血的教训)

- ⭐⭐ **加诊断日志 / 写离线探针 / 直接查库**,别读代码脑补
- ⭐ **每层都对但结果不对 → 查数据经过的格式**
  (踩过两次:正文存盘即丢、联系线存盘即丢,**都是存储格式装不下**,不是某层代码错)
- ⚠️ **grep 零命中 ≠ 代码不存在**:仓库有含裸 NUL 的文件,grep 静默跳过;
  判据 `file x.ts` 报 `data`,解法 `grep -a`
- ⚠️ **别猜 API 名**:上一轮写了 `api.getFocusedInstanceId()` / `api.getDocJSON()`
  两个都不存在。真实路径 `te.instanceRegistry.getFocusedInstanceId()`、
  `api.getDocMarkdown()` 返 `{markdown}`
- 查库姿势(app 跑着时):
  ```bash
  CRED="$HOME/Library/Application Support/KRIG Note V2/.db-credentials"
  U=$(python3 -c "import json;print(json.load(open('$CRED'))['username'])")
  P=$(python3 -c "import json;print(json.load(open('$CRED'))['password'])")
  curl -s -X POST "http://127.0.0.1:8533/sql" -H "Accept: application/json" \
    -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" -u "$U:$P" \
    -d "SELECT title, semantic FROM mind_doc;"
  ```
  ⚠️ **先核对 app 与 DB 的启动时间**:上一轮 app 比 DB 早起 86 分钟,
  查出来的「没保存」是环境错位不是 bug,差点据此改没坏的代码。

### 7.1 ⚠️ 环境坑

```bash
env -u ELECTRON_RUN_AS_NODE npx electron-forge start
```
否则 `require('electron')` 命中 npm launcher 包,报 `Cannot find module 'electron'`。

⚠️ **5173 可能被用户既有实例占用** → forge 直接退出。**不要 kill 用户进程**,问他。
⚠️ 做实验改文件用 `cp` 备份还原,**绝不用 `git checkout`**(会丢未提交的工作)。

---

## 8. ⭐ 建议的落地顺序(每步先写断言并注入验红)

| # | 步骤 | 验收点 |
|---|---|---|
| 1 | ⭐ **note 侧 def 块**:spec + NodeView + 序列化 + 落库 | ⭐ **真机:普通 note 里能插、能写、能存、重开还在** |
| 2 | `/def` slash + 别名自动分配 | 打 `/def`、`/meta`、`/图元` 都命中 |
| 3 | 词法 API(分类 / 取值 / 关系行)对外暴露 | 单测 |
| 4 | ⭐ mind 调用:读 `role:` 与关系行 → S 层 | ⭐ **联系线存得住**(现在存盘即丢) |

⭐⭐ **第 1 步做完就停下来给用户真机验** —— 底座对了再往上叠。
⚠️ 上一轮的教训:一口气做到第 4 步才发现归属错,返工两个 commit。

---

## 9. 和用户协作的方式(顺着来效率高得多)

- **他会盯着数据要证据**。说「我觉得有问题」时**通常是对的**,先查再答
- ⭐⭐ **他会推翻你的结论,而且往往对**。被纠正时**先查证再认**,别急着道歉也别硬撑
  - 本轮被推翻的:①Tab 开关(该跟随 note)②标题文字当别名(该用 A/B/C)
    ③def 归属(该在 note)—— ⭐ **三次都是他对**
- ⚠️ **他明确讨厌的**:拿一个指标否定它没测的能力;把「库里没有」当「拿不到」;
  **用注释里的说明骗过守卫**;⭐ **替他做架构决策**
- ⭐ **规则被推翻时,测试要按新规则重写并注明推翻理由** ——
  那是规则变了,不是改测试迁就实现;两者必须在 commit 里说清

---

## 10. 开场建议

别一上来就写代码:

> 「我先读 `00 §2.5`(尤其 §2.5.9 归属)与 `01 §7.7`,确认理解:
>  **def 是 note 的能力,graph 只是调用者**;上一轮建在 diglot 里已回退。
>  ⚠️ 开工前有一个决策要你拍:**def 块定义的是谁** ——
>  (甲)紧跟其后定义上一个块 /(乙)`attrs.for` 显式绑定?
>  顺带两个小的:`+++` 还留不留作输入规则?默认折叠还是展开?
>  我打算**先把断言写出来**再动手,且第 1 步只做 note 侧、做完给你真机验。
>  这个顺序你认吗?」
