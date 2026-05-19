/**
 * Claude conversation 结构化解析 — V1 plugins/browser-capability/artifact/conversation-query.ts 移植
 *
 * V1 入参是 pageId 从 trace-writer 读 conversation.json;V2 改成直接接收 raw JSON
 * 入参(来自 fetchClaudeConversationRaw + render_all_tools=true)。
 *
 * 核心能力:
 * - 把 raw chat_messages 数组结构化成 ConversationMessage(含 textContent / artifacts / contentParts)
 * - 解析每个 assistant message 的 content[] 数组,找 tool_use 节点提取 artifact 源码
 *
 * 不迁 V1 的:
 * - trace-writer ArtifactRecord 数据库 / fallback storageRef 路径(downloaded type)
 * - 那一支用于"用户上传文件被 Claude 引用"场景,罕见且依赖 2100 行 trace-writer。
 * - widget_code / file_text / local_resource 覆盖 SVG / HTML / code / sandbox 文件 — 主路径。
 */

// ── Public types (与 V1 对齐) ──

export type ConversationData = {
  uuid: string;
  name: string;
  model?: string;
  currentLeafMessageUuid?: string;
  messages: ConversationMessage[];
};

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'artifact'; artifact: MessageArtifact };

export type ConversationMessage = {
  uuid: string;
  sender: 'human' | 'assistant' | 'system';
  index: number;
  createdAt?: string;
  textContent: string;
  artifacts: MessageArtifact[];
  /** content parts in original order (text and artifacts interleaved) */
  contentParts: ContentPart[];
};

export type ArtifactKind = 'image' | 'widget' | 'code' | 'table' | 'file' | 'unknown';

export type MessageArtifact = {
  artifactId: string;
  toolUseId: string;
  toolName: string;
  title: string;
  kind: ArtifactKind;
  content: ArtifactContent | null;
};

export type ArtifactContent =
  | { type: 'widget_code'; code: string; mimeType: string }
  | { type: 'file_text'; text: string; path: string }
  | { type: 'local_resource'; filePath: string; mimeType: string; name: string; uuid?: string };

// ── Implementation (V1 对齐) ──

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractTextFromContent(content: unknown[]): string {
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    }
  }
  return parts.join('\n\n');
}

function detectMimeType(code: string): string {
  if (code.includes('<svg')) return 'image/svg+xml';
  if (code.includes('<div') || code.includes('<style') || code.includes('<script')) return 'text/html';
  return 'text/html';
}

/**
 * 从 tool_result content 提取 local_resource 条目(V1 移植)。
 * 这些是 bash_tool 在 Claude sandbox 中生成的文件。
 */
function extractLocalResources(content: unknown[]): Array<{
  filePath: string;
  name: string;
  mimeType: string;
  uuid?: string;
  toolUseId?: string;
}> {
  const resources: Array<{
    filePath: string;
    name: string;
    mimeType: string;
    uuid?: string;
    toolUseId?: string;
  }> = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type !== 'tool_result') continue;

    const toolUseId = readString(record.tool_use_id) ?? undefined;
    const inner = Array.isArray(record.content) ? record.content : [];
    for (const item of inner) {
      if (!item || typeof item !== 'object') continue;
      const res = item as Record<string, unknown>;
      if (res.type !== 'local_resource') continue;
      const filePath = readString(res.file_path);
      if (!filePath) continue;
      resources.push({
        filePath,
        name: readString(res.name) ?? filePath.split('/').pop() ?? 'file',
        mimeType: readString(res.mime_type) ?? 'application/octet-stream',
        uuid: readString(res.uuid) ?? undefined,
        toolUseId,
      });
    }
  }
  return resources;
}

function classifyLocalResourceKind(mimeType: string, filePath: string): ArtifactKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'text/html' || filePath.match(/\.html?$/i)) return 'widget';
  if (mimeType.includes('svg')) return 'image';
  if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('typescript')) return 'code';
  if (mimeType.includes('csv')) return 'table';
  return 'file';
}

