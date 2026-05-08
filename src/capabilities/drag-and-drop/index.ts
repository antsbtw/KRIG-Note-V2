/**
 * drag-and-drop capability — 协议地基
 *
 * 见 COMMON-PROTOCOL.md § 3.4。
 *
 * L5-A:dropTarget 注册表骨架 + channel(没有真实拖动,driver 占位)。
 */

import { ChannelHub } from '@slot/workspace-bus/channel';
import { capabilityRegistry } from '@slot/capability-registry/capability-registry';

export interface DropTargetRegistration {
  id: string;
  accepts: string[];
  computeDropPoint: (
    coords: { x: number; y: number },
    view: unknown,
  ) => { pos: number; valid: boolean } | null;
  onDrop: (input: { source: unknown; target: { pos: number }; dataTransfer: DataTransfer }) => void;
}

class DndCapability {
  readonly id = 'drag-and-drop';
  readonly version = '0.1.0';

  private channels = new ChannelHub();
  private dropTargets = new Map<string, DropTargetRegistration>();
  private currentSource: { type: string; data?: unknown } | null = null;

  registerDropTarget(reg: DropTargetRegistration): void {
    this.dropTargets.set(reg.id, reg);
  }

  unregisterDropTarget(id: string): void {
    this.dropTargets.delete(id);
  }

  emit(
    channelName: 'dnd.started' | 'dnd.over' | 'dnd.completed',
    payload: unknown,
  ): void {
    this.channels.emit(channelName, payload);
    if (channelName === 'dnd.started') {
      this.currentSource = (payload as { source: { type: string; data?: unknown } }).source;
    }
    if (channelName === 'dnd.completed') {
      this.currentSource = null;
    }
  }

  subscribe<T = unknown>(
    channelName: 'dnd.started' | 'dnd.over' | 'dnd.completed',
    listener: (payload: T) => void,
  ): () => void {
    return this.channels.subscribe(channelName, (p) => listener(p as T));
  }

  api = {
    getCurrentSource: (): { type: string; data?: unknown } | null => this.currentSource,
    isActive: (): boolean => this.currentSource !== null,
  };

  get dropTargetCount(): number {
    return this.dropTargets.size;
  }
}

export const dnd = new DndCapability();

// Wave 1:注册到 Registry,让 install 可校验(charter § 1.2)
capabilityRegistry.register({ id: dnd.id });
