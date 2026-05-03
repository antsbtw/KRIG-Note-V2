# Artifact Download Module 设计文档

> 创建日期：2026-04-15
> 范围：Claude 网页 artifact 的稳定下载下层模块
> 关联：[Save-To-Note-Requirements.md](Save-To-Note-Requirements.md)（上层调用方）、[Claude-Artifact-Extraction-Problem.md](Claude-Artifact-Extraction-Problem.md)（历史调研）
> 现有代码起点：`src/plugins/web-bridge/capabilities/claude-artifact-extractor.ts`

---

## 1. 模块定位

把"**怎么稳定下载到一个 artifact**"和"**什么时候下载、下载几个**"完全分开。

- **本模块（下层）**：给定一个 artifact 引用 → 返回 `{ buffer, mime, filename, kind, title, meta }`
- **调用方（上层）**：决定调用时机（一键全自动 / 用户手动 / 右键单条）和落点（哪个 Note、哪个位置）

下层做扎实，上层换什么策略都是一行调用差别。

## 2. 覆盖范围

### 在范围内
- Claude 网页对话流里的全部 artifact，**两种 DOM 形态**：
  - **卡片形态**（`.group/artifact-block`）：Code / Document / Diagram / HTML
  - **iframe 形态**（`iframe[src*="claudemcpcontent"]`）：内联渲染的交互可视化
- 形态识别（输入是 DOM 引用或 ordinal，自动判别走哪条路径）
- 内容质量后处理（SVG 编码修复、CSS 变量 fallback）
- 单次下载的原子性（will-download 拦截不串号）
- **`convertIframeToCardInClaude`**：把 iframe 形态转成卡片形态以拿到完整 HTML 源码。**有副作用**（在 Claude 对话留下新卡片），**仅供 Module 5 隐藏 webview 使用**。详见 §11。

### 不在范围内
- 形态切换控制（卡片 ↔ iframe）的自动管理——Claude 决定形态，模块不干预；唯一例外是上述 `convertIframeToCardInClaude` 显式调用
- ordinal 与 API placeholder 对齐（上层职责）
- 多 artifact 的批量调度、进度蒙层、取消逻辑（上层职责）
- 非 Claude 的 AI（ChatGPT / Gemini）

## 3. 已确认的事实（决定设计的约束）

实测于 2026-04-15，对话 `8c7b9c8e-...` 含 5 个 artifact：

### 3.1 卡片形态
- DOM 锚点：`.group/artifact-block`
- 下载按钮：`button[aria-label^="Download "]` 在卡片内，`.click()` **直接触发浏览器下载**，无需 CDP
- title 来源：卡片内 `.leading-tight.text-sm` 的 textContent
- type 来源：卡片内 `.text-xs.text-text-400` 的 textContent，格式 `"Code · GO"` / `"Document · MD"` / `"Diagram · MERMAID"` / `"Code · HTML"`
- 下载文件 = 纯源码/纯文档（`.go` / `.md` / `.mermaid` / `.html`），不被包装
- 卡片通常**不懒加载**（小体积纯 DOM）

### 3.2 iframe 形态
- DOM 锚点：`iframe[src*="claudemcpcontent"]`
- subdomain hash 是 conversation 级的，**不是 artifact id**（同一对话 5 个 iframe 共享 subdomain）
- `src` query string 区分 artifact，但人类不可读
- iframe 内部右上角 hover 出现 `...` 菜单，三项：Copy to clipboard / Download file / **Save as artifact（禁用）**
- 菜单 DOM 在 cross-origin iframe 内，**只能用 CDP 鼠标合成触发**（Radix UI 不响应 dispatchEvent）
- Download file 输出 `.svg` 矢量文件
- SVG 内**中文乱码**（Claude 服务端 latin1/utf-8 编码错位，bug）
- SVG 内 `stroke="var(--color-border-tertiary)"` 等 CSS 变量未解析
- iframe 必须在视口内才可 hover（懒加载）

### 3.3 形态切换不可控
- 同一 artifact 的形态（卡片 / iframe）由 Claude 自行决定
- 用户点过的会变 iframe，没有官方折叠开关
- KRIG 不能依赖任何"全部强制成卡片"的设置

