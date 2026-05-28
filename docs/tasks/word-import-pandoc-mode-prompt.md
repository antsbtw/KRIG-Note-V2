# Word Import Pandoc 高保真模式 — 实施 Prompt

> Owner: TBD
> Status: Draft for next conversation
> Created: 2026-05-27
> Prerequisite: `feature/word-import` 已合 main(commit 585ced0c)— 基础 mammoth 链路上线

---

## 0. 你是谁,你接的什么任务

你接手 KRIG-Note V2(Electron + TypeScript)的"Word 文档导入高保真模式"实施。V2 已有**基础版** Word 导入(走 mammoth.js),已合 main。基础版**主要短板**:

- **公式(OMML)被 mammoth 直接吞掉,导致正文出现 `defined as , which serves as` 这种空逗号断句**
- 自动编号(Word `numbering.xml`)丢失(章节号 "1.2 数据治理" 变成 "数据治理")
- 引文域(EndNote / Zotero / Word 原生 CITE)退化为纯文本
- 复杂合并单元格表格(rowspan/colspan)可能错位

**任务**:在 File 菜单新增第二个入口 `Import Word (High Quality)...`,走 Pandoc 二进制,**重点解决公式问题**(其他副产品顺带改善)。

mammoth 基础版**不删**,两条路径共存。用户没装 Pandoc 用基础版,装了能用高保真版。

---

## 1. 决策依据(已调研,你不需要再查)

调研报告显示:

| 维度 | mammoth (基础版,已实现) | Pandoc (本任务) |
|---|---|---|
| 公式 | 吞掉,无输出 | docx→LaTeX 原生强项 |
| 引文 | 退化为纯文本 | 多种引文格式正确处理 |
| 编号 | 丢失 | 保留 |
| 表格 | 简单 OK,合并破 | 显著更好 |
| 维护状态 | mammoth 1.12 单人维护活跃 | Pandoc 2026-03 仍发版,活跃 |
| 用户门槛 | 零(npm 装) | 用户装 pandoc 二进制 |
| Electron 集成 | npm 直接调 | spawn 子进程 + PATH 探测 |

**为什么不用其他方案**:
- `omml2mathml` npm 包 8 年未更新,GitHub archived
- 自己写 OMML XSLT 链路 = 维护脆弱的死包
- MarkItDown 内核就是 mammoth,等同基础版

**已知 Electron 集成坑**:
- 生产打包后 spawn pandoc 不继承用户 PATH → ENOENT(`electron/electron#5626`,`atom/atom#16667` 字面证实)
- 必须 `which pandoc` 探测 + 设置页让用户手填路径作 fallback
- V2 已有 SurrealDB 二进制管理经验(`src/storage/...`)可参考

---

## 2. 实施总体架构

```
docx 文件
  → main 进程检测 pandoc 二进制(which / 设置页配置路径)
  → spawn pandoc -f docx -t gfm <path> 拿 markdown 字符串
  → (可选)对 markdown 做后处理:封面标题抽取 / 数学符号校验
  → 复用现有 MARKDOWN_IMPORT_RUN 通道推给 renderer
  → 现有 markdown-import.ts 链路接管(folder 树、note 创建、序号、isTitle paragraph 等)
```

**关键洞察**:**不要复制 mammoth 路径的 menu handler 和 renderer 链路**——直接复用现有 markdown-import 的 renderer pipeline,只是 main 端换 pandoc 调用。

---

## 3. 必读的现有代码(顺序读)

读懂这几个文件你就理解了 V2 当前 import 架构:

### 3.1 现有 Word 导入实施(参考实现)
- [src/platform/main/word-import/index.ts](../../src/platform/main/word-import/index.ts) — menu handler 模板。你要照这个写一个 `runImportPandoc()`,几乎相同结构,只是把 `convertDocxBatch`(mammoth)换成 `convertDocxBatchPandoc`
- [src/platform/main/word-import/converter.ts](../../src/platform/main/word-import/converter.ts) — mammoth 转换器。你**不要改它**,你要新建 `converter-pandoc.ts` 平行存在

