# KRIG-Note V2 目录结构(顶层)

> v0.2 · 2026-05-03
>
> 配套文档:[charter.md](./charter.md)
>
> **设计原则**:分层写。本文档仅定义 src/ 第一层(9 目录)及其职责契约——**冻结不变**。
> 各目录内部子结构在那一层真实现时再详细设计(单独文档,如 `directory-structure-platform.md`)。

---

## 0. 为什么分层写

V1 教训:目录设计如果一次性把所有细节定下来,会"为不存在的未来需求过度规划"。等真做时,大部分子结构需要修订,文档反复返工。

V2 改用**分层写 + 决策延迟**:
- **第一层(本文档)**:9 个顶层目录 + 职责契约 + 屏障约束 — 冻结不变
- **第二层及以下**(各目录内部):那一层真要实现时才设计,写在独立 `directory-structure-<目录名>.md`

这样:
- 第一层的契约保持稳定 — 屏障原则、注册原则、分层原则物理落地
- 子目录细化跟随 [charter.md § 6 节奏规则](./charter.md) — 一层一阶段,完成才进下一层

---

## 1. 第一层目录(9 个,冻结不变)

```
src/
├── views/          ← 纵向:可视化层(L5 视图主体)
├── capabilities/   ← 纵向:能力层(npm 屏障)
├── semantic/       ← 纵向:语义层(纯类型)
├── storage/        ← 纵向:存储层(SurrealDB)
├── platform/       ← 横向:L0 应用层 + L1 窗口层(Electron 进程入口)
├── shell/          ← 横向:L2 Shell 层(三栏布局 + Slot 容器)
├── workspace/      ← 横向:L3 Workspace 层(WorkMode 状态)
├── slot/           ← 横向:L4 Slot 层(Registry 基础设施)
└── shared/         ← 跨进程共享(IPC 契约 + 共享类型)
```

### 1.1 各目录职责契约

| 目录 | 纵向类目 | 横向 L 层 | 职责 |
|---|---|---|---|
| `views/` | 可视化层 | L5 | 视图主体,纯声明,通过 install 列表使用能力 |
| `capabilities/` | 能力层 | 跨 L0~L5 | 互操作能力的抽象,封装外部 npm 依赖 |
| `semantic/` | 语义层 | 跨 L0~L5 | Atom + block + intents 等纯类型,跨进程共享 |
| `storage/` | 存储层 | L0(主进程) | SurrealDB 持久化,IPC handlers |
| `platform/` | 跨纵向(基础) | L0 + L1 | Electron 进程入口,主窗口管理,IPC 总线 |
| `shell/` | 可视化层 | L2 | 三栏布局骨架,Slot 容器机制 |
| `workspace/` | 能力层(状态) | L3 | WorkMode 实例,Workspace 状态(activeViewId / pluginStates) |
| `slot/` | 能力层(Registry) | L4 | ViewType / Capability / Command / 五大交互 Registry |
| `shared/` | 跨纵向(共享) | 跨 L0~L5 | main / renderer 共享类型,IPC channel 名,常量 |

### 1.2 屏障原则的物理体现

```
═══════════ npm 业务依赖屏障 ═══════════
   views/      ← 0 处业务 npm
   shell/      ← 0 处业务 npm
   workspace/  ← 0 处业务 npm
   slot/       ← 0 处业务 npm
═══════════ npm 业务依赖屏障 ═══════════
   capabilities/  ← 唯一允许业务 npm 的位置
   storage/       ← 唯一允许 SurrealDB SDK
   platform/      ← 唯一允许 Electron 主进程 / renderer 入口 API
   semantic/      ← 0 npm 业务包(纯类型)
   shared/        ← 0 npm 业务包(纯类型 + 常量)
```

**ESLint 自检规则按这 4+5 层级编写**(详见 § 4)。

---

## 2. 文件命名规范

### 2.1 目录命名 — kebab-case

```
✅ src/capabilities/text-editing/
✅ src/views/note/
✅ src/storage/surreal-client/

❌ src/capabilities/TextEditing/
❌ src/views/Note/
```

### 2.2 文件命名

