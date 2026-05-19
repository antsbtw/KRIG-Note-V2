/**
 * ai-sync block builder — turn payload → PM JSON nodes 数组
 *
 * 把 main 端 broadcast 的 AISyncTurn 转成可直接 insert 到 PM doc 的节点数组:
 *   1. ❓ Callout 包用户提问(仅当 userMessage 非空)
 *   2. 🔀 Toggle 包 AI 回答(label='回答 (服务名)' + ResultParser 解析后的子节点)
 *   3. horizontalRule 分隔线
 *
 * 解析 markdown 走 @shared/ai-markdown-parser 的 ResultParser + extractedBlocksToPmDoc
 * (与"提取整页对话"路径一致,保证不失真原则;feedback_inject_placeholder_replace_global
 * 已记录的 markdown 解析不允许 split('\n\n'))。
 *
 * 输出 nodes 直接 nodeType.create(...) 之前以 JSON 形态保留,view 层 dispatch 时用
 * schema.nodeFromJSON 还原 — 这样保留对 schema 的"晚绑定"(不在本模块 import driver
 * 内部 schema-builder)。
 */

import { ResultParser, extractedBlocksToPmDoc } from '@shared/ai-markdown-parser';
import type { AISyncTurn, AIServiceId } from '@capabilities/ai-extraction/types';
import { getAIServiceProfile } from '@shared/types/ai-service-types';

/** PM JSON 节点字面量(driver 层的 PMDocNode 同形态,本地复制避免跨边界 import) */
export interface PmNodeJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNodeJson[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/**
 * 把 turn payload 转成"待插入 PM nodes 数组"。
 *
 * 调用方拿到后通过 driver insertNodesAtEnd(instanceId, nodes) 落到 PM doc 末尾。
 */
export function buildAITurnPmNodes(
  serviceId: AIServiceId,
  turn: AISyncTurn,
): PmNodeJson[] {
  const nodes: PmNodeJson[] = [];

  // 1. ❓ Callout 用户提问
  const userText = turn.userMessage.trim();
  if (userText) {
    nodes.push({
      type: 'callout',
      attrs: { emoji: '❓' },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: userText }],
        },
      ],
    });
  }

  // 2. 🔀 Toggle AI 回答
  const aiText = turn.markdown.trim();
  if (aiText) {
    const parser = new ResultParser();
    const blocks = parser.parse(aiText);
    const pmDoc = extractedBlocksToPmDoc(blocks);
    const profile = getAIServiceProfile(serviceId);
    const labelText = `回答 (${profile.name})`;

    // Toggle 第一个 child 是"折叠标题"(本 driver 设计里就是首个 block),
    // 后续 children 是被折叠的真正内容。
    const labelNode: PmNodeJson = {
      type: 'paragraph',
      content: [{ type: 'text', text: labelText }],
    };

    // extractedBlocksToPmDoc 返 {type:'doc', content: PmNode[]};拿 content 当 toggle 内容
    // 兜底:若 content 为空(只有兜底 paragraph),仍保留以满足 content:'block+'
    const aiContent = (pmDoc.content as PmNodeJson[]) ?? [
      { type: 'paragraph' },
    ];

    nodes.push({
      type: 'toggleList',
      attrs: { open: true },
      content: [labelNode, ...aiContent],
    });
  }

  // 3. 分隔线(用户视觉上"一个 turn 一段")
  nodes.push({ type: 'horizontalRule' });

  return nodes;
}