### 3.2 IPC 通道(复用,不要新建)
- [src/shared/ipc/channel-names.ts](../../src/shared/ipc/channel-names.ts) — `MARKDOWN_IMPORT_RUN` 已存在,**直接复用**
- [src/views/note/markdown-import.ts](../../src/views/note/markdown-import.ts) — renderer 端导入逻辑(folder 树、序号、coverTitle 字段)。**完全不需要改**

### 3.3 菜单注册
- [src/platform/main/menu/framework-menus.ts](../../src/platform/main/menu/framework-menus.ts) — File 菜单已有 `Import Markdown...` + `Import Word...`。你要再加一项 `Import Word (High Quality)...` 在 `Import Word...` 下面
- [src/platform/main/index.ts](../../src/platform/main/index.ts) — 调用 `registerWordImport()` 处加一行 `registerPandocImport()`

### 3.4 V2 二进制管理经验参考
- `src/storage/` 下 SurrealDB sidecar 启动逻辑(具体路径自行 grep `surreal` / `sidecar`)— V2 怎么打包 + 探测 + 启动外部二进制

---

## 4. 分阶段实施(预估 4-6 小时)

### Phase 1:Pandoc 探测 + spawn 调用(1.5 小时)

新建 `src/platform/main/word-import/pandoc-detector.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PandocStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  reason?: string;
}

/**
 * 探测 pandoc 二进制
 * 优先级:
 * 1. 用户设置(future:从 V2 settings 读 customPandocPath)
 * 2. which pandoc(常规 PATH)
 * 3. 已知路径(/usr/local/bin/pandoc, /opt/homebrew/bin/pandoc)
 *
 * **关键**:Electron 生产包不继承用户 shell PATH,which 在打包后可能 ENOENT
 *           必须 fallback 已知路径 + 用户自配
 */
export async function detectPandoc(): Promise<PandocStatus> {
  // ... 实施
}
```

新建 `src/platform/main/word-import/converter-pandoc.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface PandocConvertResult {
  absPath: string;
  markdown: string;
  coverTitle: string | null;  // 同 mammoth converter,从 markdown 抽
  warnings: string[];
}

export async function convertDocxToMarkdownPandoc(
  absPath: string,
  pandocPath: string,
): Promise<PandocConvertResult> {
  // spawn pandoc 命令:
  // pandoc -f docx -t gfm --extract-media=<tempdir> -o <output.md> <input.docx>
  //   -f docx          源格式
  //   -t gfm           目标 GitHub-flavored Markdown(跟 mammoth 输出兼容)
  //   --extract-media  把嵌入图导出到 tempdir(避免 base64 inline 撑爆)
  //   或考虑直接管道到 stdout,base64 inline,跟 mammoth 同款
  //
  // ⚠️ 实施前先在终端手动跑:
  //   pandoc -f docx -t gfm 真实docx.docx | head -100
  // 看输出对不对、公式是不是 $$...$$ / $...$ 形态
}

export async function convertDocxBatchPandoc(
  paths: string[],
  pandocPath: string,
): Promise<{ results: PandocConvertResult[]; failed: ... }> {
  // 同 mammoth converter 的 batch 结构,递归扫描 + 黑名单
  // 可以直接 import mammoth converter 里的 walkDirForDocx 工具(或重构出公共扫描器)
}
```

### Phase 2:封面标题抽取 + 媒体处理(1 小时)

Pandoc 输出的 markdown 跟 mammoth 不同——**它能识别 Word 自动编号 + Title 样式**(Title 通常输出为 `# 标题` H1)。所以:

