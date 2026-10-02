/**
 * `CaptureSession` —— ⭐⭐ 本文件钉的是**三种状态不许混成一个数**
 *
 * ── 为什么这是核心(不是细节)──
 *
 * 记忆 `project-x-collect-two-legs` 实测:载荷断了而 DOM 那条腿顶着,
 * payloads 83→0 时推文数还有 38 —— 人以为「只是少了点」。
 * ⭐ 判据必须看 payloads,而 payloads 要分得出三种成因:
 * ① captured  真拿到 body
 * ② noBody    有响应但没 bodyRef → **通道哑了**
 * ③ bodyLost  有 bodyRef 但取不出 → 与老化赛跑输了
 *
 * 合成一个「捕获 N 条」时,②会长得像「这页没请求」,
 * 而要调的东西完全不同(②查 CDP 通道,③调老化上限/取得更快)。
 */

import { describe, it, expect } from 'vitest';
import { NetworkEventBus } from '@platform/main/web-capability/net/bus';
import { CaptureSession } from '@platform/main/web-capability/net/capture-session';
import type { PageId } from '@platform/main/web-capability/page/types';

const PAGE = 'page-1' as unknown as PageId;
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

function rec(id: string, url: string, status = 200) {
  return {
    requestId: id,
    pageId: PAGE,
    url,
    method: 'POST',
    status,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

describe('CaptureSession:三种状态分得清', () => {
  it('⭐ 有 body → captured,且原样文本取得回来', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    bus.recordResponseComplete(rec('r1', 'https://x.com/i/api/graphql/abc/Followers'), bytes('{"ok":1}'));

    expect(s.stats().captured).toBe(1);
    expect(s.stats().noBody).toBe(0);
    expect(s.stats().bodyLost).toBe(0);

    const [p] = s.list();
    expect(p.text, '载荷文本不是原样').toBe('{"ok":1}');
    expect(p.url).toContain('Followers');
    expect(p.byteLength).toBe(8);
  });

  it('⭐⭐ 有响应但没 body → noBody,**不计入 captured**(通道哑了的指纹)', () => {
    /**
     * ⚠️ 这一条是本文件存在的首要理由。
     * 旧实现把这种情况当正常请求滑过去 → 「捕获 0 条」看着像「这页没请求」,
     * 人去查选择器/页面,而真因在 CDP 通道,方向完全相反。
     */
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    // ⚠️ 不传 body —— 这正是「通道哑了」时总线看到的样子
    bus.recordResponseComplete(rec('r1', 'https://x.com/i/api/graphql/abc/Followers'));

    const st = s.stats();
    expect(st.captured, 'noBody 被算进 captured 了 —— 通道哑了会被当成健康').toBe(0);
    expect(st.noBody).toBe(1);
    expect(s.list(), '没 body 却攒了一条').toHaveLength(0);
  });

  it('⭐⭐ 一半有一半没有:两个数都要对', () => {
    /** ⚠️ 混成一个数时这个场景最容易看着「正常」—— 所以必须单测 */
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    bus.recordResponseComplete(rec('a', 'https://x.com/1'), bytes('x'));
    bus.recordResponseComplete(rec('b', 'https://x.com/2'));
    bus.recordResponseComplete(rec('c', 'https://x.com/3'), bytes('y'));
    bus.recordResponseComplete(rec('d', 'https://x.com/4'));

    expect(s.stats().captured).toBe(2);
    expect(s.stats().noBody).toBe(2);
  });

  it('⭐ 通道故障单独计 + 留最后一条原因', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    bus.channelFailed(PAGE, 'CDP attach 失败: 被占用', true);

    const st = s.stats();
    expect(st.channelFailures).toBe(1);
    expect(st.lastChannelFailure, '没留原因 —— 人查不到为什么').toContain('被占用');
    // ⚠️ 故障不该算成 noBody/captured —— 三类成因各归各位
    expect(st.captured).toBe(0);
    expect(st.noBody).toBe(0);
  });

  it('⭐ 通道中途丢失也要收到(不受 kinds 过滤)', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    bus.channelLost(PAGE, '页面销毁');
    expect(s.stats().channelFailures, 'channel-lost 没收到 —— 会安静等一个永不来的载荷').toBe(1);
  });
});

