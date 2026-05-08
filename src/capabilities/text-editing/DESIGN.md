# text-editing capability

PM 编辑能力封装。capability 内部依赖 `@drivers/text-editing-driver`(driver 持有
prosemirror-* npm 包,view 不可见)。

view install 路径:`install: ['text-editing']`(W5 严格收尾:不再有 `text-editing-driver`)。

## 对外面孔

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi, MarkName, DriverSerialized } from '@capabilities/text-editing/types';

// 业务路径(view render / 命令 handler)
const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');

// 渲染 PM 实例
<textEditing.Host
  config={{ instanceId: wsId, undoScope: 'note-view.pm', viewId: 'note-view' }}
  doc={note.doc}
  onChange={handleChange}
/>

// 命令式 driver API(toggleMark / setHeading / etc.)
textEditing.api.toggleMark(wsId, 'bold');

// view 注入 link-click 路由
textEditing.setLinkClickHandler({ onOpenNote, onOpenWebUrl, ... });
```

## 历史(W5 C4)

W4.x 期间存在过渡方案:
- view 层 11 处文件直 import `@drivers/text-editing-driver`
- `install: [..., 'text-editing-driver']` 含 driver id(`KNOWN_DRIVER_IDS` 白名单豁免)

W5 严格收尾:
- 新建本 capability 作为对外门面(driver 内部不动)
- view 11 处 import 全切到 `@capabilities/text-editing` 间接路由
- `install` 改 `['text-editing']`,`KNOWN_DRIVER_IDS` 整文件删除
- charter v0.4 工程可执行严格态(间接路由)达成

## 装配关系

```
view (note)
  ↓ install: ['text-editing']
  ↓ requireCapabilityApi<TextEditingApi>('text-editing')
capability.text-editing (本目录)
  ↓ import { textEditingDriverApi, ... } from '@drivers/text-editing-driver'
driver.text-editing-driver (driver 持有 prosemirror-* npm)
```
