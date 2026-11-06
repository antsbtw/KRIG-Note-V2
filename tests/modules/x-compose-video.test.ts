/**
 * 发推带视频(11-05 真机):X 弹窗里视频是 attachments 里的 <video>,进度在 role=status「名字: Processing → Ready」。
 * 钉:① 等传完的脚本拼出来是合法 JS,且真能在 DOM 上认出视频 / 认出没传完(jsdom);② 等多久按视频大小放宽。
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ inputEngine: {} }));
vi.mock('@platform/main/web-capability/wiring/web-collect-engine', () => ({ resolve: () => ({ pageId: 'p' }) }));
vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: () => ({}) }));

const { X_DOM_SCRIPTS: X_SCRIPT_DEFS, X_SCRIPTS } = await import('@modules/x/x-dom-scripts');
const { mediaWaitMs } = await import('@modules/x/x-post-draft');

const def = (X_SCRIPT_DEFS as Array<{ id: string; build: (p: Record<string, unknown>) => string }>).find((d) => d.id === X_SCRIPTS.composeMediaReady)!;

function dialog(status: string, video = true): void {
  document.body.innerHTML = `<div role="dialog"><div data-testid="tweetTextarea_0"></div>
    <div data-testid="attachments">${video ? '<video poster="data:image/png;base64,AA"></video>' : ''}</div>
    <div role="status"><span>${status}</span></div>
    <div role="button" data-testid="tweetButton" aria-disabled="${status.includes('Ready') ? 'false' : 'true'}"></div></div>`;
  // jsdom 没有 innerText
  document.querySelectorAll('[role="status"]').forEach((e) => Object.defineProperty(e, 'innerText', { get: () => e.textContent }));
}
const run = (p: Record<string, unknown>) => (0, eval)(def.build(p)) as Promise<Record<string, unknown>>;

describe('发推带视频:等 X 传完', () => {
  it('⭐ 视频「Ready」→ 认得出挂上 1 件、传完了', async () => {
    dialog('t.mp4: Ready');
    const r = await run({ want: 1 });
    expect(r).toMatchObject({ state: 'ready', attached: 1 });
  }, 10_000);

  it('⭐ 视频还在「Processing」→ 不算传完,到点超时带回 X 显示的原文', async () => {
    dialog('t.mp4: Processing');
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const p = run({ want: 1, maxMs: 60_000 });
    await vi.advanceTimersByTimeAsync(61_000);
    const r = await p;
    vi.useRealTimers();
    expect(r).toMatchObject({ state: 'timeout', attached: 1, busy: 1, videos: 1, status: 't.mp4: Processing' });
  });
});

describe('发推带视频:最多等多久', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xv-'));
  const file = (name: string, mb: number) => { const f = path.join(dir, name); writeFileSync(f, Buffer.alloc(mb * 1024 * 1024)); return f; };
  it('只有图 → 60 秒', () => {
    expect(mediaWaitMs([file('a.png', 1)])).toBe(60_000);
  });
  it('⭐ 视频按大小放宽:10 MB → 60 + 30 秒', () => {
    expect(mediaWaitMs([file('v.mp4', 10)])).toBe(90_000);
  });
});
