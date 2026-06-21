# Phase B — 导入进度条 UI 实施 Prompt

> Owner: TBD
> Status: Draft for next conversation
> Created: 2026-05-28
> Prerequisite: Phase A 已合 main(commit `3263b37f`)— Word 导入诊断 + 修复 19 commits 全部上线
> Sibling 任务: 这是 Word/Markdown 导入系列任务的下半场,Phase A(诊断 + 修 bug)已收官,Phase B 上 UI

---

## 0. 你是谁,你接的什么任务

你接手 KRIG-Note V2(Electron + TypeScript)的**导入进度条 UI** 实施。

V2 已有 4 个导入入口:
- File → **Import Markdown...**(目录递归扫 .md)
- File → **Import Word...**(mammoth,基础零依赖)
- File → **Import Word (High Quality)...**(pandoc,高保真需用户装)
- File → **Backup / Restore...**(tar.gz,跟本任务无关)

**当前问题**:这 3 个导入入口的流程**全过程无进度反馈**:
- 用户点完菜单 → 黑盒等几秒到几十秒
- 终端 log 在跑但用户看不到
- 失败时弹 `window.alert` 报错(2026-05-27 Phase A 加的)
- 成功时**啥都不弹**,用户不知道完成没有
- 大批文档(几十~几百篇)时整个 V2 卡死视觉无响应

用户 2026-05-28 反馈"一个文档导入 30 秒以上不正常呀"暴露了**没有进度条用户根本不知道在干活还是卡死**。

**任务**:给 3 个导入入口加一个统一的**进度面板**,显示:
- 总进度(N/M files)
- 当前阶段(扫描 / Pandoc 转换 / 后处理 / 创建 note 入库)
- 单文件耗时 + 字节数
- 失败明细(从现有 alert 升级,可滚动列表)
- 完成后变"完成"按钮关闭

**不要做的事**:
- 不要重写 Phase A 的诊断 log 体系(import-cache + 终端 log 是给开发者的,UI 是给用户的,并存)
- 不要替换现有 `window.alert` 失败弹窗 — 进度面板内置失败明细后再删 alert
- 不要新加 IPC channel — 复用 import-cache 现有 3 个 channel + MARKDOWN_IMPORT_RUN

---

## 1. 决策依据(已调研,你不需要再查)

### 1.1 为什么不用 ai-sync 那套 toast/dialog

V2 现有 `src/views/note/use-markdown-import.ts:10` 注释说"需要更细粒度 UI 时换成 ai-sync 用的那套 toast/dialog"。**但 ai-sync 是 fire-and-forget 单条 toast**,不适合多阶段、长时间、可滚动失败列表的场景。导入是**用户主动触发的明确任务**,应该有专门的**模态/侧栏面板**承载。

### 1.2 模态 vs 侧栏 vs 顶部 banner

- ❌ **顶部 banner**:细节展不开,失败列表无处放
- ❌ **NavSide 嵌入**:NavSide 已被 note/ebook/web/ai/graph 五标签占,加导入会挤
- ✅ **L2 FullscreenOverlay 同款 popup**(non-modal,右下角浮窗):跟 mermaid 全屏 / 全局 panel 风格一致

V2 已有 L2 FullscreenOverlay 体系(参见 memory `project_l2_fullscreen_overlay_done.md`),进度面板**走相同基建**

### 1.3 进度数据从哪里来

Phase A 已经有完整的 **import-cache** 落盘体系(`<userData>/import-cache/manifest.json`):

```json
{
  "startedAt": 1779939418020,
  "finishedAt": 1779939456922,
  "source": "word-pandoc",
  "summary": { "files": 1, "converted": 1, "failed": 0 },
  "files": [{
    "idx": 1,
    "basename": "...",
    "stages": [
      { "id": "01-raw", "bytes": 4767 },
      { "id": "02-postprocessed", "bytes": 4641 },
      { "id": "03-chunks", "bytes": 12345, "meta": { "chunkCount": 15 } },
      { "id": "04-pm-docs", "bytes": 67890 }
    ]
  }]
}
```

进度面板**消费 manifest.json**(或 main → renderer 流式推送进度事件)就够了。

### 1.4 IPC 设计:推送 vs 拉取

