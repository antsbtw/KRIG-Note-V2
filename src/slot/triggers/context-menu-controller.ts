/**
 * ContextMenu Controller — 控制 ContextMenuBinding 显示状态
 *
 * 模式:triggers 监听 DOM → 调 controller.show() → binding 重渲显示菜单
 */

import type { ContextInfo } from '../interaction-registries/context-menu-registry/context-menu-types';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  viewId: string;
  context: ContextInfo;
}

const initialState: ContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  viewId: '',
  context: {
    hasSelection: false,
    isEditable: false,
    hasLink: false,
    hasMarks: false,
    hasBlockSelection: false,
    thoughtId: null,
    pmInstanceId: null,
    x: 0,
    y: 0,
  },
};

class ContextMenuController {
  private state: ContextMenuState = initialState;
  private listeners: Set<() => void> = new Set();

  show(x: number, y: number, viewId: string, context: ContextInfo): void {
    this.state = { visible: true, x, y, viewId, context };
    this.notify();
  }

  hide(): void {
    if (!this.state.visible) return;
    this.state = { ...this.state, visible: false };
    this.notify();
  }

  getState(): ContextMenuState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const contextMenuController = new ContextMenuController();
