/**
 * L5-G7.1 — sfnt-name-reader 单测(扫描提速的核心:只读 name 表)
 *
 * 结构性断言用本机真实字体(node 环境有 fs);找不到对应字体则跳过(CI 友好)。
 * 重点验证苹方 PingFang.ttc 的 family 正确解析为 "PingFang SC"(而非 Mac 平台的
 * ".PingFang SC" 内部名)—— 这是 name 记录平台优先级打分的关键回归点。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';
import { isTtcBuffer, ttcSubfontDirOffsets, readSfntNames } from '@platform/main/fonts/sfnt-name-reader';

function findArial(): string | null {
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function findPingFangTtc(): string | null {
  try {
    const out = cp
      .execSync('find /System/Library/AssetsV2 -iname "*pingfang*" 2>/dev/null | head -1')
      .toString()
      .trim();
    return out && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

describe('sfnt-name-reader: 单字体 .ttf(本机有 Arial 才跑)', () => {
  const arial = findArial();
  it.skipIf(!arial)('读出 family=Arial', () => {
    const buf = fs.readFileSync(arial as string);
    expect(isTtcBuffer(buf)).toBe(false);
    const names = readSfntNames(buf, 0);
    expect(names).not.toBeNull();
    expect(names?.family).toBe('Arial');
  });
});

describe('sfnt-name-reader: 苹方 .ttc 平台优先级(本机有苹方才跑)', () => {
  const pf = findPingFangTtc();
  it.skipIf(!pf)('PingFang.ttc 子字体读出 "PingFang SC"(非 Mac 内部 . 前缀名)', () => {
    const buf = fs.readFileSync(pf as string);
    expect(isTtcBuffer(buf)).toBe(true);
    const offsets = ttcSubfontDirOffsets(buf);
    expect(offsets.length).toBeGreaterThan(0);

    const families = new Set<string>();
    for (const off of offsets) {
      const names = readSfntNames(buf, off);
      if (names) families.add(names.family);
    }
    // 必须有干净的 "PingFang SC",且不能有 Mac 平台的 ".PingFang" 内部名占位
    expect([...families].some((f) => /^PingFang SC$/.test(f))).toBe(true);
    expect([...families].every((f) => !f.startsWith('.PingFang'))).toBe(true);
  });
});
