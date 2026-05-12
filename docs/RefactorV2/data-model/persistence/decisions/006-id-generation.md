# Decision 006 — Atom / Edge 实体 id 生成策略

> **Phase**: 3b
> **状态**: ✅ **已转正**（2026-05-12）—— ULID 推荐方案获用户拍板
> **影响**: `persistence/spec.md` + `persistence/atom-entity.md` + `persistence/edge-entity.md` + 未来 storage 层实施

---

## 0. 决议背景

V2 `persistence/spec.md` §2.1 定义 atom / edge 实体必带 `id: string` 字段，但**生成策略未决议**（标 Open Q W3 / PE4）。

本决议比选候选方案，推荐 V2 当前阶段采用的方案。

## 1. V2 当前现状

V2 当前 `note-store.ts` 实际 id 形态：

```ts
// src/views/note/note-store.ts
const newCounter = this.state.counter + 1;
const id = `note-${newCounter}`;
```

即 V1 直迁 `'note-${counter}'` 风格。**特点**：
- 单调递增 counter（renderer 进程内）
- 短可读（`'note-42'`）
- ✗ 跨进程不安全（renderer ↔ main 各自有自己的 counter，可能碰撞）
- ✗ 业务前缀绑死（`'note-'` 写死，新增 atom domain 时不通用）
- ✗ 同毫秒批量创建有碰撞风险（V1 atom-types.ts 用 `${Date.now()}-${counter}` 也是这个问题）

→ 当前形态作为 Phase 3 RFC 起点，**需要升级**。

## 2. 候选方案比选

### 候选 1：保留 V1 `${prefix}-${counter}` 风格

**形态**：`'atom-1'` / `'atom-2'` / ...

**评估**：

| 维度 | 评分 |
|---|---|
| 字符长度 | ★★★★★ 短（5-15 字符） |
| 时间戳前缀 | ✗ 无 |
| 排序友好 | ★★ 仅同进程同 counter 单调，跨进程乱 |
| 跨进程安全 | ✗ counter 进程内，跨 renderer / main 易碰撞 |
| 碰撞率 | ✗ 高（counter 重置 / 进程崩溃后） |
| 字符集 | ASCII 数字 + 连字符 |
| 实现成本 | 0（V2 已有） |

**适用场景**：单进程单用户单设备 + 数据规模小 + 不需要跨进程。

→ V2 不符合该场景（renderer + main 双进程；未来多设备）。**不推荐**。

### 候选 2：UUID v4

**形态**：`'a3bb189e-8bf9-3888-9912-ace4e6543002'`（hex + 连字符，36 字符）

**评估**：

| 维度 | 评分 |
|---|---|
| 字符长度 | ★★ 长（36 字符） |
| 时间戳前缀 | ✗ 完全随机 |
| 排序友好 | ✗ 随机分布，B-tree 索引插入开销大 |
| 跨进程安全 | ★★★★★ 标准化 |
| 碰撞率 | ★★★★★ 122-bit 熵，极低 |
| 字符集 | hex（0-9 / a-f） + 连字符 |
| 实现成本 | 低（Node.js 内置 `crypto.randomUUID()`） |

**问题**：B-tree 索引在随机 id 插入时性能退化（每次写入都触发页面分裂）。对 atom 这种高频写入场景不友好。

→ **不推荐**（除非用于完全无序的场景）。

### 候选 3：UUID v7

**形态**：`'01890d89-0c3f-7e2b-a000-1234567890ab'`（时间戳前缀 + 随机后缀，36 字符）

**评估**：

| 维度 | 评分 |
|---|---|
| 字符长度 | ★★ 长（36 字符） |
| 时间戳前缀 | ✓ 48-bit 毫秒时间戳 |
| 排序友好 | ★★★★★ 按时间单调递增 |
| 跨进程安全 | ★★★★★ |
| 碰撞率 | ★★★★★ 74-bit 随机后缀 |
| 字符集 | hex + 连字符 |
| 实现成本 | 中（Node.js 24+ 内置，旧版本需 polyfill / uuid 库） |

**优点**：B-tree 索引友好 + 时间排序 + 跨进程安全 + 业界标准（IETF RFC 9562）。

→ **强候选**，是 UUID 家族里最适合 V2 的形态。

### 候选 4：ULID

**形态**：`'01HXAB1234CDEFGHJKMNPQRSTV'`（Crockford Base32，26 字符）

**评估**：

