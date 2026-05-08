/**
 * web-rendering capability — 对外类型(Wave 5 / D4)
 *
 * view 端 import:
 *   import type { WebRenderingApi, HostHandle, WebContextMenuPayload } from '@capabilities/web-rendering/types';
 */

export type { HostProps } from './Host';
export type { TranslateHostProps } from './translate-host';
export type {
  HostHandle,
  WebContextMenuPayload,
  WebviewElement,
} from './webview-types';

import type { ComponentType } from 'react';
import type { HostProps } from './Host';
import type { TranslateHostProps } from './translate-host';
import type { HostHandle } from './webview-types';

/** view 业务路径 API(WebView / TranslateWebView 用)*/
export interface WebRenderingApi {
  /** 普通 webview Host(forwardRef HostHandle)*/
  Host: ComponentType<HostProps & { ref?: React.Ref<HostHandle> }>;
  /** 翻译模式 Host */
  TranslateHost: ComponentType<TranslateHostProps>;
}
