/**
 * ⭐ `ready` —— 等到位(`01-contract.md` §9.4)
 *
 * ── 本步做的是「合并两份不等价实现,取并集」──
 *
 * | | `x-article-driver.ts:84` | `x-write.ts:106` | 并集(本层) |
 * |---|---|---|---|
 * | 多候选 selector | ❌ | ✅ 逗号分隔 | ✅ |
 * | 注入异常重试 | ❌ 连 try 都没有 | ✅ catch 后继续轮询 | ✅ |
 * | `anchorGone`(模态关闭) | ✅ | ❌ | ✅ |
 * | 默认超时 | `DEFAULT_WAIT_MS` | 写死 6000 | ✅ 可配 |
 *
 * ⚠️ 两份都缺对方有的东西 —— 这正是「同一 bug 修三遍」的成因:
 * 谁也不知道另一份已经踩过哪些坑。
 */
import { describe, it, expect } from 'vitest';
import { ControlEngine, DEFAULT_READY_TIMEOUT_MS } from '@platform/main/web-capability/page/control';
import { isFailed, isOk } from '@platform/main/web-capability';
import { FakeScrollPage, MapAnchors, MapScripts, PAGE } from './helpers/fake-scroll-page';

const ANCHORS = {
  /** ⭐ 多候选:新旧 selector 并列(站点改版当天的唯一缓冲) */
  composeBox: '#new-compose, .legacy-compose',
  modalMarker: '.modal-close',
  single: '#only',
};

function engine(page: FakeScrollPage, scripts: Record<string, string> = {}) {
  return new ControlEngine(page, new MapAnchors(ANCHORS), new MapScripts(scripts));
}

describe('⭐ anchorAppears / anchorGone 都 work', () => {
  it('锚点已在场 → 立刻 Ok', async () => {
    const page = new FakeScrollPage();
    page.present.add('#only');
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' });
    expect(isOk(r)).toBe(true);
  });

  it('⭐ 锚点稍后出现 → 轮询等到它(不是只查一次)', async () => {
    const page = new FakeScrollPage();
    let n = 0;
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      n += 1;
      if (n >= 3) page.present.add('#only'); // 第 3 次探测时才出现
      return orig(id, s);
    };
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' });
    expect(isOk(r)).toBe(true);
    // 自检:确实轮询了多次(只查一次的实现在这里会超时)
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('⭐⭐ anchorGone —— 模态关闭判据(X 发长文每步都要它)', async () => {
    const page = new FakeScrollPage();
    page.present.add('.modal-close'); // 模态开着
    let n = 0;
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      n += 1;
      if (n >= 2) page.present.delete('.modal-close'); // 模态关了
      return orig(id, s);
    };
    const r = await engine(page).ready(PAGE, { kind: 'anchorGone', anchor: 'modalMarker' });
    expect(isOk(r)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('⭐⭐ 模态一直不关 → Failed(不谎称已关闭)', async () => {
    // 这是连环失败的起点:模态没关却报「关了」→ 下一 step 在脏态上启动
    const page = new FakeScrollPage();
    page.present.add('.modal-close');
    const r = await engine(page).ready(PAGE, { kind: 'anchorGone', anchor: 'modalMarker' }, 50);
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('anchorGone');
  });

  it('⭐⭐ anchorGone 判「不在场」用 === false,不是 !raw', async () => {
    // ⚠️ 注入返回 undefined(脚本没跑成)会被 `!raw` 当成「已消失」——
    //    那就是把**失败**读成**成功**。这条造的正是那个场景。
    const page = new FakeScrollPage();
    page.present.add('.modal-close');
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      if (s.includes('querySelector')) return undefined; // 脚本没跑成
      return orig(id, s);
    };
    const r = await engine(page).ready(PAGE, { kind: 'anchorGone', anchor: 'modalMarker' }, 50);
    expect(isFailed(r), 'undefined 不等于「模态已关闭」').toBe(true);
  });
});

describe('⭐ 多候选 selector 生效(取自 x-write,article-driver 那份没有)', () => {
  it('⭐⭐ 只有**第二个**候选在场时也要命中', async () => {
    // 站点改版:新 selector 还没上,旧的还在 —— 多候选是当天的唯一缓冲。
    // 若实现只取第一个候选,这条会超时。
    const page = new FakeScrollPage();
    page.present.add('.legacy-compose'); // 只有旧的在
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'composeBox' }, 200);
    expect(isOk(r)).toBe(true);
  });

  it('⭐ 只有第一个候选在场时同样命中', async () => {
    const page = new FakeScrollPage();
    page.present.add('#new-compose');
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'composeBox' }, 200);
    expect(isOk(r)).toBe(true);
  });

  it('⭐ 两个候选都不在场 → Failed(反向锁:不是「一律命中」)', async () => {
    const page = new FakeScrollPage();
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'composeBox' }, 50);
    expect(isFailed(r)).toBe(true);
  });

  it('⭐ 多候选下 anchorGone 要**全部**消失才算关闭', async () => {
    // 若只查第一个候选,旧模态还开着就会被误判成「已关闭」
    const page = new FakeScrollPage();
    page.present.add('.legacy-compose'); // 旧的还在
    const r = await engine(page).ready(PAGE, { kind: 'anchorGone', anchor: 'composeBox' }, 50);
    expect(isFailed(r), '还有一个候选在场,不算全关').toBe(true);
  });
});

