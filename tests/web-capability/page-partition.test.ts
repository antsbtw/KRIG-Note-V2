/**
 * `web.page` 的 `partition` 事实(`06` §1.4,2026-09-08 补)
 *
 * 为什么这个字段必须存在(规格书原文):
 *  1. `prepare` 要挂 `webRequest`,**必须知道页面在哪个 partition** —— 否则挂不上
 *  2. 剥 CSP 是**整个 partition 生效**的,facts 拿不到 partition 就
 *     回答不了「这次 prepare 会波及哪些别的页面」
 *
 * 它与 window / ws / slot 同类:**位置事实,可查、可变、不参与身份**。
 * 下面这批用例分两类:
 *   - 「它是位置事实」—— 可 find、可改
 *   - ⭐「它不是身份」—— 除 partition 外全同的两个页面仍是两个 pageId
 *
 * 取值形态取自 V2 实况(不是编的):
 *   `persist:webview-${wsId}`(AI / X / Mail 三个 Host 共用,per-ws)
 *   `persist:webview`(WEBVIEW_PARTITION)
 *   `persist:webview-translate`(WEBVIEW_TRANSLATE_PARTITION)
 */
import { describe, it, expect } from 'vitest';
import { PageRegistry } from '@platform/main/web-capability/page';
import type { PageLifecycleEvent } from '@platform/main/web-capability/page';
import { isOk } from '@platform/main/web-capability/result';

const base = {
  window: 'win-1',
  ws: 'ws-1',
  slot: 'left' as const,
  partition: 'persist:webview-ws-1',
  owner: 'x-service',
  service: 'x',
  url: 'https://x.com/home',
};

describe('partition 是一条如实呈现的事实', () => {
  it('register 返回的 facts 里带着 partition,原样不改写', () => {
    const r = new PageRegistry();
    const facts = r.register({ ...base, partition: 'persist:webview-translate' });
    expect(facts.partition).toBe('persist:webview-translate');
  });

  it('facts(pageId) 读回来还是同一个 partition', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    const res = r.facts(page.pageId);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) throw new Error('unreachable');
    expect(res.value.partition).toBe('persist:webview-ws-1');
  });

  it('⭐ 不给默认值:三种真实取值各自原样保留,没有一个被兜底成 persist:webview', () => {
    // 静默兜底成 `persist:webview` 会把「忘了传」变成**错配到别的 session**,
    // 而且不报错 —— 正是本仓禁止的那类失败(记忆 `feedback-fail-loud-no-fallback`)。
    const r = new PageRegistry();
    for (const p of ['persist:webview-ws-1', 'persist:webview', 'persist:webview-translate']) {
      expect(r.register({ ...base, partition: p }).partition).toBe(p);
    }
  });

  it('⭐ 空串 partition 也**原样保留**,不被兜底改写(fail loud 的前提)', () => {
    // 这条是上一条的补刀:上一条只喂了三个合法值,`input.partition || 'persist:webview'`
    // 这种兜底写法根本碰不到,永远绿。真正会触发兜底的是「忘了传」的形态 ——
    // TS 那边是必填,但 JS 调用方 / `as any` 仍能塞空串进来。
    // 底座对它的义务是「如实呈现」,不是「猜一个能跑的」:悄悄改成 persist:webview
    // 会把「忘了传」变成静默错配到别人的 session,而且完全不报错。
    const r = new PageRegistry();
    const facts = r.register({ ...base, partition: '' as unknown as string });
    expect(facts.partition).toBe('');
    // 而且它不许被当成「任意 partition」参与匹配
    expect(r.find({ partition: 'persist:webview' })).toEqual([]);
  });

  it('page-created 事件里的 facts 也带着 partition(trace 拿得到)', () => {
    const r = new PageRegistry();
    const events: PageLifecycleEvent[] = [];
    r.subscribeLifecycle((e) => { events.push(e); });
    r.register({ ...base, partition: 'persist:webview-ws-7' });
    const created = events[0];
    expect(created.kind).toBe('page-created');
    if (created.kind !== 'page-created') throw new Error('unreachable');
    expect(created.facts.partition).toBe('persist:webview-ws-7');
  });
});

