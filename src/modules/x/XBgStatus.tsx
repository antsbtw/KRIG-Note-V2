/**
 * ⭐⭐ 后台采集「此刻在不在跑」提示(2026-10-14)
 *
 * 用户原话:「我觉得应该有一个任务是否在执行的提示，否则都不知道是否已经启动任务呢。」
 *
 * ⚠️ 库里的 status=running 只表示「跑过至少一段」,**不是**「这一刻在采」——
 * 这一刻只有主进程 runner 知道(bgStatus op)。X 无推送通道,每 3 秒问一次。
 * 顶栏(XOpsView)与人卡(XOpsPeople)共用这一个 hook,别各问各的。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';

export type BgStatusView = {
  readonly live: {
    readonly jobId: string; readonly handle: string; readonly range: string;
    readonly startedAt: number; readonly msg: string; readonly pageMsg?: string;
  } | null;
  readonly waitNote: string | null;
  readonly nextTickAt: number | null;
  readonly counts: Readonly<Record<'queued' | 'running' | 'paused' | 'done' | 'failed', number>>;
  /** 主进程的「现在」—— 倒计时用它算,不用 renderer 的钟 */
  readonly now: number;
};

export function useBgStatus(wsId: string): { st: BgStatusView | null; err: string | null } {
  const [st, setSt] = useState<BgStatusView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void xDataCall({ op: 'bgStatus', wsId }).then((r) => {
        if (!alive) return;
        if (r.status === 'ok') { setSt(r.value as BgStatusView); setErr(null); } else setErr(r.reason);
      });
    };
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [wsId]);
  return { st, err };
}

const RANGE_LABEL: Record<string, string> = { halfYear: '半年', year: '一年', all: '全部' };

/** 一句话:此刻在采什么 / 为什么在等 / 空闲 */
export function bgStatusLine(st: BgStatusView): { tone: 'live' | 'wait' | 'warn' | 'idle'; text: string } {
  const failed = st.counts.failed > 0 ? ` · ❌ 失败 ${st.counts.failed} 个(人卡里看原因)` : '';
  if (st.live) {
    const what = st.live.pageMsg ? `${st.live.msg} · ${st.live.pageMsg}` : st.live.msg;
    return { tone: 'live', text: `🟢 后台正在采 @${st.live.handle}(${RANGE_LABEL[st.live.range] ?? st.live.range}) · ${what}${failed}` };
  }
  const active = st.counts.queued + st.counts.running;
  if (active > 0) {
    const secs = st.nextTickAt !== null ? Math.max(0, Math.round((st.nextTickAt - st.now) / 1000)) : null;
    const when = secs !== null ? ` · 约 ${secs} 秒后再看` : ' · ⚠️ 节奏控制器没在跑';
    const why = st.waitNote ?? '还没轮到检查';
    const warn = st.waitNote?.includes('没开') === true || st.nextTickAt === null;
    return { tone: warn ? 'warn' : 'wait', text: `${warn ? '⚠️' : '🟡'} 后台 ${active} 个任务等待中 · ${why}${when}${failed}` };
  }
  const paused = st.counts.paused > 0 ? ` · 暂停 ${st.counts.paused} 个` : '';
  return { tone: failed ? 'warn' : 'idle', text: `后台空闲${paused}${failed}` };
}

const COLOR = { live: '#4caf50', wait: '#d4a72c', warn: '#e57373', idle: 'inherit' } as const;

/** 运营顶栏的那一行 */
export function BgIndicator({ wsId }: { wsId: string }): ReactElement | null {
  const { st, err } = useBgStatus(wsId);
  if (err) return <span style={{ fontSize: 11, color: COLOR.warn }} title={err}>⚠️ 问不到后台状态</span>;
  if (!st) return null;
  const { tone, text } = bgStatusLine(st);
  return (
    <span
      style={{
        fontSize: 11, color: COLOR[tone], opacity: tone === 'idle' ? 0.6 : 1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
      }}
      title={text}
    >
      {text}
    </span>
  );
}
