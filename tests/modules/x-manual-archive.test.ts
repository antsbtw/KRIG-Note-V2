/**
 * ⭐⭐ X 说明书的修改档案守卫(设计 §9,P2 2026-10-19)
 * 改了 x.manual.json 不记档 / 记了档却手改对比 / 版本跳号 —— 这里红。
 * 记档用 `node scripts/manual.mjs record src/modules/x/manual …`。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkArchive, checkManual, type ChangeArchive, type ChangeList, type SiteManual } from '@platform/main/web-capability/manual';

const DIR = join(process.cwd(), 'src/modules/x/manual');
const read = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

function load(): { manual: SiteManual; history: Record<number, unknown>; main: ChangeList; archives: ChangeArchive[] } {
  const history: Record<number, unknown> = {};
  for (const f of readdirSync(join(DIR, 'history'))) {
    const m = /^v(\d+)\.json$/.exec(f);
    if (m) history[Number(m[1])] = read(join(DIR, 'history', f));
  }
  const arch = join(DIR, 'archive');
  return {
    manual: read(join(DIR, 'x.manual.json')) as SiteManual,
    history,
    main: read(join(DIR, 'changes.json')) as ChangeList,
    archives: existsSync(arch) ? readdirSync(arch).filter((f) => f.endsWith('.json')).map((f) => read(join(arch, f)) as ChangeArchive) : [],
  };
}

describe('X 说明书 · 修改档案', () => {
  it('说明书自检过', () => {
    expect(checkManual(load().manual)).toEqual([]);
  });
  it('档案自检过:当前版 = 最新快照、版本连续、每版恰好一条记录、对比与快照重算一致', () => {
    const a = load();
    expect(Object.keys(a.history).length).toBeGreaterThanOrEqual(1);
    expect(checkArchive(a)).toEqual([]);
  });
  it('⭐ 守卫能红:改了说明书不记档 / 手改记录里的对比', () => {
    const a = load();
    const edited = { ...a.manual, data: { ...a.manual.data, noise: [...a.manual.data.noise, { url: 'x', why: 'y' }] } } as SiteManual;
    expect(checkArchive({ ...a, manual: edited }).join('\n')).toMatch(/没升版本|没记档/);
    const bumped = { ...edited, version: a.manual.version + 1 };
    expect(checkArchive({ ...a, manual: bumped }).join('\n')).toMatch(/没记档/);
    const tampered = { ...a.main, entries: a.main.entries.map((e, i) => (i === 0 ? { ...e, diff: [] } : e)) };
    expect(checkArchive({ ...a, main: tampered }).join('\n')).toMatch(/不许手改/);
  });
});
