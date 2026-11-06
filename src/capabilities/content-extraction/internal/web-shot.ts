/**
 * 网页正文截图 → 笔记(renderer 侧,2026-11-05)
 *
 * main 推 WEB_SHOT_RESULT(已框选 + 截好 + 存进媒体库)。用户 11-05 定:
 *  - 右栏开着 note → 插到**光标所在位置**(note-view.insert-pm-nodes-right)
 *  - 否则新建一篇(标题 = 网页标题),web 钉左、note 开右(同「📥 提取到笔记」)
 * 都附一行「来源:网页标题」链接,日后能回到原文。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type { ImportOrchestratorApi } from '@capabilities/import-orchestrator';
import type { PmAtomDraft, AtomFrom } from '@semantic/types';
import { buildImageBlockDraft } from './draft-builders';

export type WebShotPayload =
  | { ok: true; mediaUrl: string; title: string; url: string; width: number; height: number }
  | { ok: false; error: string };

/** 纯函数:要插进笔记的 PM 节点(长图 + 来源链接) */
export function buildShotNodes(p: { mediaUrl: string; title: string; url: string }): Array<Record<string, unknown>> {
  const label = p.title.trim() || p.url;
  return [
    {
      type: 'image',
      attrs: { src: p.mediaUrl, alt: label, title: '', width: null, height: null, alignment: 'center', id: null, sourcePages: null, thoughtId: null, bookAnchor: null },
      content: [],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '来源:' },
        { type: 'text', text: label, marks: [{ type: 'link', attrs: { href: p.url, title: null } }] },
      ],
    },
  ];
}

export async function handleWebShot(payload: WebShotPayload | null): Promise<void> {
  if (!payload) return;
  if (!payload.ok) {
    window.alert(payload.error);
    return;
  }
  const nodes = buildShotNodes(payload);

  // ① 右栏开着 note → 插到光标处
  if (commandRegistry.execute('note-view.insert-pm-nodes-right', { nodes }) === true) {
    console.log(`[web-shot] 截图已插入右栏笔记光标处 ${payload.width}×${payload.height}`);
    return;
  }

  // ② 否则新建一篇
  const title = payload.title.trim() || payload.url;
  const from: AtomFrom = { extractionType: 'web-clip', extractedAt: Date.now() };
  let n = 0;
  const alloc = (): string => `tmp-${n++}`;
  const atoms: PmAtomDraft[] = [
    { tmpId: alloc(), payload: { domain: 'pm', payload: { type: 'paragraph', attrs: { isTitle: true }, content: [{ type: 'text', text: title }] } }, from },
    buildImageBlockDraft({ src: payload.mediaUrl, alt: title }, alloc, from),
    { tmpId: alloc(), payload: { domain: 'pm', payload: nodes[1] as unknown as PmAtomDraft['payload']['payload'] }, from },
  ];
  const result = await requireCapabilityApi<ImportOrchestratorApi>('import-orchestrator').importDraftsToNotes(
    [{ atoms, folderId: null, titleHint: title }],
    { logTag: 'web-shot' },
  );
  if (result.failures.length > 0 || result.noteIds.length === 0) {
    console.error('[web-shot] 新建笔记失败:', result.failures);
    window.alert('截图已保存,但新建笔记失败');
    return;
  }
  console.log(`[web-shot] 截图 → 新笔记 ${result.noteIds[0]}`);
  commandRegistry.execute('web-view.pin-left');
  commandRegistry.execute('note-view.set-active-in-right', result.noteIds[0]);
}