- coverTitle 抽取逻辑可能跟 mammoth 完全不同——需要**真实跑一次看产物**再设计
- 可能直接用 markdown 第一行 H1 作 coverTitle 即可
- 图片:`--extract-media` 输出到 tempdir,要把这些图读成 base64 注入 markdown(或者保留路径让 renderer 自己处理——但 V2 现在不支持文件路径图)

**关键:在写代码前,在终端跑 `pandoc -f docx -t gfm 真实docx.docx > /tmp/out.md` 看产物,再设计抽取逻辑**。

### Phase 3:menu handler + 菜单项(1 小时)

新建 `src/platform/main/word-import/pandoc-import.ts`(平行于现有 `index.ts`):

```typescript
async function runImportPandoc(): Promise<void> {
  // 1. 探测 pandoc
  const status = await detectPandoc();
  if (!status.available) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Pandoc Required',
      message: 'High-quality Word import requires Pandoc.',
      detail: 'Install: brew install pandoc (macOS) / Pandoc.org for Windows.\n\n'
            + `Detection failed: ${status.reason ?? 'unknown'}`,
      buttons: ['OK', 'Open Pandoc Website'],
    });
    return;
  }
  
  // 2. 选 docx(同 mammoth handler)
  const dialogResult = await dialog.showOpenDialog({ ... });
  
  // 3. spawn pandoc 转换(批处理 + 失败收集)
  const { results, failed } = await convertDocxBatchPandoc(paths, status.path!);
  
  // 4. 复用 MARKDOWN_IMPORT_RUN 推给 renderer(零额外 renderer 代码)
  win.webContents.send(IPC_CHANNELS.MARKDOWN_IMPORT_RUN, payload);
}

export function registerPandocImport(): void {
  menuRegistry.registerCommand('file.import-word-pandoc', () => { ... });
}
```

注册:
- [src/platform/main/index.ts](../../src/platform/main/index.ts):加 `registerPandocImport()`
- [src/platform/main/menu/framework-menus.ts](../../src/platform/main/menu/framework-menus.ts) File 菜单:在 `Import Word...` 下加 `{ id: 'import-word-pandoc', label: 'Import Word (High Quality)...', command: 'file.import-word-pandoc' }`

### Phase 4:测试(1.5 小时)

**用户已有的真实测试 docx**:`/Users/wenwu/Library/CloudStorage/OneDrive-Personal/old document/02 百色反恐平台/02 详细设计/上海普元/170614马今_GX_企业服务总线及数据治理方案v1.2.docx`

测试清单:
- [ ] 没装 pandoc:菜单点击弹窗提示安装,不崩溃
- [ ] 装好 pandoc:菜单点击正常转换
- [ ] **关键回归**:之前 mammoth 吞掉的公式,Pandoc 是不是真转出 LaTeX `$...$` 了
- [ ] V2 渲染:KaTeX 渲染 `$...$` 公式正确(V2 已有 mathInline 节点,渲染基础设施完整)
- [ ] 编号:`1.2 数据治理` 这种章节号在 Pandoc 路径下是否保留
- [ ] 引文:如果你的 docx 有引文域,看是不是输出成 `[@author2020]` 或类似格式
- [ ] 表格:复杂合并表是否比 mammoth 更准
- [ ] 跟 mammoth 路径**对比同一份 docx**:用户能感知到质量提升

---

## 5. 关键陷阱(必读,避免踩坑)

### 5.1 Electron PATH 不继承

**症状**:`spawn pandoc ENOENT`(开发环境正常,生产打包后崩)。

**根因**:Electron app 启动时 PATH 是系统默认(`/usr/bin:/bin:/usr/sbin:/sbin`),不含 `/opt/homebrew/bin`(M 系列 Mac brew 装的位置)或 `/usr/local/bin`(Intel)。

