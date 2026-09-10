/**
 * h1~h6 入口齐备守卫(静态)
 *
 * 起因(2026-09-10):schema / CSS / markdown 输入规则 / 折叠三角都支持到 h6,
 * 但 **slash 菜单、⋮⋮ turn-into、快捷键、命令注册只到 h3** —— h4~h6 只能靠敲
 * `#### ` 打出来,菜单里完全不可见。是用户看截图发现的,不是测试发现的。
 *
 * 这类缺口的形态是「支持是半截的」:每一层单独看都自洽,合起来才有洞,
 * 而且**没有任何运行时测试会红**(功能没坏,只是入口不存在)。只能静态钉。
 *
 * ⚠️ stripComments:注释里写着 'h4' 不算数(禁止用注释骗守卫)。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stripComments } from '../helpers/source-scan';

const REPO = path.resolve(__dirname, '../..');
const LEVELS = [1, 2, 3, 4, 5, 6] as const;

function readCode(rel: string): string {
  return stripComments(fs.readFileSync(path.join(REPO, rel), 'utf-8'));
}

describe('h1~h6 入口齐备 —— 每一层都不许只做到 h3', () => {
  it('命令注册:slash-turn-h1..h6 全部注册', () => {
    const code = readCode('src/capabilities/text-editing/commands/register-pm-commands.ts');
    const missing = LEVELS.filter((n) => !code.includes(`'text-editing.slash-turn-h${n}'`));
    expect(missing, `slash-turn 命令缺失的级别: ${missing.join(',')}`).toEqual([]);
  });

  it('命令注册:handle-turn-h1..h6 全部注册', () => {
    const code = readCode('src/capabilities/text-editing/commands/register-pm-commands.ts');
    const missing = LEVELS.filter((n) => !code.includes(`'text-editing.handle-turn-h${n}'`));
    expect(missing, `handle-turn 命令缺失的级别: ${missing.join(',')}`).toEqual([]);
  });

  it('slash 菜单:Heading 1..6 全部有菜单项', () => {
    const code = readCode('src/capabilities/text-editing/ui/slash-menu/items.ts');
    const missing = LEVELS.filter((n) => !code.includes(`'text-editing.slash-turn-h${n}'`));
    expect(missing, `slash 菜单缺失的级别: ${missing.join(',')}`).toEqual([]);
  });

  it('⋮⋮ turn-into 子菜单:Heading 1..6 全部有子项', () => {
    const code = readCode('src/capabilities/text-editing/ui/handle-menu/items.tsx');
    const missing = LEVELS.filter((n) => !code.includes(`'text-editing.handle-turn-h${n}'`));
    expect(missing, `turn-into 子菜单缺失的级别: ${missing.join(',')}`).toEqual([]);
  });

  it('快捷键:Mod-Alt-1..6 全部绑定', () => {
    const code = readCode('src/drivers/text-editing-driver/plugins/build-heading-keymap.ts');
    const missing = LEVELS.filter((n) => !code.includes(`'Mod-Alt-${n}'`));
    expect(missing, `keymap 缺失的级别: ${missing.join(',')}`).toEqual([]);
  });

  it('markdown 输入规则:# .. ###### 全部有规则', () => {
    const code = readCode('src/drivers/text-editing-driver/plugins/build-input-rules.ts');
    const missing = LEVELS.filter((n) => !code.includes(`headingRule(/^#{${n}}\\s$/`)
      && !code.includes(`headingRule(/^${'#'.repeat(n)}\\s$/`));
    expect(missing, `输入规则缺失的级别: ${missing.join(',')}`).toEqual([]);
  });

  it('graph 渲染态闸:h1..h6 的 slash 命令都显式登记(不靠"表里没有=放行"兜底)', () => {
    const code = readCode('src/views/graph-canvas-view/slash-render-gate.ts');
    const missing = LEVELS.filter((n) => !code.includes(`'text-editing.slash-turn-h${n}'`));
    expect(
      missing,
      `渲染态闸未登记的级别: ${missing.join(',')} —— 未登记会走 undefined 静默放行,\n` +
        `  即便当前恰好可渲也是靠巧合,违反 fail loud`,
    ).toEqual([]);
  });

  it('浮动工具条 Heading 下拉:H1..H6 全部可选', () => {
    const code = readCode('src/capabilities/text-editing/ui/toolbar/items.ts');
    // 下拉的 currentLabel 本就能显示任意 H{n};缺的是"能选中"的 option
    const missing = LEVELS.filter((n) => !new RegExp(`commandArg:\\s*${n}\\b`).test(code));
    expect(missing, `工具条下拉缺失的级别: ${missing.join(',')}`).toEqual([]);
  });

  it('TurnTarget 类型:两处定义都含 h1..h6 且彼此一致', () => {
    const a = readCode('src/capabilities/text-editing/types.ts');
    const b = readCode('src/capabilities/text-editing/commands/register-pm-commands.ts');
    for (const [name, code] of [['types.ts', a], ['register-pm-commands.ts', b]] as const) {
      const missing = LEVELS.filter((n) => !code.includes(`'h${n}'`));
      expect(missing, `${name} 的 TurnTarget 缺失级别: ${missing.join(',')}`).toEqual([]);
    }
  });
});
