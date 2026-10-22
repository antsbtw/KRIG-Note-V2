/**
 * ⭐⭐ 任务「蓝V互关」(2026-10-16)—— 按设计文档的三件事展示,每件事「做到哪了 + 往下推一步」
 *
 * 用户 10-16 原需求:
 *  1「从x上找到我尚未关注的蓝V」
 *  2「对有蓝V有互关倾向的…进行互动求关」
 *  3「对已经添加好友的蓝V分析互动情况…知道哪些还没有蓝V互动过」
 * 用户 10-16:「围绕需要做的事情来展现或构建就好了」—— 细节(逐页账、候选名单)点进去再看。
 *
 * 1 找人 = 已验证的滚动截获(searchScroll,每页逐页账)+ 跑完自动扫一遍互关倾向(候选才算得出来)。
 * 2 / 3 还没做:不放假按钮,如实写「下一步做」。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getXHostState, subscribeXHost } from './x-host-registry';
import { recipeToQuery } from './x-recipe-query';
import { ledgerLine, type PageLedgerRow } from './x-page-ledger';
import type { SearchRecipe } from '@shared/types/x-timeline-types';
import { FollowStep } from './XTaskFollow';
import { EngageStep } from './XTaskEngage';
import { XTabs } from './XTabs';

type Overview = {
  lastFindAt?: string; found: number; foundBlue: number; foundBlueNotFollowed: number; candidates: number; mutualBlue: number;
};
type ScrollResult = {
  ok: boolean; why?: string; rateLimited: boolean; reportFile?: string;
  totals?: { pages: number; xTweets: number; notParsed: number; notInDb: number; badPages: number };
  pages?: Array<PageLedgerRow & { newest?: string; oldest?: string }>;
};

const when = (s?: string): string => (s ? new Date(s).toLocaleString() : '还没找过');

export function BlueMutualTask({ wsId }: { wsId: string }): ReactElement {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pages, setPages] = useState(10);
  const [finding, setFinding] = useState<string | null>(null);
  const [last, setLast] = useState<ScrollResult | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  /** ⭐ 用户 10-22 选「上面一排 tab,里面再一排」—— 三件事各一个 tab,不再一页往下滚 */
  const [tab, setTab] = useState<'find' | 'ask' | 'engage'>('ask');
  const wcId = useSyncExternalStore(subscribeXHost, () => getXHostState(wsId)?.wcId ?? null);

  const load = useCallback(() => {
    void xDataCall({ op: 'blueMutualOverview', wsId }).then((r) => {
      if (r.status === 'ok') { setOv(r.value as Overview); setErr(null); } else setErr(r.reason);
    });
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  /** ⭐ 1 找人:配方「蓝V互关」→ 滚动截获(每页对账、存库回读)→ 扫一遍互关倾向 → 刷新数字 */
  const findOnce = async (): Promise<void> => {
    if (wcId === null) { setFinding('X 网页没开 —— 先在左栏打开 X'); return; }
    setFinding('读配方…'); setLast(null);
    const lr = await xDataCall({ op: 'list' });
    const recipe = lr.status === 'ok' ? (lr.value as SearchRecipe[]).find((x) => x.name === '蓝V互关') : undefined;
    if (!recipe) { setFinding('找不到配方「蓝V互关」—— 先建配方'); return; }
    const q = recipeToQuery(recipe);
    if (q.problems.length > 0) { setFinding(`配方有问题:${q.problems.join(';')}`); return; }
    setFinding(`找人中:让页面自己翻页,最多 ${pages} 页,每页对账…(左边 X 网页别动)`);
    const sr = await xDataCall({ op: 'searchScroll', wcId, q: q.q, f: q.resultType, wantPages: pages, maxMs: 10 * 60_000 });
    if (sr.status === 'failed') { setFinding(`找人失败:${sr.reason}`); return; }
    const v = sr.value as ScrollResult;
    setLast(v);
    if (!v.ok) { setFinding(`找人没跑:${v.why ?? '?'}`); return; }
    setFinding('判断互关倾向中…');
    await xDataCall({ op: 'scanMutualIntent' });
    setFinding(null);
    load();
  };

  const t = last?.totals;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>蓝V互关</div>
      {err && <div style={{ color: '#f87171', fontSize: 12 }}>⚠️ {err}</div>}

      <XTabs active={tab} onChange={(id) => setTab(id as typeof tab)} items={[
        { id: 'find', label: `1 找蓝V${ov ? `(没关注 ${ov.foundBlueNotFollowed})` : ''}`, body: (
      <Step title="找我还没关注的蓝V">
        <div>配方搜索 · 上次 {when(ov?.lastFindAt)} · 累计找到 {ov ? ov.foundBlue : '…'} 个蓝V,其中我没关注的 {ov ? ov.foundBlueNotFollowed : '…'} 个</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <label style={{ fontSize: 12 }}>页数
            <input type="number" min={1} max={40} value={pages} disabled={finding !== null && !finding.startsWith('找人失败')}
              onChange={(e) => setPages(Math.min(40, Math.max(1, Number(e.target.value) || 10)))}
              style={{ width: 50, marginLeft: 4 }} />
          </label>
          <button type="button" disabled={finding !== null && !/失败|没跑|没开|找不到|有问题/.test(finding)} onClick={() => void findOnce()}>再找一轮</button>
          {finding && <span style={{ fontSize: 12, opacity: 0.8 }}>{finding}</span>}
        </div>
        {last?.ok && t && (
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {t.badPages === 0 ? '✓' : '⚠️'} 这一轮 {t.pages} 页 · X 列 {t.xTweets} 条 · 解析缺 {t.notParsed} · 入库缺 {t.notInDb}
            {t.badPages > 0 ? ` · ${t.badPages} 页对不上` : ' · 每页都对上了'}{last.rateLimited ? ' · ⚠️ 撞了 429' : ''}
            {' '}<button type="button" style={{ fontSize: 11 }} onClick={() => setShowLedger((s) => !s)}>{showLedger ? '收起逐页账' : '看逐页账'}</button>
            {showLedger && (
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{(last.pages ?? []).map((p) => ledgerLine(p)).join('\n')}</pre>
            )}
          </div>
        )}
      </Step>
        ) },
        { id: 'ask', label: `2 求关${ov ? `(候选 ${ov.candidates})` : ''}`, body: (
      <Step title="对有互关倾向的,互动求关">
        <FollowStep wsId={wsId} candidates={ov?.candidates} />
      </Step>
        ) },
        { id: 'engage', label: `3 互动${ov ? `(互关蓝V ${ov.mutualBlue.toLocaleString()})` : ''}`, body: (
      <Step title="已互关的蓝V,看互动情况">
        {/* ⭐ 2026-10-22:刚互关 / 一周没互动由人挑(用户 10-22:「没有我选择的空间」) */}
        <EngageStep wsId={wsId} />
      </Step>
        ) },
      ]} />
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <div style={{ padding: '2px 2px 10px' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