### 3.4 placeholder vs DOM 数量不一致
- API conversation 文本里的 placeholder 数 ≥ DOM artifact 数（重新生成的旧版本残留）
- placeholder info string 始终为空（不包含 type 信息）
- 此模块**不处理对齐**——上层职责

## 4. 公开接口

按"卡片路径 / iframe 路径"拆成两个独立函数，上面再包一个 facade 自动分派。**Save as artifact 单独成 API**（§11）。

```ts
// src/plugins/web-bridge/capabilities/claude-artifact-download.ts

export type ClaudeArtifactKind =
  | { form: 'card'; cardType: 'code'; language: string }
  | { form: 'card'; cardType: 'document'; format: string }      // md / txt
  | { form: 'card'; cardType: 'diagram'; format: string }       // mermaid
  | { form: 'card'; cardType: 'html' }
  | { form: 'iframe'; exportAs: 'svg' }
  | { form: 'iframe'; exportAs: 'png' };

export interface ClaudeArtifactDownload {
  buffer: ArrayBuffer;
  mime: string;
  filename: string;
  kind: ClaudeArtifactKind;
  title: string;
  meta: {
    pathTaken: 'card-button-click' | 'iframe-cdp-menu-svg' | 'iframe-cdp-menu-png';
    encodingFixed?: boolean;          // SVG 是否做了 latin1→utf8 反向解码
    cssFallbackInjected?: boolean;    // SVG 是否注入了 CSS 变量 fallback
    naturalSize?: { w: number; h: number };
    elapsedMs: number;
  };
}

export type ClaudeArtifactDownloadError =
  | { code: 'no-such-artifact'; ordinal: number }
  | { code: 'card-button-not-found'; cardEl: HTMLElement }
  | { code: 'iframe-not-in-viewport'; iframeEl: HTMLIFrameElement }
  | { code: 'cdp-menu-failed'; reason: string }
  | { code: 'download-timeout'; ms: number }
  | { code: 'download-empty' }
  | { code: 'unknown-card-type'; raw: string }
  | { code: 'wrong-form'; expected: 'card' | 'iframe'; actual: 'card' | 'iframe' };

// === 卡片路径（无副作用） ===
export async function downloadClaudeCardArtifact(
  webview: Electron.WebviewTag,
  ref: { cardEl: HTMLElement } | { ordinal: number },
  opts?: { timeout?: number },
): Promise<ClaudeArtifactDownload>;

// === iframe 路径（无副作用） ===
export async function downloadClaudeIframeArtifact(
  webview: Electron.WebviewTag,
  ref: { iframeEl: HTMLIFrameElement } | { ordinal: number },
  opts: { format: 'svg' | 'png'; timeout?: number },
): Promise<ClaudeArtifactDownload>;

// === Facade（按形态自动分派；iframe 默认 svg） ===
export interface ClaudeArtifactRef {
  cardEl?: HTMLElement;
  iframeEl?: HTMLIFrameElement;
  ordinal?: number;
}
export async function downloadClaudeArtifact(
  webview: Electron.WebviewTag,
  ref: ClaudeArtifactRef,
  opts?: { timeout?: number; iframeFormat?: 'svg' | 'png' },
): Promise<ClaudeArtifactDownload>;
```

调用方使用示例：
```ts
// 上层 A：全自动遍历（用 facade，按形态自动分派）
for (let i = 0; i < total; i++) {
  const dl = await downloadClaudeArtifact(webview, { ordinal: i });
  routeToBlock(dl);
}

// 上层 C：用户手动点 KRIG 工具栏按钮，已知是某个卡片
const card = activeArtifactCardUnderMouse();
const dl = await downloadClaudeCardArtifact(webview, { cardEl: card });
insertAtCursor(dl);

// 上层希望对内联可视化拿位图（中文不乱码）
const dl = await downloadClaudeIframeArtifact(webview, { iframeEl }, { format: 'png' });
```

## 5. 内部架构

两条独立路径 + 共享下载 slot + 共享 ref 解析。Facade 只做分派。