| 方案 | 实施 | 体验 |
|---|---|---|
| A. 新加 `MARKDOWN_IMPORT_PROGRESS` channel,main 端每完成一篇 send 一次 | 推送,实时 | 一步到位但要改 main + renderer 多处 |
| B. renderer 每 500ms `fs.readFile manifest.json` 轮询 | 拉取,简单 | 进度滞后,但**零 IPC 改动** |
| **C. 推送 + 拉取 hybrid**(推荐) | main 推关键事件(开始/单篇完成/全部完成),renderer 启动后立即读一次 manifest 补全 | 实时 + 容错(IPC 漏一帧靠 manifest 补) |

走 **C**——但**第一个 PR 先只做推送**,manifest 拉取留下一轮做(不影响主路径)。

### 1.5 已经存在的基础设施(你必须复用)

| 资产 | 位置 | 用途 |
|---|---|---|
| import-cache 模块 | `src/platform/main/word-import/import-cache.ts` | beginImport / registerFile / dumpStageContent / endImport,你新加进度事件挂这里 |
| MARKDOWN_IMPORT_RUN 通道 | `src/shared/ipc/channel-names.ts:112` | main → renderer 推送 ScannedFile[];你**不要改它**,新加 PROGRESS channel |
| use-markdown-import hook | `src/views/note/use-markdown-import.ts` | 现在在 NoteView mount,接收 batch + 转 PM + 落 note + 失败 alert |
| markdown-import.ts 业务 | `src/views/note/markdown-import.ts` | importMarkdownBatch:1:1 / split / folder 树重建 |
| 现有 console.log | 终端日志格式 `[word-import:pandoc] ...` / `[markdown-import] ✓ chunk N/M ...` | 你**保留这些 log**,UI 是叠加层 |

---

## 2. 实施总体架构

```
main 进程:
  ImportProgressEmitter(新加)
    ↓ 监听 import-cache 关键时点(beginImport / registerFile / endImport)
    ↓ 也监听 renderer 端 markdown-import 通过 importCacheRecordStage 推送的进度
    ↓ 通过新 channel IMPORT_PROGRESS 推送到所有 webContents
    
shared/ipc/channel-names.ts:
  IMPORT_PROGRESS = 'import.progress'(新加)
  
preload:
  onImportProgress(callback): unsubscribe(新加)

renderer:
  useImportProgress hook(新加,挂在 NoteView 或 shell 根)
    ↓ 维护本地 state:current / total / failed[] / phase / done
    ↓ 进度变化时显示 ImportProgressPanel(L2 popup)
    
ImportProgressPanel(新加 UI 组件):
  - 头部:总进度 N/M + ETA + 阶段名
  - 中部:当前文件名 + 字节数 + 耗时
  - 失败列表(可滚动,从现有 alert 升级而来)
  - 底部:[最小化] [完成]按钮
```

**关键洞察**:不要把进度逻辑写进 markdown-import.ts(业务逻辑文件)。新建 `useImportProgress` hook + `ImportProgressPanel` 组件,在 renderer **订阅 IMPORT_PROGRESS** 然后渲染。markdown-import.ts 只负责"完成一篇就推一次进度事件"。

---

## 3. 必读的现有代码(顺序读)

### 3.1 import-cache 模块(进度数据源)

- [src/platform/main/word-import/import-cache.ts](../../src/platform/main/word-import/import-cache.ts) — `beginImport` / `registerFile` / `dumpStageContent` / `endImport` 已经是天然的进度埋点位置,你**在这些函数内部 emit 进度事件**
- [src/platform/main/word-import/index.ts](../../src/platform/main/word-import/index.ts) — runImportMammoth / runImportPandoc 调用 import-cache 的顺序

### 3.2 IPC 通道注册

- [src/shared/ipc/channel-names.ts](../../src/shared/ipc/channel-names.ts) — 加 `IMPORT_PROGRESS = 'import.progress'`
- [src/platform/main/preload/main-window-preload.ts](../../src/platform/main/preload/main-window-preload.ts) — `onImportProgress(callback)` 参考 `onMarkdownImportRun` line 331
- [src/shared/ipc/electron-api.d.ts](../../src/shared/ipc/electron-api.d.ts) — d.ts 同步加类型

### 3.3 现有 alert + console.log 流程(要保留)

