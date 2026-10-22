/**
 * ⭐ 任务页的 tab(2026-10-22)
 *
 * 用户 10-22:「总体蓝V互关的布局也不友好,不如采用tab,tab中再包含tab的方式,这样可以包含的任务下的子项就多了,
 * 而不是一个页面往下滚动。」选了「上面一排 tab,里面再一排」。
 * ⚠️ 没选中的 tab 只是藏起来、不卸载 —— 求关卡 / 互动卡过到一半切走再切回来,进度还在。
 */
import type { ReactElement, ReactNode } from 'react';

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
        <div key={t.id} role="tabpanel" style={{ display: t.id === cur ? 'block' : 'none' }}>{t.body}</div>
      ))}
    </div>
  );
}
