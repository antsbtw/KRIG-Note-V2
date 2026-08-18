/**
 * 守卫:Ctrl+C(SIGINT)必须能真正退出。
 *
 * 起因(2026-08-18):按 Ctrl+C 后 shell 提示符回来了,但 app 还在刷
 * `[surreal-ws] event=reconnecting` 和 `[x-search-scheduler] ... skip`,迟迟不退。
 *
 * 三个独立成因,缺一条就会复发:
 * 1. Electron 默认不把 SIGINT/SIGTERM 转成 app.quit() → 整套 before-quit
 *    (hasWindow 对账 + 关库)被完全跳过;
 * 2. X 调度器 60s setInterval 没人停 → 吊住事件循环;
 * 3. SurrealDB SDK 重连封顶 retryDelayMax 默认 60s → 尾几次每次等近一分钟。
 *    (实测日志间隔 3.6/7.9/17.4s,与 1s×2^n + 10% jitter 吻合)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('信号退出', () => {
  const main = read('src/platform/main/index.ts');

  it('注册了 SIGINT / SIGTERM 且接回 app.quit()', () => {
    expect(main).toMatch(/'SIGINT',\s*'SIGTERM'|SIGINT[\s\S]{0,200}SIGTERM/);
    expect(main).toMatch(/process\.on\(\s*sig|process\.on\(\s*['"]SIGINT/);
    // 必须走正规退出路径(触发 before-quit 的对账+关库),而不是直接 process.exit
    expect(main).toMatch(/app\.quit\(\)/);
  });

  it('二次信号才强杀(首次必须优雅退)', () => {
    expect(main).toMatch(/quitSignalReceived/);
    expect(main).toMatch(/process\.exit\(/);
  });
});

describe('退出时停掉常驻 timer', () => {
  it('before-quit 调 stopXSearchScheduler —— 否则 60s setInterval 吊住事件循环', () => {
    const main = read('src/platform/main/index.ts');
    expect(main).toContain('stopXSearchScheduler');
    const bq = main.slice(main.indexOf("app.on('before-quit'"));
    expect(bq).toContain('stopXSearchScheduler()');
  });

  it('调度器本身提供 stopScheduler', () => {
    const sched = read('src/platform/main/x/x-search-scheduler.ts');
    expect(sched).toMatch(/export function stopScheduler/);
    expect(sched).toMatch(/clearInterval\(schedulerTimer\)/);
  });
});

describe('SurrealDB 重连不得拖住退出', () => {
  const client = read('src/storage/surreal/client.ts');

  it('显式配置 reconnect,封顶延迟远小于 SDK 默认的 60s', () => {
    expect(client).toMatch(/reconnect:\s*\{/);
    const m = client.match(/retryDelayMax:\s*([\d_]+)/);
    expect(m).not.toBeNull();
    const max = Number(m![1].replace(/_/g, ''));
    expect(max).toBeLessThanOrEqual(10_000);
  });

  it('退出中不再刷 WS 事件日志', () => {
    expect(client).toMatch(/shuttingDown/);
    expect(client).toMatch(/if \(shuttingDown\) return;/);
  });

  it('shutdownSurrealDB 先 close 客户端再杀子进程(顺序反了会触发意外掉线重连)', () => {
    const fn = client.slice(client.indexOf('export function shutdownSurrealDB'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body.indexOf('db.close()')).toBeLessThan(body.indexOf("kill('SIGTERM')"));
  });
});