- **TypeScript 模块**:`kebab-case.ts`(如 `atom-types.ts`)
- **React 组件**:`PascalCase.tsx`(如 `ShellLayout.tsx`)
- **类型纯文件**:`kebab-case.types.ts`(可选,推荐)
- **索引/入口**:`index.ts` / `index.tsx`

### 2.3 函数 / 类型命名 — camelCase / PascalCase

```ts
// camelCase 函数 / 变量
export function registerView(def: ViewDefinition) {}
const blockRegistry = new Registry();

// PascalCase 类型 / 类
export interface ViewDefinition {}
export class CapabilityRegistry {}
```

---

## 3. TypeScript Path Alias

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@views/*":        ["src/views/*"],
      "@capabilities/*": ["src/capabilities/*"],
      "@semantic/*":     ["src/semantic/*"],
      "@storage/*":      ["src/storage/*"],
      "@platform/*":     ["src/platform/*"],
      "@shell/*":        ["src/shell/*"],
      "@workspace/*":    ["src/workspace/*"],
      "@slot/*":         ["src/slot/*"],
      "@shared/*":       ["src/shared/*"]
    }
  }
}
```

**使用例**:

```ts
// src/views/note/index.ts
import { registerView } from '@slot/view-type-registry/register-view';
import type { Atom } from '@semantic/atom/atom-types';
```

---

## 4. ESLint 屏障规则

`eslint.config.js` 关键 overrides:

```js
overrides: [
  // 屏障层 1:可视化相关层(views / shell)零业务 npm import
  {
    files: ['src/views/**', 'src/shell/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*'], message: '使用 capability(具体哪个能力等真实现时定)' },
          { group: ['three', 'three/*'], message: '使用 capability(具体哪个能力等真实现时定)' },
          { group: ['pdfjs-dist'], message: '使用 capability' },
          { group: ['epubjs', 'foliate-js'], message: '使用 capability' },
          { group: ['electron'], message: 'Electron API 必须经能力层封装' },
        ],
      }],
    },
  },
  // 屏障层 2:Workspace / Slot 层零业务 npm import
  {
    files: ['src/workspace/**', 'src/slot/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs', 'foliate-js'],
            message: '基础设施层禁止 import 业务 npm 包' },
        ],
      }],
    },
  },
  // 存储层只允许 surrealdb
  {
    files: ['src/storage/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs', 'foliate-js', 'react'],
            message: '存储层只允许 surrealdb + 内部模块' },
        ],
      }],
    },
  },
  // 语义 / 共享层只允许纯类型
  {
    files: ['src/semantic/**', 'src/shared/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['*'],
            message: '语义层 / 共享层只允许 import 同层内部模块,不允许任何 npm 包' },
        ],
      }],
    },
  },
  // capabilities 是唯一允许业务 npm 的位置(无限制)
];
```

**CI 卡死**:任何违规 = CI 失败,无法 merge。

---

## 5. 子目录设计原则(分层写 + 文档与代码同位)

第一层目录冻结后,**各目录内部子结构在真要实现那一层时再设计**。

### 5.1 文档归位原则

按"文档与代码同位"原则,V2 不同类型文档分别归位到不同位置:

| 文档类型 | 归位 | 理由 |
|---|---|---|
| **跨层纲领**(charter / vision / directory-structure 等) | `docs/00-architecture/` | 不属于任何单一层 |
| **业务领域设计**(note / block / graph 等业务概念) | `docs/10-business-design/` | 跨层,按业务组织 |
| **V1 历史归档** | `docs/99-archive-v1/` | 不动 |
| **阶段实施报告**(L0~L5 完成报告) | `docs/RefactorV2/stages/` | 按时间序,不按层 |
| **每层 README**(快速说明) | `src/<层>/README.md` | 与代码同位 |
| **每层 DESIGN**(详细设计) | `src/<层>/DESIGN.md` | 与代码同位,改代码时强制同步 |
| **每个模块 DESIGN**(NoteView / 某能力等) | `src/<层>/<模块>/DESIGN.md` | 同上 |

**核心命题**:**架构性文档 → docs/(跨层、跨时间)** + **代码相关文档 → src/(与代码同位)**。

### 5.2 src/<层>/README.md 内容要求

每个第一层目录至少有 README,内容:
- 该层做什么(职责契约)
- 屏障约束
- 子目录划分(指向 DESIGN.md 详述)
- 当前状态 + 下一步什么时候扩展

### 5.3 src/<层>/DESIGN.md 内容要求

那一层真要实现时写:
- 子目录详细划分(及理由)
- 文件命名约定(如有特殊约定)
- 内部模块依赖关系
- 与其他层的接口契约
- 屏障约束的具体落地(如有)

### 5.4 src/<层>/<模块>/DESIGN.md(可选)

具体模块实现时写,如:
- `src/views/note/DESIGN.md` — NoteView 详细设计(在 L5 NoteView 阶段写)
- `src/capabilities/text-editing/DESIGN.md` — text-editing 能力详细设计(实现该能力时写)

### 5.5 阶段实施报告

每个 L 阶段(L0~L5)完成时,在 `docs/RefactorV2/stages/` 内写一份 `L<n>-<name>-completion.md`,内容详见 `docs/RefactorV2/README.md`。

不与 src/<层>/DESIGN.md 重复——前者是"实施过程记录"(用户可感知验证 / 完成判据 / 遗留问题),后者是"架构设计稳定文档"(那一层的设计契约)。

---

## 6. 与 V1 目录的对应(简略,详细对应等迁移时定)

| V1 → V2 主要映射 |
|---|
| V1 `src/main/` → V2 `src/platform/main/` + `src/storage/`(部分迁移) |
| V1 `src/renderer/` → V2 `src/platform/renderer/` + `src/views/`(部分迁移) |
| V1 `src/renderer/shell/` → V2 `src/shell/` |
| V1 `src/main/workspace/` → V2 `src/workspace/` |
| V1 `src/renderer/ui-primitives/` → V2 `src/slot/` |
| V1 `src/plugins/<X>/` → V2 `src/views/<x>/` + `src/capabilities/<x-related>/`(每个 plugin 拆分到能力层) |
| V1 `src/shared/` → V2 `src/shared/` + `src/semantic/`(纯类型迁移到 semantic) |

详细映射在每个 V2 目录实现时,在对应 `directory-structure-<x>.md` 中给出。

---

## 7. 待拍板

无(第一层 9 目录已冻结)。

各子目录的待拍板项,在对应 `directory-structure-<x>.md` 真要写时再列。

---

## 8. 修订记录

| 日期 | 版本 | 内容 | 作者 |
|---|---|---|---|
| 2026-05-03 | v0.1 | 初稿;详细描述 9 个第一层 + 各目录内部子结构(views / capabilities 3 类 / semantic / storage / platform / shell / workspace / slot / shared 各自 sub-tree)+ 与 V1 目录详细对应 — 备份为 `_archive_directory-structure-v0.1-detailed.md` 供未来真实现时参考 | wenwu + Claude |
| 2026-05-03 | v0.2 | 重写,大幅简化;采用"分层写"原则——本文档仅定义第一层 9 目录 + 职责契约 + 屏障 + 命名 + path alias + ESLint;子目录细节移到独立 `directory-structure-<x>.md`(那一层真实现时再写);v0.1 详细子结构归档为 `_archive_` 文件 | wenwu + Claude |
| 2026-05-03 | v0.3 | § 5 重构;采用"文档与代码同位 + 阶段记录单独存放"混合方案;层级 README/DESIGN 改放 `src/<层>/` 内(与代码同位),取代之前"放 docs/00-architecture/" 的安排;新建 `docs/RefactorV2/stages/` 存放阶段实施报告 | wenwu + Claude |

---

## 附录:v0.1 详细版归档

v0.1 含详细子目录设计,**已归档** `_archive_directory-structure-v0.1-detailed.md`。

参考用途:
- 等真实现某一层时,可查阅 v0.1 对应章节作起点参考
- 不强制照抄(v0.1 是猜测,真实现时按当时需求定)
- v0.1 中提及的 18+ block / N 个 shape / line / substance 不一定全做,按需选

**v0.1 → 当前层级实现的决策延迟到那时**。
