/**
 * NoteView SlashMenu 注册(C3:工厂函数化,内容来源 text-editing capability + view 业务增量)
 *
 * 本文件职责(C3 后):
 * - 12 PM 通用项(11 turn-into + math-block)走 text-editing 工厂
 * - 7 NoteView 业务插入项(image/table/audio/video/tweet/file-block/external-ref)
 *   留在本文件:依赖 mediaStore / tweetFetcher / ytdlp 等业务 capability,
 *   命令 id 仍是 'note-view.slash-insert-*'(C0 §三 §🟢 决议 D-3 — 留 view)
 */

import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';
import type { SlashItem } from '@slot/interaction-registries/slash-registry/slash-types';
import {
  createTurnIntoItems,
  createMathBlockItem,
} from '@capabilities/text-editing/ui/slash-menu/items';

const VIEW = 'note-view';

/** NoteView 专属业务插入项(7 项 — 依赖业务 capability,不上提) */
function createNoteBusinessInsertItems(): SlashItem[] {
  return [
    // L5-B3.5:image(insert,不是 turn into)
    {
      id: `${VIEW}.slash.image`,
      label: 'Image',
      command: 'note-view.slash-insert-image',
      keywords: ['image', 'picture', 'photo', 'img', '图片'],
      view: VIEW,
      order: 130,
    },
    // L5-B3.16:audio / video(媒体三兄弟,跟 image 同模式)
    {
      id: `${VIEW}.slash.audio`,
      label: 'Audio',
      command: 'note-view.slash-insert-audio',
      keywords: ['audio', 'music', 'sound', 'mp3', 'podcast', '音频'],
      view: VIEW,
      order: 145,
    },
    {
      id: `${VIEW}.slash.video`,
      label: 'Video',
      command: 'note-view.slash-insert-video',
      keywords: ['video', 'movie', 'mp4', 'youtube', '视频'],
      view: VIEW,
      order: 150,
    },
    // L5-B3.18:tweet-block(X / Twitter 推文嵌入)
    {
      id: `${VIEW}.slash.tweet`,
      label: 'X Post',
      command: 'note-view.slash-insert-tweet',
      keywords: ['x', 'tweet', 'twitter', 'post', 'social', '推文'],
      view: VIEW,
      order: 155,
    },
    // L5-B3.7:Table 3x3(第一行 header)
    {
      id: `${VIEW}.slash.table`,
      label: 'Table',
      command: 'note-view.slash-insert-table',
      keywords: ['table', 'grid', '表格'],
      view: VIEW,
      order: 160,
    },
    // L5-B3.14:fileBlock / externalRef(fileLink 不在 slash — 仅 paste/drag 路径产生)
    {
      id: `${VIEW}.slash.file-block`,
      label: 'File attachment',
      command: 'note-view.slash-insert-file-block',
      keywords: ['file', 'attachment', 'pdf', 'attach', '附件'],
      view: VIEW,
      order: 170,
    },
    {
      id: `${VIEW}.slash.external-ref`,
      label: 'External reference',
      command: 'note-view.slash-insert-external-ref',
      keywords: ['ref', 'link', 'file', 'url', 'reference', '引用'],
      view: VIEW,
      order: 180,
    },
  ];
}

export function registerSlashMenu(): void {
  slashRegistry.register([
    ...createTurnIntoItems(VIEW),
    createMathBlockItem(VIEW),
    ...createNoteBusinessInsertItems(),
  ]);
}
