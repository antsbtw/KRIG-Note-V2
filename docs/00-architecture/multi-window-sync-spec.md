# 多窗口数据同步规范 v1.0

> 状态：设计已定，Phase 0 待实施  
> 作者：架构讨论 2026-07-22  
> 关联：multi-window-process-isolation.md、reliability-charter.md

---

## 一、设计目标

每个窗口（workspace）是一个**严格独立的操作空间**：

- 独立的网络环境（proxy / UA / cookie partition）
- 独立的 UI 状态（当前打开的笔记、布局）
- 独立的编辑副本（本地持有，保存时与数据库协调）

多窗口、未来多终端、未来多用户，共用同一套 merge 引擎，只需扩展操作者标识维度。

---

## 二、已完成的隔离层

| 层 | 机制 | 状态 |
|---|---|---|
| 网络/环境层 | `persist:webview-${wsId}` partition per-ws | ✅ 已完成 |
| UI/状态层 | `pluginStates['note'].activeNoteId` per-ws | ✅ 已完成 |
| 窗口身份层 | 主进程显式给每个窗口（含首窗口）传入 wsId | ✅ 已完成 |
| 数据层 | block-hash merge | 📋 本规范覆盖，待实施 |

---

## 三、数据结构设计

### 3.1 ClientIdentity（设备身份）

```typescript
// 存储位置：localStorage key = 'krig.clientId'
// 生成时机：app 首次启动，此后持久化
interface ClientIdentity {
  clientId: string;   // ULID，设备唯一，永不变更
  // 多用户扩展时追加：
  // userId: string;
  // displayName: string;
  // avatarUrl?: string;
}
```

### 3.2 BlockAtom 扩展字段

在现有 AtomEntity 基础上追加（存入 SurrealDB atom payload）：

```typescript
interface BlockAtomSyncMeta {
  blockHash: string;            // 该 block 内容的 SHA-1（16进制，40字符）
  lastEditedBy: string;         // clientId（多用户时升级为 userId）
  lastEditedBySession: string;  // wsId（多用户时升级为 sessionId）
  lastEditedAt: number;         // 毫秒时间戳（与 updatedAt 同步）
}
```

### 3.3 NoteContainer 扩展字段

在 note container atom payload 追加：

```typescript
interface NoteContainerSyncMeta {
  docVersion: number;   // 单调递增整数，每次成功写库 +1，初始值 1
  docHash: string;      // 所有 blockHash 排序后拼接的 SHA-1（快速全文检测）
}
```

### 3.4 NoteBaseSnapshot（内存，不持久化）

每个窗口打开笔记时在内存中保存快照，窗口关闭后释放：

```typescript
interface NoteBaseSnapshot {
  noteId: string;
  docVersion: number;               // 打开时的版本号
  docHash: string;                  // 打开时的全文 hash
  blockHashes: Map<string, string>; // blockId → blockHash，打开时快照
  openedAt: number;                 // 打开时间戳（离线超时判断用）
  openedBySession: string;          // wsId（轮询时排除自己）
}
```

---

## 四、保存流程

```
窗口保存笔记时：

Step 1：计算本窗口当前状态
  changedBlocks = diff(当前 blockHashes, baseSnapshot.blockHashes)
  若 changedBlocks 为空 → 无需保存，退出

Step 2：检测并发
  从数据库拉取当前 docVersion 和 docHash
  若 docHash == baseSnapshot.docHash → 无并发写 → 直接写全量，版本 +1，结束

Step 3：Block 级 Merge（有并发写时）
  从数据库拉取当前 blockHashes（逐 block）
  对每个 changedBlock：
    db[block] == base[block]  → 只有本窗口改了 → 写本窗口版本
    db[block] != base[block]  → 冲突（数据库和本窗口都改了）→ 进入 Step 4

Step 4：冲突处理
  自动可合并部分先写入
  冲突 block 提示用户选择（展示两个版本的内容片段）
  用户选择后进入 Step 5

Step 5：带乐观锁写入
  写库时携带 expectedVersion = 读到的 docVersion
  若数据库 docVersion 已变（Step 4 期间又有写入）→ 回到 Step 3 重算
  写成功 → docVersion +1，更新 docHash

Step 6：广播
  广播新的 blockHashes 给所有其他窗口
  其他窗口收到后更新自己的 baseSnapshot（不覆盖本地编辑内容）
```

---

## 五、新增 / 删除 Block 的处理

| 操作 | 处理策略 |
|---|---|
| 本窗口新增 block | db 中无此 blockId → 直接插入，无冲突 |
| 本窗口删除 block，其他窗口未改该 block | db 中该 block 与 base 一致 → 执行删除 |
| 本窗口删除 block，其他窗口已修改该 block | 冲突：提示用户"该 block 在其他窗口有编辑，确认删除？" |
| 两个窗口同时新增 block | blockId 用 ULID 生成，概率碰撞 `1/2^80`，忽略不计 |

---

## 六、BlockId 生成规范

