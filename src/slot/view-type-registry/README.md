# view-type-registry — view 类型注册中心

按 charter § 1.4 + § 1.2:L5 view 通过 `registerView({...})` 注册自身。
注册时自动把子字段(contextMenu / toolbar / slash / handle / floatingToolbar)
拆分到对应 Registry,view 字段自动补为 view ID。

## 使用模式(L5 view)

```ts
import { registerView } from '@slot/view-type-registry/register-view';

registerView({
  id: 'note',
  install: ['text-editing', 'history'],
  contextMenu: [
    { id: 'copy', label: 'Copy', command: 'note.copy' },
  ],
});
```
