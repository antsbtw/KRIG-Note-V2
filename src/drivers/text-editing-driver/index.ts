/**
 * text-editing-driver 主入口 — driver 单例 export
 *
 * 见 DESIGN.md v0.2.1 § 1.3。
 *
 * import 时触发 side-effect:模块级 capability handler 注册一次。
 */

import { setupClipboardIntegration } from './capability-integrations/clipboard-handlers';
import { Host } from './Host';
import { serializeDoc, deserializeDoc, buildSchema } from './schema-builder';
import type { TextEditingDriver, DriverSerialized } from './types';
import { textBlockSpec } from './blocks/text-block/spec';
import './pm-host.css';

// ── 模块加载时的副作用:注册模块级 capability 命令 handler(应用启动一次)──
setupClipboardIntegration();

// ── driver 单例 ──
export const textEditingDriver: TextEditingDriver = {
  id: 'text-editing-driver',
  version: '0.1.0',
  Host,
  serialize: (payload: unknown) => {
    // payload 是 PMDoc.toJSON() 的结果
    return {
      format: 'pm-doc-json',
      version: '0.1',
      payload,
    } satisfies DriverSerialized;
  },
  deserialize: (data: DriverSerialized) => {
    // 用空 schema 验证 format/version + 解 payload
    if (data.format !== 'pm-doc-json') return null;
    if (data.version !== '0.1') return null;
    return data.payload;
  },
};

/** 创建空 doc(供 view 创建笔记时用)
 *
 * L5-B3.11:首块带 isTitle:true(对齐 title-guard 约束 — doc 必须以 isTitle 开头)
 */
export function createEmptyDoc(): DriverSerialized {
  const schema = buildSchema([textBlockSpec]);
  const titleNode = schema.node('text-block', { isTitle: true, level: null }, []);
  const emptyDoc = schema.node('doc', null, [titleNode]);
  return serializeDoc(emptyDoc);
}

/** 从 DriverSerialized 中提取首段文本(标题派生用)*/
export function extractFirstParagraphText(data: DriverSerialized): string {
  if (data.format !== 'pm-doc-json') return '';
  const payload = data.payload as { content?: Array<{ content?: Array<{ text?: string }> }> };
  const firstBlockText = payload.content?.[0]?.content?.[0]?.text?.trim() ?? '';
  return firstBlockText;
}

// ── re-exports(NoteView 用)──
export type { DriverSerialized, TextEditingHostProps, TextEditingConfig } from './types';
export { deserializeDoc };
export { textEditingDriverApi, type MarkName, type ActiveBlockType } from './api';
export {
  setLinkClickHandler,
  type LinkClickHandler,
} from './plugins/build-link-click-plugin';
export {
  noteLinkCommandKey,
  setNoteLinkSearchHandler,
  getNoteLinkActiveView,
  type NoteLinkCommandState,
  type NoteLinkSearchHandler,
} from './plugins/build-note-link-command-plugin';
export { noteLinkSpec } from './blocks/note-link/spec';
export { fileBlockSpec } from './blocks/file-block/spec';
export { fileLinkSpec } from './blocks/file-link/spec';
export { externalRefSpec } from './blocks/external-ref/spec';
export { audioBlockSpec } from './blocks/audio-block/spec';
export { videoBlockSpec } from './blocks/video-block/spec';
