/**
 * ContextMenuPopover 数据契约
 */

import type { ReactNode } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  separator?: boolean;
  disabled?: boolean;
  /** 命令字符串(优先) */
  command?: string;
  commandArg?: unknown;
  /** 或本地 onClick(适合一次性闭包) */
  onClick?: () => void;
}

export interface ContextMenuPopoverProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}