/**
 * 从一条 assistant message 的 content 数组中提取所有 artifact(V1 移植)。
 *
 * 逻辑:
 * 1. 第一遍扫 tool_result,收集 bash_tool 输出的 local_resource(sandbox 文件)
 * 2. 第二遍扫 tool_use:show_widget(widget_code) / create_file(file_text) /
 *    view(file_text) / present_files(关联 local_resource) / bash_tool(关联
 *    local_resource)等都视为 artifact
 * 3. 把 local_resource 没被 tool_use 引用的也补一条(独立 artifact)
 *
 * 删除 V1 的 ArtifactRecord 匹配链路(那需要 trace-writer 数据库)。
 */
function extractArtifactsFromContent(
  content: unknown[],
): MessageArtifact[] {
  const result: MessageArtifact[] = [];
  const skippedToolUseIds = new Set<string>();

  // 第一遍:收集所有 local_resource(bash_tool 输出)
  const localResources = extractLocalResources(content);

  // 第二遍:扫描 tool_use 节点
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    if (record.type !== 'tool_use') continue;

    const toolName = readString(record.name) ?? '';
    const toolUseId = readString(record.id) ?? '';
    const input = record.input && typeof record.input === 'object'
      ? record.input as Record<string, unknown>
      : null;
    if (!input) continue;

    const isShowWidget = toolName.includes('show_widget');
    const isCreateFile = toolName === 'create_file';
    const isViewFile = toolName === 'view';
    const isPresentFiles = toolName === 'present_files';
    const isBashTool = toolName === 'bash_tool';

    // 不产生 artifact 的工具调用跳过
    if (!isShowWidget && !isCreateFile && !isViewFile && !isPresentFiles && !isBashTool) continue;

    const pathSegment = readString(input.path)?.split('/').pop();
    const title = readString(input.title)
      ?? readString(input.name)
      ?? pathSegment
      ?? toolUseId;

    let artifactContent: ArtifactContent | null = null;
    const widgetCode = readString(input.widget_code);
    const fileText = readString(input.file_text);
    const filePath = readString(input.path);

    if (widgetCode) {
      artifactContent = {
        type: 'widget_code',
        code: widgetCode,
        mimeType: detectMimeType(widgetCode),
      };
    } else if (fileText && filePath) {
      artifactContent = {
        type: 'file_text',
        text: fileText,
        path: filePath,
      };
    }

    let kind: ArtifactKind = 'unknown';
    if (isShowWidget && widgetCode?.includes('<svg')) kind = 'image';
    else if (isShowWidget) kind = 'widget';
    else if (isCreateFile) kind = 'file';
    else if (isViewFile) kind = 'file';
    else if (isPresentFiles) kind = 'file';

    // bash_tool 没 artifactContent 时跳过(走 local_resource 路径补)
    if (isBashTool && !artifactContent) {
      continue;
    }

    // view 文件:改 title 为文件名
    if (isViewFile && filePath) {
      result.push({
        artifactId: `artifact:${toolUseId}`,
        toolUseId,
        toolName,
        title: filePath.split('/').pop() ?? title,
        kind: 'file',
        content: artifactContent,
      });
      continue;
    }

    // present_files:用 local_resource 作 content(若有同名 create_file 已 push 则跳过去重)
    if (isPresentFiles) {
      const filepathsToCheck = Array.isArray(input.filepaths) ? input.filepaths : [];
      const alreadyCreated = filepathsToCheck.length > 0 && filepathsToCheck.every((fp: unknown) => {
        if (typeof fp !== 'string') return false;
        const fname = fp.split('/').pop();
        return result.some(r => r.toolName === 'create_file' && r.content?.type === 'file_text'
          && (r.content as { path?: string }).path?.split('/').pop() === fname);
      });
      if (alreadyCreated) {
        skippedToolUseIds.add(toolUseId);
        continue;
      }
      const filepaths = Array.isArray(input.filepaths) ? input.filepaths : [];
      const fileNames = filepaths
        .map((fp: unknown) => typeof fp === 'string' ? fp.split('/').pop() : null)
        .filter((n: unknown): n is string => typeof n === 'string');

      // 关联 local_resource(来自同一 toolUseId 的 tool_result)
      const resourcesForThis = localResources.filter((r) => r.toolUseId === toolUseId);
      if (resourcesForThis.length > 0) {
        for (const res of resourcesForThis) {
          const resContent: ArtifactContent = {
            type: 'local_resource',
            filePath: res.filePath,
            mimeType: res.mimeType,
            name: res.name,
            uuid: res.uuid,
          };
          result.push({
            artifactId: `artifact:local:${res.name}`,
            toolUseId,
            toolName,
            title: res.name,
            kind: classifyLocalResourceKind(res.mimeType, res.filePath),
            content: resContent,
          });
        }
      } else {
        result.push({
          artifactId: `artifact:${toolUseId}`,
          toolUseId,
          toolName,
          title: fileNames.length > 0 ? fileNames.join(', ') : title,
          kind: 'file',
          content: artifactContent,
        });
      }
      continue;
    }

    result.push({
      artifactId: `artifact:${toolUseId}`,
      toolUseId,
      toolName,
      title,
      kind,
      content: artifactContent,
    });
  }

  // 第三遍:补充 local_resource 中未被 tool_use 覆盖的(独立 artifact)
  const coveredToolUseIds = new Set(result.map((a) => a.toolUseId));
  for (const res of localResources) {
    if (res.toolUseId && (coveredToolUseIds.has(res.toolUseId) || skippedToolUseIds.has(res.toolUseId))) continue;

    const content: ArtifactContent = {
      type: 'local_resource',
      filePath: res.filePath,
      mimeType: res.mimeType,
      name: res.name,
      uuid: res.uuid,
    };

    result.push({
      artifactId: `artifact:local:${res.name}`,
      toolUseId: res.toolUseId ?? '',
      toolName: 'bash_tool',
      title: res.name,
      kind: classifyLocalResourceKind(res.mimeType, res.filePath),
      content,
    });
  }

  return result;
}