**正确做法**:
1. 不要直接 `spawn('pandoc', ...)`
2. 先用 `which pandoc` 探测完整路径(execFile 不依赖 shell PATH,但 `which` 命令本身依赖 — 所以用 node `child_process.execFile` 跑 `/usr/bin/which pandoc`)
3. 探测失败时按已知路径列表逐一 stat 检查:
   ```ts
   const candidates = [
     '/opt/homebrew/bin/pandoc',
     '/usr/local/bin/pandoc',
     '/usr/bin/pandoc',
   ];
   ```
4. 探测到的路径**缓存到 V2 settings**,下次启动直接用
5. 提供用户手填路径的 fallback(设置页)

### 5.2 Pandoc 输出方言

`pandoc -t markdown` 是 Pandoc 自家 Markdown(支持更多扩展语法),**跟 V2 现有 markdown-to-pm 不完全兼容**。

**正确做法**:用 `pandoc -t gfm`(GitHub-flavored),这是 mammoth 也用的方言,V2 markdownToProseMirror 已经能消化。

### 5.3 公式输出语法

Pandoc 默认对 docx OMML 公式:
- block 公式 → `$$...$$` (display math)
- inline 公式 → `$...$` (inline math)

**V2 已支持**:[src/capabilities/text-editing/converters/md-to-pm.ts](../../src/capabilities/text-editing/converters/md-to-pm.ts) 里 `mathBlock`(`$$..$$`)和 `mathInline`(`$..$`)都已经处理。

**但是**:某些 Pandoc 版本对 inline 公式输出 `\(...\)` 而不是 `$...$`。需要测试实际输出,如果是 `\(...\)`,要在 md-to-pm 加支持或者在 converter-pandoc 后处理替换为 `$...$`。

### 5.4 图片处理

Pandoc 选项:
- 默认不处理图,markdown 里 `<img>` 标签或 broken link
- `--extract-media=<dir>`:把图导到目录,markdown 写相对路径
- 没有"直接 inline base64"选项

**V2 现状**:markdown-to-pm 支持 base64 `data:` URL(走 mediaStore),**不支持文件路径**。

**正确做法**:
1. Pandoc 输出图到 `os.tmpdir()/krig-pandoc-import/<uuid>/`
2. 后处理:遍历 markdown 里所有 `![](./media/...)` 路径,读文件 → base64 → 替换为 `![](data:image/...;base64,...)`
3. 清理 tempdir

### 5.5 用户首次安装引导

如果 `detectPandoc()` 返回 `available: false`,**不要只弹窗说"请装 pandoc"**——给具体可执行的步骤:

```
This feature requires Pandoc (a document conversion tool).

To install:
  • macOS:   brew install pandoc
  • Windows: Download from pandoc.org/installing
  • Linux:   apt install pandoc / yum install pandoc

After installing, restart KRIG Note and try again.

[Open Pandoc Website]  [OK]
```

---

## 6. 不该做的事(避免范围蔓延)

- ❌ **不要删 mammoth 路径**——两条路径共存,用户自选
- ❌ **不要内嵌 Pandoc 二进制**(几十 MB,跨平台打包噩梦,违反 V2 "二进制走用户系统" 原则,参考 SurrealDB 也是用户系统装)
- ❌ **不要重复实现 markdown 导入 renderer 逻辑**——`MARKDOWN_IMPORT_RUN` 通道直接复用
- ❌ **不要为 Pandoc 高保真新加 IPC channel** ——复用现有
- ❌ **不要在这个 PR 顺手改 mammoth 路径的行为** ——独立的可回退性最重要
- ❌ **不要做"自动选 mammoth 还是 Pandoc"的智能模式**——用户明确选,可预测;智能选择会让用户困惑

---

## 7. 文档 / 决议产物

完成后在 `docs/tasks/` 加 handoff(参考其他 `*-handoff.md`),记录:
- 实际 Pandoc 版本 + 测试 docx 列表
- 哪些场景比 mammoth 显著改善(用真实文档截图对比)
- 已知仍不支持的边界(总有的)
- Electron 生产打包探测的实测路径(覆盖 macOS Intel/M1 + Windows + Linux)

