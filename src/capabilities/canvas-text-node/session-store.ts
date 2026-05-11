/**
 * session-store — 单一活跃编辑会话的命令式 → React 桥
 *
 * canvas-text-node.enterEdit(opts) 命令式 API 触发 setSession,EditOverlay
 * (挂在 view 顶层)订阅 store 变化 → 渲染 popup.
 * 同一时刻最多一个 session(V1 模式:enter 时若已有 session 先 commit 当前).
 */

import type { EnterEditOptions, EditSession } from './types';

export interface ActiveSession {
  opts: EnterEditOptions;
}

type Listener = () => void;

class SessionStore {
  private active: ActiveSession | null = null;
  private listeners = new Set<Listener>();

  get(): ActiveSession | null {
    return this.active;
  }

  set(opts: EnterEditOptions): EditSession {
    // 已有 session 时先 commit(对齐 V1 EditOverlay.enter:78)
    if (this.active) {
      const prev = this.active.opts;
      // 命令式 commit 旧 session:无 latest doc 信息(由 EditOverlay React 组件持有),
      // 触发 onExit(null) 让旧 session 写丢失态.实际生产环境基本只 active 1 个 —
      // double-enter 是边缘情况,这里 fallback 安全.
      try {
        prev.onExit(prev.instanceId, null);
      } catch (e) {
        console.warn('[canvas-text-node/session-store] onExit threw on auto-commit', e);
      }
    }
    this.active = { opts };
    this.emit();
    return {
      // 命令式 exit 主要给外部"强制关闭"场景用(view unmount 等);
      // 编辑结束的正常路径走 EditOverlay 内部 onExit + clear(它持有最新 doc).
      // 这里命令式 commit 拿不到 latest doc,等同 commit=false(丢弃),只 clear 状态.
      exit: (_commit: boolean): void => {
        if (!this.active || this.active.opts.instanceId !== opts.instanceId) return;
        opts.onExit(opts.instanceId, null);
        this.active = null;
        this.emit();
      },
      isActive: (): boolean =>
        this.active !== null && this.active.opts.instanceId === opts.instanceId,
    };
  }

  clear(): void {
    if (!this.active) return;
    this.active = null;
    this.emit();
  }

  isActive(): boolean {
    return this.active !== null;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch (e) { console.error('[session-store] listener threw', e); }
    }
  }
}

export const sessionStore = new SessionStore();
