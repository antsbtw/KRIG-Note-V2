/**
 * ⭐⭐ 说明书引擎(P2 2026-10-19)—— 与站点无关的行为 + 自检能抓出写错 + 不执行任何代码
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { census, checkManual, loadManual, orderedByTime, type SiteManual } from '@platform/main/web-capability/manual';
import { stripComments } from '../helpers/source-scan';

/** 一个虚构站点:论坛帖子列表 —— 证明引擎不只认 X 的形状 */
const FORUM: SiteManual = {
  site: 'forum.example',
  version: 1,
  data: {
    census: {
      containers: { find: 'blocks', label: '$ins.kind', labelMissing: '?' },
      entries: ['$ins.posts[*]'],
      entry: { id: { firstString: ['$entry.key'] }, body: '$entry' },
      rules: [
        { rule: 'cursor', when: { nonEmpty: '$body.next' }, value: '$body.next', direction: '$body.dir', directions: { older: 'down' } },
        { rule: 'item', kind: 'post', when: { equals: ['$body.type', 'post'] }, node: '$body', id: '$node.pid',
          missing: { countAs: 'deleted' }, hidden: { when: { equals: ['$node.state', 'hidden'] }, countAs: 'hidden' },
          variants: [{ kind: 'ad', when: { matches: ['$id', '^sponsor', 'i'] } }] },
        { rule: 'group', when: { isArray: '$body.replies' }, children: '$body.replies[*]', childId: { firstString: ['$child.key', '$id'] }, childBody: '$child' },
      ],
      unknownName: { strip: ['-\\d+$'], empty: '(无)' },
    },
    orderedByTime: [{ url: '/latest' }, { url: '/search', require: ['sort=new'] }],
    noise: [{ url: 'cdn.example', why: '图片' }],
  },
  outside: [],
};

describe('通用清点 —— 虚构站点', () => {
  it('条目 / 广告变体 / 隐藏 / 删除 / 模块 / 游标 / 方向映射不到 / 不认识,各归各类', () => {
    const text = JSON.stringify({ page: { blocks: [
      { kind: 'list', posts: [
        { key: 'p-1', type: 'post', pid: '1' },
        { key: 'Sponsor-9', type: 'post', pid: '9' },
        { key: 'p-2', type: 'post', pid: '2', state: 'hidden' },
        { key: 'p-3', type: 'post' },
        { key: 'thread-5', replies: [{ key: 'r-6', type: 'post', pid: '6' }, { type: 'post', pid: '7' }] },
        { key: 'banner-12', foo: 1 },
        { key: 'c', next: 'N1', dir: 'OLDER' },
        { key: 'c2', next: 'N0', dir: 'newer' },
        { key: 'p-1', type: 'post', pid: '1' },
      ] },
      {},
    ] } });
    expect(census(FORUM.data.census, text)).toEqual({
      items: { post: ['1', '6', '7'], ad: ['9'] },
      counts: { hidden: 1, deleted: 1 },
      cursors: { down: 'N1' },
      otherCursors: { newer: 1 },
      unknown: { banner: 1 },
      containers: { list: 1, '?': 1 },
    });
    expect(checkManual(FORUM)).toEqual([]);
  });

  it('不是 JSON → null', () => {
    expect(census(FORUM.data.census, 'oops')).toBeNull();
  });

  it('按时间排:第一条命中的规则说了算,require 全在才算;URL 先解码', () => {
    const R = FORUM.data.orderedByTime;
    expect(orderedByTime(R, 'https://f/latest?p=2')).toBe(true);
    expect(orderedByTime(R, 'https://f/search?q=a&sort%3Dnew')).toBe(true);
    expect(orderedByTime(R, 'https://f/search?q=a&sort=top')).toBe(false);
    expect(orderedByTime(R, 'https://f/home')).toBe(false);
  });
});