- [src/views/note/use-markdown-import.ts](../../src/views/note/use-markdown-import.ts) — failed 时 `window.alert` 弹失败明细 + console.warn
- [src/views/note/markdown-import.ts](../../src/views/note/markdown-import.ts) — `[markdown-import] ✓ chunk N/M ...` 终端日志
- 终端 log **不删** — UI 是叠加层,开发调试仍靠终端

### 3.4 L2 FullscreenOverlay popup 风格参考

- 参见 memory `project_l2_fullscreen_overlay_done.md` — 已有"app-scoped 全屏视图槽"基础
- ImportProgressPanel **不是全屏**,是**右下角浮窗 + 模态遮罩可选**(导入时是否禁用其他操作?见 §5.4)
- 找一个 V2 现有 popup 组件作为视觉/CSS 参考:`src/shell/help-panel/` 或 NavSide 弹出菜单

---

## 4. 分阶段实施(预估 4-6 小时)

### Phase B1:IPC channel + main 端事件 emit(1 小时)

新建 `src/platform/main/word-import/progress-emitter.ts`:

```typescript
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

export type ImportProgressEvent =
  | { kind: 'begin'; source: 'word-mammoth' | 'word-pandoc' | 'markdown'; totalFiles: number | null /* 文件数可能还没扫,null = 未知 */ }
  | { kind: 'file-start'; fileIdx: number; basename: string }
  | { kind: 'file-stage'; fileIdx: number; stage: '01-raw' | '02-postprocessed' | '03-chunks' | '04-pm-docs'; bytes?: number; elapsedMs?: number }
  | { kind: 'file-done'; fileIdx: number; converted: boolean; reason?: string }
  | { kind: 'end'; summary: { files: number; converted: number; failed: number; elapsedMs: number } };

export function emitImportProgress(event: ImportProgressEvent): void {
  // broadcast 到所有 webContents
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue;
    win.webContents.send(IPC_CHANNELS.IMPORT_PROGRESS, event);
  }
}
```

在 [src/shared/ipc/channel-names.ts](../../src/shared/ipc/channel-names.ts) 加:
```typescript
IMPORT_PROGRESS: 'import.progress',  // main → renderer 推送 ImportProgressEvent
```

在 import-cache.ts 的关键函数末尾**直接调 emitImportProgress**:
- `beginImport(source)` 末尾 emit `{ kind: 'begin', source, totalFiles: null }`
- `registerFile(basename, ...)` 末尾 emit `{ kind: 'file-start', fileIdx, basename }`
- `dumpStageContent(idx, stage, ...)` 末尾 emit `{ kind: 'file-stage', fileIdx, stage, bytes, elapsedMs }`
- `endImport(summary)` 末尾 emit `{ kind: 'end', summary: { ...summary, elapsedMs } }`

main 端 word-import/index.ts 在 broadcastResults 推送 MARKDOWN_IMPORT_RUN 前再 emit 一次 `{ kind: 'begin', totalFiles: results.length }`(此时知道真实文件数,补全 begin 事件的 totalFiles)

renderer 端 markdown-import.ts 在每文件 1:1 / 每 chunk split 完成后,通过现有 `importCacheRecordStage` 推送 + 同时 emit `{ kind: 'file-done', fileIdx, converted: true }`(需新加 IPC 让 renderer 也能发 progress,或者用现有 record-stage 让 main 端推断"file done")

**关键陷阱**:renderer 推送的进度事件最终也走 main 的 emitImportProgress 广播,**不要让 renderer 直接 send 给自己**

### Phase B2:preload + d.ts(0.3 小时)

[src/platform/main/preload/main-window-preload.ts](../../src/platform/main/preload/main-window-preload.ts) 加(参考 `onMarkdownImportRun` line 331-335):

```typescript
onImportProgress(callback: (event: unknown) => void): () => void {
  const handler = (_e: unknown, data: unknown): void => callback(data);
  ipcRenderer.on(IPC_CHANNELS.IMPORT_PROGRESS, handler);
  return () => ipcRenderer.off(IPC_CHANNELS.IMPORT_PROGRESS, handler);
},
```

[src/shared/ipc/electron-api.d.ts](../../src/shared/ipc/electron-api.d.ts) 同步加类型(参考 onMarkdownImportRun)

