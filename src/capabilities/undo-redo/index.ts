/**
 * undo-redo capability — 协议地基
 *
 * 见 COMMON-PROTOCOL.md § 3.3。
 *
 * L5-A:scope 注册表骨架 + channel(没有真实 undo,driver 占位 noop)。
 * L5-B 加 prosemirror-history 时,driver 注册真实 scope。
 */

import { ChannelHub } from '@shared/event-bus/channel';
import { capabilityRegistry } from '@slot/capability-registry/capability-registry';

export interface UndoScopeRegistration {
  scope: string;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

class UndoRedoCapability {
  readonly id = 'undo-redo';
  readonly version = '0.1.0';

  private channels = new ChannelHub();
  private scopes = new Map<string, UndoScopeRegistration>();
  private activeScope: string | null = null;

  registerScope(reg: UndoScopeRegistration): void {
    this.scopes.set(reg.scope, reg);
  }

  unregisterScope(scope: string): void {
    this.scopes.delete(scope);
    if (this.activeScope === scope) this.activeScope = null;
  }

  notifyChanged(scope: string): void {
    const reg = this.scopes.get(scope);
    if (!reg) return;
    this.channels.emit('history.changed', {
      scope,
      canUndo: reg.canUndo(),
      canRedo: reg.canRedo(),
    });
  }

  subscribe(listener: (payload: { scope: string; canUndo: boolean; canRedo: boolean }) => void): () => void {
    return this.channels.subscribe('history.changed', (p) => listener(p as Parameters<typeof listener>[0]));
  }

  api = {
    getActiveScope: (): string | null => this.activeScope,
    setActiveScope: (scope: string | null): void => {
      this.activeScope = scope;
    },
    canUndo: (scope?: string): boolean => {
      const target = scope ?? this.activeScope;
      if (!target) return false;
      return this.scopes.get(target)?.canUndo() ?? false;
    },
    canRedo: (scope?: string): boolean => {
      const target = scope ?? this.activeScope;
      if (!target) return false;
      return this.scopes.get(target)?.canRedo() ?? false;
    },
  };

  /** 由 commandRegistry 'undo-redo.undo' handler 调 */
  performUndo(scope?: string): boolean {
    const target = scope ?? this.activeScope;
    if (!target) return false;
    const reg = this.scopes.get(target);
    if (!reg) return false;
    const ok = reg.undo();
    if (ok) this.notifyChanged(target);
    return ok;
  }

  performRedo(scope?: string): boolean {
    const target = scope ?? this.activeScope;
    if (!target) return false;
    const reg = this.scopes.get(target);
    if (!reg) return false;
    const ok = reg.redo();
    if (ok) this.notifyChanged(target);
    return ok;
  }

  get scopeCount(): number {
    return this.scopes.size;
  }
}

export const undoRedo = new UndoRedoCapability();

// Wave 1:注册到 Registry,让 install 可校验(charter § 1.2)
capabilityRegistry.register({ id: undoRedo.id });