// ── Public API ──

/**
 * 把 raw conversation JSON(/api/.../chat_conversations/{id}?...&render_all_tools=true 返回)
 * 解析成结构化 ConversationData。
 *
 * 入参约束:必须是带 render_all_tools=true 抓的 — 否则 content[] 数组没有 tool_use,
 * 拿不到 widget_code/file_text。fetchClaudeConversationRaw 已确保参数对齐。
 */
export function getConversationData(raw: Record<string, unknown>): ConversationData | null {
  const uuid = readString(raw.uuid);
  if (!uuid) return null;

  const chatMessages = Array.isArray(raw.chat_messages) ? raw.chat_messages : [];
  const messages: ConversationMessage[] = [];

  for (const msg of chatMessages) {
    if (!msg || typeof msg !== 'object') continue;
    const record = msg as Record<string, unknown>;
    const msgUuid = readString(record.uuid);
    if (!msgUuid) continue;

    const sender = record.sender === 'human' ? 'human'
      : record.sender === 'assistant' ? 'assistant'
      : 'system';

    const content = Array.isArray(record.content) ? record.content : [];
    const rawText = readString(record.text);
    const textContent = rawText ?? extractTextFromContent(content);

    // 构造 contentParts 保持原始顺序 + 收集 artifacts
    const contentParts: ContentPart[] = [];
    const msgArtifacts: MessageArtifact[] = [];

    if (sender === 'assistant' && content.length > 0) {
      // artifact lookup(按 toolUseId 索引)
      const artifactsByToolUseId = new Map<string, MessageArtifact>();
      for (const a of extractArtifactsFromContent(content)) {
        artifactsByToolUseId.set(a.toolUseId, a);
        msgArtifacts.push(a);
      }

      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const partRecord = part as Record<string, unknown>;
        if (partRecord.type === 'text') {
          const text = readString(partRecord.text);
          if (text) contentParts.push({ type: 'text', text });
        } else if (partRecord.type === 'tool_use') {
          const toolUseId = readString(partRecord.id);
          if (toolUseId) {
            const artifact = artifactsByToolUseId.get(toolUseId);
            if (artifact) {
              contentParts.push({ type: 'artifact', artifact });
            }
          }
        }
        // skip tool_result and other types
      }
    } else {
      // human / system messages — 只 text
      if (textContent.trim()) {
        contentParts.push({ type: 'text', text: textContent });
      }
    }

    messages.push({
      uuid: msgUuid,
      sender,
      index: typeof record.index === 'number' ? record.index : messages.length,
      createdAt: readString(record.created_at) ?? undefined,
      textContent,
      artifacts: msgArtifacts,
      contentParts,
    });
  }

  return {
    uuid,
    name: readString(raw.name) ?? '',
    model: readString(raw.model) ?? undefined,
    currentLeafMessageUuid: readString(raw.current_leaf_message_uuid) ?? undefined,
    messages,
  };
}
