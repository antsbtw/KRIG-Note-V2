/**
 * ⭐⭐ 读一个人的主页资料 —— 一份(Module5-04 第 5 步,2026-10-26)
 *
 * 原来点人核对(x-person-act)/ 关系采集(x-relation-task)/ 认号(x-account-repo)各抄一遍
 * 「去主页 → 只等主页资料那一条 → 从载荷里挑出这个人」,说不清的原因各写各的。
 * 只读,不写库:落库走 x-save-batch savePersonRefresh(认号只要数字 id,不落库)。
 * ⚠️ 调之前必须已占住 wcId(本文件不碰锁)。
 */
import { webviewPorts } from './x-collect-ports';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { auditUserPayload, type XUserRecord } from './x-user-audit';
import { PROFILE_ENDPOINT, pickProfileUser } from './x-person-refresh';

export type ProfileRead =
  | { readonly ok: true; readonly rec: XUserRecord }
  | { readonly ok: false; readonly why: string };

/** restId 不给 = 只知道 handle(认号) */
export async function readProfileOn(wcId: number, who: { readonly handle: string; readonly restId?: string }): Promise<ProfileRead> {
  try {
    const rep = await webviewPorts(wcId).harvest({
      gotoPage: { name: X_PAGE_NAME.profile, params: { handle: who.handle } },
      /** 只等主页资料那一条;来了就停,最多 3 轮、10 秒 */
      pageUrlIncludes: [PROFILE_ENDPOINT], wantPages: 1, maxRounds: 3, maxMs: 10_000,
      noisyUrlSubstrings: X_NOISY_URLS,
    }) as { items?: Array<{ url: string; text: string }>; problems?: string[] } | null;
    if (!rep) return { ok: false, why: '去不到他的主页 / 页面没了' };
    const items = (rep.items ?? []).filter((it) => it.url.includes(PROFILE_ENDPOINT));
    const rec = pickProfileUser(items.flatMap((it) => auditUserPayload(it.text).items), who.handle, who.restId);
    if (rec) return { ok: true, rec };
    const why = rep.problems?.[0];
    return { ok: false, why: items.length === 0 ? `主页资料那条请求没来${why ? `:${why}` : ''}` : '载荷里找不到这个人' };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}