describe('⭐⭐ 注入异常会重试(取自 x-write;article-driver 那份连 try 都没有)', () => {
  it('⭐⭐ 前几次注入抛错,之后恢复 → 最终 Ok', async () => {
    // 页面正在导航时 executeJavaScript 必抛 —— 那恰恰说明「还没到位」,
    // 正是该继续等的时刻。没有重试就会把「还没加载完」误判成「判据不满足」。
    const page = new FakeScrollPage();
    page.present.add('#only');
    page.evaluateThrows = '页面正在导航';
    page.throwTimes = 3; // 抛 3 次后恢复
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' }, 5000);
    expect(isOk(r)).toBe(true);
    // 自检:确实抛过(场景真造出来了,不是空转)
    expect(page.evaluateCount).toBeGreaterThan(3);
  });

  it('⭐ 一直抛到超时 → Failed,且原因里带**最后一次异常**', async () => {
    // 只说「判据不满足」会把人指向 selector,而真因是注入一直抛 ——
    // 那次转义事故烧一整天,一半原因就是日志把猜测当结论
    const page = new FakeScrollPage();
    page.evaluateThrows = 'ERR_ABORTED';
    page.throwTimes = Infinity; // ⚠️ 一直抛。用「很大的数」会被跑完,场景就没造出来
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' }, 50);
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('ERR_ABORTED');
    expect(r.reason).toContain('最后一次注入异常');
  });

  it('⭐ 判据满足后的成功里**不带**异常信息(异常已被清掉)', async () => {
    const page = new FakeScrollPage();
    page.present.add('#only');
    page.evaluateThrows = '临时抖动';
    page.throwTimes = 1;
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' }, 5000);
    expect(isOk(r)).toBe(true);
  });
});

describe('urlIncludes / custom 判据', () => {
  it('urlIncludes 命中 → Ok', async () => {
    const page = new FakeScrollPage({ url: 'https://x.test/compose/post' });
    const r = await engine(page).ready(PAGE, { kind: 'urlIncludes', fragment: '/compose/' });
    expect(isOk(r)).toBe(true);
  });

  it('urlIncludes 不命中 → Failed', async () => {
    const page = new FakeScrollPage({ url: 'https://x.test/home' });
    const r = await engine(page).ready(PAGE, { kind: 'urlIncludes', fragment: '/compose/' }, 50);
    expect(isFailed(r)).toBe(true);
  });

  it('⭐ URL 中途变化 → 轮询能等到(不是只看第一次)', async () => {
    const page = new FakeScrollPage({ url: 'https://x.test/home' });
    let n = 0;
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      n += 1;
      if (n >= 3) page.url = 'https://x.test/compose/post';
      return orig(id, s);
    };
    const r = await engine(page).ready(PAGE, { kind: 'urlIncludes', fragment: '/compose/' }, 5000);
    expect(isOk(r)).toBe(true);
  });

  it('⭐ custom 走预注册脚本;未注册 → Failed(不收脚本字符串)', async () => {
    const page = new FakeScrollPage();
    const r = await engine(page).ready(PAGE, { kind: 'custom', script: 'x.nope' as never }, 50);
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('未注册');
    expect(r.retryable, '脚本没注册,重试没有意义').toBe(false);
  });

  it('custom 已注册且返回 true → Ok', async () => {
    const page = new FakeScrollPage();
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => (s.includes('READY_MARK') ? true : orig(id, s));
    const r = await engine(page, { 'x.ready': '(function(){ return READY_MARK; })()' })
      .ready(PAGE, { kind: 'custom', script: 'x.ready' as never });
    expect(isOk(r)).toBe(true);
  });

  it('⭐ custom 返回非 true 的真值不算满足(只认 === true)', async () => {
    // 返回 'yes' / 1 / {} 都不算 —— 松了会让「脚本返回了个对象」被当成成功
    const page = new FakeScrollPage();
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => (s.includes('READY_MARK') ? 'yes' : orig(id, s));
    const r = await engine(page, { 'x.ready': '(function(){ return READY_MARK; })()' })
      .ready(PAGE, { kind: 'custom', script: 'x.ready' as never }, 50);
    expect(isFailed(r)).toBe(true);
  });
});