describe('CaptureSession:生命周期', () => {
  it('⭐ start 幂等 —— 重复调不会把同一条载荷存两份', () => {
    /**
     * ⚠️ 不幂等的现象是「捕获数翻倍」,而人会以为真来了那么多
     * (`project-host-broadcast-multi-ws-fanout` 同族)。
     */
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    s.start();
    s.start();
    bus.recordResponseComplete(rec('r1', 'https://x.com/1'), bytes('x'));

    expect(s.stats().captured, 'start 不幂等 —— 同一条被算了多次').toBe(1);
    expect(s.list()).toHaveLength(1);
  });

  it('⭐⭐ stop 之后真的不再收', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    bus.recordResponseComplete(rec('r1', 'https://x.com/1'), bytes('x'));
    s.stop();
    bus.recordResponseComplete(rec('r2', 'https://x.com/2'), bytes('y'));

    expect(s.stats().captured, 'stop 之后还在收 —— 人点了停而数字还在动').toBe(1);
    expect(s.stats().running).toBe(false);
  });

  it('⭐ running 如实反映状态', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    expect(s.stats().running, '还没 start 就说在跑').toBe(false);
    s.start();
    expect(s.stats().running).toBe(true);
    s.stop();
    expect(s.stats().running).toBe(false);
  });

  it('⭐ stop 后能再 start（人点停又点开始）', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    s.stop();
    s.start();
    bus.recordResponseComplete(rec('r1', 'https://x.com/1'), bytes('x'));
    expect(s.stats().captured, '重新 start 之后收不到 —— 订阅没重建').toBe(1);
  });

  it('⭐ clearPayloads 清内容但**保留计数**', () => {
    /** ⚠️ 计数一起清会让人不知道这一轮总共来过多少 */
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    bus.recordResponseComplete(rec('r1', 'https://x.com/1'), bytes('x'));
    bus.recordResponseComplete(rec('r2', 'https://x.com/2'));
    s.clearPayloads();

    expect(s.list()).toHaveLength(0);
    expect(s.stats().held).toBe(0);
    expect(s.stats().captured, 'clearPayloads 把计数也清了').toBe(1);
    expect(s.stats().noBody, 'clearPayloads 把 noBody 也清了').toBe(1);
  });

  it('⭐ resetStats 才清计数', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    bus.recordResponseComplete(rec('r1', 'https://x.com/1'), bytes('x'));
    s.resetStats();
    expect(s.stats().captured).toBe(0);
  });
});

describe('CaptureSession:封顶与如实', () => {
  it('⭐ 攒的条数封顶,淘汰最老的', () => {
    /**
     * ⚠️ 不封顶的话主进程内存一直涨,而**涨到卡住之前没有任何症状**。
     * ⚠️ 判据必须验「留下的是新的」—— 只验 length 的话,
     * 淘汰最新的那种写法也会绿。
     */
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    for (let i = 0; i < 100; i += 1) {
      bus.recordResponseComplete(rec(`r${i}`, `https://x.com/${i}`), bytes(`body-${i}`));
    }
    const held = s.list(999);
    expect(held.length, '一条都没淘汰 —— 内存会一直涨').toBeLessThanOrEqual(64);
    expect(held.length).toBeGreaterThan(0);
    // list 最新在前
    expect(held[0].text, '留下的不是最新的 —— 淘汰方向反了').toBe('body-99');
    expect(
      held.some((p) => p.text === 'body-0'),
      '最老的那条还在 —— 淘汰没生效',
    ).toBe(false);
    // ⭐ 计数不受封顶影响:总共来过 100 条这个事实要留住
    expect(s.stats().captured, '封顶把计数也砍了 —— 丢掉了「总共来过多少」').toBe(100);
  });

  it('⭐ list(limit) 只影响返回量,不动存量', () => {
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    for (let i = 0; i < 10; i += 1) {
      bus.recordResponseComplete(rec(`r${i}`, `https://x.com/${i}`), bytes(`b${i}`));
    }
    expect(s.list(3)).toHaveLength(3);
    expect(s.stats().held, 'list 把存量改了').toBe(10);
  });

  it('⚠️ 只订阅自己那一页 —— 别的页面的载荷不许串进来', () => {
    /**
     * ⚠️ 串页的现象是「在 A 窗口看到 B 窗口的载荷」,
     * 而人会据此判断 A 的采集状态(`project-ws-instance-isolation-invariant` 同族)。
     */
    const bus = new NetworkEventBus();
    const s = new CaptureSession(bus, PAGE);
    s.start();
    const other = { ...rec('r9', 'https://x.com/other'), pageId: 'page-2' as unknown as PageId };
    bus.recordResponseComplete(other, bytes('z'));
    expect(s.stats().captured, '别的页面的载荷串进来了').toBe(0);
  });
});

