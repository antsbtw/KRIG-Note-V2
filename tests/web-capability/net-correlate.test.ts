/**
 * 请求关联 —— webRequest requestId ↔ CDP requestId(`04` §4)
 *
 * ⚠️ **两套编号**:同一次请求在 webRequest 和 CDP 各有一个 id,号不一样。
 * V1 用 URL + method + resourceType + 10s 内时间就近配对,并做类型归一。
 * 这是踩出来的经验(prompt §4.4 要求照搬),本文件把它的行为钉死。
 *
 * 少了任何一环的后果:
 *  - 少类型归一 → CDP 报 xhr、webRequest 报 fetch,同一请求**配不上**
 *  - 少时间窗   → 页面反复请求同一 URL 时,配到很久以前那次,**body 张冠李戴**
 *  - 配不上不报 → **静默丢**,而 prompt §7 明令禁止
 */
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeResourceType,
  resourceTypesMatch,
  findClosestMatch,
  CORRELATION_WINDOW_MS,
  NetworkEventBus,
  shouldCaptureBody,
} from '@platform/main/web-capability/net';
import type { PageId } from '@platform/main/web-capability/page';

const A = 'page_a' as PageId;

describe('resourceType 归一(V1 字面移植)', () => {
  it('mainframe / subframe → document', () => {
    expect(normalizeResourceType('mainFrame')).toBe('document');
    expect(normalizeResourceType('subFrame')).toBe('document');
  });

  it('⭐ xhr → fetch(两侧叫法不同,不归一就配不上)', () => {
    expect(normalizeResourceType('XHR')).toBe('fetch');
    expect(normalizeResourceType('xhr')).toBe('fetch');
  });

  it('其它类型只转小写', () => {
    expect(normalizeResourceType('Image')).toBe('image');
    expect(normalizeResourceType(undefined)).toBeUndefined();
  });

  it('⭐ 任一侧缺类型时算匹配(缺信息不该导致配对失败)', () => {
    expect(resourceTypesMatch(undefined, 'fetch')).toBe(true);
    expect(resourceTypesMatch('fetch', undefined)).toBe(true);
    expect(resourceTypesMatch('xhr', 'fetch')).toBe(true);
    expect(resourceTypesMatch('image', 'fetch')).toBe(false);
  });
});

describe('findClosestMatch —— 就近配对', () => {
  const base = { url: 'https://x.com/api/graphql/T', method: 'GET' };

  it('URL + method 全等且在窗内 → 配上', () => {
    const hit = findClosestMatch(
      [{ id: 'w1', ...base, startedAt: '2026-09-08T10:00:00.000Z' }],
      { ...base, startedAt: '2026-09-08T10:00:01.000Z' },
    );
    expect(hit).toBe('w1');
  });

  it('⭐ 多个候选取**时间最近**的那个', () => {
    const hit = findClosestMatch(
      [
        { id: 'old', ...base, startedAt: '2026-09-08T10:00:00.000Z' },
        { id: 'near', ...base, startedAt: '2026-09-08T10:00:09.000Z' },
      ],
      { ...base, startedAt: '2026-09-08T10:00:09.500Z' },
    );
    expect(hit).toBe('near');
  });

  it(`⭐ 超出 ${CORRELATION_WINDOW_MS}ms 窗口不配(防张冠李戴)`, () => {
    const hit = findClosestMatch(
      [{ id: 'w1', ...base, startedAt: '2026-09-08T10:00:00.000Z' }],
      { ...base, startedAt: '2026-09-08T10:00:11.000Z' },
    );
    expect(hit).toBeNull();
  });

  it('URL 或 method 不同不配', () => {
    expect(findClosestMatch(
      [{ id: 'w1', ...base, startedAt: '2026-09-08T10:00:00.000Z' }],
      { url: 'https://x.com/api/other', method: 'GET', startedAt: '2026-09-08T10:00:00.000Z' },
    )).toBeNull();
    expect(findClosestMatch(
      [{ id: 'w1', ...base, startedAt: '2026-09-08T10:00:00.000Z' }],
      { ...base, method: 'POST', startedAt: '2026-09-08T10:00:00.000Z' },
    )).toBeNull();
  });

  it('⭐ 类型归一后能配上(CDP 报 xhr,webRequest 报 fetch)', () => {
    const hit = findClosestMatch(
      [{ id: 'w1', ...base, resourceType: 'fetch', startedAt: '2026-09-08T10:00:00.000Z' }],
      { ...base, resourceType: 'XHR', startedAt: '2026-09-08T10:00:00.500Z' },
    );
    expect(hit).toBe('w1');
  });

  it('空候选 / 坏时间戳返回 null(不抛、不瞎配)', () => {
    expect(findClosestMatch([], { ...base, startedAt: '2026-09-08T10:00:00.000Z' })).toBeNull();
    expect(findClosestMatch(
      [{ id: 'w1', ...base, startedAt: 'not-a-date' }],
      { ...base, startedAt: '2026-09-08T10:00:00.000Z' },
    )).toBeNull();
    expect(findClosestMatch(
      [{ id: 'w1', ...base, startedAt: '2026-09-08T10:00:00.000Z' }],
      { ...base, startedAt: 'not-a-date' },
    )).toBeNull();
  });
});

