# web-rendering capability

封装 Electron `<webview>` tag 的整个生命周期 + SyncDriver / TranslateDriver 编排。

view 层 install 时只声明 `'web-rendering'`(audit review P1-A:**不列 driver ID**),
两个底层 driver 是 capability 内部实现细节,view 不可见。

详见 [docs/RefactorV2/audit/wave4-design/W4.2-web-rendering-capability.md](../../../docs/RefactorV2/audit/wave4-design/W4.2-web-rendering-capability.md)。

## 对外面孔

```ts
import { Host, TranslateHost } from '@capabilities/web-rendering';

// 普通 webview(支持 imperative ref)
<Host
  ref={hostRef}                     // HostHandle:loadURL / goBack / goForward / reload / stop / isLoading
  workspaceId={wsId}
  currentUrl={wsState.currentUrl}
  translateMode={isTranslateMode}
  partition={WEBVIEW_PARTITION}
  className="..."
  onContextMenu={(payload) => showWebContextMenu(payload)}
  onUrlChanged={(url) => setWebUrl(wsId, url)}
  onLoadingChanged={setLoading}
  onNavStateChanged={({ canGoBack, canGoForward }) => { /* ... */ }}
  onDisplayUrlChanged={setDisplayUrl}
/>

// 翻译模式 webview(右栏被动)
<TranslateHost
  workspaceId={wsId}
  partition={WEBVIEW_TRANSLATE_PARTITION}
  targetLang={wsState.targetLang}
  className="..."
/>
```

## 内部组件

| 文件 | 职责 |
|---|---|
| [Host.tsx](./Host.tsx) | 普通 webview 编排 + 左侧 SyncDriver lifecycle |
| [translate-host.tsx](./translate-host.tsx) | 翻译 webview 编排 + 右侧 SyncDriver + TranslateDriver |
| [slot-bus.ts](./slot-bus.ts) | capability 内部跨 slot pubsub(不对外暴露)|
| [webview-types.ts](./webview-types.ts) | WebviewElement / HostHandle / WebContextMenuPayload |

## 装配关系

- capability → driver(charter § 1.3 capability 封装 driver 的合规向下调用)
- driver 之间 0 import(铁律 5,SyncDriver / TranslateDriver 互独立)
- slot-bus 通过接口注入到 SyncDriver(driver 不直接依赖 capability 模块)
