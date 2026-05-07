/**
 * NoteView SlashMenu 注册 — L5-B3.2 扩展到 10 项
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 5.2(L5-B3.1 起 + B3.2 扩展)。
 */

import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';

const VIEW = 'note-view';

export function registerSlashMenu(): void {
  slashRegistry.register([
    { id: 'note-view.slash.p', label: 'Paragraph', command: 'note-view.slash-turn-paragraph',
      keywords: ['p', 'paragraph', 'text', 'plain'], view: VIEW, order: 10 },
    { id: 'note-view.slash.h1', label: 'Heading 1', command: 'note-view.slash-turn-h1',
      keywords: ['h1', 'heading', 'title', 'header'], view: VIEW, order: 20 },
    { id: 'note-view.slash.h2', label: 'Heading 2', command: 'note-view.slash-turn-h2',
      keywords: ['h2', 'heading', 'header'], view: VIEW, order: 30 },
    { id: 'note-view.slash.h3', label: 'Heading 3', command: 'note-view.slash-turn-h3',
      keywords: ['h3', 'heading', 'header'], view: VIEW, order: 40 },
    { id: 'note-view.slash.bullet', label: 'Bullet List', command: 'note-view.slash-turn-bullet',
      keywords: ['bullet', 'ul', 'list', 'unordered'], view: VIEW, order: 50 },
    { id: 'note-view.slash.ordered', label: 'Numbered List', command: 'note-view.slash-turn-ordered',
      keywords: ['ordered', 'ol', 'list', 'number'], view: VIEW, order: 60 },
    { id: 'note-view.slash.task', label: 'Task List', command: 'note-view.slash-turn-task',
      keywords: ['task', 'todo', 'checkbox', 'check'], view: VIEW, order: 70 },
    { id: 'note-view.slash.quote', label: 'Quote', command: 'note-view.slash-turn-quote',
      keywords: ['quote', 'blockquote'], view: VIEW, order: 80 },
    { id: 'note-view.slash.code', label: 'Code Block', command: 'note-view.slash-turn-code',
      keywords: ['code', 'codeblock', 'pre'], view: VIEW, order: 90 },
    { id: 'note-view.slash.divider', label: 'Divider', command: 'note-view.slash-turn-divider',
      keywords: ['divider', 'hr', 'horizontal', 'rule', 'separator'], view: VIEW, order: 100 },
    { id: 'note-view.slash.callout', label: 'Callout', command: 'note-view.slash-turn-callout',
      keywords: ['callout', 'tip', 'warning', 'note', 'admonition'], view: VIEW, order: 110 },
    { id: 'note-view.slash.toggle', label: 'Toggle List', command: 'note-view.slash-turn-toggle',
      keywords: ['toggle', 'fold', 'collapse', 'expand', 'detail'], view: VIEW, order: 120 },
    // L5-B3.5:image(insert,不是 turn into)
    { id: 'note-view.slash.image', label: 'Image', command: 'note-view.slash-insert-image',
      keywords: ['image', 'picture', 'photo', 'img', '图片'], view: VIEW, order: 130 },
    // L5-B3.6:Math Block(行内公式不在这里,在 floating toolbar)
    { id: 'note-view.slash.math-block', label: 'Math Block', command: 'note-view.slash-insert-math-block',
      keywords: ['math', 'latex', 'equation', 'formula', '公式'], view: VIEW, order: 140 },
  ]);
}