| 维度 | 评分 |
|---|---|
| 字符长度 | ★★★★ 中短（26 字符，比 UUID 短 28%） |
| 时间戳前缀 | ✓ 48-bit 毫秒时间戳 |
| 排序友好 | ★★★★★ 词典序 = 时间序 |
| 跨进程安全 | ★★★★★ 80-bit 随机后缀 |
| 碰撞率 | ★★★★★ |
| 字符集 | Crockford Base32（去除 I / L / O / U 等易混字符，可大小写） |
| 实现成本 | 低（多个 npm 库可选，如 `ulid` / `ulidx`） |

**优点**：
- 短（26 字符 vs UUID 的 36 字符），URL / 日志友好
- Crockford Base32 字符集**无歧义字符**（I/L/O/U 排除），用户键入 / 朗读不易出错
- 词典序排序 = 时间序排序（B-tree 插入友好）
- 跟 KRIG-Note 整体"工程友好"风格一致（如 noteLink 用 `[[label]]` 而不是 UUID）

**缺点**：
- 不是 IETF 标准（虽然事实标准，多语言 SDK 完善）
- 比 UUID v7 略短（80-bit vs 74-bit 后缀，但都达到天文级别低碰撞）

### 候选 5：nanoid

**形态**：`'V1StGXR8_Z5jdHi6B-myT'`（URL-safe Base64，默认 21 字符）

**评估**：

| 维度 | 评分 |
|---|---|
| 字符长度 | ★★★★★ 最短（21 字符） |
| 时间戳前缀 | ✗ 无 |
| 排序友好 | ✗ 随机分布 |
| 跨进程安全 | ★★★★★ |
| 碰撞率 | ★★★★ |
| 字符集 | URL-safe（A-Z / a-z / 0-9 / - / _） |
| 实现成本 | 低（`nanoid` npm 包，体积极小） |

**问题**：跟 UUID v4 同样无时间戳前缀 → 排序不友好，B-tree 退化。

→ **不推荐**（除非接受牺牲排序换取最短）。

## 3. 候选对比矩阵

| 维度 | V1 counter | UUID v4 | UUID v7 | **ULID** | nanoid |
|---|---|---|---|---|---|
| 字符长度 | 5-15 | 36 | 36 | **26** | 21 |
| 时间戳前缀 | ✗ | ✗ | ✓ | **✓** | ✗ |
| 排序友好 | ✗ | ✗ | ✓ | **✓** | ✗ |
| 跨进程安全 | ✗ | ✓ | ✓ | **✓** | ✓ |
| 碰撞率 | 高 | 极低 | 极低 | **极低** | 低 |
| 字符无歧义 | ✓ | ✗ | ✗ | **✓** | ✗ |
| 业界标准化 | ✗ | RFC 4122 | RFC 9562 | **事实标准** | de facto |
| V1 数据迁移 | 直接保留 | 需 migration | 需 migration | **需 migration** | 需 migration |

## 4. 推荐方案：ULID

V2 当前阶段（Phase 3 RFC）推荐采用 **ULID**。

### 4.1 论证

**核心优点 vs 其他候选**：

1. **字符长度短**：26 字符 vs UUID 36 字符 = 节省 28% 存储 + 日志可读。
2. **词典序 = 时间序**：B-tree 索引友好，atom / edge 时间范围查询零额外排序成本。
3. **字符无歧义**：Crockford Base32 去除 I/L/O/U，肉眼不易看错。
4. **风格匹配**：跟 V2 整体"工程友好"哲学一致（noteLink / mediaId 等都偏可读）。

**vs UUID v7 的取舍**：

- UUID v7 是 IETF RFC 9562 标准（2024 年发布），未来标准化最强。
- ULID 是事实标准（GitHub 用，多语言 SDK 完善），但**非 IETF 标准**。
- **字符长度差异**：ULID 26 字符 vs UUID v7 36 字符 —— V2 场景下有意义（atom / edge 高频出现，每条边带 subject + object id 共 26+26=52 vs 36+36=72 字符）。
- **随机熵差异**：ULID 随机后缀 **80-bit**，**高于** UUID v7 的 74-bit 随机后缀。两者都远远超过实际碰撞概率所需，不构成实际差异。

→ V2 选 ULID 优先字符长度 / 可读性，**接受非 IETF 标准的代价**（多语言 SDK 完善，工具链不缺）。

### 4.2 实施细节

**npm 包**：`ulid`（或 `ulidx`）

```ts
import { ulid } from 'ulid';

const id = ulid();    // '01HXAB1234CDEFGHJKMNPQRSTV'
const id2 = ulid(Date.now());    // 显式指定时间戳（测试 / 迁移用）
```