```
downloadClaudeArtifact(ref)        ← facade
  └─ resolveRef(ref) → form
      ├─ form='card'   → downloadClaudeCardArtifact(ref)
      └─ form='iframe' → downloadClaudeIframeArtifact(ref, { format: opts.iframeFormat ?? 'svg' })


downloadClaudeCardArtifact(ref)
  ├─ cardEl = resolveCardEl(ref)            ← 错形态抛 wrong-form
  ├─ kind   = probeCardKind(cardEl)         ← 读 .text-xs.text-text-400
  ├─ title  = readCardTitle(cardEl)
  ├─ acquireDownloadSlot()
  ├─ queryDownloadButton(cardEl).click()    ← 主 document 直接 click
  ├─ { buffer, filename, mime } = awaitDownload(timeout)
  └─ releaseDownloadSlot()
  → { buffer, mime, filename, kind, title, meta:{ pathTaken:'card-button-click', elapsedMs } }


downloadClaudeIframeArtifact(ref, { format })
  ├─ iframeEl = resolveIframeEl(ref)        ← 错形态抛 wrong-form
  ├─ ensureInViewport(iframeEl)             ← scroll + 等高度稳定
  ├─ acquireDownloadSlot()                  ← png 路径不需要，但 svg 要
  ├─ if format='svg':
  │     cdpHoverAndClickMenuItem(iframeEl, 'Download file')
  │     { buffer, filename } = awaitDownload(timeout)
  │     buffer = postProcessSvg(buffer)     ← 编码修复 + CSS fallback
  │     pathTaken = 'iframe-cdp-menu-svg'
  │ else if format='png':
  │     cdpHoverAndClickMenuItem(iframeEl, 'Copy to clipboard')
  │     await sleep(700)
  │     buffer = await wbReadClipboardImage()
  │     filename = `artifact-${ts}.png`; mime = 'image/png'
  │     pathTaken = 'iframe-cdp-menu-png'
  ├─ releaseDownloadSlot()
  └─ → ClaudeArtifactDownload
```

### 5.1 resolveRef（facade 内部）

```ts
function resolveRef(ref: ClaudeArtifactRef): { form: 'card' | 'iframe' } {
  if (ref.cardEl) return { form: 'card' };
  if (ref.iframeEl) return { form: 'iframe' };
  // ordinal: 全文档顺序
  const all = [
    ...document.querySelectorAll('.group\\/artifact-block'),
    ...[...document.querySelectorAll('iframe[src*="claudemcpcontent"]')]
       .filter(f => !f.closest('.group\\/artifact-block')),
  ].sort(byDocumentOrder);
  const el = all[ref.ordinal!];
  if (!el) throw { code: 'no-such-artifact', ordinal: ref.ordinal };
  return { form: el.tagName === 'IFRAME' ? 'iframe' : 'card' };
}
```

`downloadClaudeCardArtifact` / `downloadClaudeIframeArtifact` 内部各自再做一次 ref → DOM 的解析（`resolveCardEl` / `resolveIframeEl`），如果调用方传错（卡片函数收到 iframe ref），抛 `wrong-form`。

### 5.2 probeCardKind

`.text-xs.text-text-400` 的 textContent 形如 `"Code · GO"` / `"Document · MD"`：

| 解析结果 | kind |
|---|---|
| `Code · GO` / `Code · PY` / ... | `{ form:'card', cardType:'code', language:'go' }` |
| `Code · HTML` | `{ form:'card', cardType:'html' }` |
| `Document · MD` / `Document · TXT` | `{ form:'card', cardType:'document', format:'md' }` |
| `Diagram · MERMAID` | `{ form:'card', cardType:'diagram', format:'mermaid' }` |
| 其它 | 抛 `unknown-card-type`，上层决定降级 |

注意 `Code · HTML` 是特例（HTML 走 html-embed block，不是 code block）。

### 5.3 ensureInViewport

```ts
async function ensureInViewport(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  // iframe 形态：等高度稳定
  if (el.tagName === 'IFRAME') {
    await waitForStableHeight(el, { minHeight: 100, stableMs: 400, timeout: 3000 });
  }
}
```

卡片本身不懒加载，但 scrollIntoView 仍要做（用户可能滚远了，按钮不在视口内 click 也能成，但 iframe 一定要在视口）。

### 5.4 acquireDownloadSlot（main 端）

