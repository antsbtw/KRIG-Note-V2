# web-sync-driver

renderer 侧双 webview 事件同步引擎。从 `views/web/sync/` 物理迁移过来(audit Wave 4.2 C1)。

## 接口注入(charter § 1.1 单向调用)

```ts
import { SyncDriver } from '@drivers/web-sync-driver';
import { slotBus } from '...';  // capability 内部 / view 端实例

const driver = new SyncDriver(
  'left',          // side
  slotBus,         // bus 接口注入(必填)
  onInputEnter,    // optional callback
  isBusy,          // optional guard
);
```

driver **不直接 import** 任何 view/capability 模块。bus 由实例化方提供具体实现,
SyncBus 接口形态见 [sync-driver.ts](./sync-driver.ts)。

## 协议

| Action | 方向 | 用途 |
|---|---|---|
| `wt:navigate` | controller → passive | URL 变更通知 |
| `wt:request-url` | 右 → 左 | 右栏请求左栏发送当前 URL |
| `wt:ready` | 右 → 左 | 右栏页面就绪可同步 |
| `wt:sync-events` | controller → passive | 同步事件批量传输 |
| `wt:take-control` | 新 controller → 旧 | 控制权交接 |

详见 [sync-protocol.ts](./sync-protocol.ts)。

## 内部脚本

[sync-inject.js](./sync-inject.js) 通过 Vite `?raw` import 字符串读入,
执行时占位符 `__KRIG_SIDE__` 用 `/g` 全局替换为本侧标记。
