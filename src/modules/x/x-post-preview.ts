/**
 * 发推预览窗的开关(发推第①期,2026-10-27)—— 一次只开一个;盯着 note 那段内容,改了就重新排版
 *
 * 排版不在界面算:经 IPC 调能力 x.post.prepare(AI 调的也是它,两边看到的是同一个结果)。
 * ⚠️ 连改几个字只排最后一次(300ms 防抖);晚回来的旧结果丢掉(seq),不让预览倒退。
 *
 * 第②期「发布 ▸」:X 没开就先在 note 的另一栏打开 → 等网页登记好 → 调能力 x.post.fill(填进 X 发推框,不发)。
 * 之后在左边 X 顶上的确认条里确认 / 取消(XPostBar);这里只显示草稿状态(x-post-pending-store)。
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { xDataCall } from './x-data-types';
import type { PmNode, PostForm, PostPlan } from './x-post-compose';
import { XPostPreview, type PreviewState, type FillState } from './XPostPreview';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getXHostState, subscribeXHost } from './x-host-registry';
import { X_WEB_VIEW_ID } from './x-view-id';
import { pendingSnap, refreshPending, rememberDraftNote, subscribePending } from './x-post-pending-store';

const DEBOUNCE_MS = 300;

type Open = { root: Root; host: HTMLElement; stop: () => void; timer?: number; unsub?: () => void };

const X_OPEN_WAIT_MS = 20_000;

/**
 * X 不在台上 → 在 note 的另一栏打开(拉到前台),等它登记好。
 * note 在哪一栏从编辑器实例 id 读(`<ws>::slot:<left|right>`,记忆 project-dont-guess-own-slot:读状态不猜)。
 *
 * ⚠️⚠️ 「X 开着」看 slotBinding(在不在栏里),不看网页登记(2026-10-27 真机):
 * 点 ✕ 关 X 后框架把它 display:none 保活,网页还活着、还登记着(后台采集照用,不动它);
 * 以登记为准就会往看不见的零尺寸页面里填 —— X 在那里不弹发推弹窗。
 * ⚠️ 拉回前台可能换一个网页实例(保活的那份挂在另一个位置上会被卸掉重建),
 * 所以等「登记变了」;实例没换就不会变,等 1.5 秒照用原来那份。
 */
async function ensureXOpen(wsId: string, instanceId: string): Promise<string | null> {
  const ws = workspaceManager.get(wsId);
  const bus = workspaceManager.getBus(wsId);
  if (!ws || !bus) return '找不到这个工作区';
  if (ws.slotBinding.left === X_WEB_VIEW_ID || ws.slotBinding.right === X_WEB_VIEW_ID) {
    return getXHostState(wsId) ? null : waitHost(wsId, () => true);
  }
  const m = /::slot:(left|right)$/.exec(instanceId);
  if (!m) return `认不出这篇 note 在哪一栏(${instanceId})—— 先自己把 X 打开再点发布`;
  const before = getXHostState(wsId)?.wcId ?? null;
  const t0 = Date.now();
  const r = m[1] === 'left' ? bus.slot.openRight(X_WEB_VIEW_ID) : bus.slot.openLeft(X_WEB_VIEW_ID);
  if (!r.ok) return `X 网页没打开:${r.reason}`;
  console.log(`[x-post] X 不在台上(保活网页 wc#${before ?? '无'}),已在${m[1] === 'left' ? '右' : '左'}栏打开`);
  return waitHost(wsId, (wcId) => wcId !== before || Date.now() - t0 > X_SAME_INSTANCE_MS);
}

const X_SAME_INSTANCE_MS = 1500;

function waitHost(wsId: string, ready: (wcId: number) => boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let off = (): void => undefined;
    const done = (why: string | null): void => { off(); clearInterval(t); resolve(why); };
    const check = (): void => {
      const h = getXHostState(wsId);
      if (h && ready(h.wcId)) done(null);
      else if (Date.now() - t0 > X_OPEN_WAIT_MS) done(`X 网页 ${X_OPEN_WAIT_MS / 1000} 秒还没加载好 —— 等它出来再点一次发布`);
    };
    off = subscribeXHost(check);
    const t = setInterval(check, 250);
    check();
  });
}
let open: Open | null = null;

export function closePostPreview(): void {
  if (!open) return;
  const o = open;
  open = null;
  o.stop();
  o.unsub?.();
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
  let fill: FillState = { phase: 'idle' };
  /** 最新的那段内容 —— 点发布时填的就是它(和预览上看到的同一份) */
  let latest: unknown[] = [];
  const openedAt = Date.now();
  const draw = (): void => {
    if (open !== me) return;
    root.render(createElement(XPostPreview, {
      state, handle, wholeDoc, initialForm, fill, openedAt,
      pending: pendingSnap(wsId),
      onBackToNote: () => { te.focusInstance(instanceId); },
      onClose: closePostPreview,
      onPublish: (form: PostForm) => { void publish(form); },
    }));
  };
  const publish = async (form: PostForm): Promise<void> => {
    fill = { phase: 'filling', step: '打开 X…' };
    draw();
    const why = await ensureXOpen(wsId, instanceId);
    if (why) { fill = { phase: 'failed', why }; draw(); return; }
    fill = { phase: 'filling', step: '填进 X 发推框…' };
    draw();
    const r = await xDataCall({ op: 'postFill', wsId, form, content: latest as PmNode[] });
    /** 预览窗中途被关了也要记:X 上那条的「回 note 改」靠它找回 note */
    if (r.status === 'ok') rememberDraftNote((r.value as { draftId: string }).draftId, instanceId);
    if (open !== me) return;
    if (r.status === 'ok') {
      /** 填好就关:接下来在 X 顶上的确认条里定;预览窗留着会压住那条的按钮(10-27 真机截图) */
      await refreshPending(wsId);
      closePostPreview();
      return;
    } else {
      fill = { phase: 'failed', why: r.reason };
      console.warn(`[x-post] 没填进 X:${r.reason}`);
    }
    await refreshPending(wsId);
    draw();
  };
  me.unsub = subscribePending(wsId, draw);

  const prepare = async (content: unknown[]): Promise<void> => {
    latest = content;
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