main 进程维护一个**单 slot 锁**：
- 同时只能有一个 pending download
- `wbCaptureDownloadOnce(timeoutMs)` 注册一个 one-shot listener，绑定到下一个 will-download 事件
- 拿到 buffer 后立刻释放 listener，下一次调用前必须先解锁

为什么单 slot：will-download 事件没有 request id，多个并发时无法区分谁是谁。串行执行避免歧义。

```ts
// preload exposed
viewAPI.wbCaptureDownloadOnce(timeoutMs: number): Promise<{
  buffer: ArrayBuffer;
  filename: string;
  mime: string;
}>;
```

### 5.5 trigger — card path

```ts
function triggerCardDownload(cardEl: HTMLElement) {
  const btn = cardEl.querySelector('button[aria-label^="Download "]');
  if (!btn) throw { code: 'card-button-not-found', cardEl };
  (btn as HTMLButtonElement).click();
}
```

`button.click()` 已实测可用，触发 native HTMLButtonElement click，React onClick 合成事件正常响应。

### 5.6 trigger — iframe path

`downloadClaudeIframeArtifact` 内部按 format 调用同一个 `cdpHoverAndClickMenuItem(iframeEl, menuItem)`，菜单项不同：

| format | menuItem | MENU_OFFSETS |
|---|---|---|
| svg | `Download file`（菜单第二项） | `dx=-80, dy=+81` |
| png | `Copy to clipboard`（菜单第一项） | `dx=-80, dy=+45` |

复用现有 `claude-artifact-extractor.ts` 的 CDP 鼠标合成机制：

```ts
async function cdpHoverAndClickMenuItem(iframeEl: HTMLIFrameElement, item: 'Download file' | 'Copy to clipboard') {
  const rect = await scrollAndReadRect(iframeEl);
  // 1. hover 三段轨迹：屏幕外 → iframe 中心 → 右上角 ... 热区
  await wbSendMouse([
    { type: 'mouseMoved', x: -100, y: rect.top + rect.height / 2 },
    { type: 'mouseMoved', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { type: 'mouseMoved', x: rect.right - 30, y: rect.top + 30 },
  ]);
  await sleep(250);  // 菜单弹出
  // 2. 移到指定菜单项
  const off = MENU_OFFSETS[item === 'Download file' ? 'downloadFile' : 'copyToClipboard'];
  await wbSendMouse([
    { type: 'mouseMoved', x: rect.right - 30 + off.dx, y: rect.top + 30 + off.dy },
  ]);
  await sleep(100);
  // 3. 点击
  await wbSendMouse([
    { type: 'mousePressed', button: 'left' },
    { type: 'mouseReleased', button: 'left' },
  ]);
}
```

下载路径触发的 Claude 下载确认弹窗（"This app wants to download a file"）由 main 端 will-download hook 自动 accept，无需 UI 交互。剪贴板路径触发后等待 700ms 让图像写入剪贴板，然后 `wbReadClipboardImage()` 读出。

**`Save as artifact`（菜单第三项，`dx=-80, dy=+117`）不在本节范围内**，见 §11。

### 5.7 postProcess — SVG 后处理

#### 5.7.1 编码修复

```ts
function tryFixSvgEncoding(text: string): { fixed: string; ok: boolean } {
  // 检测：含连续 mojibake 模式（中文 utf-8 三字节被 latin1 解读后的特征）
  const mojibakePattern = /[\u00c2-\u00ef][\u0080-\u00bf]{1,2}/g;
  if (!mojibakePattern.test(text)) return { fixed: text, ok: true };

  // 反向解码：当前字符串当成 latin1 写出的 bytes，按 utf8 重新解读
  try {
    const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xff));
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // 验证：修复后包含可识别的中日韩字符
    if (/[\u3000-\u9fff]/.test(fixed)) return { fixed, ok: true };
    return { fixed: text, ok: false };
  } catch {
    return { fixed: text, ok: false };
  }
}
```

如果修复失败，**返回 `meta.encodingFixed=false`**，调用方可以看 meta 决定是否 fallback PNG（重新调 download 走 `preferIframeFormat:'png'`）。

#### 5.7.2 CSS 变量 fallback 注入

Claude SVG 的 CSS 变量集合（已知，需要根据更多样本扩充）：

