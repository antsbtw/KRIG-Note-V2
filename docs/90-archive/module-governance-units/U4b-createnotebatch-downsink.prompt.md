# 执行 Prompt · U4-b · CreateNoteBatch 类型下沉 shared

> 复制给新对话执行。自包含。干净类型下沉（同 U4-a 模式）。

## 任务

KRIG-Note-V2 里 `shared/ipc/electron-api.d.ts:22` import `@capabilities/note/types`（上层）→ shared
反依赖 capabilities（违规）。把 `CreateNoteBatchInput/Result/Item/Failure` 类型下沉到 shared，消除违规。

## 背景（已核实，可放心下沉）

这几个是纯数据类型（IPC 契约），依赖全部已在 shared 可达层：
- `NoteInfo` → **已在** `src/shared/ipc/note-folder-types.ts`
- `PmAtomDraft`（CreateNoteBatchItem.atoms 字段）→ `@semantic/types`（**shared 可依赖 semantic：纯类型
  leaf，无运行时，semantic 零引 shared 无循环——已确认合法**）
- 无一引 capabilities 内部逻辑。→ 干净下沉，无需「最小契约」设计。

## 步骤

1. **新建** `src/shared/ipc/note-batch-types.ts`，把这 4 个类型从 `src/capabilities/note/types.ts`
   **移动**过去（约 L27–L61 的 `CreateNoteBatchItem` / `CreateNoteBatchInput` / `CreateNoteBatchFailure` /
   `CreateNoteBatchResult`，连注释一起搬）：
   ```ts
   import type { PmAtomDraft } from '@semantic/types';
   import type { NoteInfo } from './note-folder-types';
   // ...4 个 interface 原封搬过来...
   ```
   > 不要搬 `NoteCapabilityApi`（那是 capability 接口，含方法签名，留 capabilities）。只搬这 4 个数据类型。

2. **原文件** `capabilities/note/types.ts`：删掉已搬走的 4 个类型，改为 re-export：
   `export type { CreateNoteBatchInput, CreateNoteBatchResult, CreateNoteBatchItem, CreateNoteBatchFailure } from '@shared/ipc/note-batch-types';`
   （保 4 个消费方不断：import-pipeline.ts、markdown-import.ts、extraction-import.ts、platform/main/note/handlers.ts。）

3. **electron-api.d.ts:22**：把 `CreateNoteBatchInput, CreateNoteBatchResult` 的 import 从
   `@capabilities/note/types` 改为 `./note-batch-types`（本层）。

## 验收（自检 + 报告）

1. `grep -rn "@capabilities" src/shared/` → **0**（shared 不再依赖 capabilities）。
2. 4 类型在 `shared/ipc/note-batch-types.ts`；capabilities/note/types.ts re-export 之。
3. `grep -rn "from '@semantic" src/shared/ipc/note-batch-types.ts` → 有（PmAtomDraft，合法）。
4. 4 个消费方仍能拿到类型（tsc 不报缺失）；NoteCapabilityApi 仍在 capabilities。
5. tsc 通过。
6. 报告：改了哪些文件、grep 结果、tsc。

## 边界（不要做）

- ❌ 只搬 4 个数据类型，不搬 `NoteCapabilityApi`（capability 接口留原处）。
- ❌ 不碰其他 shared 违规（已在别的单元处理完）。
- ❌ 不改消费方业务逻辑。

## 完成后

回报「U4-b 完成」+ `grep @capabilities src/shared/`（应 0）+ tsc + git diff --stat。