### Phase B3:renderer hook + UI 组件(2 小时)

新建 `src/views/note/use-import-progress.ts`:

```typescript
import { useEffect, useState } from 'react';
import type { ImportProgressEvent } from '@platform/main/word-import/progress-emitter';

interface ProgressState {
  active: boolean;
  source: string | null;
  current: number;
  total: number | null;
  currentBasename: string | null;
  currentStage: string | null;
  failed: Array<{ basename: string; reason: string }>;
  done: boolean;
  summary: { files: number; converted: number; failed: number; elapsedMs: number } | null;
}

export function useImportProgress(): ProgressState & {
  dismiss: () => void;  // 用户点"完成"按钮
} {
  const [state, setState] = useState<ProgressState>({ /* 初始 */ });
  
  useEffect(() => {
    const unsub = window.electronAPI.onImportProgress((raw) => {
      const e = raw as ImportProgressEvent;
      setState((prev) => reduce(prev, e));
    });
    return unsub;
  }, []);
  
  return { ...state, dismiss: () => setState(/* 重置 */) };
}
```

新建 `src/views/note/ImportProgressPanel.tsx`(参考 V2 现有 popup 视觉):

- 右下角固定位置(`position: fixed; bottom: 24px; right: 24px;`)
- 宽度 360px,高度自适应,最大 480px(失败列表滚动)
- 顶部进度条 `<progress value={current} max={total ?? undefined} />`
- 中部:`正在导入 {currentBasename} ({stage})`
- 失败列表:折叠 details,默认展开前 5 条,>5 时滚动
- 完成时变绿色 "✓ 导入完成 N 篇,失败 M 篇" + [完成]按钮
- 失败时变红色

挂到 shell 根 / NoteView mount 位置(跟 useMarkdownImport hook 同位置):

```typescript
// shell 或 NoteView 顶部
const progress = useImportProgress();
return (
  <>
    {existing}
    {progress.active && <ImportProgressPanel {...progress} />}
  </>
);
```

### Phase B4:删 alert + 真实导入测试(1 小时)

- 删 use-markdown-import.ts 的 `window.alert` 失败弹窗 — ImportProgressPanel 已内置失败列表
- 保留 console.error / console.log(终端调试)
- 测试清单:
  - [ ] Pandoc 小文档(math sample 4.6KB)→ 1 秒内出现完成面板
  - [ ] Pandoc 长文档(170614马今 docx 100MB)→ 全程进度刷新,15 chunks 逐个 ✓
  - [ ] Mammoth 同样测两个
  - [ ] 故意装错 pandoc 路径 → 弹安装引导(走老 dialog,不进 progress panel)
  - [ ] Pandoc 转换失败(给个损坏 docx)→ 进度面板红色 "1 失败" 显示原因
  - [ ] Import Markdown 30 个 .md → 进度面板 1-30 流式更新

### Phase B5:文档 + 提交(0.5 小时)

- handoff `docs/tasks/import-progress-ui-handoff.md`:
  - 实测产物截图(进度面板 / 失败列表 / 完成态)
  - 已知局限(如多窗口并发导入未处理)
- 推荐 commit 粒度:
  ```
  feat(import): IPC channel + main-side progress emitter
  feat(import): preload + d.ts onImportProgress
  feat(import): useImportProgress hook + ImportProgressPanel UI
  refactor(import): remove window.alert in favor of progress panel
  docs(tasks): import progress UI handoff
  ```

---

## 5. 关键陷阱(必读,避免踩坑)

### 5.1 main 启动顺序 — IPC handler 必须在 createMainWindow 前注册

main 端 `progress-emitter.ts` 是 fire-and-forget(只 `webContents.send`,不 handle invoke),所以**不需要在 main 启动期 register**。但你要确保 import-cache.ts 加 emit 后,在第一次导入前 import-cache 模块已 imported(它是被 word-import/index.ts import 的,V2 启动期已加载)。

### 5.2 renderer 端事件可能丢

`webContents.send` 不保证送达(IPC 是 fire-and-forget)。当用户切了 workspace 或窗口隐藏时,event 可能被吞。**解决**:Phase B 下半场加 manifest 拉取兜底(本 PR 不做,只埋好接口)。

