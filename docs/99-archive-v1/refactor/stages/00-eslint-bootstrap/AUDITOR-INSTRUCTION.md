# Auditor 审计指令 — 阶段 00：ESLint Bootstrap

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入（按顺序读全文）

1. **本目录文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — 完成判据 J0~J7 + 严禁顺手做（你审计的对账标尺）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**（你不需要知道 Builder 怎么干，只需要看它干了什么）

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出（必读）**：
   - `tmp/builder-report.md` — Builder 自检报告
   - `git diff main...refactor/eslint-bootstrap` — 完整代码 diff
   - `git log main..refactor/eslint-bootstrap --oneline` — Builder 的 commit 列表

## 二、本次审计核心要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/eslint-bootstrap` |
| 审计阶段 | **基础设施类前置波次**（不是 Step A、不是 Step B）—— 用 J0~J7 完成判据对账 |
| 功能契约 | **N/A**（跳过 AUDITOR-PROMPT § 三 B 节"功能契约保留"） |
| 关键审计点 | A 段总纲合规 + 完成判据 J0~J7 逐条核验 + 范围越界检查（**不写项目规则、不动业务代码**） |

## 三、特别关注（本阶段独有）

### 关注点 1：J2 文件内容字节级对账

`eslint.config.mjs` 必须**字节级匹配** task-card § J2 给出的代码块。审计步骤：

1. Read `eslint.config.mjs`
2. Read `docs/refactor/stages/00-eslint-bootstrap/task-card.md` § J2 代码块
3. 逐字符对照（除尾行换行外）

**如有任何字符不一致 = ❌**——即便 Builder 解释"我改得更好"也不接受。

### 关注点 2：范围越界——绝对不允许动业务代码

本阶段**只允许**动以下 5 个文件：
- `package.json`（J0 + J1）
- `package-lock.json`（npm install 副作用）
- `eslint.config.mjs`（J2，新建）
- `tsconfig.json`（J3）
- `.gitignore`（J4）

`git diff main...refactor/eslint-bootstrap --stat` **绝不允许**出现：
- `src/**` 任何文件
- `CLAUDE.md`
- `tools/**` 任何文件
- `docs/**` 任何文件（除非 Builder 在 cards 里漏了状态字段更新等微小变更，需 Builder 在 F 段说明）

任何超出上述 5 个文件 = ❌

### 关注点 3：禁止"顺手"添加项目规则

`eslint.config.mjs` 中**不能出现**任何针对 KRIG 业务的规则，特别是：
- `no-restricted-imports` 含 `openCompanion` / `closeRightSlot` 等关键词
- `no-restricted-paths` 含 `plugins` / `engine` 等
- 自定义 KRIG 规则

**只允许**出现 task-card § J2 字面给出的 4 条 "off" 降噪规则。任何超出 = ❌

阶段 01 才写项目规则——Builder 不允许顺手做。

### 关注点 4：J0 版本号检查

- `package.json` `devDependencies.eslint` 必须以 `^9` 或 `~9` 开头（不允许 `^8.x`）
- `package.json` `devDependencies.typescript-eslint` 必须 ≥ `^8`
- `package-lock.json` 中实际安装的 `eslint` 主版本必须是 9

### 关注点 5：J5 验证证据

Builder 报告 A 段必须给出 J5a/J5b/J5c 的具体命令输出。审计员**自己重跑一次**确认（不属于"写代码"，是 read-only 验证）：

```bash
git checkout refactor/eslint-bootstrap
npm run lint 2>&1 | head -20    # 看是否 crash
echo "lint exit: $?"
npm run typecheck 2>&1 | head -20
echo "typecheck exit: $?"
```

退出码与 Builder 报告对账。

### 关注点 6：原有 scripts 保留

`package.json` `scripts` 字段中**必须保留** start / package / make / postinstall / build:fonts 5 条原有 script。**仅新增** lint 和 typecheck，**不允许**修改、删除任何已有 script。

### 关注点 7：tsconfig 仅一处改动

`tsconfig.json` 改动**仅限** `include` 字段从 `["src/**/*"]` → `["src/**/*", "tools/**/*"]`。任何其他字段（compilerOptions / exclude / 等）改动 = ❌。

## 四、审计输出（写入 `tmp/auditor-report.md`）

严格按 AUDITOR-PROMPT § 四"输出格式"。要点：

- **B 段（功能契约保留）填"N/A 基础设施类前置波次"**
- **D 段（Step B 合规）跳过**——本阶段非 Step B
- **C 段（Step A 纯度）借用语义**——把"任何 .ts/.tsx 业务代码改动 = 0"作为 C1
- **总评**只能是：通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 commit message / Builder 解释说服——**只看代码 + task-card**
- ❌ 不写代码、不修复、不建议 task-card 修订
- ❌ 不在审计中扩展讨论
- ✅ 疑议从严：grep 不到证据 = ⚠️ 或 ❌
- ✅ 验证命令（npm run lint / typecheck）自己跑一次对账 Builder 报告

---

**记住**：你的价值在于"独立、不被说服、严格对账"。审计完成立即结束会话，把判断权交还给用户。
