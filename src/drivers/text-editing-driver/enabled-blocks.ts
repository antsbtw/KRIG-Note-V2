/**
 * ENABLED_BLOCKS — driver 全启用 block spec 列表(单一来源)
 *
 * 原内联在 Host.tsx;L5-G5 抽出共享,让"headless 整 doc 改样式"(node-style-command.ts)
 * 与 Host 用**同一套 schema**构建,避免 schema 漂移导致 deserialize 失败。
 *
 * 任何处需要"和 Host 等价的 PM schema",都应 buildSchema(ENABLED_BLOCKS)。
 */

import { paragraphSpec } from './blocks/paragraph/spec';
import { headingSpec } from './blocks/heading/spec';
import { listItemSpec } from './blocks/list-item/spec';
import { bulletListSpec } from './blocks/bullet-list/spec';
import { orderedListSpec } from './blocks/ordered-list/spec';
import { taskListSpec, taskItemSpec } from './blocks/task-list/spec';
import { blockquoteSpec } from './blocks/blockquote/spec';
import { codeBlockSpec } from './blocks/code-block/spec';
import { horizontalRuleSpec } from './blocks/horizontal-rule/spec';
import { hardBreakSpec } from './blocks/hard-break/spec';
import { calloutSpec } from './blocks/callout/spec';
import { toggleListSpec } from './blocks/toggle-list/spec';
import { unknownSpec } from './blocks/unknown/spec';
import { imageSpec } from './blocks/image/spec';
import { mathBlockSpec } from './blocks/math-block/spec';
import { mathInlineSpec } from './blocks/math-inline/spec';
import { noteLinkSpec } from './blocks/note-link/spec';
import { fileBlockSpec } from './blocks/file-block/spec';
import { fileLinkSpec } from './blocks/file-link/spec';
import { externalRefSpec } from './blocks/external-ref/spec';
import { audioBlockSpec } from './blocks/audio-block/spec';
import { videoBlockSpec } from './blocks/video-block/spec';
import { tweetBlockSpec } from './blocks/tweet-block/spec';
import { htmlBlockSpec } from './blocks/html-block/spec';
import { mathVisualSpec } from './blocks/math-visual/spec';
import {
  tableSpec,
  tableRowSpec,
  tableCellSpec,
  tableHeaderSpec,
} from './blocks/table';
import { columnListSpec, columnSpec } from './blocks/column-list';
import type { BlockSpec } from './types';

export const ENABLED_BLOCKS: BlockSpec[] = [
  paragraphSpec,
  headingSpec,
  listItemSpec,
  bulletListSpec,
  orderedListSpec,
  taskItemSpec,
  taskListSpec,
  blockquoteSpec,
  codeBlockSpec,
  horizontalRuleSpec,
  hardBreakSpec,
  calloutSpec,
  toggleListSpec,
  unknownSpec,
  imageSpec,
  mathBlockSpec,
  mathInlineSpec,
  tableSpec,
  tableRowSpec,
  tableCellSpec,
  tableHeaderSpec,
  columnListSpec,
  columnSpec,
  noteLinkSpec,
  fileBlockSpec,
  fileLinkSpec,
  externalRefSpec,
  audioBlockSpec,
  videoBlockSpec,
  tweetBlockSpec,
  htmlBlockSpec,
  mathVisualSpec,
];
