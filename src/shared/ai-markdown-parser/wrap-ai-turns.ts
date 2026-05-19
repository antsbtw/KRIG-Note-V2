/**
 * 把"提取整页对话"产物的 AI 回答每轮包进 toggleList。
 *
 * 输入:aiMarkdownToNoteDoc(整页 markdown).payload.content 数组(扁平 PM JSON 节点)
 * 整页 markdown 结构(extractClaudeFullConversation 等出来的格式):
 *
 *   # 标题(opt heading-1)
 *   > 模型: ...      (blockquote 元数据)
 *   > 共 N 条消息
 *
 *   ## 👤 用户
 *   ... user 文本 ...
 *
 *   ---             ← horizontalRule 分隔
 *
 *   ## 🤖 AI (xxx)
 *   ... AI 文本(可能含 artifact image / fence)...
 *
 *   ---
 *
 *   ## 👤 用户       (下一轮)
 *   ...
 *
 * 输出:每个 "🤖 AI (xxx)" heading + 后续 body block(直到下一个 h2 或文末)被打包进
 *      一个 toggleList,首 child 是 paragraph 标签 "回答 (xxx)";heading 本身不进 toggle
 *      (被替换为 toggle label,避免重复)。
 *
 * 设计考量:
 * - 用户提问 ("👤 用户" heading + body)不动 — 用户希望看见所有问题,只有 AI 回答可折叠
 * - "---" horizontalRule 保留(turn 之间视觉分隔)
 * - 顶部 # 标题 / 模型 blockquote 不动 — 它们是 conversation meta
 * - 检测 heading 文本以 "🤖" emoji 起始(allow leading 空格)— 来自我们自己 main 端
 *   的固定格式,只要 buildFullMarkdown 不改就稳
 */

interface PmJsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmJsonNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/**
 * 提取 heading PM 节点的纯文本(走第一层 text node 的 concat)。
 */
function headingText(node: PmJsonNode): string {
  if (node.type !== 'heading') return '';
  const parts: string[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'text' && typeof child.text === 'string') {
      parts.push(child.text);
    }
  }
  return parts.join('');
}

function isAITurnHeading(node: PmJsonNode): boolean {
  if (node.type !== 'heading') return false;
  if ((node.attrs?.level as number | undefined) !== 2) return false;
  return /^\s*🤖/.test(headingText(node));
}

function isUserTurnHeading(node: PmJsonNode): boolean {
  if (node.type !== 'heading') return false;
  if ((node.attrs?.level as number | undefined) !== 2) return false;
  return /^\s*👤/.test(headingText(node));
}

/**
 * 把扁平的 PM 节点数组按 "🤖 AI" turn 打包。
 *
 * @param nodes 整页 markdown 转出来的扁平节点数组(NoteDocEnvelope.payload.content)
 * @param serviceName "Claude" / "ChatGPT" / "Gemini" — 走 toggle label 显示
 * @returns 新节点数组,可直接喂 driver insertNodesAtCursorOrEnd
 */
export function wrapAITurnsInToggle(
  nodes: unknown[],
  serviceName: string,
): unknown[] {
  const input = nodes as PmJsonNode[];
  const output: PmJsonNode[] = [];
  let i = 0;
  while (i < input.length) {
    const node = input[i];
    if (isAITurnHeading(node)) {
      // 收集 AI heading 之后、直到下一个 h2 之前的所有节点(也含 horizontalRule)
      const bodyNodes: PmJsonNode[] = [];
      let j = i + 1;
      while (j < input.length) {
        const next = input[j];
        if (isAITurnHeading(next) || isUserTurnHeading(next)) break;
        bodyNodes.push(next);
        j++;
      }
      // 构造 toggleList:label paragraph + body
      const label: PmJsonNode = {
        type: 'paragraph',
        content: [{ type: 'text', text: `回答 (${serviceName})` }],
      };
      output.push({
        type: 'toggleList',
        // open=true:用户看见 ▼ 默认展开(对齐 V1 截图;后续要折叠用户手动点 ▼→▶)
        attrs: { open: true },
        content: [label, ...(bodyNodes.length > 0 ? bodyNodes : [{ type: 'paragraph' }])],
      });
      i = j;
    } else {
      output.push(node);
      i++;
    }
  }
  return output;
}
