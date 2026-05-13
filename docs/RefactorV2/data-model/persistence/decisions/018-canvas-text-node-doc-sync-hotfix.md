# Decision 018 — Canvas Text-Node Doc Sync Hotfix(P0d)

> **Phase**: N(实施 Phase）/ Hotfix(局部 — sub-phase 3a-1 范围)
> **状态**: ✅ **已实施完成 + binary verify 场景 ① 三层实证 + 反向更新完成,授权合 main**(10 commits — 5 实施 + 1 merge main + 4 反向更新)
> **设计师 / 审计师**: 总指挥(main)
> **诊断 + 实施**: 本对话(P0d 排查实施者)
> **决议日期**: 2026-05-13
> **暴露日期**: 2026-05-13(decision 017 binary verify 期间总指挥发现 — §12.5 占位)
>
> ## TL;DR
>
> sub-phase 3a-1 引入 text-node + pmContentCapability 时 view 端契约(inst.doc =
> DriverSerialized 信封对象)与 store 端契约(inst.doc = unknown[] 数组,经
> `incomingDocToPmPayload` 转换)**形态错位**,导致:
>
> - view 推 DriverSerialized 对象 → `Array.isArray()` 返 false → 静默 fallback
>   写入 `{ type:'doc', content:[] }` → pm atom 空 doc
> - 重启后 text-node 框保留(graph-instance + hasContent 边正常),**框内文字消失**(pm content 空)
>
> 实验 1 实证(用户输入"abc" + commit + 不重启 + 直查库):pm atom content
> 字面 `[]` 空数组,与 fallback 返回值 100% 匹配 — 根因坐实。
>
> 修法 Option α(总指挥拍板):store 端 incomingDocToPmPayload 严格识别 DriverSerialized
> 信封 + 不静默兜底;读路径反方向也对齐返 DriverSerialized;新建路径(InteractionController)
> 形态对齐空 DriverSerialized 信封。

---

## 0. 执行指南

### 0.1 角色与流程

```
decision 017 binary verify(主对话总指挥)
    ↓ 发现 P0d 占位(§12.5)
P0d 排查实施者(本对话)
    ↓ 完整读 canvas-store / canvas-text-node / Host / NodeRenderer / InteractionController
    ↓ grep verify view 端 inst.doc 消费形态
    ↓ 报告"根因怀疑 + Option α/β 修法草案 + 实验设计"
    ↓
总指挥(批复)
    ↓ Option α 拍板 + Q1 选 A(InteractionController 一并改)+ Q3 选 A(类型放宽)
    ↓ 实验 1 协调用户跑 + HTTP query 实证
    ↓ 实验 1 数据:pm content [] 字面匹配 fallback → 根因坐实,无需实验 1.5
    ↓
P0d 排查实施者(本对话)
    ↓ 起 fix/canvas-text-node-doc-sync(基于 main f7f908d)
    ↓ 4 个 commit 实施修复
    ↓ 写本决议 018
    ↓ 报"P0d hotfix 实施完成请审计"
    ↓
总指挥
    ↓ 静态复核 + 协调用户跑 binary verify 2 场景
    ↓ 通过 → 合 main + push → 反向更新 014 / 017 / L7 启动包
```

### 0.2 实施纪律(本次已遵守)

1. 起独立分支 `fix/canvas-text-node-doc-sync` 基于 main `f7f908d`(decision 017 HEAD)
2. **不在** `feature/L7-sub3a-2.5-note-form-upgrade` 上做(避免违反分支按模块切纪律)
3. 4 个 commit:1 类型放宽 + 1 写路径 + 1 读路径 + 1 新建形态对齐 — 按总指挥批复 commit 顺序
4. 拍板前不动代码 + 不起分支(诊断对话已做对)
5. grep verify 发现新违反(类型签名 `TextNodeAtoms=unknown[]`)立即停下汇报,等总指挥 Q3 批复后才动 — 不擅自扩

---

## 1. 问题字面描述 + 实证证据

### 1.1 症状

**用户报**(2026-05-13 主对话总指挥转述,sub-phase 3a-2.5 binary verify 期间发现):

- 画板创建 text-node → 输入文字 → graceful close → 重启 → text-node 框还在,**框内文字消失**
- shape(rectangle / circle / pentagon 等无内容节点)跨重启正常保留 ← P0a 修后已实证
- 仅 text-node 这种"有 pm content"的节点失内容

### 1.2 数据库 binary 实证

**实验 1**(2026-05-13 总指挥协调用户跑):

操作:用户在画板输入"abc" → 点 popup 外空白(commit)→ **不 graceful close** → 总指挥 HTTP query 8533。

数据:
```
canvas (p0d-test): atom 01KRFVHN97R6974EFXADA7WWZP
text-node i-001: ref='krig.text.label'            ← 框已落库 ✓
hasContent 边 i-001 → pm atom 01KRFVJB8AP3RA2VA6J9FMWCZV  ← 边已落库 ✓
pm atom content: []                                ← bug 字面实证
  createdAt: 1778648689930
  updatedAt: 1778648699018(晚 9 秒,view 端二次 save)
```

pm atom payload 字面是 `{ type:'doc', content:[] }`,与
`incomingDocToPmPayload` 的 fallback 返回 `{ type:'doc', content:[] }` 100% 匹配 —
**用户输入的 "abc" 从未写进库**。

`updatedAt` 比 `createdAt` 晚 9 秒(view 端 popup 关闭二次 trigger),也走同一 fallback,
content 仍 `[]` — 验证 `incomingDocToPmPayload` 修一处同时解 create + update 两路径。

### 1.3 根因字面

**字面位置**:[`src/platform/main/graph/canvas-store.ts:268-274`](../../../../../src/platform/main/graph/canvas-store.ts#L268)(修复前)

```ts
function incomingDocToPmPayload(inst: Record<string, unknown>): PmPayload {
  const docArr = Array.isArray(inst.doc) ? inst.doc : [];
  return {
    type: 'doc',
    content: docArr as PmPayload[],
  };
}
```

**契约错位**:
- 函数注释自称"incoming.doc 是 TextNodeAtoms = unknown[]"
- view 端实际写回的 inst.doc 是 **DriverSerialized 信封对象**
  `{ format:'pm-doc-json', version:'0.1', payload:{ type:'doc', content:[...] } }`
- `Array.isArray(对象) === false` → `docArr = []` → 库存 `{ type:'doc', content:[] }`

**字面追溯**(view 端写回 DriverSerialized 对象):

1. [edit-overlay.tsx:81-102](../../../../../src/capabilities/canvas-text-node/edit-overlay.tsx#L81) — `latestDocRef: DriverSerialized`,`handleChange(newDoc: DriverSerialized)` 字面类型
2. [edit-overlay.tsx:104-109](../../../../../src/capabilities/canvas-text-node/edit-overlay.tsx#L104) — `exit(commit)` 把 `latestDocRef.current`(DriverSerialized)传给 `session.opts.onExit(id, doc)`
3. [GraphCanvasView.tsx:261-264](../../../../../src/views/graph-canvas-view/GraphCanvasView.tsx#L261) — `onExit` 把 newDoc(DriverSerialized)透传给 `host.updateInstance(id, { doc: newDoc })`
4. [Host.tsx:286-305](../../../../../src/capabilities/canvas-rendering/Host.tsx#L286) — `updateInstance` 浅合并 `next = {...current, ...patch}` → `inst.doc = DriverSerialized`
5. `scheduleSave()` 1s 防抖 → `host.serialize()` → `renderer.listInstances()` → IPC GRAPH_SAVE → `canvas-store.update` → **走 incomingDocToPmPayload fallback**

### 1.4 次要错位 — 读路径反方向

[`canvas-store.ts:217-230`](../../../../../src/platform/main/graph/canvas-store.ts#L217)(修复前)
也是同向错位:

```ts
const env = wrapPmDoc(pmAtom.payload.payload as PmPayload);
const pmDoc = env.payload as PmPayload;
instance.doc = pmDoc.content ?? [];   // ← 给 view 一个数组(V1 NoteView Atom[] 形态)
```

view 端 atom-bridge 字面支持 DriverSerialized + V1 atoms[] 两种形态(分支 1 +
分支 2),但写路径既然要求对齐 DriverSerialized,读路径也应一并对齐 — 单形态契约
更清晰,view 端可砍掉 V1 兼容分支(留作 unwind 项,本次不动 atom-bridge)。

### 1.5 第三处违反 — 新建路径

[`InteractionController.ts:725-728`](../../../../../src/capabilities/canvas-rendering/interaction/InteractionController.ts#L725)(修复前):

```ts
// 文字节点:创建时初始化空 doc 字段(G4.5 canvas-text-node 编辑时填内容)
if (spec.ref === 'krig.text.label') {
  instance.doc = [];
}
```

新建 text-node 时把 inst.doc 初始化为空数组(V1 形态)。Option α 落地后这条路径
触发 store 端 fallback 路径 + warn — 行为正确但 warn 噪音化,违反 P0c 修法纪律的
反向版本(warn 噪音化 → 真 warn 被淹)。

### 1.6 第四处违反 — 类型签名

[`canvas-rendering/types.ts:43`](../../../../../src/capabilities/canvas-rendering/types.ts#L43)(修复前):

```ts
export type TextNodeAtoms = unknown[];
```

类型签名说 doc 是数组,但 V2 实际是 DriverSerialized 对象 — sub-phase 3a-1 引入时
的设计错位。不放宽 InteractionController 改成对象会 typecheck fail。

---

## 2. 修法拍板 + 工程量

### 2.1 修法决议树(Option α 拍板)

| 选项 | 内容 | 拍板理由 |
|---|---|---|
| **α(选)** | 改 store 端 incomingDocToPmPayload 识别 DriverSerialized + 反方向 instanceAtomToObject 也返 DriverSerialized + InteractionController 形态对齐 + 类型放宽 | (1) view 端契约就是 DriverSerialized 全程透传(B3 plan v0.2 路径 A "G4-2=B" 既定);(2) store 是后增的转换层,改 store 不影响 view 任何代码;(3) 写读两端对齐后 view 端只需消费一种形态 |
| β(弃) | 改 view 端写出去前先 unwrap DriverSerialized → 数组 | 破坏 atom-bridge.docToDriverSerialized 当前为兼容三种形态(DriverSerialized / V1 Atom[] / 空)写的逻辑;view 端要散布 wrap/unwrap |

### 2.2 改动清单(共 4 处)

| # | 文件 | 修法 | Commit |
|---|---|---|---|
| 1 | `src/capabilities/canvas-rendering/types.ts:43` | `TextNodeAtoms = unknown[]` → `unknown`(类型放宽,允许对象/数组) | commit 1 |
| 2 | `src/platform/main/graph/canvas-store.ts:268-274` (`incomingDocToPmPayload`) | 严格识别 DriverSerialized 信封 + warn 不静默兜底 | commit 2 |
| 3 | `src/platform/main/graph/canvas-store.ts:217-230` (`instanceAtomToObject` text-node 分支) | 直接组装 DriverSerialized 信封返;移除 `wrapPmDoc` import(已不使用) | commit 3 |
| 4 | `src/capabilities/canvas-rendering/interaction/InteractionController.ts:725-728` | 新建 text-node 时 `instance.doc = {format:..., payload:{content:[]}}`(形态对齐 + 防 warn 噪音化) | commit 4 |

### 2.3 commit 2 修法字面

```ts
function incomingDocToPmPayload(inst: Record<string, unknown>): PmPayload {
  const doc = inst.doc as unknown;
  // V2 view 端契约:DriverSerialized 信封 { format:'pm-doc-json', payload:PmPayload }
  if (doc && typeof doc === 'object' && (doc as Record<string, unknown>).format === 'pm-doc-json') {
    const payload = (doc as { payload?: unknown }).payload;
    if (
      payload && typeof payload === 'object' &&
      (payload as { type?: string }).type === 'doc' &&
      Array.isArray((payload as { content?: unknown }).content)
    ) {
      return payload as PmPayload;
    }
  }
  // 兜底:格式不认 = view 端契约破裂,记 warn,返空 doc(沿 P0c 修法纪律不静默)
  console.warn('[graph/canvas-store] incomingDocToPmPayload: unexpected inst.doc shape', doc);
  return { type: 'doc', content: [] };
}
```

**纪律对齐**:
- 不要 V1 Atom[] 分支 — 写路径不该有,严格才能 fail-fast
- 加 warn 不静默(沿 P0c 修法纪律 — catch 不吞错)
- 不复用 unwrapPmDoc / wrapPmDoc — inst.doc 形态来自 view,不一定符合 NoteDocEnvelope 类型契约

### 2.4 commit 3 修法字面

```ts
if (payload.ref === TEXT_LABEL_REF) {
  const pmAtomId = await getPmAtomIdForInstance(atom.id);
  if (pmAtomId) {
    const pmAtom = await storage.getAtom<'pm'>(pmAtomId);
    if (pmAtom && pmAtom.payload.domain === PM_DOMAIN) {
      instance.doc = {
        format: 'pm-doc-json',
        version: '0.1',
        payload: pmAtom.payload.payload as PmPayload,
      };
    }
  }
}
```

`wrapPmDoc` 走一圈再取 `.payload.content` 改成直接组装 DriverSerialized,与写路径
对齐。`wrapPmDoc` import 顺手删(已无使用点)。

### 2.5 commit 4 修法字面

```ts
if (spec.ref === 'krig.text.label') {
  instance.doc = {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: [] },
  };
}
```

**为什么不是 canvasEmptyDoc**:`canvasEmptyDoc`(atom-bridge.ts:120)是 enter
编辑态时 PM 初始化兜底,带空 paragraph(isTitle:false);本路径是"刚创建 instance
还没编辑文字",字面就是没内容,content 应为空数组。

**为什么 inline**:grep 全 src 无现成"空 DriverSerialized"工厂(`createEmptyDoc`
含 isTitle:true / `canvasEmptyDoc` 含 isTitle:false paragraph / `wrapPmDoc` 不是空
工厂);按总指挥批复不扩 envelope 模块,inline 即可。

### 2.6 不做的事

- **不动** sub-phase 3a-2.5 分支(`feature/L7-sub3a-2.5-note-form-upgrade` 的 3 commits 保留)
- **不动** atom-bridge V1 atoms[] 兼容分支(分支 2 — 留作 unwind 项;本次未污染 view 端契约)
- **不动** 历史脏 pm atom(实验 1 写出来的空 doc)— 用户手动清理或下次 graceful close 自然覆盖

---

## 3. 验证清单

### 3.1 静态验证(实施者跑,完成时填 §12.2)

- ⏳ `npx tsc --noEmit` typecheck pass
- ⏳ `npx eslint <4 个改动文件>` lint clean
- ⏳ grep verify view 端 inst.doc 消费形态(Step 1 已 verify,无新违反)

### 3.2 用户 binary verify(总指挥协调,完成时填 §12.3)

**场景 ① — text-node 文字跨重启保留**

1. 关 V2 全部进程 + sidecar:`pkill -f "KRIG Note V2"; pkill -f "surreal start"`
2. 启动 V2(此分支 build):`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm start`
3. 创建一个画板(标题 `p0d-verify-1`)
4. 双击空白处创建 text-node → 输入"hotfix verify"→ 点 popup 外空白(commit)
5. Cmd+Q **graceful** 退出
6. 等 5 秒,重启 V2
7. 打开 `p0d-verify-1` 画板
   - **预期**:text-node 框保留,框内文字"hotfix verify"完整显示

**场景 ② — text-node 文字编辑跨重启保留**

1. 接场景 ① 重启后状态
2. 双击该 text-node 进入编辑 → 改成"hotfix verify v2"→ 点空白(commit)
3. Cmd+Q graceful 退出
4. 等 5 秒,重启
5. 打开同一画板
   - **预期**:text-node 内容是"hotfix verify v2"(新内容,验证 update 路径)

**场景 ③ — 数据库 binary 实证(总指挥跑)**

```bash
curl -s -X POST http://127.0.0.1:8533/sql \
  -H "Authorization: Basic <...>" \
  -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" \
  --data '
    SELECT * FROM atom WHERE payload.domain = "pm" ORDER BY updatedAt DESC LIMIT 5;
  '
```

**预期**:最新 pm atom 的 `payload.payload.content` 含 `{type:'paragraph', content:[{type:'text', text:'hotfix verify v2'}]}` 形态(真实文字),不是空数组。

### 3.3 回归验证 — 非 text-node 路径不破坏

- 创建 shape(hexagon / rect / circle) + graceful close + 重启 → shape 保留(017 已通过,本次回归确认未影响)
- 创建画板 + 不放 text-node → graceful close + 重启 → 画板保留,无 text-node 相关 warn
- 创建 substance + graceful close + 重启 → substance 保留

---

## 4. 实施 commit 链

| Commit | 内容 | 文件 |
|---|---|---|
| `2a203e2` | fix(graph/types): TextNodeAtoms unknown[] → unknown — P0d 类型契约对齐 | `src/capabilities/canvas-rendering/types.ts` |
| `f4bc441` | fix(graph/canvas-store): incomingDocToPmPayload 识别 DriverSerialized — 修 P0d 写路径 | `src/platform/main/graph/canvas-store.ts` |
| `8659715` | fix(graph/canvas-store): get text-node instance.doc 返 DriverSerialized — 对齐读路径形态 | `src/platform/main/graph/canvas-store.ts` |
| `db046fb` | fix(graph/canvas/interaction): 新建 text-node instance.doc 初始化空 DriverSerialized — 形态对齐 | `src/capabilities/canvas-rendering/interaction/InteractionController.ts` |

分支基础:main `f7f908d`(Merge fix/storage-persistence-hotfix — decision 017)

---

## 5. (留空,本决议不涉及)

## 6. 验证证据(binary 实测记录,填写于实施后)

### 6.1 实验 1 实证(根因坐实)

见 §1.2 — 用户输入 "abc" + commit + 不重启 + 直查库,pm atom content `[]` 字面匹配
fallback 返回值。

### 6.2 修法验证(待跑 — §12 填写)

⏳ 等 binary verify 场景 ① ② ③ 跑完后填

---

## 9. Open Questions

### Q-1 — atom-bridge V1 atoms[] 兼容分支去留(unwind 项)

**字面位置**:[`src/capabilities/canvas-text-node/atom-bridge.ts:55-67`](../../../../../src/capabilities/canvas-text-node/atom-bridge.ts#L55)
+ [atom-bridge.ts:94-110](../../../../../src/capabilities/canvas-text-node/atom-bridge.ts#L94)

**现状**:`atomsToSvgInput` / `docToDriverSerialized` 字面有两条分支:
- 分支 1: DriverSerialized 形态(V2 写出)
- 分支 2: V1 NoteView Atom[] 形态(向后兼容 V1 持久化)

**问题**:本次修复后 store 端读写两端都对齐 DriverSerialized,V2 持久化路径
**永远不会**产生 V1 Atom[] 形态的 inst.doc。分支 2 实际死代码。

**去留**:
- 留:防 V1 历史数据迁移场景(暂未确认是否有 V1 数据要迁)
- 删:简化 view 端契约,inst.doc 单一形态 DriverSerialized

**优先级**:P3 — 不影响 P0d 修复正确性,留独立 unwind 项。

### Q-2 — 类型 `TextNodeAtoms = unknown` 是否进一步收紧成 `DriverSerialized`

**现状**:本次放宽到 `unknown`,允许任意形态(对象/数组)。

**收紧候选**:`TextNodeAtoms = DriverSerialized`,直接类型守门写读路径形态。

**为什么本次不做**:
- 需要 canvas-rendering/types.ts 从 `@capabilities/text-editing/types` import
  DriverSerialized 类型,引入 capability 间循环依赖风险(canvas-rendering 是
  text-editing 的下游?需要 grep dependency tree 确认)
- 本次修法范围严格守"4 处" — 类型收紧扩到第 5 处,违反纪律
- 留 sub-phase 3a-N+ / B3.X 时统一处理

**优先级**:P3 — 留独立 issue。

### Q-3 — 历史脏 pm atom 清理

**字面**:实验 1 写出来的空 pm atom(`01KRFVJB8AP3RA2VA6J9FMWCZV`)+ 用户之前实测
过程中可能产生的空 pm atom 仍在数据库。

**影响**:
- 不影响修复正确性(下次 user save 会 putAtom UPSERT 覆盖)
- 影响 binary verify 场景 ③ 数据库实证 — 老 pm atom content 仍是空,需要查 `ORDER BY updatedAt DESC` 拿最新

**处理**:本 hotfix 不主动清理(无 reproducer 风险 + 用户重启后自然覆盖)。

---

## 10. 反向更新清单

合 main 后必须更新以下决议链:

### 10.1 `decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md`

§12.X 链下游(decision 017 之后)加 P0d 偏离登记:

| 偏离点 | 设计文档原写法 | 实际实施 | 原因 |
|---|---|---|---|
| **§3.4 / §3.5.x pmContentCapability 写读路径** | inst.doc 形态隐式默认 V1 NoteView Atom[](unknown[]) | **DriverSerialized 信封对象**(view 端 G4-2=B 路径透传) | view 端契约从 sub-phase 3a-1 起就是 DriverSerialized 全程透传,但 store 端跟旧 V1 形态对齐 → 写路径 fallback 写空 doc;decision 018 修复 |

§12 教训表加一行:**P1 教训第 7 次** — "view ↔ store 边界形态契约必须一次性对齐
全链路(读 / 写 / 新建初始化 / 类型签名 4 个口子都不能漏);只对齐一端会被 fallback
路径吞掉真实数据。"

### 10.2 `decisions/017-storage-persistence-hotfix.md`

§12.5 "P0d 新发现"占位条目改成"P0d 已修复(decision 018)"+ 引用 018 文档。

§12 链下游加:`2026-05-13 hotfix 018 — sub-phase 3a-1 text-node doc sync 修复`。

### 10.3 `L7-next-phase-kickoff.md`

§1.4 P0d 占位条目改成"P0d 已修复(decision 018)"+ 引用 018。

### 10.4 `surreal-schema.md` / `data-model/README.md`(若引用了 pm atom 形态)

如有"text-node pm atom payload = PM content 数组"字面表述,改为"DriverSerialized
信封 payload = PmPayload"。无引用则不动。

---

## 12. 实施实际情况(填写于实施后)

### 12.1 Commit hash

**实施 commits**(5 个):

- `2a203e2` — fix(graph/types): TextNodeAtoms unknown[] → unknown — P0d 类型契约对齐
- `f4bc441` — fix(graph/canvas-store): incomingDocToPmPayload 识别 DriverSerialized — 修 P0d 写路径
- `8659715` — fix(graph/canvas-store): get text-node instance.doc 返 DriverSerialized — 对齐读路径形态
- `db046fb` — fix(graph/canvas/interaction): 新建 text-node instance.doc 初始化空 DriverSerialized — 形态对齐
- `724cbbd` — docs(decision 018): P0d canvas text-node doc sync hotfix 决议

**merge main 拉 P0a-bis**(1 个,无 conflict):

- `7104ad9` — Merge branch 'main' into fix/canvas-text-node-doc-sync(拉 P0a-bis K1+K2+K3+K4 三层防线 + 017 反向更新链)

**反向更新 commits**(4 个,binary verify PASS 后,合 main 前):

- `7469853` — 反向更新 014 §12.11 + §12.12:DriverSerialized 透传引入 P0d + P1 第 8 次教训
- `3b8bcff` — 反向更新 017 §12.8:P0d binary verify 暴露 P0a-bis + P0d 恢复路径
- (本 commit)— 反向更新 018 §12.X 标实施完成 + binary verify 场景 ① 三层实证
- (后续)— 反向更新 019 §12.X + L7 启动包

### 12.2 静态验证结果

- TypeScript:`npx tsc --noEmit -p tsconfig.json` — 无输出(pass)
- ESLint:`npx eslint src/capabilities/canvas-rendering/types.ts src/capabilities/canvas-rendering/interaction/InteractionController.ts src/platform/main/graph/canvas-store.ts` — 无 warning / error(pass;仅有 1 条 eslint.config.js MODULE_TYPELESS_PACKAGE_JSON 工具自身 warning,与本次修改无关)
- grep verify:view 端字面消费 `inst.doc` 的所有位置(NodeRenderer.ts:481 透传给 atomBridge / GraphCanvasView.tsx:252 透传给 enterEdit / InteractionController.ts:725-732 新建初始化)— 全部已对齐 DriverSerialized 信封形态
- merge main(`7104ad9`)后再跑 `npx tsc --noEmit` + 三文件 lint — 全部 0 错(P0a-bis 与 P0d 字面位置不重叠,自动合并无回归)

### 12.3 Binary verify 结果 — ✅ 场景 ① 三层实证 PASS(2026-05-13)

**总指挥拍板 A**:场景 ② / ③ 跳过(场景 ① 已覆盖核心 + update 路径等价覆盖 + K1 + self-check 兼容)。

**场景 ① — create + 跨重启**:

| 实证层 | 字面证据 |
|---|---|
| 屏幕层 | 用户报告 text-node "123-abc*abc" 字面可见 |
| HTTP query 层 | pm atom `01KRGRZ70S0G50K04W4338V7PN` content = `[{type:'paragraph', attrs:{isTitle:false}, content:[{type:'text', text:'123-abc*abc'}]}]` 跨重启完整保留 |
| 等价覆盖路径 | updatedAt > createdAt 1500+ 秒(view 端 readback 触发 save),但 content **未被覆盖空** → 等价覆盖场景 ② update 路径 |

→ P0d 修法字面完整生效:写路径 `incomingDocToPmPayload` 识别 DriverSerialized + 读路径 `instanceAtomToObject` 返 DriverSerialized + 新建路径初始化空 DriverSerialized 三处都已生效。

**附加 verify(P0a-bis 兼容)**:

- **K1 ULID 兼容**:新 text-node id = `01KRGRZ60YKYJHQ3V2PWRB4C90`(26 字符 ULID,非 i-XXX)
- **K3 self-check 兼容**:启动 self-check 输出
  ```
  [storage/cardinality-check] user:krig:inCanvas: scanned 3 edges, found 0 violations, cleaned 0 stale edges
  [storage/cardinality-check] user:krig:hasContent: scanned 2 edges, found 0 violations, cleaned 0 stale edges
  ```
- **启动 latency**:596ms 不退化

### 12.4 用户报告 listNotes 误列观察(2026-05-13,非 P0d 范围)

binary verify 期间用户截图发现 graph text-node 内容(刚输入的 "123-abc*abc")**误列在 note 列表里** — 这正是 sub-phase 3a-2.5([decision 016 §1.1 + §6.2.4](016-sub-phase-3a-2.5-note-form-upgrade.md))要修的 bug,**不属于 P0d 范围**。

**根因**:sub-phase 2 noteCapability `listNotes` 假设所有 `pm` domain atom = note,sub-phase 3a-1 引入 graph text-node 共享 pm domain 后,`listNotes` 会误列 text-node 的 pm atom 为"note"。

**P0d 修法本职是 text-node 内容写入正确性**(已通过),listNotes 误列由 sub-phase 3a-2.5 合 main 后通过 `hasNoteView` 边形态升级修复(只列有 `hasNoteView` 边的 pm atom 为 note)。

**当前状态**:L7 启动包 §1.4 字面已挂"noteCapability listNotes 误列 text-node pm atom" Open Question 占位,等 sub-phase 3a-2.5 合 main 后清掉。

### 12.5 反向更新清单 — ✅ 完成

| # | 文件 | 字面 | 状态 |
|---|---|---|---|
| 1 | [decision 014 §12.11 + §12.12](014-sub-phase-3a-1-graph-canvas-instance-migration.md) | DriverSerialized 透传契约引入 P0d + P1 第 8 次教训 | ✅ commit `7469853` |
| 2 | [decision 017 §12.8](017-storage-persistence-hotfix.md) | P0d binary verify 暴露 P0a-bis + P0d 恢复路径 | ✅ commit `3b8bcff` |
| 3 | 本决议 018 §12.X | 标实施完成 + binary verify 场景 ① + listNotes 误列 + P0a-bis 兼容 | ✅(本 commit) |
| 4 | [decision 019 §12.X](019-graph-instance-cardinality-hotfix.md) | P0a-bis K1 ULID + K3 self-check 兼容 P0d 修法 | 待落 |
| 5 | L7 启动包 §1.4 | P0d ✅ 已修(去掉占位) | 待落 |

### 12.6 链下游 — listNotes 误列由 sub-phase 3a-2.5 修复(2026-05-13)

§12.4 字面预告的 "graph text-node 内容误列在 note 列表里" 现象,sub-phase 3a-2.5
合 main 后通过 `hasNoteView` 边形态升级修复完成。

**修复决议**:[decision 016](016-sub-phase-3a-2.5-note-form-upgrade.md) — note 形态从
"pm atom = note" 升级到 "pm atom + `user:krig:hasNoteView` 边 = note"。

**核心 binary verify**(decision 016 §12.4 §6.2.4):
- 4 个 graph text-node pm atom 字面**零 hasNoteView 边**
- 4 个 hasNoteView 边都指向真正的 note pm atom(零 hasContent 入边)
- listNotes 返 4 / graph text-node 隔离 4 / **完全互不污染**

**跨 hotfix 链完整闭环**(017 + 018 + 019 + sub-phase 3a-2.5):
- P0d 修法本职 text-node 内容写入正确性 ✅(本决议)
- P0a-bis 修法 inCanvas cardinality ✅(decision 019)
- sub-phase 3a-2.5 修法 note 形态升级 ✅(decision 016)
- 三层共同覆盖 sub-phase 3a-1 三个漏机制(DriverSerialized 错位 / cardinality 漏 / listNotes 误列)

L7 启动包 §1.4 字面 "noteCapability listNotes 误列 text-node pm atom" Open Question
占位:✅ 已修(随 sub-phase 3a-2.5 合 main)。

---

## 13. P1 教训第 7 次记录

**教训字面**:view ↔ store 边界形态契约必须一次性对齐全链路 — 读 / 写 / 新建初始化
/ 类型签名 4 个口子都不能漏;只对齐一端会被静默 fallback 路径吞掉真实数据。

**触发背景**:sub-phase 3a-1 引入 text-node 时,view 端按 B3 plan v0.2 路径 A
"G4-2=B" 走 DriverSerialized 全程透传,但 store 端 incomingDocToPmPayload 注释字面
仍写"incoming.doc 是 TextNodeAtoms = unknown[]"(V1 形态)— 形态错位埋了 ~2 个月,
直到 decision 017 binary verify 场景外 user 报"text-node 文字消失"才暴露。

**与 P0c 静默 catch 教训的关联**:`Array.isArray(对象) === false → 兜底空数组`
是 P0c 反向版本(吞错没 warn,但是用空 fallback 隐藏问题)。本次修法加 warn 不静默 —
未来契约破裂会立即暴露,不再依赖用户重启实测才发现。

**预防 checklist**(后续 sub-phase 边界类型字段引入时必跑):
1. grep view 端字面消费该字段的所有位置,确认形态契约
2. grep store 端字面读写该字段的所有位置,确认形态契约
3. 跑一次 binary 实测(用户输入 → 直查库)对齐形态
4. 类型签名是否能严格守门(unknown vs 严格类型)— 严格 > 放宽 > unknown

写入 L7 启动包 §1.5 教训库。
