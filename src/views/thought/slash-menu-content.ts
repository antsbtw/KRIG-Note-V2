/**
 * ThoughtView SlashMenu 注册(对齐 V1 ThoughtEditor + V2 charter §1.4 view 平等)
 *
 * V1 ThoughtEditor 字面只禁 5 项(noteTitle / titleGuardPlugin / thoughtPlugin /
 * AskAIPanel / TOC),slash menu 全部保留 — 即用户在 thought 内可 / 触发 turn-into
 * + 插 math/mermaid/html/mathVisual + image/audio/video/tweet/file/external-ref。
 *
 * V2 实施:
 * - PM 通用 4 项(turn-into / math-block / mermaid / html / mathVisual)→ 工厂
 * - 业务插入 7 项(image / audio / video / tweet / file-block / external-ref / table)
 *   → 复用 note-view.slash-insert-* 命令(thought 已 install media-storage 等
 *   全套 capability,命令实施层与 view 解耦)
 */

import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';
import type { SlashItem } from '@slot/interaction-registries/slash-registry/slash-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

const VIEW = 'thought-view';

/** 业务插入项(复用 note-view.slash-insert-* 命令实施) */
function createBusinessInsertItems(): SlashItem[] {
  return [
    {
      id: `${VIEW}.slash.image`,
      label: 'Image',
      command: 'note-view.slash-insert-image',
      keywords: ['image', 'picture', 'photo', 'img', '图片'],
      view: VIEW,
      group: 'media',
      icon: 'image',
      order: 130,
    },
    {
      id: `${VIEW}.slash.audio`,
      label: 'Audio',
      command: 'note-view.slash-insert-audio',
      keywords: ['audio', 'music', 'sound', 'mp3', '音频'],
      view: VIEW,
      group: 'media',
      icon: 'audio-lines',
      order: 145,
    },
    {
      id: `${VIEW}.slash.video`,
      label: 'Video',
      command: 'note-view.slash-insert-video',
      keywords: ['video', 'movie', 'mp4', '视频'],
      view: VIEW,
      group: 'media',
      icon: 'video',
      order: 150,
    },
    {
      id: `${VIEW}.slash.tweet`,
      label: 'Tweet',
      command: 'note-view.slash-insert-tweet',
      keywords: ['tweet', 'twitter', 'x', '推文'],
      view: VIEW,
      group: 'media',
      icon: 'bird',
      order: 155,
    },
    {
      id: `${VIEW}.slash.file-block`,
      label: 'File',
      command: 'note-view.slash-insert-file-block',
      keywords: ['file', 'attach', '文件', '附件'],
      view: VIEW,
      group: 'media',
      icon: 'paperclip',
      order: 160,
    },
    {
      id: `${VIEW}.slash.external-ref`,
      label: 'External Ref',
      command: 'note-view.slash-insert-external-ref',
      keywords: ['ref', 'external', 'link', '外链', '引用'],
      view: VIEW,
      group: 'media',
      icon: 'external-link',
      order: 170,
    },
    {
      id: `${VIEW}.slash.table`,
      label: 'Table',
      command: 'note-view.slash-insert-table',
      keywords: ['table', '表格'],
      view: VIEW,
      group: 'advanced',
      icon: 'table',
      order: 180,
    },
  ];
}

export function registerSlashMenu(): void {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui.slashMenu;
  slashRegistry.register([
    ...ui.createTurnIntoItems(VIEW),
    ui.createMathBlockItem(VIEW),
    ui.createMermaidBlockItem(VIEW),
    ui.createHtmlBlockItem(VIEW),
    ui.createMathVisualBlockItem(VIEW),
    ...createBusinessInsertItems(),
  ]);
}
