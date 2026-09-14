/**
 * 守卫:renderer 里不得使用 window.prompt。
 *
 * 起因(2026-09-02 实机报错):Electron renderer **不实现** window.prompt,
 * 调用直接抛 "prompt() is not supported"。它不是编译错误、也不是 lint 错误,
 * typecheck 全绿、跑起来才炸 —— 只能靠守卫钉死。
 *
 * 替代:行内 input(见 XInboxView 的 B′ 诊断)或已有的弹窗体系。
 * window.confirm / window.alert 是**支持**的,不在本守卫范围。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../../src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe('renderer 不得用 window.prompt', () => {
  it('全仓零命中', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, 'utf-8');
      src.split('\n').forEach((line, i) => {
        // 跳过注释行(本守卫自己的说明、以及解释为什么不能用的注释)
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/\bwindow\.prompt\s*\(/.test(line)) {
          offenders.push(`${file.replace(ROOT, 'src')}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      'Electron renderer 不支持 window.prompt,运行时会抛 "prompt() is not supported"。\n'
      + '  改用行内 input 或既有弹窗体系。',
    ).toEqual([]);
  });
});
