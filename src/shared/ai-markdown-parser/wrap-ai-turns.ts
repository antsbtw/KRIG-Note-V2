/**
 * 把"提取整页对话"产物按轮次重整为紧凑格式 — 跟 ai-sync 自动同步 buildAITurnPmNodes
 * 输出一致(❓ Callout 包用户提问 + 🔀 Toggle 包 AI 回答 + --- 分隔)。
 *
 * 输入:aiMarkdownToNoteDoc(整页 markdown).payload.content 数组(扁平 PM JSON 节点)
 * 整页 markdown 结构(extractClaudeFullConversation 等出来的格式):
 *
 *   # 标题(H1)                  ← 砍掉(无用元数据)
 *   > 模型: ...                   ← 砍掉
 *   > 共 N 条消息                 ← 砍掉
 *
 *   ## 👤 用户                    ← 转 ❓ Callout
 *   ... user 文本 ...
 *
 *   ---                           ← 保留(turn 分隔)
 *
 *   ## 🤖 AI (xxx)                ← 转 ▼ Toggle (label="回答 (服务名)")
 *   ... AI 文本(可能含 artifact image / htmlBlock / fence)...
 *
 *   ---
 *
 *   ## 👤 用户                    (下一轮)
 *   ...
 *
 * 设计意图(用户反馈):
 * - H1 标题 / 模型 / 共 N 条消息 都是无用噪声,砍
 * - 用户提问外套 ❓ Callout(对齐 ai-sync 增量同步 — 整页提取也是同款形态)
 * - AI 回答外套 ▶ Toggle 默认折叠(对齐用户截图;点开看具体回答)
 * - turn 之间的 --- 保留视觉分隔
 *
 * 检测 heading 文本以 "🤖" / "👤" emoji 起始 — 来自 buildFullMarkdownFromExtracted 的
 * 固定格式,只要那一端不改就稳。
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
 * 把整页 markdown 转出的扁平节点数组按轮次重整成"❓ Callout + 🔀 Toggle + ---"。
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

  // 1. 跳过开头元数据(H1 标题 / blockquote 模型/共 N 条消息),直到遇到第一个
  //    "## 👤 用户" 或 "## 🤖 AI" heading
  let i = 0;
  while (i < input.length) {
    const node = input[i];
    if (isUserTurnHeading(node) || isAITurnHeading(node)) break;
    i++; // 砍 H1/blockquote/任何 turn 前的杂项
  }

  // 2. 按 turn 处理 — 遇到 heading 时收集其后所有 body block 直到下一个 h2
  while (i < input.length) {
    const node = input[i];

    if (isUserTurnHeading(node)) {
      // 收集 user heading 之后的 body block(直到下一个 h2)
      const bodyNodes: PmJsonNode[] = [];
      let j = i + 1;
      while (j < input.length) {
        const next = input[j];
        if (isAITurnHeading(next) || isUserTurnHeading(next)) break;
        // 砍 turn body 内的 horizontalRule(它是 turn 之间分隔的标记,不是 turn 内容)
        if (next.type === 'horizontalRule') { j++; continue; }
        bodyNodes.push(next);
        j++;
      }
      // ❓ Callout 包用户提问(空 body 用空 paragraph 占位满足 content:'block+')
      output.push({
        type: 'callout',
        attrs: { emoji: '❓' },
        content: bodyNodes.length > 0 ? bodyNodes : [{ type: 'paragraph' }],
      });
      i = j;
    } else if (isAITurnHeading(node)) {
      // 收集 AI heading 之后的 body block(直到下一个 h2)
      const bodyNodes: PmJsonNode[] = [];
      let j = i + 1;
      while (j < input.length) {
        const next = input[j];
        if (isAITurnHeading(next) || isUserTurnHeading(next)) break;
        if (next.type === 'horizontalRule') { j++; continue; }
        bodyNodes.push(next);
        j++;
      }
      // 🔀 Toggle 包 AI 回答(label="回答 (服务名)";default open=false 折叠,对齐
      // 用户截图 — 默认看不到展开内容,点 ▶ 展开)
      const label: PmJsonNode = {
        type: 'paragraph',
        content: [{ type: 'text', text: `回答 (${serviceName})` }],
      };
      output.push({
        type: 'toggleList',
        attrs: { open: false },
        content: [label, ...(bodyNodes.length > 0 ? bodyNodes : [{ type: 'paragraph' }])],
      });
      // turn 之间 ─── 分隔(对齐 ai-sync buildAITurnPmNodes 同款,视觉分隔每轮)
      output.push({ type: 'horizontalRule' });
      i = j;
    } else {
      // 不是 heading(罕见:开头跳过元数据后仍有杂项)— 透传
      output.push(node);
      i++;
    }
  }

  return output;
}