describe('⭐⭐ 自检 —— 写错当场报出哪一段哪一条', () => {
  const broken = (patch: (m: Record<string, any>) => void): string[] => {
    const m = JSON.parse(JSON.stringify(FORUM));
    patch(m);
    return checkManual(m);
  };
  it.each([
    ['路径写法不对', (m: any) => { m.data.census.rules[1].id = 'node.pid'; }, /rules\[1\]\.id.*写法不对/],
    ['变量在这里没有', (m: any) => { m.data.census.rules[1].when = { isObject: '$node' }; }, /rules\[1\]\.when\.isObject.*\$node/],
    ['取一个值的地方带了 [*]', (m: any) => { m.data.census.rules[1].id = '$node.pid[*]'; }, /不能带 \[\*\]/],
    ['取一串的地方没带 [*]', (m: any) => { m.data.census.rules[2].children = '$body.replies'; }, /要以 \[\*\] 结尾/],
    ['正则编不过', (m: any) => { m.data.census.rules[1].hidden.when = { matches: ['$node.state', '(['] }; }, /正则.*编不过/],
    ['不认识的条件', (m: any) => { m.data.census.rules[1].when = { eval: 'x' }; }, /条件只认/],
    ['不认识的规则', (m: any) => { m.data.census.rules[0].rule = 'script'; }, /只认 cursor \/ item \/ group/],
    ['方向只能 up / down', (m: any) => { m.data.census.rules[0].directions = { older: 'sideways' }; }, /directions/],
    ['countAs / unknownAs 两个都写', (m: any) => { m.data.census.rules[1].missing = { countAs: 'a', unknownAs: 'b' }; }, /恰好写一个/],
    ['噪音没写为什么', (m: any) => { m.data.noise = [{ url: 'x' }]; }, /noise\[0\]/],
    ['保留名不能 bind', (m: any) => { m.data.census.bind = { node: '$body' }; }, /保留/],
  ])('%s', (_name, patch, re) => {
    const problems = broken(patch);
    expect(problems.join('\n')).toMatch(re);
  });
  it('loadManual 自检不过就抛,列出全部问题', () => {
    expect(() => loadManual({ ...FORUM, version: 0, site: '' })).toThrow(/自检不过（?\(?2 处/);
  });
});

describe('⭐ 铁律:引擎不执行说明书里的任何东西', () => {
  const DIR = join(process.cwd(), 'src/platform/main/web-capability/manual');
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
  it('先确认扫到了文件', () => { expect(files.length).toBeGreaterThanOrEqual(5); });
  it('零处 eval / new Function / 动态 import / Node / Electron', () => {
    for (const f of files) {
      const code = stripComments(readFileSync(join(DIR, f), 'utf8'));
      expect(code, f).not.toMatch(/\beval\s*\(|new\s+Function\b|\bimport\s*\(|from\s+['"](electron|node:|fs|path)/);
    }
  });
});

describe('修改档案的纯函数', () => {
  it('diffManual:逐项路径,version 不算改动,数组按下标', async () => {
    const { diffManual } = await import('@platform/main/web-capability/manual');
    expect(diffManual({ version: 1, a: { b: 1, c: [1, 2] } }, { version: 2, a: { b: 2, c: [1], d: 'x' } })).toEqual([
      { path: 'a.b', before: 1, after: 2 },
      { path: 'a.c[1]', before: 2 },
      { path: 'a.d', after: 'x' },
    ]);
  });
  it('archiveByMonth:本月的 + 举手的留下,其余按月分组', async () => {
    const { archiveByMonth } = await import('@platform/main/web-capability/manual');
    const e = (version: number, at: string, status: 'ok' | 'raised' = 'ok') => ({
      version, at, by: 'human' as const, summary: 's', reason: 'r', evidence: [], regression: { fixed: 0, broken: 0, detail: '' },
      cloud: { used: false }, diff: [], status,
    });
    const r = archiveByMonth([e(4, '2026-11-02T10:00:00'), e(3, '2026-10-20T10:00:00'), e(2, '2026-09-10T10:00:00', 'raised'), e(1, '2026-09-01T10:00:00')], new Date('2026-11-05T10:00:00'));
    expect(r.keep.map((x) => x.version)).toEqual([4, 2]);
    expect(Object.fromEntries(Object.entries(r.byMonth).map(([m, xs]) => [m, xs.map((x) => x.version)]))).toEqual({ '2026-10': [3], '2026-09': [1] });
  });
  it('checkChange:用过云端必须写发了什么', async () => {
    const { checkChange } = await import('@platform/main/web-capability/manual');
    const ok = { version: 1, at: '2026-10-19T00:00:00Z', by: 'cloud-ai', summary: 's', reason: 'r', evidence: [], regression: { fixed: 0, broken: 0, detail: '' }, diff: [], status: 'ok' };
    expect(checkChange({ ...ok, cloud: { used: false } }, 'c')).toEqual([]);
    expect(checkChange({ ...ok, cloud: { used: true } }, 'c').join()).toMatch(/发了什么/);
  });
});
