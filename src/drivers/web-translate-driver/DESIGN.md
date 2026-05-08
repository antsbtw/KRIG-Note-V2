# web-translate-driver

renderer 侧 Google Translate widget 注入引擎。从 `views/web/translate/` 物理迁移过来(audit Wave 4.2 C2)。

## 用法

```ts
import { TranslateDriver } from '@drivers/web-translate-driver';

const td = new TranslateDriver('zh-CN');
await td.inject(webviewElement);
// td.injecting → true 期间,SyncDriver 应跳过 poll(用 isBusy callback)
```

## 注入策略

- Step 1 (CSP):移除 webview 内 CSP meta + MutationObserver 防新加
- Step 2 (fetch element.js):走 main 进程 IPC(`window.electronAPI.translateFetchElementJs`),避免 webview 自身 CSP block
- Step 3-5:顺序注入 google-translate-inject.js + element.js + 暗色 meta(fire-and-forget .then 链)
- 每次 did-finish-load 触发新的 inject,旧的通过 injectId 比对自然丢弃

## 注入脚本

[google-translate-inject.js](./google-translate-inject.js) 通过 Vite `?raw` import,
执行时占位符 `__KRIG_TARGET_LANG__` 用 `/g` 全局替换为目标语言代码。
