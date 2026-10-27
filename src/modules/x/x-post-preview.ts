/**
 * 发推预览窗的开关(发推第①期,2026-10-27)—— 一次只开一个;盯着 note 那段内容,改了就重新排版
 *
 * 排版不在界面算:经 IPC 调能力 x.post.prepare(AI 调的也是它,两边看到的是同一个结果)。
 * ⚠️ 连改几个字只排最后一次(300ms 防抖);晚回来的旧结果丢掉(seq),不让预览倒退。
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { xDataCall } from './x-data-types';
import type { PmNode, PostForm, PostPlan } from './x-post-compose';
import { XPostPreview, type PreviewState } from './XPostPreview';

const DEBOUNCE_MS = 300;

type Open = { root: Root; host: HTMLElement; stop: () => void; timer?: number };
let open: Open | null = null;

export function closePostPreview(): void {
  if (!open) return;
  const o = open;
  open = null;
  o.stop();
  if (o.timer !== undefined) window.clearTimeout(o.timer);
  o.root.unmount();
  o.host.remove();
}

export function openPostPreview(wsId: string, instanceId: string, initialForm?: PostForm): void {
  closePostPreview();
  const te = requireCapabilityApi<TextEditingApi>('text-editing').api;

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const me: Open = { root, host, stop: () => undefined };
  open = me;

  let state: PreviewState = { kind: 'loading' };
  let handle: string | null = null;
  let wholeDoc = true;
  let seq = 0;
  const draw = (): void => {
    if (open !== me) return;
    root.render(createElement(XPostPreview, {
      state, handle, wholeDoc, initialForm,
      onBackToNote: () => { te.focusInstance(instanceId); },
      onClose: closePostPreview,
    }));
  };

  const prepare = async (content: unknown[]): Promise<void> => {
    const my = ++seq;
    const r = await xDataCall({ op: 'postPrepare', content: content as PmNode[] });
    if (my !== seq || open !== me) return;
    state = r.status === 'ok' ? { kind: 'ok', plan: r.value as PostPlan } : { kind: 'failed', why: r.reason };
    if (r.status !== 'ok') console.warn(`[x-post] 排版没成:${r.reason}`);
    draw();
  };

  const watched = te.watchSelectionContent(instanceId, (content) => {
    if (open !== me) return;
    if (content === null) { state = { kind: 'gone' }; draw(); return; }
    if (me.timer !== undefined) window.clearTimeout(me.timer);
    me.timer = window.setTimeout(() => { void prepare(content); }, DEBOUNCE_MS);
  });
  if (!watched) {
    state = { kind: 'failed', why: '找不到这篇 note 的编辑器(点一下 note 再右键试试)' };
    draw();
    return;
  }
  me.stop = watched.stop;
  wholeDoc = watched.wholeDoc;
  draw();
  void prepare(watched.content);

  void xDataCall({ op: 'wsAccount', wsId }).then((r) => {
    const v = r.status === 'ok' ? (r.value as { handle?: string } | null) : null;
    handle = v?.handle ?? null;
    draw();
  });
}
