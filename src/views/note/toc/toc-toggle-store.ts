/**
 * toc-toggle-store — TOC 面板开关的极简共享状态
 *
 * 为什么需要:目录按钮注册在 toolbar(toolbar-content.tsx 走 command),
 * 而面板渲染在 NoteView 内的 TocIndicator。两处不在同一 React 树,靠这个
 * per-instance 的 store 桥接:toolbar 命令 toggle → TocIndicator 订阅渲染。
 *
 * 决议:去掉 hover 触发(易误触反复弹框),改 toolbar 按钮显式开 + 点外部关。
 */

type Listener = () => void;

const openState = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();

function emit(instanceId: string): void {
  listeners.get(instanceId)?.forEach((l) => l());
}

export const tocToggleStore = {
  isOpen(instanceId: string): boolean {
    return openState.get(instanceId) ?? false;
  },
  set(instanceId: string, open: boolean): void {
    if ((openState.get(instanceId) ?? false) === open) return;
    openState.set(instanceId, open);
    emit(instanceId);
  },
  toggle(instanceId: string): void {
    this.set(instanceId, !this.isOpen(instanceId));
  },
  subscribe(instanceId: string, cb: Listener): () => void {
    let set = listeners.get(instanceId);
    if (!set) {
      set = new Set();
      listeners.set(instanceId, set);
    }
    set.add(cb);
    return () => { set!.delete(cb); };
  },
};