describe('⭐ 超时与三态', () => {
  it('⭐ 超时返回 Failed,**不返回 Ok**', async () => {
    const page = new FakeScrollPage();
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' }, 50);
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('超时');
    expect(r.retryable, '等不到多半是时机问题,可重试').toBe(true);
  });

  it('⭐ 超时可配(默认 6000,传值生效)', async () => {
    expect(DEFAULT_READY_TIMEOUT_MS).toBe(6000);
    const page = new FakeScrollPage();
    const t0 = Date.now();
    await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' }, 30);
    // 用可控时钟,真实耗时应远小于默认 6000
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('⭐ 锚点没登记 → Failed(不可重试),与「等不到」可区分', async () => {
    const page = new FakeScrollPage();
    const r = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'noSuchAnchor' }, 50);
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('无法解释成 selector');
    expect(r.retryable).toBe(false);
    // 与「等不到」的可重试性不同 —— 这是调用方唯一能自动分流的信号
    const timeout = await engine(page).ready(PAGE, { kind: 'anchorAppears', anchor: 'single' }, 50);
    if (!isFailed(timeout)) throw new Error('unreachable');
    expect(timeout.retryable).toBe(true);
  });
});

describe('⭐ 能力层边界', () => {
  it('control.ts / scroll-scripts.ts 零处 electron', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    for (const f of ['control.ts', 'scroll-scripts.ts', 'control-types.ts']) {
      const code = fs
        .readFileSync(`src/platform/main/web-capability/page/${f}`, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, `${f} 碰了 Electron`).not.toMatch(/from\s+['"]electron['"]/);
      expect(code, `${f} 出现 webContents`).not.toMatch(/\bwebContents\b|\bWebContents\b/);
    }
  });

  it('⭐ wiring/electron-control.ts 确实存在且确实碰 Electron(否则上条空转)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/wiring/electron-control.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/from\s+['"]electron['"]/);
    expect(code).toMatch(/executeJavaScript/);
  });

  it('⭐ 接线层不 catch **注入**异常(吞掉会让 ready 的重试与 scrollUntil 的分辨都失效)', () => {
    /**
     * ⚠️ **收窄到 `evaluate` 的函数体**(2026-09-15,`goto` 落地时改)。
     *
     * 初版扫整个文件禁 `catch` —— 而 `navigate` **必须** catch:
     * `loadURL` 常常不 resolve(站点自行接管导航,X 的 ERR_ABORTED 是常态),
     * 契约 §9.3 明写「底座必须内建:处理站点自行接管导航」。
     * 不 catch 就等于把正常导航一律当失败。
     *
     * ⭐ 这条守卫真正保护的是**注入异常要往上抛** ——
     * `ready` 靠它决定「继续等」,`scrollUntil` 靠它区分「滚不动」与「做不了」。
     * 那是 `evaluate` 的事,与 `navigate` 无关。故按函数体守,不按文件守。
     */
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/wiring/electron-control.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const start = code.indexOf('async evaluate(');
    expect(start, '锚点过时:找不到 evaluate').toBeGreaterThan(0);
    // evaluate 是文件里最后一个方法;取到类结尾即可
    const body = code.slice(start);
    expect(body, 'evaluate 里吞了注入异常 —— ready 的重试与 scrollUntil 的分辨都会失效')
      .not.toMatch(/catch\s*[({]/);

    // ⭐ 反向锁:navigate 那条 catch 必须**还在**(删了就等于把正常导航当失败)
    expect(code, 'navigate 不 catch loadURL reject —— 站点接管导航会被误判成失败')
      .toMatch(/loadURL\([^)]*\)\.catch\(/);
  });
});
