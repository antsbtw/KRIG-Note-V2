/**
 * note-card 公共组件(2026-11-06)
 * 设计稿:docs/10-business-design/note/note-card-公共组件设计.md
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { emptyDoc, fromPlainText, toPlainText, contentOf } from '@capabilities/note-card/doc';
import { menuItems } from '@capabilities/note-card/menu-items';
import type { NoteDoc } from '@capabilities/note-card/types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { filterSlashItemsToRenderable } from '../../src/lib/atom-serializers/svg/slash-render-gate';
import * as slashMenu from '../../src/capabilities/text-editing/ui/slash-menu/items';
import * as floatingToolbar from '../../src/capabilities/text-editing/ui/floating-toolbar/items';
import * as handleMenu from '../../src/capabilities/text-editing/ui/handle-menu/items';

const DOC: NoteDoc = {
  format: 'pm-doc-json',
  version: '0.1',
  payload: {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { isTitle: false }, content: [{ type: 'text', text: 'Andy 已知' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1:30 出发,向北' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '路程 ' }, { type: 'mathInline', attrs: { latex: 'd=8t' } }] }] },
        ],
      },
      { type: 'mathBlock', content: [{ type: 'text', text: '8t=12(t-1)' }] },
    ],
  },
};

describe('① 内容', () => {
  it('纯文字 → doc:一行一段,带 version,首段不是标题', () => {
    const d = fromPlainText('甲\n乙');
    expect(d.version).toBe('0.1'); // 缺 version 编辑器静默空白(记忆:嵌 note 编辑器三坑)
    expect(d.payload.content).toHaveLength(2);
    expect(d.payload.content[0].attrs).toEqual({ isTitle: false });
    expect(toPlainText(d)).toBe('甲\n乙');
  });

  it('doc → 纯文字:列表逐行、行内公式取 LaTeX、块公式取源码', () => {
    expect(toPlainText(DOC)).toBe('Andy 已知\n1:30 出发,向北\n路程 d=8t\n8t=12(t-1)');
  });

  it('只有一个空段落 = 没有内容', () => {
    expect(contentOf(emptyDoc())).toBeNull();
    expect(contentOf(undefined)).toBeNull();
    expect(contentOf(DOC)).toHaveLength(3);
  });
});

describe('③ 菜单项 = 画板那套', () => {
  beforeAll(() => {
    // menuItems 运行时经 registry 拿 text-editing(tests/setup.ts 里是全局桩);这里用真的工厂函数补上
    vi.mocked(requireCapabilityApi).mockImplementation(((id: string) => {
      if (id === 'text-editing') return { ui: { slashMenu, floatingToolbar, handleMenu } };
      throw new Error(`[test] capability '${id}' not stubbed`);
    }) as never);
  });

  it('斜杠与浮动工具条的 id 集合,和画板注册处(views/graph-canvas-view/index.ts)完全一致', () => {
    const V = 'v';
    const items = menuItems(V);
    // 照抄画板 registerTextEditingMenusForCanvas 的拼装
    const graphSlash = filterSlashItemsToRenderable([
      ...slashMenu.createTurnIntoItems(V),
      slashMenu.createMathBlockItem(V),
    ]);
    const graphFloating = [
      ...floatingToolbar.createMarkButtons(V),
      floatingToolbar.createMathButton(V),
      floatingToolbar.createLinkButton(V),
      floatingToolbar.createColorButton(V),
    ];
    expect(items.slash.map((i) => i.id)).toEqual(graphSlash.map((i) => i.id));
    expect(items.floatingToolbar.map((i) => i.id)).toEqual(graphFloating.map((i) => i.id));
  });

  it('斜杠里没有画不出的块(折叠列表被画板屏蔽);手柄菜单的「转换为…」同样过闸', () => {
    const items = menuItems('v');
    expect(items.slash.some((i) => i.command === 'text-editing.slash-turn-toggle')).toBe(false);
    expect(items.handle.some((i) => i.command === 'text-editing.handle-turn-toggle')).toBe(false);
    expect(items.handle.some((i) => i.command === 'text-editing.handle-turn-bullet')).toBe(true);
  });
});

describe('④ 框:拖边改宽(用户选 A:改宽度、文字重排、高度随内容)', () => {
  it('拖右边:左边不动', async () => {
    const { resizeFromEdge } = await import('@capabilities/note-card/frame-math');
    expect(resizeFromEdge(100, 200, 50, 'right')).toEqual({ left: 100, width: 250 });
    expect(resizeFromEdge(100, 200, -50, 'right')).toEqual({ left: 100, width: 150 });
  });
  it('拖左边:右边不动(左边跟着挪)', async () => {
    const { resizeFromEdge } = await import('@capabilities/note-card/frame-math');
    expect(resizeFromEdge(100, 200, -50, 'left')).toEqual({ left: 50, width: 250 });
    expect(resizeFromEdge(100, 200, 50, 'left')).toEqual({ left: 150, width: 150 });
  });
  it('有最小 / 最大宽度,碰到后不再动(左边也不会被推走)', async () => {
    const { resizeFromEdge } = await import('@capabilities/note-card/frame-math');
    expect(resizeFromEdge(100, 200, -500, 'right')).toEqual({ left: 100, width: 80 });
    expect(resizeFromEdge(100, 200, 500, 'left')).toEqual({ left: 220, width: 80 });
    expect(resizeFromEdge(100, 200, 5000, 'right')).toEqual({ left: 100, width: 800 });
  });
});