describe('总线上的双向关联', () => {
  it('⭐ CDP 先登记,webRequest 后到 → 记录上带 providerRequestId', () => {
    const bus = new NetworkEventBus();
    bus.bindProviderRequest(A, 'cdp-77', {
      url: 'https://x.com/api/graphql/T', method: 'GET', resourceType: 'xhr',
      startedAt: '2026-09-08T10:00:00.000Z',
    });
    bus.recordRequestStart({
      requestId: 'wr-1', pageId: A, url: 'https://x.com/api/graphql/T',
      method: 'GET', resourceType: 'fetch', startedAt: '2026-09-08T10:00:00.300Z',
    });
    expect(bus.list(A)[0].providerRequestId).toBe('cdp-77');
  });

  it('⭐ webRequest 先到,CDP 后送 body → body 贴到正确的记录上', () => {
    const bus = new NetworkEventBus();
    bus.recordRequestStart({
      requestId: 'wr-1', pageId: A, url: 'https://x.com/api/graphql/T',
      method: 'GET', resourceType: 'fetch', startedAt: '2026-09-08T10:00:00.000Z',
    });
    bus.bindProviderRequest(A, 'cdp-77', {
      url: 'https://x.com/api/graphql/T', method: 'GET', resourceType: 'xhr',
      startedAt: '2026-09-08T10:00:00.200Z',
    });
    const result = bus.attachProviderBody(A, 'cdp-77', {
      url: 'https://x.com/api/graphql/T', method: 'GET', resourceType: 'xhr',
      body: new TextEncoder().encode('{"tweets":[]}'),
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.value.requestId).toBe('wr-1');
    expect(result.value.providerRequestId).toBe('cdp-77');

    const fetched = bus.body(result.value.bodyRef!);
    expect(fetched.status).toBe('ok');
    if (fetched.status !== 'ok') throw new Error('unreachable');
    expect(new TextDecoder().decode(fetched.value)).toBe('{"tweets":[]}');
  });

  it('⭐⭐ 配不上时返回 Failed —— **不静默丢**(prompt §7)', () => {
    const bus = new NetworkEventBus();
    // 没有任何 webRequest 记录可配
    const result = bus.attachProviderBody(A, 'cdp-77', {
      url: 'https://x.com/api/graphql/T', method: 'GET',
      body: new TextEncoder().encode('{}'),
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.reason).toContain('关联失败');
    // 失败原因要能指认是哪条请求 —— 否则排查时无从下手
    expect(result.reason).toContain('https://x.com/api/graphql/T');
  });

  it('⭐ 同一 URL 连发两次,body 各自贴到时间最近的那条(不串)', () => {
    const bus = new NetworkEventBus();
    const url = 'https://x.com/api/graphql/T';
    bus.recordRequestStart({ requestId: 'wr-1', pageId: A, url, method: 'GET', startedAt: '2026-09-08T10:00:00.000Z' });
    bus.recordRequestStart({ requestId: 'wr-2', pageId: A, url, method: 'GET', startedAt: '2026-09-08T10:00:08.000Z' });

    bus.bindProviderRequest(A, 'cdp-1', { url, method: 'GET', startedAt: '2026-09-08T10:00:00.100Z' });
    bus.bindProviderRequest(A, 'cdp-2', { url, method: 'GET', startedAt: '2026-09-08T10:00:08.100Z' });

    const r1 = bus.attachProviderBody(A, 'cdp-1', { url, method: 'GET', body: new TextEncoder().encode('first') });
    const r2 = bus.attachProviderBody(A, 'cdp-2', { url, method: 'GET', body: new TextEncoder().encode('second') });

    if (r1.status !== 'ok' || r2.status !== 'ok') throw new Error('两条都该配上');
    expect(r1.value.requestId).toBe('wr-1');
    expect(r2.value.requestId).toBe('wr-2');
  });
});

describe('⭐ 噪音名单外置(`04` §3.1:站点适配不进底层)', () => {
  it('⭐ 底座默认**一条站点名单都不带**', () => {
    // V1 在 session-capture.ts:31 硬编码了 s-cdn.anthropic.com/images/ —— 那是 Claude 的
    // 站点适配漏进了底层。本层默认只按 resourceType 过滤,不认识任何具体站点。
    expect(shouldCaptureBody({ url: 'https://s-cdn.anthropic.com/images/x.png', resourceType: 'fetch' })).toBe(true);
  });

  it('调用方给了名单才过滤', () => {
    const policy = { noisyUrlSubstrings: ['s-cdn.anthropic.com/images/'] };
    expect(shouldCaptureBody({ url: 'https://s-cdn.anthropic.com/images/x.png', resourceType: 'fetch' }, policy)).toBe(false);
    expect(shouldCaptureBody({ url: 'https://claude.ai/api/x', resourceType: 'fetch' }, policy)).toBe(true);
  });

  it('通用规则:只抓 fetch/document,非 http(s) 一律不抓', () => {
    expect(shouldCaptureBody({ url: 'https://x.com/a', resourceType: 'xhr' })).toBe(true);
    expect(shouldCaptureBody({ url: 'https://x.com/a', resourceType: 'document' })).toBe(true);
    expect(shouldCaptureBody({ url: 'https://x.com/a.png', resourceType: 'image' })).toBe(false);
    expect(shouldCaptureBody({ url: 'data:text/html,x', resourceType: 'document' })).toBe(false);
    expect(shouldCaptureBody({ url: 'https://x.com/a' })).toBe(false);  // 无类型不抓
  });

  it('resourceTypes 可由调用方覆盖', () => {
    expect(shouldCaptureBody(
      { url: 'https://x.com/a.png', resourceType: 'image' },
      { resourceTypes: ['image'] },
    )).toBe(true);
  });
});
