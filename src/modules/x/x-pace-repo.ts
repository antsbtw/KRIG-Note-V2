/**
 * ⭐ 节奏自调 —— 读写库(2026-10-20)。判定在 `x-pace.ts`。
 * 每种接口一行当前节奏(x_pace,id = 接口名);每次调整只追加一条记录(x_pace_event),界面只读展示。
 */
import { getXDB } from '@storage/surreal/client';
import { adjustPace, defaultPace, type PaceDecision, type PaceKey, type PaceState } from './x-pace';

type Row = { gap_sec: number; pages: number; ok_streak: number; limited_at?: string };

export async function readPace(key: PaceKey): Promise<PaceState> {
  const [rows] = await getXDB().query<[Row[]]>(
    `SELECT gap_sec, pages, ok_streak, (IF limited_at != NONE THEN <string> limited_at ELSE NONE END) AS limited_at
       FROM type::record('x_pace', $key)`, { key },
  );
  const r = rows?.[0];
  return r ? { gapSec: r.gap_sec, pages: r.pages, okStreak: r.ok_streak, limitedAt: r.limited_at ?? undefined } : defaultPace(key);
}

/** ⭐ 记一段的结果,算新节奏、存、调了就留一条记录 */
export async function recordPaceOutcome(key: PaceKey, outcome: 'ok' | 'limited', now = new Date()): Promise<PaceDecision> {
  const cur = await readPace(key);
  const d = adjustPace(cur, outcome, now);
  const db = getXDB();
  const [rows] = await db.query<[unknown[]]>(
    `UPSERT type::record('x_pace', $key) SET gap_sec = $gap, pages = $pages, ok_streak = $streak,
       limited_at = (IF $lim = NONE THEN NONE ELSE type::datetime($lim) END), updated_at = time::now()`,
    { key, gap: d.next.gapSec, pages: d.next.pages, streak: d.next.okStreak, lim: d.next.limitedAt },
  );
  if (!rows || rows.length !== 1) throw new Error(`[x.pace] ${key} 节奏没写上`);
  if (d.event) {
    await db.query(
      `CREATE x_pace_event CONTENT { pace_key: $key, at: time::now(), kind: $kind, from_gap: $fg, to_gap: $tg, from_pages: $fp, to_pages: $tp, why: $why }`,
      { key, kind: d.event.kind, fg: cur.gapSec, tg: d.next.gapSec, fp: cur.pages, tp: d.next.pages, why: d.event.why },
    );
    console.log(`[x.pace] ${key} ${d.event.kind === 'slower' ? '放慢' : '加快'}:每 ${cur.gapSec}s ${cur.pages} 页 → 每 ${d.next.gapSec}s ${d.next.pages} 页(${d.event.why})`);
  }
  if (d.giveUp) console.warn(`[x.pace] ${key} ${d.giveUp}`);
  return d;
}

export type PaceView = { readonly key: PaceKey; readonly state: PaceState; readonly lastEvent?: { at: string; kind: string; why: string; from: string; to: string } };

/** 界面只读:每种接口当前节奏 + 最近一次调整 */
export async function readPaceViews(): Promise<PaceView[]> {
  const keys: PaceKey[] = ['list:followers', 'list:following', 'list:verifiedFollowers', 'timeline'];
  const out: PaceView[] = [];
  for (const key of keys) {
    const [ev] = await getXDB().query<[Array<{ at: string; kind: string; why: string; from_gap: number; to_gap: number; from_pages: number; to_pages: number }>]>(
      `SELECT <string> at AS at, kind, why, from_gap, to_gap, from_pages, to_pages FROM x_pace_event WHERE pace_key = $key ORDER BY at DESC LIMIT 1`, { key },
    );
    const e = ev?.[0];
    out.push({
      key, state: await readPace(key),
      lastEvent: e ? { at: e.at, kind: e.kind, why: e.why, from: `每 ${e.from_gap}s ${e.from_pages} 页`, to: `每 ${e.to_gap}s ${e.to_pages} 页` } : undefined,
    });
  }
  return out;
}
