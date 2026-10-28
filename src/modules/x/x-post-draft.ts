/**
 * ⭐⭐ 待发草稿(发推第②期,2026-10-27)—— 主进程;设计 docs/10-business-design/x/x-posting-design.md §2 / §5.2
 *
 * 用户 10-26:「发推后,发到 x 上再确定如何?多一个确认环节」→ 发布拆两步:
 *   x.post.fill   把排好的正文填进 X 的发推弹窗(不发),**网页一直占着**(执行器 keep),记一份待发草稿
 *   x.post.cancel 清掉框里的字、放网页、草稿撤掉(人点取消 / 回 note 改 / 10 分钟没确认自动撤)
 *   x.post.publish 第③期
 * 一个 ws 同一时刻最多一份(网页就一个)。
 *
 * ⚠️ 草稿的真假以锁为准:网页销毁时锁被收回(x-data-ipc revokePage),这里读的时候发现锁不是它的了就当草稿没了 ——
 *   不另接一条「网页没了 → 删草稿」的线(另接的线会漏)。
 * ⚠️ 往框里贴只贴一次(check none),再自己读回来核对:底座的 exact 校验对不上会换路再贴一遍,
 *   X 把表情画成图片时 textContent 里没有表情 → 对不上 → 同一段字被贴两次。
 */
import { inputEngine } from '@platform/main/web-capability/wiring/runtime';
import { resolve as resolvePage } from '@platform/main/web-capability/wiring/web-collect-engine';
import { webviewPorts } from './x-collect-ports';
import { X_SCRIPTS } from './x-dom-scripts';
import { X_ANCHORS, X_PAGE_NAME } from './x-pages';
import { holdsPage } from './x-page-lock';
import type { PostForm } from './x-post-compose';

/** 人多久不确认就自动撤回(设计 §2:不能让发推框永远占着网页) */
export const DRAFT_TTL_MS = 10 * 60_000;
/** 锁的兜底超时:比草稿多 2 分钟 —— 正常由撤回放;撤回也没跑才轮到锁超时收回(要响) */
export const DRAFT_LOCK_TTL_MS = DRAFT_TTL_MS + 2 * 60_000;

export type PendingPost = {
  readonly draftId: string;
  readonly wsId: string;
  readonly wcId: number;
  /** 网页锁的 token(cancel / publish 带它进来,由它放) */
  readonly token: string;
  readonly noteId?: string;
  readonly form: PostForm;
  readonly text: string;
  readonly handle: string;
  readonly filledAt: number;
  readonly expiresAt: number;
};
/** 给界面看的(不带锁 token) */
export type PendingView = Omit<PendingPost, 'token' | 'wcId'>;
/** 上一份是怎么结束的(界面据此说「已撤回(超时没确认)」) */
export type DraftEnded = { readonly draftId: string; readonly why: CancelWhy; readonly at: number; readonly cleared: boolean };
export type CancelWhy = 'user' | 'back-to-note' | 'timeout';

const pending = new Map<string, PendingPost>();
const ended = new Map<string, DraftEnded>();
const timers = new Map<string, NodeJS.Timeout>();

let seq = 0;
export const newDraftId = (now: number): string => `draft_${now.toString(36)}_${(seq = (seq + 1) % 1e6).toString(36)}`;

/** 这个 ws 的待发草稿;锁已经不是它的(网页销毁 / 超时收回)→ 当没有,顺手清掉 */
export function pendingPost(wsId: string): PendingPost | null {
  const p = pending.get(wsId);
  if (!p) return null;
  if (!holdsPage(p.token, p.wcId)) {
    console.warn(`[x.post] 待发草稿 ${p.draftId} 的网页锁已经不在了(网页关了 / 被收回)—— 草稿作废`);
    dropPending(wsId);
    return null;
  }
  return p;
}

export function viewOf(p: PendingPost): PendingView {
  return {
    draftId: p.draftId, wsId: p.wsId, noteId: p.noteId, form: p.form, text: p.text, handle: p.handle,
    filledAt: p.filledAt, expiresAt: p.expiresAt,
  };
}

export function lastEnded(wsId: string): DraftEnded | null {
  return ended.get(wsId) ?? null;
}

/** 记一份;超时就调 onTimeout(由能力层传:走执行器的 x.post.cancel,caller timer,留痕一样) */
export function addPending(p: PendingPost, onTimeout: (p: PendingPost) => void): void {
  dropPending(p.wsId);
  pending.set(p.wsId, p);
  const t = setTimeout(() => { timers.delete(p.wsId); onTimeout(p); }, Math.max(0, p.expiresAt - Date.now()));
  t.unref?.();
  timers.set(p.wsId, t);
}

export function endPending(p: PendingPost, why: CancelWhy, cleared: boolean): void {
  dropPending(p.wsId);
  ended.set(p.wsId, { draftId: p.draftId, why, at: Date.now(), cleared });
}

function dropPending(wsId: string): void {
  pending.delete(wsId);
  const t = timers.get(wsId);
  if (t) clearTimeout(t);
  timers.delete(wsId);
}

