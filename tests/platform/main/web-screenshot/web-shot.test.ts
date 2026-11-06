/**
 * 网页正文截图到笔记(2026-11-05)。
 * 用户 11-05 定:整篇正文长图;先框选调整再确认(「否则有可能会漏掉部分正文」);
 * 右栏开着 note 插光标处,否则新建。
 */
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('electron', () => ({ nativeImage: {} }));

import { buildSelectScript, RESTORE_SCRIPT } from '../../../../src/platform/main/web-screenshot/select-script';
import { tileRect, stackBitmaps } from '../../../../src/platform/main/web-screenshot/capture';
import { buildShotNodes } from '../../../../src/capabilities/content-extraction/internal/web-shot';

/**
 * 第一版用 captureBeyondViewport 一次截屏外区域:**在 <webview> 里不生效**,只把可见画面平铺填满
 * (笔记里长图「两份并排、上下重复」;离线 Electron 复现)→ 改成滚一屏截一屏。
 */
describe('tileRect(滚到目标后截视口里的哪一块)', () => {
  const sel = { x: 300, width: 700 };
  const vp = { w: 1000, h: 800 };
  it('正常滚到位:从视口顶开始,截满一屏', () => {
    expect(tileRect(sel, 2000, 5000, { x: 0, y: 2000 }, vp)).toEqual({ x: 300, y: 0, width: 700, height: 800 });
  });
  it('最后一段不足一屏:只截剩下的', () => {
    expect(tileRect(sel, 2000, 120, { x: 0, y: 2000 }, vp)).toEqual({ x: 300, y: 0, width: 700, height: 120 });
  });
  it('页面滚到底滚不动:按实际位置算偏移,不重叠也不漏', () => {
    expect(tileRect(sel, 5000, 300, { x: 0, y: 4600 }, vp)).toEqual({ x: 300, y: 400, width: 700, height: 300 });
  });
  it('横向滚过:x 按实际横向位置换算,宽度不超出视口', () => {
    expect(tileRect({ x: 900, width: 700 }, 0, 100, { x: 600, y: 0 }, vp)).toEqual({ x: 300, y: 0, width: 700, height: 100 });
  });
  it('目标带小数、滚动位置取了整(165.79 vs 166)→ 不当成越界(真机复现)', () => {
    expect(tileRect(sel, 165.79, 500, { x: 0, y: 166 }, vp)).toEqual({ x: 300, y: 0, width: 700, height: 500 });
  });
  it('视口里已经没有选区内容 → null(调用方报错,不死循环)', () => {
    expect(tileRect(sel, 5000, 300, { x: 0, y: 4100 }, vp)).toBeNull();
  });
});

describe('stackBitmaps', () => {
  it('竖着拼,宽度取最窄的那段(段间取整差 1px 时不错位)', () => {
    const a = { buf: Buffer.from([1, 1, 1, 1, 2, 2, 2, 2, 9, 9, 9, 9]), width: 3, height: 1 };
    const b = { buf: Buffer.from([3, 3, 3, 3, 4, 4, 4, 4]), width: 2, height: 1 };
    const r = stackBitmaps([a, b]);
    expect(r.width).toBe(2);
    expect(r.height).toBe(2);
    expect([...r.buf]).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  });
});

describe('buildShotNodes', () => {
  it('长图 + 「来源:标题」链接', () => {
    const [img, para] = buildShotNodes({ mediaUrl: 'media://images/img-1.png', title: ' 小米 ', url: 'https://x.example/a' });
    expect(img).toMatchObject({ type: 'image', attrs: { src: 'media://images/img-1.png', alt: '小米', alignment: 'center' } });
    expect(para).toEqual({ type: 'paragraph', content: [
      { type: 'text', text: '来源:' },
      { type: 'text', text: '小米', marks: [{ type: 'link', attrs: { href: 'https://x.example/a', title: null } }] },
    ] });
  });
});

