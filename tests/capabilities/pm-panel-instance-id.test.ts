/**
 * 守卫:selection-bound popup 面板不得用裸 wsId 当 driver instanceId。
 *
 * 起因(2026-08-18 回归):LinkPanel 的 wsId 来自 useWsId(),而 instanceRegistry 的 key
 * 是 per-slot 复合 id(`${wsId}::slot:<left|right>`,见 note/data-model.ts noteInstanceId)。
 * 裸 wsId 永远 get 不到实例 → api.setLink 首行 `if (!inst) return` 静默 no-op,
 * 表现为「输完 URL 按 Enter,弹窗关了但链接没加上」,且控制台无任何报错。
 *
 * 对齐 ColorPickerPanel:instanceId 必须走 instanceRegistry.getFocusedInstanceId()。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('LinkPanel instanceId 来源', () => {
  const src = read('src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx');

  it('用 getFocusedInstanceId(),不用 useWsId()', () => {
    expect(src).toContain('getFocusedInstanceId');
    // useWsId 返回的是裸 wsId — 与 registry 的 per-slot key 不同构。
    // 只禁 import / 实际调用;文首注释里解释"为什么不能用"的那处字面允许保留。
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    expect(importLines.some((l) => l.includes('useWsId'))).toBe(false);
    expect(src).not.toMatch(/=\s*useWsId\(\)/);
  });

  it('在 mount 时快照 instanceId(面板 input 带 autoFocus 会抢走 PM 焦点)', () => {
    // autoFocus 抢焦点后 getFocusedInstanceId() 会返 null,故必须存进 ref 而非现读
    expect(src).toContain('autoFocus');
    expect(src).toMatch(/instanceIdRef[\s\S]*getFocusedInstanceId/);
  });
});

describe('driver 侧不变量', () => {
  it('noteInstanceId 产出 per-slot 复合 id(裸 wsId 取不到实例的根因)', () => {
    const dm = read('src/views/note/data-model.ts');
    expect(dm).toMatch(/return `\$\{wsId\}::slot:\$\{slot\}`/);
  });

  it('setLink 拿不到实例时静默 return —— 正因如此 id 错了不会报错', () => {
    const api = read('src/drivers/text-editing-driver/api.ts');
    const body = api.slice(api.indexOf('setLink(instanceId'));
    expect(body.slice(0, 200)).toContain('if (!inst) return');
  });
});

describe('同批次(5148ef15)另两个面板 —— 同源 bug', () => {
  // HandleFormatSubmenu / HandleColorSubmenu 与 LinkPanel 同一个 commit 被改成 useWsId(),
  // 病灶相同:传裸 wsId 给 block-scoped API → instanceRegistry 取不到 → 静默 no-op。
  const PANELS = [
    'src/capabilities/text-editing/ui/handle-menu/HandleFormatSubmenu.tsx',
    'src/capabilities/text-editing/ui/color-picker/HandleColorSubmenu.tsx',
  ];

  it.each(PANELS)('%s 用 getFocusedInstanceId 快照,不用裸 useWsId', (path) => {
    const src = read(path);
    expect(src).toContain('getFocusedInstanceId');
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    expect(importLines.some((l) => l.includes('useWsId'))).toBe(false);
    expect(src).not.toMatch(/=\s*useWsId\(\)/);
  });
});

describe('右键菜单命令 —— 必须用抓拍的 pmInstanceId', () => {
  // 菜单弹出后焦点已从 PM 转向菜单,getFocusedInstanceId() 现读返 null。
  // register-context-info.ts 为此在触发瞬间抓拍 custom.pmInstanceId;
  // 消费端漏读就会静默跳过(2026-08-18「移除链接不生效」根因)。
  const src = read('src/capabilities/text-editing/commands/register-pm-commands.ts');

  it.each([
    ['cm-remove-link', /cm-remove-link[\s\S]{0,600}?custom\.pmInstanceId/],
    ['getCmBlockPos', /function getCmBlockPos[\s\S]{0,600}?custom\.pmInstanceId/],
  ])('%s 读 context.custom.pmInstanceId', (_name, re) => {
    expect(src).toMatch(re);
  });

  it('抓拍源仍在贡献 pmInstanceId(消费端的前提)', () => {
    const info = read('src/capabilities/text-editing/ui/context-menu/register-context-info.ts');
    expect(info).toMatch(/pmInstanceId\s*=\s*instanceRegistry\.getFocusedInstanceId\(\)/);
    expect(info).toMatch(/return \{[\s\S]*?pmInstanceId/);
  });
});