```ts
const CSS_FALLBACK = `
<style>
  :root {
    --color-border-tertiary: rgba(222, 220, 209, 0.15);
    --color-border-secondary: rgba(222, 220, 209, 0.3);
    --color-text-primary: #1a1a1a;
    --color-bg-primary: #ffffff;
    /* TODO: 收集更多变量 */
  }
</style>
`;

function injectCssFallback(svg: string): string {
  // SVG 没有 <head>，把 style 插到 <defs> 内或 <svg> 第一个子元素
  return svg.replace(/<defs[^>]*>/, m => m + CSS_FALLBACK);
}
```

### 5.8 SVG → PNG 自动 fallback（facade 内）

facade `downloadClaudeArtifact` 看到 iframe + svg 路径返回 `meta.encodingFixed=false` 时，**不自动 fallback**，而是把结果原样返回给上层。原因：

- "fallback PNG"是个有损降级（位图代替矢量），调用方应该有知情权
- facade 负责"按形态分派"，不负责"按质量降级"
- 上层若想自动重试，明确再调一次 `downloadClaudeIframeArtifact(ref, { format: 'png' })`

如果未来发现某些 SVG 几乎必然乱码（比如 detect 到中文字体名称），可以考虑给 facade 加 `opts.autoFallbackPng = true`，默认 false。

## 6. 错误模型

每个失败点对应一个 `ClaudeArtifactDownloadError`，调用方据此决定行为：

| 错误 | 含义 | 上层建议 |
|---|---|---|
| `no-such-artifact` | ordinal 越界 | abort，提示 placeholder 与 DOM 不匹配 |
| `card-button-not-found` | 卡片 DOM 异常（Claude 改版？） | 跳过 + 上报埋点 |
| `iframe-not-in-viewport` | scroll 后高度未稳定 | 重试一次，仍失败则跳过 |
| `cdp-menu-failed` | 三段 hover 后菜单未弹出 / 点击后无反应 | 重试 1 次（dwell 加长），仍失败则跳过 |
| `download-timeout` | 触发后 N ms 内 will-download 未触发 | 跳过 |
| `download-empty` | buffer 为空 | 跳过 |
| `unknown-card-type` | type 标签未识别 | 上层降级到 fallback block（如纯 text） |
| `wrong-form` | 调用方用 `downloadClaudeCardArtifact` 传了 iframe ref，反之亦然 | 调用方修代码；facade 不会出这个错 |

## 7. 单次原子性保证

- 一个 `downloadClaudeArtifact` 调用对应**最多一个** will-download 事件
- main 端在调用开始时注册 listener，结束时移除
- 调用之间不能并发（will-download 无法关联）—— 上层用顺序循环或 mutex
- 超时后 listener 必须移除（否则下次调用会抢到上次残留）

## 8. 已知不解决的问题（明确边界）

1. **Claude UI 改版**：`MENU_OFFSETS`、`.group/artifact-block` class 名等都是反向工程结果，Claude 改一次 UI 就要重新校准。模块要把这些常量集中到一个 `claude-ui-constants.ts`，方便定位修改。
2. **形态切换不可控**：用户点过的 iframe 不会自动收回卡片。模块只看当前 DOM，不试图改变它。
3. **placeholder ↔ DOM 对齐**：上层职责。本模块只对一个明确的 ref 负责。
4. **下载弹窗的 OS 级权限**：macOS Catalina+ 可能对下载触发系统授权。Electron `will-download` 应该能绕过，需要实测确认。
5. **多窗口 / 多 webview 并发**：本模块假设单 webview 操作，多个并发要由上层串行化。
6. **完整 CSS 变量集**：v1 只覆盖 SVG 里观察到的 4-5 个变量，未来需要持续收集。

## 9. 代码组织

