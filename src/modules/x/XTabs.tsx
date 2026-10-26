/**
 * ⭐ 任务页的 tab(2026-10-22)
 *
 * 用户 10-22:「总体蓝V互关的布局也不友好,不如采用tab,tab中再包含tab的方式,这样可以包含的任务下的子项就多了,
 * 而不是一个页面往下滚动。」选了「上面一排 tab,里面再一排」。
 * ⚠️ 没选中的 tab 只是藏起来、不卸载 —— 求关卡 / 互动卡过到一半切走再切回来,进度还在。
 */
import { Component, type ReactElement, type ReactNode } from 'react';

/**
 * ⚠️ 一个 tab 里渲染出错只坏这一块,不把整个窗口拖成白屏(2026-10-22 真机:「最近关注」读了空的队列状态,整窗白屏)。
 * 出错要大声说出来(写在这块里 + console.error),不是悄悄藏掉。
 */
class TabBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } { return { error }; }
  componentDidCatch(error: Error): void { console.error(`[x.tabs] 「${this.props.name}」这块出错:`, error); }
  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ color: '#f87171', fontSize: 12 }}>
          ⚠️ 这一块出错了:{this.state.error.message}
          {' '}<button type="button" style={{ fontSize: 11 }} onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export type TabItem = { readonly id: string; readonly label: ReactNode; readonly body: ReactNode; readonly hidden?: boolean };

export function XTabs({ items, active, onChange, small = false }: {
  items: readonly TabItem[]; active: string; onChange: (id: string) => void; small?: boolean;
}): ReactElement {
  const shown = items.filter((t) => !t.hidden);
  const cur = shown.some((t) => t.id === active) ? active : shown[0]?.id;
  return (
    <div>
      <div role="tablist" style={{ display: 'flex', gap: small ? 4 : 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border-color, #333)', marginBottom: 8 }}>
        {shown.map((t) => {
          const on = t.id === cur;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
              style={{
                fontSize: small ? 12 : 13, padding: small ? '3px 8px' : '5px 12px', cursor: 'pointer',
                background: on ? 'var(--accent-bg, rgba(45,74,107,0.5))' : 'transparent',
                color: 'inherit', fontWeight: on ? 600 : 400,
                border: '1px solid var(--border-color, #333)', borderBottom: on ? '2px solid var(--accent-color, #4a90d9)' : '1px solid transparent',
                borderRadius: '6px 6px 0 0', marginBottom: -1,
              }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {shown.map((t) => (
        <div key={t.id} role="tabpanel" style={{ display: t.id === cur ? 'block' : 'none' }}><TabBoundary name={t.id}>{t.body}</TabBoundary></div>
      ))}
    </div>
  );
}
