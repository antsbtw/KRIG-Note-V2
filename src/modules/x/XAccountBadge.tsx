/**
 * ⭐⭐ 运营顶栏「登录号」(2026-10-16,蓝V互关 M0)
 *
 * 用户 10-07:「运营时登录的是那个号，就应该以那个号为主题。」
 * 用户 10-16 选 A:从 X 页面认号(不碰登录凭据);第一次认到某个号会开一次它的主页拿数字 id。
 *
 * · 打开运营时先读库里记的号(不碰页面),再自动认一次
 * · 认不出 / 要等(X 网页没开、正忙)→ 如实写原因,给「认号」按钮重试
 * · 认出的号变了 → 通知父组件,让「状态」「人」按新号重查(关系按号存,1.2.27)
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getXHostState, subscribeXHost } from './x-host-registry';
import type { WsAccount } from './x-account';

type Identify =
  | { status: 'ok'; account: WsAccount }
  | { status: 'pending'; handle?: string; reason: string }
  | { status: 'failed'; reason: string };

export function XAccountBadge({ wsId, onAccount }: {
  wsId: string;
  /** 认出的号(有数字 id 才算);认不出给 null */
  onAccount(a: WsAccount | null): void;
}): ReactElement {
  const [acc, setAcc] = useState<WsAccount | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const identify = useCallback(async () => {
    setBusy(true);
    setNote('认号中…(还没数字 id 时会开一次你的主页)');
    const r = await xDataCall({ op: 'identifyAccount', wsId });
    setBusy(false);
    if (r.status === 'failed') { setNote(`认号出错:${r.reason}`); return; }
    const v = r.value as Identify;
    if (v.status === 'ok') {
      setAcc(v.account); setNote(null); onAccount(v.account);
    } else {
      setNote(v.reason);
      /** ⚠️ 没认成时重新读库:页面上的号可能已记下(只是没数字 id),要如实显示 */
      const w = await xDataCall({ op: 'wsAccount', wsId });
      const a = w.status === 'ok' ? (w.value as WsAccount | null) : null;
      setAcc(a);
      onAccount(a?.restId ? a : null);
    }
  }, [wsId, onAccount]);

  useEffect(() => {
    let alive = true;
    void xDataCall({ op: 'wsAccount', wsId }).then((r) => {
      if (!alive) return;
      const a = r.status === 'ok' ? (r.value as WsAccount | null) : null;
      setAcc(a);
      onAccount(a?.restId ? a : null);
      void identify();
    });
    return () => { alive = false; };
    // ⚠️ 只在换 ws 时自动认一次 —— identify 依赖 onAccount,放进依赖会每次渲染都认
  }, [wsId]);

  /**
   * ⭐ X 网页后登记好 → 再认一次(2026-10-16 真机:任务页一打开就认号,那一刻 X 网页还没登记,
   * 顶栏一直挂着「X 网页没开,认不了号」,而 X 网页明明开着)。只在上次是「没开」失败时重试。
   */
  const wcId = useSyncExternalStore(subscribeXHost, () => getXHostState(wsId)?.wcId ?? null);
  useEffect(() => {
    if (wcId !== null && note !== null && note.includes('网页没开') && !busy) void identify();
  }, [wcId]);

  /**
   * ⭐ 页面还没渲染好就认 → 「页面上找不到登录号」(2026-10-17 真机:X 网页刚建好、停在 x.com/home 还没画出侧栏,
   * 1 秒内认号失败,警告一直挂着,而后面求关时认号是好的)。这种失败隔 3 秒再认,最多 5 次;人点「认号」重新计数。
   */
  const retries = useRef(0);
  useEffect(() => {
    if (note === null || !note.includes('找不到登录号') || busy || retries.current >= 5) return;
    const t = setTimeout(() => { retries.current += 1; void identify(); }, 3000);
    return () => clearTimeout(t);
  }, [note, busy]);

  const label = acc === null ? '登录号未知'
    : acc.restId ? `@${acc.handle}` : `@${acc.handle}(数字 id 未知)`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9 }}>
      <span title={acc?.restId ? `数字 id ${acc.restId}${acc.detectedAt ? ` · 认于 ${acc.detectedAt}` : ''}` : undefined}>
        {wsId} · {label}
      </span>
      <button type="button" disabled={busy} onClick={() => { retries.current = 0; void identify(); }}
        title="读 X 网页此刻登录的号;还没数字 id 时会开一次你的主页"
        style={{ fontSize: 11, padding: '1px 6px', cursor: busy ? 'default' : 'pointer' }}>
        {busy ? '认号中…' : '认号'}
      </button>
      {note && <span style={{ color: '#d9a441' }}>⚠️ {note}</span>}
    </span>
  );
}
