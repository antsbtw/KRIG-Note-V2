// @vitest-environment jsdom
/**
 * ⭐ 任务页 tab(用户 10-22「上面一排 tab,里面再一排」)—— 没选中的只藏不卸载:求关卡过到一半切走再切回来,进度还在
 */
import { describe, expect, it } from 'vitest';
import { act, createElement as h, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { XTabs } from '@modules/x/XTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Counter(): ReactElement {
  const [n, setN] = useState(0);
  return h('button', { type: 'button', 'data-testid': 'inc', onClick: () => setN((v) => v + 1) }, String(n));
}
function Page(): ReactElement {
  const [tab, setTab] = useState('a');
  return h(XTabs, { active: tab, onChange: setTab, items: [
    { id: 'a', label: 'A', body: h(Counter) },
    { id: 'b', label: 'B', body: h('span', null, 'b') },
    { id: 'c', label: 'C', hidden: true, body: h('span', null, 'c') },
  ] });
}

describe('XTabs', () => {
  it('切走再切回来,里面的状态还在;hidden 的 tab 不出现', () => {
    const el = document.createElement('div');
    document.body.append(el);
    act(() => { createRoot(el).render(h(Page)); });
    const tabs = (): HTMLButtonElement[] => [...el.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs().map((t) => t.textContent)).toEqual(['A', 'B']);
    const inc = el.querySelector('[data-testid="inc"]') as HTMLButtonElement;
    act(() => { inc.click(); inc.click(); });
    act(() => { tabs()[1].click(); });
    expect((inc.closest('[role="tabpanel"]') as HTMLElement).style.display).toBe('none');
    act(() => { tabs()[0].click(); });
    expect(el.querySelector('[data-testid="inc"]')!.textContent).toBe('2');
  });
});