**生成时机**：

- atom 实体写入 storage 时由 storage 层调用 `ulid()` 生成（按 [`persistence/spec.md §5.3`](../spec.md)）
- **不允许业务层指定**（按 spec PE4 决议）
- 例外：迁移 V1 数据时按"接近原 createdAt 的时间戳"生成 ULID，保持时间顺序

### 4.3 atom / edge 共用同一生成器

按 [`persistence/spec.md §3`](../spec.md) 后端中立 + 跨实体一致性：

- atom / edge 实体 id 用同一 ULID 生成器
- id 字符串前**不带类型前缀**（不写 `'atom-01HXAB...'` 也不写 `'edge-01HXAB...'`）
- 类型区分通过 storage 层表 / 字段标记（如 SurrealDB 不同 table）

**好处**：跨表 join / 关系查询时 id 形态一致，减少特殊处理。

## 5. V2 现状迁移

V2 当前 `'note-${counter}'` 风格 → ULID 的迁移：

```ts
// V2 当前
const id = `note-${counter}`;    // 'note-42'

// 升级后
const id = ulid();                // '01HXAB1234CDEFGHJKMNPQRSTV'
```

**迁移成本**：

- V2 当前无真实用户数据（按 N7 决议确认），重建即可
- 实施代码改造（noteStore.create 调 ulid 而不是 counter++）—— Phase 3 RFC 转正 + 独立 Phase 实施

**实施代码范围**（提前预告，本决议不实施）：

- `src/views/note/note-store.ts`：counter 替换为 ulid
- `src/views/note/folder-store.ts`：同上
- 其他 store（graph / ebook / 等）逐个 audit + 升级

## 6. 拒绝的方案备忘

| 方案 | 拒绝理由 |
|---|---|
| 保留 V1 counter | 跨进程不安全 + 碰撞率高 + 业务前缀绑死 |
| UUID v4 | 无时间戳 + B-tree 退化 + 字符过长 |
| UUID v7 | 字符过长（36 vs 26）；如果你强烈需要 IETF 标准化，可改用 v7 |
| nanoid | 无时间戳 + 排序不友好 |
| 复合 id（如 `${domain}-${ulid}`） | 跨表 join 需特殊处理 + 增加字符长度，不必要 |
| 业务层指定 id（如 `'note-my-special'`） | 重复 / 冲突风险 + 违反"storage 层统一生成"原则（spec §6 PE4） |

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| ID1 | ULID 大小写规范：lower / upper / mixed？ | **uppercase**（ULID 官方规范默认 uppercase；与本决议 §1 / §4.2 示例一致）。SurrealDB 字段类型按二进制存储不区分大小写敏感性，url / 文件名场景如需 lowercase 由 capability 层 toLowerCase 处理 | Phase 3 实施时确认 |
| ID2 | 是否使用 monotonic ULID（同毫秒批量生成时严格单调）？ | **使用 monotonic**（避免同毫秒批量插入碰撞） | Phase 3 实施时启用 `ulid` 包的 monotonic 模式 |
| ID3 | id 字段类型在 SurrealDB 表设计中是 `string` 还是 `record id`？ | 待 [`surreal-schema.md`](../surreal-schema.md)（Phase 3d）决议 | Phase 3d |
| ID4 | 跨平台 / 跨语言 ULID 库选择 —— `ulid` vs `ulidx` vs 其他？ | **`ulid`**（事实标准 npm 包） | Phase 3 实施时确认 |

## 8. 影响清单

如本决议获批：

1. `persistence/spec.md` §2.1 的 id 生成策略 Open Q W3 标已决议（指向本文件）
2. `persistence/atom-entity.md` §2.1 id 字段"生成策略"小节加 ULID 实施细节
3. `persistence/edge-entity.md`（Phase 3c）同步引用本决议
4. `persistence/surreal-schema.md`（Phase 3d）按 ULID 设计 id 字段
5. **未来 V2 代码改造**（独立 Phase）—— `src/storage/` 引入 `ulid` 包，所有 atom / edge id 走统一生成

## 9. 参考来源

- [ULID 规范](https://github.com/ulid/spec)
- [RFC 9562 UUID v7](https://www.rfc-editor.org/rfc/rfc9562)
- [Crockford Base32](https://www.crockford.com/base32.html)
- `npm: ulid` / `npm: ulidx`
- V1 / V2 实施现状：`src/views/note/note-store.ts`
