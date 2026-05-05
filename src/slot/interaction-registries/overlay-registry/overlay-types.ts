/** 通用 Overlay 类型(帮助 / dialog / 进度等) */

import type { ReactElement } from 'react';

export interface OverlayDefinition {
  id: string;
  /** 关联 view(undefined = 全局,所有 view 可显示)*/
  view?: string;
  /** Overlay 内容渲染器(React 组件)*/
  render: () => ReactElement;
  /** 触发命令 ID(注册到 commandRegistry)— 调用此命令显示 Overlay */
  triggerCommand?: string;
}
