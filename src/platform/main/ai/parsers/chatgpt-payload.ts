/**
 * ChatGPT 载荷解析 —— **纯逻辑,零 Electron 依赖,可完全单测**
 *
 * ── 为什么单独成文件(步 4 还债②)──
 *
 * 这些函数原先埋在 `extractors/chatgpt-full-extraction.ts` 里,**全部未导出**,
 * 唯一入口 `loadChatGPTConversation(wc)` 需要真 `WebContents` —— vitest 够不着。
 * 步 0 因此留下两笔债(`08` §6.5.1):
 *
 *   债① 「多轮取最后一轮」没有网:把 `walkMapping` 的 `children[children.length-1]`
 *        改成 `children[0]`(**正是 project-chatgpt-extract-stale-cache 那次事故的形态**),
 *        `tests/ai/` 120 条**一条不红**。
 *   债② 「私用区 marker widget 还原」没有网:不还原就会让 `▤url▤标题▤href▤`
 *        乱码方块进 Note。
 *
 * ⚠️ 还债的做法**不是给它们加 export**(那是把测试需求泄漏进产品),
 * 而是把「取数」与「解析」拆开 —— 取数走 `web.dom`(要真页面),
 * 解析是纯函数(不要页面)。拆开之后它们**自然可测**。
 *
 * ⭐ **行为一字未改**:函数体逐字搬过来,`tests/ai/` 120 条是判据。
 */

export function extractConversationId(url: string): string | null {
  const m = url.match(/\/c\/([a-f0-9-]{36})/);
  return m ? m[1] : null;
}

export function sniffMimeFromBase64(b64: string | null | undefined): string | null {
  if (!b64 || b64.length < 8) return null;
  const head = b64.slice(0, 16);
  if (head.startsWith('iVBORw')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('R0lGODl')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('PHN2Zy') || head.startsWith('PD94bWw')) return 'image/svg+xml';
  if (head.startsWith('JVBER')) return 'application/pdf';
  return null;
}