使用 **ULID（Universally Unique Lexicographically Sortable Identifier）**：

- 48 bit 毫秒时间戳 + 80 bit 随机数
- 每个 renderer 进程持有独立的 `monotonicFactory()`，同进程内严格单调
- 跨进程、跨设备碰撞概率 `1/2^80`（≈10^-24），分布式安全，无需协调
- **结论：不需要中心化 ID 分配，现有 ULID 方案已覆盖多窗口和多终端场景**

---

## 七、操作者标识演进路径

| 阶段 | `lastEditedBy` 值 | `lastEditedBySession` 值 | 冲突提示文案 |
|---|---|---|---|
| 单用户多窗口（当前）| `clientId`（设备ID）| `wsId`（窗口ID）| "窗口 A 有未同步的编辑" |
| 单用户多终端（未来）| `clientId`（设备ID）| `wsId` | "设备 MacBook Pro 有未同步的编辑" |
| 多用户（未来）| `userId`（账号ID）| `sessionId` | "用户 Alice 有未同步的编辑" |

**演进只需扩展 `lastEditedBy` 的解析逻辑，不需要改 merge 引擎本身。**

---

## 八、实施分阶段

### Phase 0 — 基础设施 ✅ 已完成（2026-07-22）
- [x] 建立 `clientId`：`src/shared/client-identity.ts`，读 localStorage `krig.clientId`，首次生成 ULID
- [x] block atom 加 `blockHash` / `lastEditedBy` / `lastEditedBySession` / `lastEditedAt`
- [x] note container 加 `docVersion` / `docHash`
- [x] `getNote` 返回时带 `docVersion` + `blockHashes`
- [x] 打开笔记时保存 `NoteBaseSnapshot`（内存，per-wsId Map）
- [x] 写库成功后更新 `baseSnapshot`

### Phase 1 — Merge 引擎 ✅ 已完成（2026-07-22）
- [x] 保存时 diff changedBlocks（`computeCurrentBlockHashes` + `stripSyncMeta`）
- [x] 检测 docHash，无并发直接写
- [x] 有并发时做 block 级自动 merge，冲突 block last-write-wins + `[sync/conflict]` warn
- [x] 带乐观锁（`expectedVersion`）写库，冲突时最多重试 3 次，超过 fail loud
- [x] 写成功后广播 `NOTE_BASE_SNAPSHOT_UPDATED`，其他窗口更新 baseSnapshot 基线
- [x] `getNoteVersionInfo` 轻量接口（不 assemble 全文，比 `getNote` 快 10x）

### Phase 2 — 冲突 UI（暂缓，待用户反馈后立项）

**触发条件**：两个窗口同时打开同一篇笔记，且恰好编辑了同一个 block，且保存时机有交叠。概率极低，Phase 1 的 last-write-wins + warn 已覆盖大多数场景。

**需要实现的内容**：
- [ ] 冲突检测后暂停写入，弹出冲突面板（不再 last-write-wins）
- [ ] 面板展示冲突 block 的两个版本：「本窗口版本」vs「数据库版本（来自哪个窗口/设备）」
- [ ] 用户操作：「用我的」/ 「用对方的」（手动合并 Phase 2.5 再做）
- [ ] 删除冲突确认：本窗口删了某 block，但数据库里该 block 已被另一窗口修改
- [ ] 冲突面板关闭后继续写入流程（带乐观锁重试）

**设计约束**：
- 冲突面板不阻塞其他 block 的写入，只暂存冲突 block
- 用户选择后仍走乐观锁写入路径，不绕过 Phase 1 的 merge 引擎
- `lastEditedBy` / `lastEditedBySession` 字段（Phase 0 已写入）用于显示「来自哪个窗口」

### Phase 3 — 多终端扩展（暂缓，待多终端架构立项后处理）

**前置条件**：需要服务端 + 账号体系支持，依赖授权/计费架构（见 project-auth-billing-architecture.md）。

**需要实现的内容**：
- [ ] `baseSnapshot` 有效期：离线超过 N 小时后重连，强制 rebase（拉最新版本重建基线）
- [ ] 重连后的 merge 策略：离线期间本地积累的 changedBlocks 与服务端版本做全量 diff
- [ ] 服务端 push 替代本地广播：`NOTE_BASE_SNAPSHOT_UPDATED` 改由服务端推送给所有在线设备
- [ ] `clientId` 与账号绑定：设备注册，`lastEditedBy` 从 clientId 升级为 userId

---

## 九、不变量（铁律）

1. **每个窗口必须有明确的 wsId**，主进程在创建窗口时显式传入，不允许 renderer 侧用 `activeId` 兜底
2. **blockId 由 renderer 生成（ULID）**，不由数据库分配，保证离线可用
3. **写库必须带 `expectedVersion`**（Phase 1 起），冲突时 fail loud，不静默覆盖
4. **`baseSnapshot` 仅在内存中**，不持久化，窗口关闭即释放
5. **merge 引擎不感知业务语义**，只比对 blockHash，业务解释由上层处理
