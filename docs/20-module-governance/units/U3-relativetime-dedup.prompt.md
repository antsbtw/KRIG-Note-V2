# 执行 Prompt · U3 · relativeTime 去重（抽到 shared）

> 复制给新对话执行。自包含。trivial 去重，一个小活。

## 任务

KRIG-Note-V2 里 `relativeTime(ts): string` 在 4 个 view 各写了一份（逐行相同）。抽到
`src/shared/date-utils.ts`，4 处改引。架构治理去重，shared 是纯 leaf 工具层。

## 4 处重复（逐行相同）

1. `src/views/note/tree-builder.ts:103` — `export function relativeTime(ts: number): string`
2. `src/views/ebook/nav-side-content.tsx:61` — `function relativeTime` (local)
3. `src/views/web/nav-side-content.tsx:59` — `function relativeTime` (local)
4. `src/views/graph-canvas-view/nav-side-content.tsx:52` — `function relativeTime` (local)

## 步骤

1. **新建** `src/shared/date-utils.ts`，放一份 `relativeTime`：
   ```ts
   /** 相对时间：ts(ms) → '刚刚' / 'N 分钟前' 等 */
   export function relativeTime(ts: number): string {
     // 照抄现有实现（4 处一致），原封搬
   }
   ```
   （从任一处复制完整实现体，它们相同。）

2. **4 个 view 文件**：删掉本地 `relativeTime` 定义，改为
   `import { relativeTime } from '@shared/date-utils';`（用项目的 shared 别名，参考同文件其他 @shared import 写法）。

3. **额外消费方**：`src/views/note/nav-side-content.tsx:25` 现在从 `./tree-builder` 引 relativeTime
   （因为 tree-builder 曾 export 它）。tree-builder 不再 export 后，这里改为从 `@shared/date-utils` 引。
   （或者：tree-builder 保留 `export { relativeTime } from '@shared/date-utils'` re-export，则此处不用改——
   二选一，优先直接改引 shared 更干净。）

## 验收（自检 + 报告）

1. `grep -rn "function relativeTime" src/views/` → **0**（views 里无本地定义）。
2. `src/shared/date-utils.ts` 有一份 relativeTime。
3. 4 个 view + nav-side-content.tsx 都从 @shared/date-utils 引。
4. tsc 通过。
5. 冒烟：note/ebook/web/graph 的列表相对时间显示正常（"刚刚"/"N分钟前"）。
6. 报告：改了哪些文件、grep 结果、tsc。

## 边界

- ❌ 只做 relativeTime 去重，不碰其他 views 代码。
- ❌ 不动 workspaceManager 相关（那是别的单元）。

## 完成后

回报「U3 完成」+ `grep function relativeTime src/views/`（应为 0）+ tsc。