```
src/plugins/web-bridge/capabilities/
  claude-artifact-download.ts                   ← 模块入口（Claude 专属）
                                                   导出 downloadClaudeArtifact (facade)
                                                         downloadClaudeCardArtifact
                                                         downloadClaudeIframeArtifact
                                                         convertIframeToCardInClaude (§11)
  claude-artifact-download/
    resolve-ref.ts                              ← ClaudeArtifactRef → DOM + form
    probe-card-kind.ts                          ← 卡片 DOM → ClaudeArtifactKind
    card-path.ts                                ← downloadClaudeCardArtifact 内核
    iframe-path.ts                              ← downloadClaudeIframeArtifact 内核（CDP 菜单 svg/png）
    svg-postprocess.ts                          ← 编码修复 + CSS fallback
    download-slot.ts                            ← will-download 单 slot 锁
    convert-iframe-to-card.ts                   ← §11 独立 API（仅 Module 5 使用）
    claude-ui-constants.ts                      ← 反向工程常量集中
                                                   .group/artifact-block selector
                                                   MENU_OFFSETS（含 saveAsArtifact）
                                                   CSS 变量 fallback 集
```

### 9.1 整合策略（清理现有代码，不留技术债）

现有 [claude-artifact-extractor.ts](../../src/plugins/web-bridge/capabilities/claude-artifact-extractor.ts)（22 KB）的内容**必须主动消化**进新结构，不允许新旧并存。迁移表：

| 现有内容 | 去向 |
|---|---|
| `MENU_OFFSETS` 常量 | `claude-ui-constants.ts`（含 `saveAsArtifact` 偏移） |
| `scrollAndReadRect()` | `iframe-path.ts` 内部工具 |
| `clickArtifactMenuItem()` | `iframe-path.ts`，重命名 `cdpHoverAndClickMenuItem()` |
| `extractArtifactImage()` | **删除**——被 `downloadClaudeIframeArtifact({ format:'png' })` 取代 |
| `extractArtifactSource()` | **删除**——原假设"download→html"已被证伪（实际是 svg） |
| `listArtifacts()` | `resolve-ref.ts` 内部使用 |
| `triggerArtifactSave()` | `convert-iframe-to-card.ts`，重命名 `convertIframeToCardInClaude()` |
| `WB_CAPTURE_DOWNLOAD_ONCE` IPC | main 端保留，由 `download-slot.ts` 包装调用 |

完成后 `claude-artifact-extractor.ts` **整个删除**。外部调用方（经 grep 确认）只有 1 处：[src/plugins/ai-note-bridge/pipeline/claude-artifacts.ts](../../src/plugins/ai-note-bridge/pipeline/claude-artifacts.ts)——随迁移一并改 import 和函数名。

不保留任何"过渡 shim"或"deprecated 导出"。

## 10. 测试计划

### 10.1 手动 checklist（必过）

- [ ] 新建测试对话，让 Claude 生成 6 个 artifact：1 Go / 1 Python / 1 Markdown / 1 Mermaid / 1 HTML / 1 React 可视化
- [ ] 对每个 artifact 调用 `downloadClaudeArtifact({ ordinal: i })`，断言：
  - [ ] kind 正确
  - [ ] buffer 非空
  - [ ] filename 合理
  - [ ] SVG 中文修复成功（用第一性原理那种含中文的可视化测）
- [ ] 同对话先全部以卡片形态测一遍，再点开几个变 iframe 再测一遍
- [ ] 故意让 ordinal 越界 → 抛 `no-such-artifact`
- [ ] 故意离线 → 抛 `download-timeout`

### 10.2 自动化测试

- 单元测试：`probe-kind`、`svg-postprocess`、`resolve-ref` 用 jsdom 跑
- 集成测试：依赖真实 Claude 页面，留作手动

### 10.3 回归监测

每次 Claude UI 改版可能让本模块失效。建议在 KRIG 启动时跑一个 smoke test：扫 `.group/artifact-block` 选择器是否还命中已知页面元素，命中失败 log warning。

## 11. Module 5 集成：`convertIframeToCardInClaude`（有副作用）

iframe 形态 artifact 的 Download file 输出是 `.svg`（矢量但中文乱码），Copy to clipboard 输出是 PNG（位图）。两者都**拿不到 HTML 源码**——而 Module 5（KRIG 内置 Gemma / 本地 AI）需要源码来理解、加工、再生成 artifact。

唯一拿到 HTML 源码的路径是 Claude 菜单第三项 **Save as artifact**：它会把 iframe 转成一张新的 `Code · HTML` 卡片，卡片的 Download 按钮就能下载完整 HTML。

