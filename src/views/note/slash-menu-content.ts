/**
 * NoteView SlashMenu 注册 — L5-B3.2 扩展到 10 项
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 5.2(L5-B3.1 起 + B3.2 扩展)。
 */

import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';

const VIEW = 'note-view';

export function registerSlashMenu(): void {
  slashRegistry.register([
    // L5-G4.5:turn-into 类 scope='global' — 所有 PM-using view 共享通用 block 切换能力
    // (canvas-text-node 嵌入的 popup 编辑器也能用 / 触发 H1/H2/list/...)
    { id: 'note-view.slash.p', label: 'Paragraph', command: 'note-view.slash-turn-paragraph',
      keywords: ['p', 'paragraph', 'text', 'plain'], view: VIEW, scope: 'global', order: 10 },
    { id: 'note-view.slash.h1', label: 'Heading 1', command: 'note-view.slash-turn-h1',
      keywords: ['h1', 'heading', 'title', 'header'], view: VIEW, scope: 'global', order: 20 },
    { id: 'note-view.slash.h2', label: 'Heading 2', command: 'note-view.slash-turn-h2',
      keywords: ['h2', 'heading', 'header'], view: VIEW, scope: 'global', order: 30 },
    { id: 'note-view.slash.h3', label: 'Heading 3', command: 'note-view.slash-turn-h3',
      keywords: ['h3', 'heading', 'header'], view: VIEW, scope: 'global', order: 40 },
    { id: 'note-view.slash.bullet', label: 'Bullet List', command: 'note-view.slash-turn-bullet',
      keywords: ['bullet', 'ul', 'list', 'unordered'], view: VIEW, scope: 'global', order: 50 },
    { id: 'note-view.slash.ordered', label: 'Numbered List', command: 'note-view.slash-turn-ordered',
      keywords: ['ordered', 'ol', 'list', 'number'], view: VIEW, scope: 'global', order: 60 },
    { id: 'note-view.slash.task', label: 'Task List', command: 'note-view.slash-turn-task',
      keywords: ['task', 'todo', 'checkbox', 'check'], view: VIEW, scope: 'global', order: 70 },
    { id: 'note-view.slash.quote', label: 'Quote', command: 'note-view.slash-turn-quote',
      keywords: ['quote', 'blockquote'], view: VIEW, scope: 'global', order: 80 },
    { id: 'note-view.slash.code', label: 'Code Block', command: 'note-view.slash-turn-code',
      keywords: ['code', 'codeblock', 'pre'], view: VIEW, scope: 'global', order: 90 },
    { id: 'note-view.slash.divider', label: 'Divider', command: 'note-view.slash-turn-divider',
      keywords: ['divider', 'hr', 'horizontal', 'rule', 'separator'], view: VIEW, scope: 'global', order: 100 },
    { id: 'note-view.slash.callout', label: 'Callout', command: 'note-view.slash-turn-callout',
      keywords: ['callout', 'tip', 'warning', 'note', 'admonition'], view: VIEW, scope: 'global', order: 110 },
    { id: 'note-view.slash.toggle', label: 'Toggle List', command: 'note-view.slash-turn-toggle',
      keywords: ['toggle', 'fold', 'collapse', 'expand', 'detail'], view: VIEW, scope: 'global', order: 120 },
    // L5-B3.5:image(insert,不是 turn into)
    { id: 'note-view.slash.image', label: 'Image', command: 'note-view.slash-insert-image',
      keywords: ['image', 'picture', 'photo', 'img', '图片'], view: VIEW, order: 130 },
    // L5-B3.6:Math Block(行内公式不在这里,在 floating toolbar)
    { id: 'note-view.slash.math-block', label: 'Math Block', command: 'note-view.slash-insert-math-block',
      keywords: ['math', 'latex', 'equation', 'formula', '公式'], view: VIEW, order: 140 },
    // L5-B3.7:Table 3x3(第一行 header)
    { id: 'note-view.slash.table', label: 'Table', command: 'note-view.slash-insert-table',
      keywords: ['table', 'grid', '表格'], view: VIEW, order: 160 },
    // L5-B3.14:fileBlock / externalRef(fileLink 不在 slash — 仅 paste/drag 路径产生)
    { id: 'note-view.slash.file-block', label: 'File attachment',
      command: 'note-view.slash-insert-file-block',
      keywords: ['file', 'attachment', 'pdf', 'attach', '附件'], view: VIEW, order: 170 },
    { id: 'note-view.slash.external-ref', label: 'External reference',
      command: 'note-view.slash-insert-external-ref',
      keywords: ['ref', 'link', 'file', 'url', 'reference', '引用'], view: VIEW, order: 180 },
    // L5-B3.16:audio / video(媒体三兄弟收齐,跟 image 同模式)
    { id: 'note-view.slash.audio', label: 'Audio',
      command: 'note-view.slash-insert-audio',
      keywords: ['audio', 'music', 'sound', 'mp3', 'podcast', '音频'], view: VIEW, order: 145 },
    { id: 'note-view.slash.video', label: 'Video',
      command: 'note-view.slash-insert-video',
      keywords: ['video', 'movie', 'mp4', 'youtube', '视频'], view: VIEW, order: 150 },
    // L5-B3.18:tweet-block(X / Twitter 推文嵌入,iframe + Data 离线缓存 + Fetch + Download)
    { id: 'note-view.slash.tweet', label: 'X Post',
      command: 'note-view.slash-insert-tweet',
      keywords: ['x', 'tweet', 'twitter', 'post', 'social', '推文'], view: VIEW, order: 155 },
  ]);
}