/** before-quit:停掉所有撤回定时器(记忆 project-graceful-shutdown) */
export function stopPostDraftTimers(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

/** 核对用:去掉空白(X 编辑器分段后 textContent 没有换行) */
export const sameText = (a: string, b: string): boolean => a.replace(/\s/g, '') === b.replace(/\s/g, '');

type BoxState = {
  found?: boolean; count?: number; text?: string;
  dialogs?: number; boxesAnywhere?: number; loggedOut?: boolean; ready?: string; width?: number;
} | null;
type ClearState = { state?: 'empty' | 'cleared' | 'not-cleared' | 'no-box'; via?: string; left?: string } | null;

/** 找不到框时页面上有什么(给人和日志看) */
const seen = (b: BoxState): string =>
  `页面上弹窗 ${b?.dialogs ?? '?'} 个、发推框 ${b?.boxesAnywhere ?? '?'} 个(含首页内嵌那个)、加载 ${b?.ready ?? '?'}`
  + (b?.width === 0 ? '、页面宽 0 —— X 网页没显示出来(被收起了?)' : `、页面宽 ${b?.width ?? '?'}`);

export type FillOutcome = { readonly ok: true } | { readonly ok: false; readonly why: string };

/**
 * 打开发推弹窗 → 框得是空的、只有一个 → 贴一次 → 读回核对。对不上就清掉。
 * ⚠️ 调之前网页必须已被执行器占着。
 */
export async function fillCompose(wcId: number, text: string): Promise<FillOutcome> {
  const ports = webviewPorts(wcId);
  const go = await ports.goto(X_PAGE_NAME.compose, {});
  if (!go.ok) return { ok: false, why: `发推弹窗没打开:${go.reason ?? '?'}` };
  /**
   * X 刚打开(冷启动)时整页加载慢,一次 8 秒等不到弹窗(10-27 真机:新开 X 立刻点发布,9 秒报找不到)。
   * 最多再等一轮;还没有就带着页面实况报错。
   */
  let box = (await ports.runScript(X_SCRIPTS.composeBoxState, {})) as BoxState;
  if (!box?.found && !box?.loggedOut) {
    console.log(`[x.post] 8 秒没等到发推弹窗(${seen(box)}),再等一轮`);
    box = (await ports.runScript(X_SCRIPTS.composeBoxState, {})) as BoxState;
  }
  if (!box?.found) {
    return { ok: false, why: box?.loggedOut ? 'X 没登录 —— 先在 X 网页里登录' : `发推弹窗里找不到正文框(${seen(box)})` };
  }
  if (box.count !== 1) return { ok: false, why: `发推弹窗里有 ${box.count} 个正文框,不知道该填哪个` };
  if ((box.text ?? '') !== '') {
    return { ok: false, why: `发推框里已经有字(「${box.text!.slice(0, 30)}」,可能是 X 留着的上一次)—— 没往里填,免得两段拼在一起` };
  }
  const page = resolvePage({ wcId });
  if ('error' in page) return { ok: false, why: page.error };
  const typed = await inputEngine.type(page.pageId, { anchor: X_ANCHORS.composeBox, text, check: { kind: 'none' } });
  if (typed.status === 'failed') return { ok: false, why: `没填进去:${typed.reason}` };

  /** 读回核对:粘贴后编辑器要一点时间画出来,最多等 3 秒 */
  let got = '';
  for (let n = 0; n < 12; n += 1) {
    const b = (await ports.runScript(X_SCRIPTS.composeBoxState, {})) as BoxState;
    got = b?.text ?? '';
    if (sameText(got, text)) return { ok: true };
    await new Promise((r) => setTimeout(r, 250));
  }
  const c = await clearCompose(wcId);
  return {
    ok: false,
    why: `填进去的和排好的对不上(框里:「${got.slice(0, 40)}」)—— ${c.cleared ? '已清掉' : `清也没清掉:${c.detail}`}`,
  };
}

export type ClearOutcome = { readonly cleared: boolean; readonly detail: string };

/** 清空框;清掉了(或本来就空 / 弹窗不在)→ 回首页把弹窗关掉。清不掉不导航(别把字留在一个看不见的弹窗里) */
export async function clearCompose(wcId: number): Promise<ClearOutcome> {
  const ports = webviewPorts(wcId);
  const c = (await ports.runScript(X_SCRIPTS.composeClear, {})) as ClearState;
  if (c?.state === 'not-cleared') return { cleared: false, detail: `框里还剩「${c.left ?? ''}」` };
  if (c?.state !== 'cleared' && c?.state !== 'empty' && c?.state !== 'no-box') return { cleared: false, detail: `清框脚本没回话(${JSON.stringify(c)})` };
  const go = await ports.goto(X_PAGE_NAME.home, {});
  const detail = c.state === 'no-box' ? '弹窗已经不在了' : c.state === 'empty' ? '框本来就是空的' : `已清空(${c.via})`;
  return { cleared: true, detail: go.ok ? detail : `${detail};回首页没成:${go.reason ?? '?'}` };
}