/** 在 jsdom 里真跑注入脚本(没有排版,坐标是 0,但流程和 DOM 改动是真的) */
function page() {
  const dom = new JSDOM(
    '<body><header id="nav" style="position:fixed">导航</header><h1>标题</h1><article><p>' + '正文'.repeat(200) + '</p></article></body>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.example/a' },
  );
  const w = dom.window as unknown as Window & { eval: (s: string) => unknown };
  (w as unknown as { scrollTo: () => void }).scrollTo = () => {};
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return (this as HTMLElement).textContent; } });
  return w;
}

function clickButton(w: Window, text: string): void {
  const b = [...w.document.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`没有按钮 ${text}`);
  (b as HTMLButtonElement).click();
}

describe('框选脚本(jsdom 真跑)', () => {
  it('框贴着正文内容块,不按全宽容器;侧栏不算(bufanche 实测框成 1679 宽)', async () => {
    const dom = new JSDOM(
      '<body><main id="m"><h1 id="h">标题</h1><p id="p1">' + '正文'.repeat(150) + '</p><p id="p2">' + '正文'.repeat(150) +
        '</p><aside><p id="side">侧栏推荐</p></aside></main></body>',
      { runScripts: 'outside-only', pretendToBeVisual: true },
    );
    const w = dom.window as unknown as Window & { eval: (s: string) => unknown };
    (w as unknown as { scrollTo: () => void }).scrollTo = () => {};
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return (this as HTMLElement).textContent; } });
    const R: Record<string, [number, number, number, number]> = {
      m: [0, 0, 1600, 3000], h: [600, 200, 800, 60], p1: [600, 300, 800, 400], p2: [600, 720, 800, 400], side: [1450, 300, 140, 500],
    };
    w.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const r = R[this.id] ?? [0, 0, 0, 0];
      return { left: r[0], top: r[1], width: r[2], height: r[3], right: r[0] + r[2], bottom: r[1] + r[3], x: r[0], y: r[1], toJSON() {} } as DOMRect;
    };
    const p = w.eval(buildSelectScript()) as Promise<Record<string, number>>;
    clickButton(w, '确认截图');
    const sel = await p;
    // 内容块范围 x 600~1400、y 200~1120,四周各留 12px
    expect(sel).toMatchObject({ x: 588, y: 188, width: 824, height: 944 });
  }, 15000);

  it('能解析;出现框和工具栏;Esc 取消 → null,框移除', async () => {
    const w = page();
    const p = w.eval(buildSelectScript()) as Promise<unknown>;
    const buttons = [...w.document.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['⤒ 顶边', '⤓ 底边', '确认截图', '取消']);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBeNull();
    expect(w.document.querySelectorAll('button').length).toBe(0);
  });

  it('确认 → 带回选区;框先移除;吸顶栏藏起,还原脚本放回来', async () => {
    const w = page();
    const p = w.eval(buildSelectScript()) as Promise<Record<string, unknown>>;
    clickButton(w, '确认截图');
    const sel = await p;
    expect(sel).toMatchObject({ title: '', url: 'https://x.example/a', dpr: 1 });
    expect(typeof sel.height).toBe('number');
    expect(w.document.querySelectorAll('button').length).toBe(0);
    const nav = w.document.getElementById('nav') as HTMLElement;
    expect(nav.style.visibility).toBe('hidden');
    expect(w.eval(RESTORE_SCRIPT)).toBe(1);
    expect(nav.style.visibility).toBe('');
  }, 15000);

  it('正在框选时再点一次 → 直接 null,不叠第二个框', async () => {
    const w = page();
    const p1 = w.eval(buildSelectScript()) as Promise<unknown>;
    expect(await (w.eval(buildSelectScript()) as Promise<unknown>)).toBeNull();
    expect(w.document.querySelectorAll('button').length).toBe(4);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    await p1;
  });
});