describe('find({ partition }) —— 位置事实,可作为条件', () => {
  it('精确命中所在 partition 的页面', () => {
    const r = new PageRegistry();
    r.register({ ...base, ws: 'ws-1', partition: 'persist:webview-ws-1' });
    r.register({ ...base, ws: 'ws-2', partition: 'persist:webview-ws-2' });

    const hits = r.find({ partition: 'persist:webview-ws-2' });
    expect(hits).toHaveLength(1);
    expect(hits[0].ws).toBe('ws-2');
  });

  it('⭐ 不匹配时返回空数组,**不兜底给一个**', () => {
    // 「找不到时随便给一个」才是兜底;如实说没有不是。
    const r = new PageRegistry();
    r.register({ ...base, partition: 'persist:webview-ws-1' });
    expect(r.find({ partition: 'persist:webview-ws-9' })).toEqual([]);
  });

  it('⭐ 精确相等,不做前缀匹配 —— `persist:webview` 不命中 `persist:webview-ws-1`', () => {
    // 这两个是真正不同的 session。前缀匹配会让 prepare 波及面被算错。
    const r = new PageRegistry();
    r.register({ ...base, partition: 'persist:webview-ws-1' });
    expect(r.find({ partition: 'persist:webview' })).toEqual([]);
  });

  it('⭐⭐ 同一 partition 里有三个页面 → 全部返回,不许替调用方挑', () => {
    // AI / X / Mail 三个 Host 在同一 ws 共用 `persist:webview-${ws}` —— 这是实况,
    // 也正是「剥 CSP 会波及哪些别的页面」这个问题的形状。
    const r = new PageRegistry();
    r.register({ ...base, owner: 'x-service' });
    r.register({ ...base, owner: 'ai-service', service: 'gemini', url: 'https://gemini.google.com/' });
    r.register({ ...base, owner: 'mail-service', service: 'gmail', url: 'https://mail.google.com/' });

    const hits = r.find({ partition: 'persist:webview-ws-1' });
    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((h) => h.pageId)).size).toBe(3);
    expect(hits.map((h) => h.owner).sort()).toEqual(['ai-service', 'mail-service', 'x-service']);
  });

  it('partition 与其它条件是「与」关系,不互相覆盖', () => {
    const r = new PageRegistry();
    r.register({ ...base, owner: 'x-service' });
    r.register({ ...base, owner: 'browser' });
    const hits = r.find({ partition: 'persist:webview-ws-1', owner: 'browser' });
    expect(hits).toHaveLength(1);
    expect(hits[0].owner).toBe('browser');
  });
});

describe('⭐⭐ partition 不参与身份(`06` §1.4)', () => {
  it('除 partition 外全同的两个页面 → 仍是两个不同 pageId', () => {
    // 判据:身份是不透明串,不由任何维度拼出 —— 加一个维度,身份不动。
    const r = new PageRegistry();
    const a = r.register({ ...base, partition: 'persist:webview-ws-1' });
    const b = r.register({ ...base, partition: 'persist:webview-ws-2' });
    expect(a.pageId).not.toBe(b.pageId);
  });

  it('partition 值不出现在 pageId 里(不透明,应用无从解析)', () => {
    const r = new PageRegistry();
    const facts = r.register({ ...base, partition: 'persist:webview-ws-42' });
    expect(facts.pageId).not.toContain('persist');
    expect(facts.pageId).not.toContain('webview');
    expect(facts.pageId).not.toContain('42');
  });
});

describe('⭐ partition 可变 —— 换 ws 时它跟着变,pageId 不变', () => {
  it('update 能改 partition,pageId 原样', () => {
    // V2 的 partition 是 per-ws 的,而「换 ws pageId 不变」是已验收的不变量。
    // 两条合起来:换 ws 时 partition 必须能改,否则 facts 里存的是过期的谎话。
    const r = new PageRegistry();
    const page = r.register({ ...base, ws: 'ws-1', partition: 'persist:webview-ws-1' });
    const res = r.update(page.pageId, { ws: 'ws-2', partition: 'persist:webview-ws-2' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) throw new Error('unreachable');
    expect(res.value.partition).toBe('persist:webview-ws-2');
    expect(res.value.pageId).toBe(page.pageId);
  });

  it('改完之后 find 按新 partition 找得到,按旧的找不到', () => {
    const r = new PageRegistry();
    const page = r.register({ ...base, partition: 'persist:webview-ws-1' });
    r.update(page.pageId, { ws: 'ws-2', partition: 'persist:webview-ws-2' });

    expect(r.find({ partition: 'persist:webview-ws-2' }).map((f) => f.pageId)).toEqual([page.pageId]);
    expect(r.find({ partition: 'persist:webview-ws-1' })).toEqual([]);
  });

  it('只改别的字段时 partition 不被抹掉(patch 里不给 = 不动)', () => {
    const r = new PageRegistry();
    const page = r.register(base);
    const res = r.update(page.pageId, { url: 'https://x.com/compose/post' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) throw new Error('unreachable');
    expect(res.value.partition).toBe('persist:webview-ws-1');
  });

  it('换 partition 发 page-moved(它与 window/ws/slot 同类,都是位置)', () => {
    const r = new PageRegistry();
    const events: PageLifecycleEvent[] = [];
    const page = r.register(base);
    r.subscribeLifecycle((e) => { events.push(e); });
    r.update(page.pageId, { partition: 'persist:webview-ws-2' });

    expect(events.map((e) => e.kind)).toEqual(['page-moved']);
    const moved = events[0];
    if (moved.kind !== 'page-moved') throw new Error('unreachable');
    expect(moved.facts.partition).toBe('persist:webview-ws-2');
    expect(moved.pageId).toBe(page.pageId);
  });

  it('partition 传同值不算移动(不发多余事件)', () => {
    const r = new PageRegistry();
    const events: PageLifecycleEvent[] = [];
    const page = r.register(base);
    r.subscribeLifecycle((e) => { events.push(e); });
    r.update(page.pageId, { partition: 'persist:webview-ws-1' });
    expect(events).toEqual([]);
  });
});