---

## 8. 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 没装 Pandoc:菜单点击不崩,弹窗友好引导 | 在没装 pandoc 的环境跑 |
| 2 | 装好 Pandoc:菜单点击正常转换 | 跑通用户的真实测试 docx |
| 3 | **公式正确**:之前 mammoth 吞掉的 `H(X)=-\sum p_i \log p_i` 现在在 V2 渲染成 KaTeX 公式 | 跟 mammoth 同 docx 对比 |
| 4 | 章节自动编号保留(`1.2 数据治理` 不丢 `1.2`) | 跑用户的 ESB docx |
| 5 | 图片正常显示(走 base64 → mediaStore) | NavSide 打开任意带图 note |
| 6 | 跟 mammoth 共存,不影响 mammoth 路径 | 切到 `Import Word...` 仍可用 |
| 7 | typecheck 通过 + 测试清单全过 + commit 粒度清晰 | code review |
| 8 | 用户拍板"显著比 mammoth 路径好,值得保留" | 用户接受 |

---

## 9. 推荐的 commit 粒度

```
feat(word-import): Pandoc detector + binary path discovery
feat(word-import): Pandoc converter (spawn + GFM output + image extract)
feat(word-import): Pandoc menu entry + first-run install guidance
test(word-import): cross-compare Pandoc vs mammoth on real docx samples
docs(tasks): word-import-pandoc-mode handoff (实测产物 + 局限)
```

---

## 10. 怎么开始

1. **第一步**:在终端跑 `pandoc -f docx -t gfm /Users/wenwu/Library/.../170614马今...docx | less` 看真实产物。这一步决定 Phase 2 怎么写。**不跑这一步就开始写代码 = 重蹈 mammoth-styleMap 凭印象拍的覆辙**。
2. 看完产物再决定:封面标题怎么抽、公式格式是 `$..$` 还是 `\(...\)`、图片路径是绝对还是相对。
3. **然后**开 `feature/word-import-pandoc-mode` 分支,按 Phase 1→4 实施。
4. 每个 Phase 完成跑一次 typecheck + 真实导入测试。
5. Phase 4 测试如果有非预期问题,**先 console.log 诊断**不要凭猜测改(参考 `feedback_diag_log_before_speculation.md` 教训)。

---

## 附录:相关文件清单

| 文件 | 用途 |
|---|---|
| [src/platform/main/word-import/index.ts](../../src/platform/main/word-import/index.ts) | mammoth menu handler(参考结构) |
| [src/platform/main/word-import/converter.ts](../../src/platform/main/word-import/converter.ts) | mammoth converter(参考 batch + warnings 模式) |
| [src/platform/main/markdown-import/index.ts](../../src/platform/main/markdown-import/index.ts) | markdown menu handler(IPC 推送模式) |
| [src/platform/main/markdown-import/scanner.ts](../../src/platform/main/markdown-import/scanner.ts) | 目录递归扫描 + 黑名单(可复用) |
| [src/views/note/markdown-import.ts](../../src/views/note/markdown-import.ts) | renderer 端导入(完全复用,不改) |
| [src/views/note/use-markdown-import.ts](../../src/views/note/use-markdown-import.ts) | renderer hook(不改) |
| [src/platform/main/menu/framework-menus.ts](../../src/platform/main/menu/framework-menus.ts) | 菜单注册 |
| [src/platform/main/index.ts](../../src/platform/main/index.ts) | main 入口,register*Import() |
| [src/shared/ipc/channel-names.ts](../../src/shared/ipc/channel-names.ts) | MARKDOWN_IMPORT_RUN channel(复用) |
| [src/capabilities/text-editing/converters/md-to-pm.ts](../../src/capabilities/text-editing/converters/md-to-pm.ts) | markdown → PM(mathBlock/mathInline 已实现,公式渲染基础) |
