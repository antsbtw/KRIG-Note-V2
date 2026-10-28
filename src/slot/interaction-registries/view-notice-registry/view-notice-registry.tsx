/**
 * View Notice Registry — 页面顶部提示挂点(2026-10-28,发推第③b期起用)
 *
 * view 在自己内容的顶上留一块,别的模块往里挂一行提示(如 X 挂「这篇 note 发过 2 次 · 查看 ↗」)。
 * view 只给「我是谁、现在显示的是哪个对象」,不认识挂进来的是谁;删掉挂的那个模块,那行就没了。
 *
 * 契约:
 * - 同 id 重复注册 → 后者覆盖(console.warn 一次,便于发现意外重复)
 * - Component 没东西要说就 return null(挂点不画空框)
 * - 一个 Component 抛错只坏它自己那一行(ErrorBoundary 收住、console.error),不拖垮 view
 */
import { Component as ReactComponent, type ComponentType, type ReactNode, useSyncExternalStore } from 'react';

export interface ViewNoticeProps {
  readonly wsId: string;
  /** view 现在显示的对象 id(note-view 里是 noteId) */
  readonly subjectId: string;
  /** view 里编辑器实例 id(`<ws>::slot:<left|right>`,没有就空串) */
  readonly instanceId: string;
}

export interface ViewNoticeItem {
  /** 跨 view 唯一(命名建议:`<module>.<view>.<name>`) */
  readonly id: string;
  readonly view: string;
  /** 小的在上;默认 100 */
  readonly order?: number;
  readonly Component: ComponentType<ViewNoticeProps>;
}

class ViewNoticeRegistry {
  private items = new Map<string, ViewNoticeItem>();
  private listeners = new Set<() => void>();
  /** 每个 view 一份排好序的快照(useSyncExternalStore 要稳定引用) */
  private snaps = new Map<string, readonly ViewNoticeItem[]>();

  register(item: ViewNoticeItem): void {
    if (this.items.has(item.id)) console.warn(`[viewNoticeRegistry] '${item.id}' re-registered, replacing previous`);
    this.items.set(item.id, item);
    this.changed();
  }

  unregister(id: string): void {
    if (this.items.delete(id)) this.changed();
  }

  forView(view: string): readonly ViewNoticeItem[] {
    let s = this.snaps.get(view);
    if (!s) {
      s = [...this.items.values()].filter((i) => i.view === view).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      this.snaps.set(view, s);
    }
    return s;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private changed(): void {
    this.snaps.clear();
    for (const l of this.listeners) l();
  }
}

export const viewNoticeRegistry = new ViewNoticeRegistry();

class NoticeBoundary extends ReactComponent<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(e: unknown): void { console.error(`[viewNotice] '${this.props.id}' 画不出来:`, e); }
  render(): ReactNode { return this.state.failed ? null : this.props.children; }
}

/** view 在内容顶上放一个:把挂给它的提示按顺序画出来 */
export function ViewNotices({ view, ...props }: ViewNoticeProps & { readonly view: string }): ReactNode {
  const items = useSyncExternalStore((cb) => viewNoticeRegistry.subscribe(cb), () => viewNoticeRegistry.forView(view));
  if (items.length === 0) return null;
  return (
    <div className="krig-view-notices" data-view-notices={view}>
      {items.map(({ id, Component }) => (
        <NoticeBoundary key={id} id={id}><Component {...props} /></NoticeBoundary>
      ))}
    </div>
  );
}
