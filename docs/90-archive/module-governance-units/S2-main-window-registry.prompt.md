# S2 执行 Prompt — 主进程窗口注册表（mainWindow 单例 → Map）

## 背景

这是多窗口架构治理 step2 核心改动（S2）。

**目标**：把 `src/platform/main/window/main-window.ts` 的模块级单例 `mainWindow` 改成**窗口注册表** `Map<windowId, { win: BrowserWindow; wsId: string | null }>`，并让 `createMainWindow()` → `createWindow(wsId?)` 支持多次调用（每次创建一个新窗口）。

**范围**：仅改 L1 层（`platform/main/window/` + 直接调用方），**不改** renderer、storage、workspace 等。

---

## 现状（需要改的）

**文件**：`src/platform/main/window/main-window.ts`

```typescript
// 第 19 行 — 模块级单例
let mainWindow: BrowserWindow | null = null;

// 第 24 行 — 每次调用覆盖单例
export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({ ... });
  // ...
  win.on('closed', () => {
    mainWindow = null;   // 第 94 行 — 关闭时清 null（多窗口下会误清别的窗口引用）
  });
  mainWindow = win;     // 第 98 行 — 覆盖
  // ...
  return win;
}

// 第 108 行 — 只返回最后一个
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
```

---

## 改动要求

### 1. 替换单例为注册表

```typescript
// 删除
let mainWindow: BrowserWindow | null = null;

// 新增
const windowRegistry = new Map<number, { win: BrowserWindow; wsId: string | null }>();
```

### 2. `createMainWindow` → `createWindow(wsId?)`

```typescript
export async function createWindow(wsId?: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({ ... });  // 创建逻辑不变

  // closed 事件：从注册表删除自己（不影响其他窗口）
  win.on('closed', () => {
    windowRegistry.delete(win.id);
  });

  // 注册到 Map
  windowRegistry.set(win.id, { win, wsId: wsId ?? null });

  // reportL1Alive 保持（传 win.id）
  reportL1Alive({ windowId: win.id, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  return win;
}

// 向后兼容保留（调用方在改完前还在用 createMainWindow）
export async function createMainWindow(): Promise<BrowserWindow> {
  return createWindow();
}
```

### 3. 替换 `getMainWindow`，新增 `getWindow` / `getAllWindows`

```typescript
// 取指定 id 的窗口
export function getWindow(windowId: number): BrowserWindow | null {
  return windowRegistry.get(windowId)?.win ?? null;
}

// 取所有窗口（替代 BrowserWindow.getAllWindows() 的语义，只返回本 app 创建的）
export function getAllWindows(): BrowserWindow[] {
  return Array.from(windowRegistry.values()).map((e) => e.win);
}

// 取某 ws 对应的窗口（多窗口下一 ws 对应一 window）
export function getWindowByWsId(wsId: string): BrowserWindow | null {
  for (const { win, wsId: wid } of windowRegistry.values()) {
    if (wid === wsId) return win;
  }
  return null;
}

// 向后兼容：旧调用方用 getMainWindow() 的地方，先临时返回第一个窗口
// （后续 S3/S4 完成后再逐一替换调用方）
export function getMainWindow(): BrowserWindow | null {
  const first = windowRegistry.values().next().value;
  return first?.win ?? null;
}
```

### 4. 找到所有调用方，确认不需要改动（或仅调整）

先 grep：
```bash
grep -rn "createMainWindow\|getMainWindow" src/platform/main/ --include="*.ts"
```

对每个调用点：
- `createMainWindow()` 调用 → 暂时保留（向后兼容 wrapper 还在），**不需要改**。
- `getMainWindow()` 调用 → 暂时保留（向后兼容 wrapper 还在），**不需要改**。
- 若有直接操作 `mainWindow` 变量的地方（不经函数）→ **需要改成通过 `getMainWindow()` 取**。

---

## 验收标准

```bash
# 1. 模块级 let mainWindow 变量已消失
grep -n "^let mainWindow" src/platform/main/window/main-window.ts
# 期望：0 行

# 2. windowRegistry Map 已存在
grep -n "windowRegistry" src/platform/main/window/main-window.ts
# 期望：≥3 行（声明 + set + delete）

# 3. createWindow 函数已导出
grep -n "export.*createWindow" src/platform/main/window/main-window.ts
# 期望：≥1 行

# 4. getAllWindows / getWindow 已导出
grep -n "export.*getAllWindows\|export.*getWindow" src/platform/main/window/main-window.ts
# 期望：≥2 行

# 5. tsc 编译通过
npx tsc --noEmit
```

---

## 注意事项

1. `win.on('closed', ...)` 里必须用 `win.id`（`windowId`）而非 `mainWindow = null`。因为关闭事件触发时 `win` 实例仍可访问，`win.id` 是稳定的数字 id。
2. 向后兼容 wrapper（`createMainWindow` / `getMainWindow`）在本次 S2 **保留**，等 S3/S4 完成后再删。本次只做「单例→注册表」的底层改动，不影响上层调用方。
3. `reportL1Alive` 的 `windowId` 参数已有，直接传 `win.id`（类型是 number，与现状一致）。
4. 不要改 BrowserWindow 的 `webPreferences`、`will-attach-webview`、`setWindowOpenHandler` 等逻辑，只改注册表部分。
5. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
