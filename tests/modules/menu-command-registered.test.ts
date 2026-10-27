/**
 * ⭐⭐ 右键菜单里的每条命令都必须有人注册 —— 否则点了静默无反应(2026-10-26)
 *
 * ⚠️ 起因:9-29 删 X 业务时把「发到 X」「发布为 X 文章」的命令删了,菜单项还留在 note 的右键菜单里,
 *   点了只在 DevTools 打一行 `command not registered`,界面上什么都没有(「看着能用实际没有」那一族)。
 *   X 的装卸守卫(x-module-detachable)只看 import 路径,菜单里的命令字符串它看不见 —— 这条补那个盲区。
 *
 * 判据:所有 `*context-menu*` 文件里 `command: '<id>'` 的 id,都要在 src 里某处
 *   `registerWsCommand('<id>'` / `commandRegistry.register('<id>'` 出现过。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const full = join(dir, e.name);
    if (e.isDirectory()) return listSources(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

const sources = listSources(join(ROOT, 'src')).map((p) => ({ path: relative(ROOT, p), code: readFileSync(p, 'utf-8') }));

/** 菜单项引用的命令 → 在哪个文件 */
function menuCommands(files: typeof sources): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    if (!f.path.includes('context-menu')) continue;
    for (const m of f.code.matchAll(/command:\s*'([^']+)'/g)) out.set(m[1], f.path);
  }
  return out;
}

function registeredCommands(files: typeof sources): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    for (const m of f.code.matchAll(/(?:registerWsCommand|commandRegistry\.register)\(\s*'([^']+)'/g)) out.add(m[1]);
  }
  return out;
}

const unregistered = (files: typeof sources): string[] => {
  const reg = registeredCommands(files);
  return [...menuCommands(files)].filter(([c]) => !reg.has(c)).map(([c, p]) => `${c}  ←  ${p}`);
};

describe('右键菜单的命令都有人注册', () => {
  it('前提:扫到了足够多的菜单命令(扫描面没塌)', () => {
    expect(menuCommands(sources).size).toBeGreaterThan(20);
  });

  it('自检:注入一条没人注册的菜单命令,守卫要变红', () => {
    const fake = [...sources, { path: 'src/views/fake/context-menu-content.ts', code: `{ command: 'fake-view.nobody-registers' }` }];
    expect(unregistered(fake)).toContain('fake-view.nobody-registers  ←  src/views/fake/context-menu-content.ts');
  });

  it('没有指向空命令的菜单项', () => {
    expect(unregistered(sources), '这些菜单项点了会静默无反应 —— 注册命令,或连菜单项一起删').toEqual([]);
  });
});
