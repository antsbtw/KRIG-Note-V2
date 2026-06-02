/**
 * _spike-draft-builders — Stage 1 临时 spike(验证后删除)
 *
 * 目的:在写任何提取逻辑前,验证 image/video/audio block 的 PmAtomDraft 形态
 * 能被 createNotesBatch 成功落库 + assemble-pm-doc 拼回 + NoteView 正常渲染。
 *
 * 触发:devtools console 跑 `window.__krigSpikeClip()`(由 web-commands 注册命令转发,
 * 或直接调本函数)。验证通过后**整文件删除**,draft-builders.ts 保留。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type {
  NoteCapabilityApi,
  CreateNoteBatchItem,
} from '@capabilities/note/types';
import type { PmAtomDraft, AtomFrom } from '@semantic/types';
import {
  buildImageBlockDraft,
  buildVideoBlockDrafts,
  buildAudioBlockDrafts,
} from './draft-builders';

export async function runDraftBuildersSpike(): Promise<void> {
  let counter = 0;
  const alloc = (): string => `tmp-${counter++}`;
  const from: AtomFrom = { extractionType: 'web-clip-spike', extractedAt: Date.now() };

  const atoms: PmAtomDraft[] = [];

  // 1. 标题段落(顶层 paragraph,isTitle)
  atoms.push({
    tmpId: alloc(),
    payload: {
      domain: 'pm',
      payload: {
        type: 'paragraph',
        attrs: { isTitle: true },
        content: [{ type: 'text', text: 'Spike — image/video/audio block 形态验证' }],
      },
    },
    from,
  });

  // 2. 正文段落
  atoms.push({
    tmpId: alloc(),
    payload: {
      domain: 'pm',
      payload: {
        type: 'paragraph',
        attrs: {},
        content: [{ type: 'text', text: '下面应渲染出图片、视频、音频三个 block。' }],
      },
    },
    from,
  });

  // 3. image block(用一张稳定的远程图,验证 src 渲染)
  atoms.push(
    buildImageBlockDraft(
      {
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/320px-Example.jpg',
        alt: 'Example image',
      },
      alloc,
      from,
    ),
  );

  // 4. video block(YouTube embed,远程;附一段假字幕验证 transcriptText 落库)
  atoms.push(
    ...buildVideoBlockDrafts(
      {
        src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        embedType: 'youtube',
        title: 'Spike Video',
        transcriptText: JSON.stringify([{ time: 0, text: '字幕第一行' }, { time: 5, text: '字幕第二行' }]),
      },
      alloc,
      from,
    ),
  );

  // 5. audio block(远程 mp3)
  atoms.push(
    ...buildAudioBlockDrafts(
      {
        src: 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg',
        title: 'Spike Audio',
      },
      alloc,
      from,
    ),
  );

  const item: CreateNoteBatchItem = { atoms, folderId: null, titleHint: 'Spike Clip' };
  const noteCap = requireCapabilityApi<NoteCapabilityApi>('note');
  const result = await noteCap.createNotesBatch({ items: [item] });

  console.log('[spike] createNotesBatch result:', result);
  if (result.failures.length > 0) {
    console.error('[spike] FAILED — createNotesBatch failures:', result.failures);
    return;
  }
  const noteId = result.notes[0]?.id;
  if (!noteId) {
    console.error('[spike] no note id returned');
    return;
  }
  console.log('[spike] created note', noteId, '— opening…');
  commandRegistry.execute('note-view.set-active', noteId);
}

// devtools 入口(spike 期临时挂全局)
(window as unknown as { __krigSpikeClip?: () => Promise<void> }).__krigSpikeClip =
  runDraftBuildersSpike;
