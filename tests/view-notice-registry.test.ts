// @vitest-environment jsdom
/**
 * ⭐ 页面顶部提示挂点(2026-10-28,发推第③b期起用)—— view 只画挂给它的,不认识挂的是谁
 * 钉:只画本 view 的、按 order 排、一个坏了只坏那一行、注销了就不画;note 右键报 noteId(X「发到 X」靠它记哪篇)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewNotices, viewNoticeRegistry, type ViewNoticeProps } from '@slot/interaction-registries/view-notice-registry/view-notice-registry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const said = (text: string) => function Said(p: ViewNoticeProps): ReactElement { return h('div', { 'data-n': text }, `${text}:${p.subjectId}`); };
function Boom(): ReactElement { throw new Error('坏了'); }
function Quiet(): null { return null; }

const ids: string[] = [];
const reg = (id: string, view: string, Component: (p: ViewNoticeProps) => ReactElement | null, order?: number): void => {
  ids.push(id);
  viewNoticeRegistry.register({ id, view, order, Component });
};
afterEach(() => { for (const id of ids.splice(0)) viewNoticeRegistry.unregister(id); document.body.innerHTML = ''; });

const mount = (view: string): HTMLElement => {
  const el = document.createElement('div');
  document.body.append(el);
  act(() => { createRoot(el).render(h(ViewNotices, { view, wsId: 'ws-1', subjectId: 'note-1', instanceId: 'ws-1::slot:left' })); });
  return el;
};
const shown = (el: HTMLElement): string[] => [...el.querySelectorAll('[data-n]')].map((n) => n.textContent ?? '');

describe('view-notice-registry', () => {
  it('⭐ 只画挂给这个 view 的,按 order 排;拿到 view 给的对象 id', () => {
    reg('t.b', 'note-view', said('乙'), 20);
    reg('t.a', 'note-view', said('甲'), 10);
    reg('t.other', 'ebook-view', said('别的'));
    expect(shown(mount('note-view'))).toEqual(['甲:note-1', '乙:note-1']);
  });

  it('⭐ 一个挂的东西出错只坏它那一行,别的照画', () => {
    reg('t.boom', 'note-view', Boom, 1);
    reg('t.ok', 'note-view', said('好'), 2);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mount('note-view');
    err.mockRestore();
    expect(shown(el)).toEqual(['好:note-1']);
  });

  it('没挂东西 / 都说没事 → 挂点什么都不画(没有空框);注销后跟着没', () => {
    expect(mount('note-view').innerHTML).toBe('');
    reg('t.quiet', 'note-view', Quiet);
    expect(mount('note-view').querySelector('[data-view-notices]')?.textContent).toBe('');
    reg('t.later', 'note-view', said('后挂'));
    const el = mount('note-view');
    expect(shown(el)).toEqual(['后挂:note-1']);
    act(() => { viewNoticeRegistry.unregister('t.later'); });
    expect(shown(el)).toEqual([]);
  });
});

describe('note 右键报是哪篇', () => {
  it('⭐ 右键落在 NoteView 外框里(data-note-id)→ custom.noteId;外面 → 不报', async () => {
    const { noteContextInfo } = await import('@views/note/context-menu-content');
    document.body.innerHTML = '<div data-note-id="01NOTE"><p><span id="in">字</span></p></div><span id="out">外</span>';
    expect(noteContextInfo(document.getElementById('in')!)).toEqual({ noteId: '01NOTE' });
    expect(noteContextInfo(document.getElementById('out')!)).toEqual({});
  });
});