export function fileIdFromAssetPointer(ptr: string | undefined | null): string | null {
  if (!ptr || typeof ptr !== 'string') return null;
  const m = ptr.match(/file_[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

export function fileIdFromEstuaryUrl(url: string): string | null {
  const m = url.match(/[?&]id=(file_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// ─── ChatGPT 私有内联 widget 还原 ─────────────────────────────────────
//
// ChatGPT 把内联超链接等编码成「私用区 marker 分隔结构」(非 JSON):
//   U+E200  类型名  U+E202  字段1  U+E202  字段2 … U+E201
// 实测从落盘 note 捞到的真实样例(url 类型):
//   <U+E200>url<U+E202>IPinfo<U+E202>https://ipinfo.io<U+E201>
//   → 字段1=标题 IPinfo,字段2=href → 还原成 [IPinfo](https://ipinfo.io)
//
// marker 码点:
//   START=U+E200  END=U+E201  SEP=U+E202
// 不还原会在 Note 里露出 ▤url▤标题▤href▤ 乱码方块(▤ 即未渲染的 marker)。

const WIDGET_START = 0xe200;
const WIDGET_END = 0xe201;
const WIDGET_SEP = 0xe202;

/**
 * charts_widget_v2 → markdown 表格。
 * 真实结构(实测):{"charts_widget_v2":{"content":{
 *   "chartType":"line","meta":{"title":..,"description":..},
 *   "series":[{"dataKey":"value","label":"Portfolio Value",..}],
 *   "data":[{"year":"0","value":1000}, ...] }}}
 * 落地:标题/描述 + data 数组转两列(或多列)表格,列名取 data 项的 key。
 */
export function chartWidgetToMarkdown(content: Record<string, unknown>): string | null {
  const data = content.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  // 收集所有列名(按首项 key 顺序 + 后续补漏)
  const cols: string[] = [];
  for (const row of data) {
    if (row && typeof row === 'object') {
      for (const k of Object.keys(row as Record<string, unknown>)) {
        if (!cols.includes(k)) cols.push(k);
      }
    }
  }
  if (cols.length === 0) return null;

  // 列名美化:用 series.label 替换 dataKey(若有映射)
  const labelByKey = new Map<string, string>();
  const series = content.series;
  if (Array.isArray(series)) {
    for (const s of series) {
      if (s && typeof s === 'object') {
        const dk = (s as Record<string, unknown>).dataKey;
        const lb = (s as Record<string, unknown>).label;
        if (typeof dk === 'string' && typeof lb === 'string') labelByKey.set(dk, lb);
      }
    }
  }
  const headerCells = cols.map((c) => labelByKey.get(c) ?? c);

  const lines: string[] = [];
  const meta = content.meta;
  if (meta && typeof meta === 'object') {
    const title = (meta as Record<string, unknown>).title;
    const desc = (meta as Record<string, unknown>).description;
    if (typeof title === 'string' && title.trim()) lines.push(`**${title.trim()}**`);
    if (typeof desc === 'string' && desc.trim()) lines.push(desc.trim());
    if (lines.length) lines.push('');
  }
  lines.push(`| ${headerCells.join(' | ')} |`);
  lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const row of data) {
    const r = (row && typeof row === 'object') ? row as Record<string, unknown> : {};
    lines.push(`| ${cols.map((c) => String(r[c] ?? '')).join(' | ')} |`);
  }
  return lines.join('\n');
}

/** 把一个 widget(类型 + 字段数组)还原成 markdown;认不出返字段拼接兜底 */
export function widgetFieldsToMarkdown(type: string, fields: string[]): string {
  const t = type.trim().toLowerCase();
  // url / link:[标题](href)。字段顺序实测为 [标题, href];个别情况只给 href。
  if (t === 'url' || t === 'link') {
    let title = '';
    let href = '';
    for (const f of fields) {
      if (/^https?:\/\//.test(f.trim())) href = f.trim();
      else if (!title) title = f.trim();
    }
    if (href) return `[${(title || href)}](${href})`;
    return fields.join(' ').trim();
  }

  // genui / image_group 等:字段是一段 JSON,按内部结构识别。
  // (实测 genui→charts_widget_v2 图表;image_group→carousel 图片组)
  for (const f of fields) {
    const trimmed = f.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    // 图表:{"charts_widget_v2":{"content":{...}}}
    const chartW = obj.charts_widget_v2;
    if (chartW && typeof chartW === 'object') {
      const content = (chartW as Record<string, unknown>).content;
      if (content && typeof content === 'object') {
        const md = chartWidgetToMarkdown(content as Record<string, unknown>);
        if (md) return md;
      }
    }
    // image_group carousel 由 unwrapWidgets 单独处理(emit 位置占位符),不到这里。
  }

  // 未知类型:剥掉 JSON 字段(不可读),只留非 JSON 文本;全是 JSON 则返空(不污染正文)
  const readable = fields.filter((f) => !f.trim().startsWith('{')).join(' ').trim();
  return readable;
}

/** 判断一个 widget(type + fields)是否 image_group carousel */
export function isImageGroupWidget(type: string, fields: string[]): boolean {
  const t = type.trim().toLowerCase();
  if (t === 'image_group') return true;
  for (const f of fields) {
    const trimmed = f.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.layout === 'carousel' || Array.isArray(obj.query)) return true;
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * 扫描文本,把 U+E200…U+E201 的 marker widget 还原成 markdown;
 * 任何游离的私用区 marker(U+E000–F8FF)兜底剥掉,绝不让乱码进 Note。
 */
export function unwrapWidgets(text: string): string {
  if (!text) return text;
  // 文本里没有任何 marker → 快速返回
  let hasMarker = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xe000 && c <= 0xf8ff) { hasMarker = true; break; }
  }
  if (!hasMarker) return text;

  const out: string[] = [];
  let i = 0;
  let imageGroupIdx = 0; // image_group widget 计数 → {{IMAGE_GROUP_N}} 占位符
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === WIDGET_START) {
      // 找配对的 END
      let j = i + 1;
      let end = -1;
      for (; j < text.length; j++) {
        const cc = text.charCodeAt(j);
        if (cc === WIDGET_END) { end = j; break; }
        if (cc === WIDGET_START) break; // 嵌套异常,放弃本段
      }
      if (end < 0) {
        // 没配对到 END:跳过这个起始 marker,继续(不输出乱码)
        i++;
        continue;
      }
      const inner = text.slice(i + 1, end);
      const segs = inner.split(String.fromCharCode(WIDGET_SEP));
      const type = segs[0] ?? '';
      const fields = segs.slice(1);
      // image_group:替换成位置占位符 {{IMAGE_GROUP_N}}(保留它在原文的位置),
      // 真实图片由 buildChatGPTMessageBody 按占位符在此处插入 message.imageGroups[N]。
      if (isImageGroupWidget(type, fields)) {
        out.push(`\n\n{{IMAGE_GROUP_${imageGroupIdx}}}\n\n`);
        imageGroupIdx++;
      } else {
        out.push(widgetFieldsToMarkdown(type, fields));
      }
      i = end + 1;
      continue;
    }
    if (c >= 0xe000 && c <= 0xf8ff) {
      // 游离 marker(SEP / END / 其它私用区)— 剥掉
      i++;
      continue;
    }
    out.push(text[i]);
    i++;
  }
  return out.join('');
}

// ─── Conversation tree walk ──────────────────────────────────────────

export function walkMapping(mapping: Record<string, { parent?: string | null; children?: string[]; message?: unknown }>): unknown[] {
  let rootId: string | null = null;
  for (const k of Object.keys(mapping)) {
    if (!mapping[k].parent) { rootId = k; break; }
  }
  const ordered: unknown[] = [];
  let cur: string | null = rootId;
  while (cur && mapping[cur]) {
    const node = mapping[cur];
    if (node.message) ordered.push(node.message);
    const children = node.children || [];
    cur = children.length ? children[children.length - 1] : null;
  }
  return ordered;
}

export interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  fileRefs: string[];
  /**
   * image_group 搜索结果图片的真实公开 URL,**按组**(来自 metadata.content_references,
   * 非 parts widget JSON)。V1 链路:ChatGPT 把搜到的图 URL 存进 content_references,
   * carousel widget 的 JSON 里只有搜索词。第 N 组对应文本里第 N 个 {{IMAGE_GROUP_N}}
   * 占位符,buildChatGPTMessageBody 按占位符在原位置插入。URL 公开(images.openai.com 等),
   * 嵌 ![](url) 后由 orchestrator 的 image-proxy 统一下载入 mediaStore。
   */
  imageGroups: string[][];
  recipient: string | null;
  hidden: boolean;
}

export function normalizeMessage(raw: {
  id?: string;
  author?: { role?: string };
  recipient?: string;
  content?: { parts?: unknown[] };
  metadata?: {
    attachments?: Array<{ id?: string }>;
    aggregate_result?: { messages?: Array<{ image_url?: string }> };
    content_references?: Array<{
      type?: string;
      images?: Array<{ image_result?: { content_url?: string } }>;
    }>;
    is_visually_hidden_from_conversation?: boolean;
  };
}): NormalizedMessage {
  const author = raw.author?.role || 'system';
  const recipient = raw.recipient ?? null;
  const parts = raw.content?.parts || [];

  const textParts: string[] = [];
  const fileRefs: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.length > 0) textParts.push(p);
    } else if (p && typeof p === 'object') {
      const obj = p as { asset_pointer?: string };
      if (obj.asset_pointer) {
        const id = fileIdFromAssetPointer(obj.asset_pointer);
        if (id) fileRefs.push(id);
      }
    }
  }

  const attachments = raw.metadata?.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a?.id && /^file_/.test(a.id)) fileRefs.push(a.id);
    }
  }
  const agg = raw.metadata?.aggregate_result;
  if (agg?.messages && Array.isArray(agg.messages)) {
    for (const m of agg.messages) {
      if (typeof m?.image_url === 'string') {
        const id = fileIdFromAssetPointer(m.image_url);
        if (id) fileRefs.push(id);
      }
    }
  }

  // image_group 真实图片 URL(V1 字面:metadata.content_references[].images[].image_result.content_url)
  // 按组保留:每个 type==='image_group' 的 ref 是一组,顺序对应文本里的 {{IMAGE_GROUP_N}}。
  const imageGroups: string[][] = [];
  const contentRefs = raw.metadata?.content_references;
  if (Array.isArray(contentRefs)) {
    for (const ref of contentRefs) {
      if (ref?.type === 'image_group' && Array.isArray(ref.images)) {
        const urls: string[] = [];
        for (const img of ref.images) {
          const url = img?.image_result?.content_url;
          if (typeof url === 'string' && url.length > 0) urls.push(url);
        }
        if (urls.length > 0) imageGroups.push(urls);
      }
    }
  }

  const text = unwrapWidgets(textParts.join('\n\n'));
  const role: NormalizedMessage['role'] = (author === 'user' || author === 'assistant' || author === 'tool' || author === 'system') ? author : 'system';
  return {
    id: raw.id || '',
    role,
    text,
    fileRefs: Array.from(new Set(fileRefs)),
    imageGroups,
    recipient,
    hidden: !!raw.metadata?.is_visually_hidden_from_conversation,
  };
}