**副作用**：转换后 Claude 对话里**永久新增一张卡片**，无法撤销。

### 11.1 适用边界

- ✅ **允许**：在**隐藏 webview**（Module 5 后台 AI 自己的 Claude session）中使用——卡片污染不影响用户视图，webview 销毁后副本随之丢失
- ❌ **禁止**：在用户当前正在交互的 Claude 对话里使用——会让用户对话凭空多出"Saved artifact"，令人困惑

### 11.2 接口

```ts
export interface ConvertResult {
  cardEl: HTMLElement;           // 新生成的卡片 DOM 引用
  preExistingCardCount: number;  // 操作前的卡片数（用于回滚或验证）
}

export async function convertIframeToCardInClaude(
  webview: Electron.WebviewTag,
  ref: { iframeEl: HTMLIFrameElement } | { ordinal: number },
  opts?: { timeout?: number },
): Promise<ConvertResult>;
```

### 11.3 实现

复用 §5.6 的 CDP 鼠标合成，菜单项换成第三项 `Save as artifact`（`MENU_OFFSETS.saveAsArtifact: dx=-80, dy=+117`），等待 `.group/artifact-block` 数量增加 1：

```ts
async function convertIframeToCardInClaude(webview, ref) {
  const iframeEl = resolveIframeEl(ref);
  await ensureInViewport(iframeEl);
  const beforeCount = document.querySelectorAll('.group\\/artifact-block').length;
  await cdpHoverAndClickMenuItem(iframeEl, 'Save as artifact');
  const cardEl = await waitFor(() => {
    const cards = document.querySelectorAll('.group\\/artifact-block');
    if (cards.length > beforeCount) return cards[cards.length - 1];
  }, { timeout: opts?.timeout ?? 5000 });
  return { cardEl, preExistingCardCount: beforeCount };
}
```

### 11.4 典型用法（Module 5 后台 AI）

```ts
// 隐藏 webview 已加载 Claude 某对话
const { cardEl } = await convertIframeToCardInClaude(hiddenWebview, { ordinal: 3 });
const dl = await downloadClaudeCardArtifact(hiddenWebview, { cardEl });
// dl.kind = { form:'card', cardType:'html' }，dl.buffer 是完整 HTML 源码
// 给 Gemma 当上下文
hiddenWebview.destroy();  // 卡片副本也随之丢失
```

### 11.5 安全检查

调用方有义务：
- 确认当前 webview 是隐藏 / 后台用途
- 调用前 log 一条警告（包含 webview id），方便排查"用户对话被污染"的 bug
- 不要在主 webview 暴露 UI 入口让用户能触发这个函数

模块内部**不做**这些检查——边界由调用方界定，本模块只忠实执行。

## 12. 实施顺序（约 5 天）

1. **D1**：搭 `download-slot.ts` + main 端 will-download hook 重构（若现有 `WB_CAPTURE_DOWNLOAD_ONCE` 已可用就直接用）
2. **D2**：`card-path.ts` + `probe-card-kind.ts` + `resolve-ref.ts`，`downloadClaudeCardArtifact` 跑通 4 类卡片
3. **D3**：`iframe-path.ts`（复用现有 CDP 代码），`downloadClaudeIframeArtifact` 跑通 SVG + PNG 两种 format
4. **D4**：`svg-postprocess.ts`（编码修复 + CSS fallback），收集 CSS 变量样本
5. **D5**：facade `downloadClaudeArtifact`、错误处理统一、`convertIframeToCardInClaude`（§11）、手动测试 checklist 全过

完工标志：
- `downloadClaudeCardArtifact` 对 4 类卡片成功率 ≥ 99%
- `downloadClaudeIframeArtifact { svg }` 中文乱码修复成功率 ≥ 90%（取决于 Claude SVG bug 稳定性）
- `downloadClaudeIframeArtifact { png }` 成功率 ≥ 95%
- `convertIframeToCardInClaude` 在隐藏 webview 中成功率 ≥ 95%
- 单次调用 ≤ 5 秒
- **`claude-artifact-extractor.ts` 已删除**，[claude-artifacts.ts](../../src/plugins/ai-note-bridge/pipeline/claude-artifacts.ts) 已改用新接口，repo 内 grep 无遗留 import