### 5.3 不要在 useImportProgress 里重复执行业务

进度 hook **只读不写** — useMarkdownImport hook 已经在跑业务逻辑(订阅 MARKDOWN_IMPORT_RUN + 跑 importMarkdownBatch),useImportProgress **只订阅进度事件**,不要重新跑导入。

### 5.4 进度面板是 modal 还是 non-modal?

**建议 non-modal**(用户导入时仍可点别的 note 看现有内容)。但**导入中禁用 File 菜单**避免并发导入(可以加一个全局 `importInFlight` flag)。

### 5.5 大批文档(>100 篇)时 UI 渲染压力

每文件 4 个 stage event × 100 篇 = 400 次 setState,React 会卡。**节流**:进度 hook 内部 throttle 到 100ms 一次 setState。

### 5.6 失败列表可能很长(几百个)

不要全渲染。**虚拟滚动**(简单实现:只渲染前 50 + "查看完整列表(去 import-cache 找 manifest.json)"按钮)。

---

## 6. 不该做的事(避免范围蔓延)

- ❌ **不要替换 console.log 终端日志** — 那是 Phase A 给开发者的诊断,UI 是叠加层不是替代
- ❌ **不要改 import-cache 落盘 schema** — 进度面板用 IPC 实时数据,不读 manifest(下一轮再做拉取兜底)
- ❌ **不要在进度面板里加"取消导入"按钮** — Phase A 没设计取消机制,加按钮无 backend 支持,UI 假动作
- ❌ **不要顺手优化 markdown-import.ts 业务逻辑** — 那是 Phase A 的代码,本 PR 只加进度埋点
- ❌ **不要给 Backup/Restore 加进度** — 那是独立任务,有自己的进度需求(参见 `project_backup_restore_v2_done.md`)

---

## 7. 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 任一导入入口触发 → 进度面板 100ms 内出现 | 跑 Pandoc 小文档 |
| 2 | 多阶段名(扫描 / 转换 / 后处理 / 入库)正确显示 | 看进度面板中部文字 |
| 3 | 长文档(15 chunks)进度从 1/15 → 15/15 流式更新 | 跑 170614马今 docx |
| 4 | 失败时面板变红色 + 显示失败明细 + 不再弹 window.alert | 故意给坏 docx |
| 5 | 完成后变绿色 + [完成]按钮可关闭 | 任一导入结束 |
| 6 | 大批 import(>100 篇)UI 不卡 | Import Markdown 整个 docs/ 目录 |
| 7 | typecheck + lint clean | code review |
| 8 | 用户拍板"体验显著改善,可合 main" | 用户接受 |

---

## 8. 测试 docx 路径

跟 Phase A 一致:

- 小文档:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/docs/temp/krig-phase0-math-sample.docx`
- 长文档:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/docs/temp/百色市fk项目可行性研究报告_V2.2.8.1_20171025.docx`(751 页,15 chunks)
- 批量:用 `docs/` 目录递归 markdown 导入测压

---

## 9. 怎么开始

1. **第一步**:跑一次现有导入,观察终端 log 的关键时点 — 你的进度事件应该一对一对应这些时点
2. **第二步**:实现 IPC channel + main 端 emit(B1) — 重启 V2 跑一次,DevTools console 应该收到 ProgressEvent
3. **第三步**:写 hook 不写 UI(B3 前半) — 用 console.log 打印 state,验证 reduce 逻辑
4. **第四步**:写 UI(B3 后半) — Tailwind / V2 现有 CSS variables,跟 NavSide / 顶栏视觉协调
5. **第五步**:删 alert + 端到端测(B4)

---

## 附录:Phase A 已完成的相关基础(你站在哪个肩膀上)

- 19 commits 已合 main `3263b37f`,详 memory `project_word_import_pipeline_hardening_done.md`
- import-cache 模块(4 阶段产物落盘 + manifest)
- 共用 md-postprocess(image-with-trailing-text 拆分)
- 双菜单(mammoth + pandoc)
- HTML img / figure / table flatten
- EMF/WMF placeholder + 原文件落盘
- 表格 cell 默认 colwidth 修复

Phase B 的进度面板**不解决任何 Phase A 的 bug**,只是把已经在跑的事**让用户看见**。
