/**
 * NavSide 内容注册
 *
 * 见 DESIGN.md v0.2.2 § 5.1。
 */

import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { NoteList } from './note-list';

export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'note-view',
    title: '笔记目录',
    actions: [
      { id: 'create', label: '+ 笔记', command: 'note-view.create-note' },
    ],
    searchPlaceholder: '搜索笔记...',
    onSearch: () => {
      // L5-A:不实施过滤(留 L5-B)
    },
    contentRenderer: () => <NoteList />,
  });
}