/**
 * ⭐⭐ 用**假 bus** 造那两个真 bus 造不出的场景。
 *
 * ── ⚠️ 为什么非要这一节(2026-10-02 注入验证逼出来的)──
 *
 * 我上面那 15 条跑完全绿,但注入「bodyLost 混进 captured」和
 * 「URL 找不到时猜一个」时**照样全绿** —— 因为真 bus 下
 * `body()` 总是取得到、`record` 总是找得到,
 * **我的样本里压根没有那两个现象**(`feedback-check-sample-contains-phenomenon`:
 * 别拿不含某现象的样本论证该现象)。
 *
 * ⭐ 假 bus 只实现 `CaptureSession` 真正用到的三个方法,
 * 精确控制 `body()` 失败与 `list()` 为空。
 */
describe('CaptureSession:用假 bus 造边界场景', () => {
  type Listener = (e: unknown) => void;

  /** ⚠️ 只实现被用到的三个方法 —— 多实现就要跟着真 bus 改,反而成了负担 */
  function fakeBus(opts: { bodyOk: boolean; hasRecord: boolean }) {
    let listener: Listener | null = null;
    return {
      bus: {
        subscribe(_p: unknown, _m: unknown, l: Listener) {
          listener = l;
          return () => { listener = null; };
        },
        body: () => (opts.bodyOk
          ? { status: 'ok' as const, value: bytes('payload') }
          : { status: 'failed' as const, reason: 'body not available(已被老化淘汰)', retryable: false }),
        list: () => (opts.hasRecord
          ? [{ requestId: 'r1', url: 'https://x.com/real', method: 'POST', status: 200 }]
          : []),
      },
      emit(e: unknown) { listener?.(e); },
    };
  }

  const completeEvent = {
    kind: 'response-complete' as const,
    pageId: PAGE,
    requestId: 'r1',
    status: 200,
    bodyRef: 'ref-1',
    at: new Date().toISOString(),
  };

  it('⭐⭐ 有 bodyRef 但取不出来 → bodyLost,**不计入 captured**', () => {
    /**
     * ⚠️ 这是「与老化赛跑输了」,与「通道哑了」(noBody)是两种成因:
     * 前者该调老化上限/取得更快,后者该查 CDP 通道。
     * 混进 captured 的话两者都看不见 —— 而显示的是「捕到了」,最误导。
     */
    const { bus, emit } = fakeBus({ bodyOk: false, hasRecord: true });
    const s = new CaptureSession(bus as never, PAGE);
    s.start();
    emit(completeEvent);

    const st = s.stats();
    expect(st.bodyLost, 'bodyLost 没计上').toBe(1);
    expect(st.captured, 'bodyLost 被算进 captured 了 —— 取不到 body 却显示捕到了').toBe(0);
    expect(st.noBody, 'bodyLost 被算成 noBody 了 —— 两种成因混了').toBe(0);
    expect(s.list(), '取不到 body 却攒了一条').toHaveLength(0);
  });

  it('⚠️⚠️ 找不到请求记录时 URL 留空串,**不猜一个**', () => {
    /**
     * ⭐ 猜一个(比如 x.com/home)会让人以为采的就是那一页 ——
     * 而「URL 未知」和「URL 是某页」对排查的意义完全相反。
     * 这正是 `project-x-collect-panel-scraped-homepage` 那次的形态:
     * 看着是在采某页,实际采的是首页。
     */
    const { bus, emit } = fakeBus({ bodyOk: true, hasRecord: false });
    const s = new CaptureSession(bus as never, PAGE);
    s.start();
    emit(completeEvent);

    const [p] = s.list();
    expect(p, '该攒下一条').toBeDefined();
    expect(p.url, 'URL 找不到时猜了一个 —— 会让人以为采的是那一页').toBe('');
  });

  it('⭐ 记录找得到时 URL 如实带上', () => {
    /** ⚠️ 反向锁:上一条光有「留空」会被一个「永远留空」的实现满足 */
    const { bus, emit } = fakeBus({ bodyOk: true, hasRecord: true });
    const s = new CaptureSession(bus as never, PAGE);
    s.start();
    emit(completeEvent);
    expect(s.list()[0].url, 'URL 明明找得到却没带上').toBe('https://x.com/real');
  });
});
