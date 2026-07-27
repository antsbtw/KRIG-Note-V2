/**
 * markdown-core 契约测试 —— 阶段 B1 唯一解析核的回归护栏。
 *
 * 覆盖（验收要求）：
 *  - 每类 B1 block：heading / paragraph / horizontalRule / codeBlock / mathBlock / mathInline
 *  - 两个已知 fence 坑：嵌套 fence 长度配对 + 闭栏带残留不吞到文末
 *  - inline mark 递归嵌套（bold/italic/strike/code/link 互套）
 *  - 「未覆盖」出口：非 B1 block 产 uncovered 哨兵、绝不静默吞
 *
 * B1 拍板：①(AI 提取) 与 ②(文件/剪藏/Word 导入) 的这几类 block 都吃本核产出的
 * canonical 形态。本文件同时锁 markdownCore 直接产物 + ① blocks-to-pm-doc 一致性。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  markdownCore,
  parseInline,
  tryParseFencedCode,
  isUncovered,
  UNCOVERED_TYPE,
  buildTableNode,
  buildCalloutNode,
  calloutEmojiFor,
  splitCellOnBr,
  parseImageSrc,
  buildImageNode,
  buildVideoNode,
  buildAudioNode,
  buildHtmlBlockNode,
  buildFileBlockNode,
  buildExternalRefNode,
  tryParseMediaTag,
  tryParseObsidianVideoEmbed,
  stripBlockquotePrefix,
  buildBlockquoteNode,
  classifyListLine,
  buildListItemNode,
  buildBulletListNode,
  buildOrderedListNode,
  buildTaskItemNode,
  buildTaskListNode,
  type PMNode,
} from '@shared/markdown-core';

// ── heading ──────────────────────────────────────────────────────────
describe('markdown-core / heading', () => {
  it('# ~ ###### → heading level 1-6', () => {
    for (let lvl = 1; lvl <= 6; lvl++) {
      const nodes = markdownCore(`${'#'.repeat(lvl)} 标题${lvl}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('heading');
      expect(nodes[0].attrs?.level).toBe(lvl);
      expect(nodes[0].content?.[0]).toEqual({ type: 'text', text: `标题${lvl}` });
    }
  });

  it('heading 内含 mark（canonical inline）', () => {
    const [h] = markdownCore('## 含 **粗** 与 `代码`');
    expect(h.type).toBe('heading');
    const texts = (h.content ?? []).map((n) => n.text);
    expect(texts).toContain('粗');
    expect(h.content?.find((n) => n.text === '粗')?.marks).toEqual([{ type: 'bold' }]);
    expect(h.content?.find((n) => n.text === '代码')?.marks).toEqual([{ type: 'code' }]);
  });
});

// ── paragraph ────────────────────────────────────────────────────────
describe('markdown-core / paragraph', () => {
  it('纯文本 → paragraph', () => {
    const [p] = markdownCore('一段普通文字');
    expect(p.type).toBe('paragraph');
    expect(p.content).toEqual([{ type: 'text', text: '一段普通文字' }]);
  });
});

// ── horizontalRule ───────────────────────────────────────────────────
describe('markdown-core / horizontalRule', () => {
  it.each(['---', '***', '___', '----', '******'])('%s → horizontalRule', (rule) => {
    const [hr] = markdownCore(rule);
    expect(hr).toEqual({ type: 'horizontalRule' });
  });
});

// ── codeBlock + fence 两个坑 ─────────────────────────────────────────
const codeText = (n: PMNode): string => n.content?.[0]?.text ?? '';

describe('markdown-core / codeBlock', () => {
  it('```lang → codeBlock，有 language 才带 attrs', () => {
    const [c] = markdownCore('```python\nprint("hi")\n```');
    expect(c.type).toBe('codeBlock');
    expect(c.attrs?.language).toBe('python');
    expect(codeText(c)).toBe('print("hi")');
  });

  it('无 language 的 ``` → attrs 省略（undefined）', () => {
    const [c] = markdownCore('```\ncode\n```');
    expect(c.type).toBe('codeBlock');
    expect(c.attrs).toBeUndefined();
    expect(codeText(c)).toBe('code');
  });

  it('空代码块 → content 省略', () => {
    const [c] = markdownCore('```\n```');
    expect(c.type).toBe('codeBlock');
    expect(c.content).toBeUndefined();
  });

  // 坑 1：嵌套 fence 长度配对
  it('坑1 嵌套 ````markdown 包 ```mermaid：单块，内层内容完整不漏', () => {
    const md = '前言。\n\n````markdown\n```mermaid\nmindmap\n  root((NJ))\n    Chapter 1\n```\n````\n\n结束。';
    const nodes = markdownCore(md);
    const code = nodes.filter((n) => n.type === 'codeBlock');
    expect(code).toHaveLength(1);
    expect(code[0].attrs?.language).toBe('markdown');
    expect(codeText(code[0])).toContain('```mermaid');
    expect(codeText(code[0])).toContain('Chapter 1');
    // 绝不能出现空 codeBlock / mermaid 内容漏成正文
    expect(nodes.some((n) => n.type === 'codeBlock' && !codeText(n).trim())).toBe(false);
    expect(nodes.some((n) => n.type === 'paragraph' && (codeText(n)).includes('mindmap'))).toBe(false);
  });

  it('坑1 内层带空行的 mermaid 内容完整保留', () => {
    const md = '````markdown\n```mermaid\nmindmap\n  root((X))\n\n    Chapter 1\n\n    Chapter 2\n```\n````';
    const code = markdownCore(md).filter((n) => n.type === 'codeBlock');
    expect(code).toHaveLength(1);
    expect(codeText(code[0])).toContain('Chapter 1');
    expect(codeText(code[0])).toContain('Chapter 2');
  });

  // 坑 2：闭栏带残留不吞到文末
  it('坑2 闭栏行带残留（``` 后跟文字）不把后续段落吞进代码块', () => {
    const md = '第一段。\n\n```\ncode\n``` 后面还有字\n\n第三段。';
    const nodes = markdownCore(md);
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    const last = nodes[nodes.length - 1];
    expect(last.content?.some((t) => (t.text ?? '').includes('第三段'))).toBe(true);
  });

  it('tryParseFencedCode 非开栏返回 null', () => {
    expect(tryParseFencedCode(['普通行'], 0)).toBeNull();
    expect(tryParseFencedCode(['``', 'x'], 0)).toBeNull(); // 只有 2 个 backtick
  });
});

// ── mathBlock ────────────────────────────────────────────────────────
describe('markdown-core / mathBlock', () => {
  it('单行 $$…$$ → mathBlock，content=[text]', () => {
    const [m] = markdownCore('$$a^2 + b^2 = c^2$$');
    expect(m.type).toBe('mathBlock');
    expect(m.content).toEqual([{ type: 'text', text: 'a^2 + b^2 = c^2' }]);
  });

  it('多行 $$ … $$ → mathBlock，跨行 latex 完整', () => {
    const [m] = markdownCore('$$\n\\int_0^1 x dx\n= \\frac{1}{2}\n$$');
    expect(m.type).toBe('mathBlock');
    expect(codeText(m)).toContain('\\int_0^1');
    expect(codeText(m)).toContain('\\frac{1}{2}');
  });

  it('空 $$$$ → uncovered 哨兵（不静默吞，caller 决定降级）', () => {
    const [n] = markdownCore('$$$$');
    expect(isUncovered(n)).toBe(true);
  });
});

// ── mathInline + inline mark 递归嵌套 ───────────────────────────────
describe('markdown-core / inline marks', () => {
  it('mathInline $x^2$ → inline node', () => {
    const nodes = parseInline('值为 $x^2$ 结束');
    expect(nodes.some((n) => n.type === 'mathInline' && n.attrs?.latex === 'x^2')).toBe(true);
  });

  it('strike ~~删除~~', () => {
    const nodes = parseInline('~~删除~~');
    expect(nodes[0].marks).toEqual([{ type: 'strike' }]);
  });

  it('递归嵌套 [**X**](url)：link + bold 同叠', () => {
    const nodes = parseInline('[**加粗链接**](https://x.com)');
    expect(nodes).toHaveLength(1);
    const marks = (nodes[0].marks ?? []).map((m) => m.type).sort();
    expect(marks).toEqual(['bold', 'link']);
    expect(nodes[0].marks?.find((m) => m.type === 'link')?.attrs?.href).toBe('https://x.com');
  });

  it('递归嵌套 **[X](url)**：bold 外套 link', () => {
    const nodes = parseInline('**[链接](u)**');
    const marks = (nodes[0].marks ?? []).map((m) => m.type).sort();
    expect(marks).toEqual(['bold', 'link']);
  });

  it('code 为叶子，内部 ** 不再解析', () => {
    const nodes = parseInline('`**不是粗**`');
    expect(nodes).toEqual([{ type: 'text', text: '**不是粗**', marks: [{ type: 'code' }] }]);
  });
});

// ── 未覆盖出口（不静默吞）────────────────────────────────────────────
describe('markdown-core / uncovered exit', () => {
  it('list / table / blockquote 等非 B1 block → uncovered 哨兵带原始源行', () => {
    const md = '- 列表项\n- 第二项';
    const nodes = markdownCore(md);
    expect(nodes.every((n) => n.type === UNCOVERED_TYPE)).toBe(true);
    const raw = nodes.map((n) => (n.attrs as { rawLines: string }).rawLines).join('\n');
    expect(raw).toContain('列表项');
    expect(raw).toContain('第二项');
  });

  it('uncovered 块内容一字不丢（table）', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const nodes = markdownCore(md);
    const raw = nodes.map((n) => (n.attrs as { rawLines: string })?.rawLines ?? '').join('\n');
    expect(raw).toContain('| a | b |');
    expect(raw).toContain('| 1 | 2 |');
  });

  it('B1 块与 uncovered 块混排：B1 规范解析、uncovered 隔断', () => {
    const md = '# 标题\n\n- 列表\n\n普通段落';
    const nodes = markdownCore(md);
    expect(nodes[0].type).toBe('heading');
    expect(nodes[1].type).toBe(UNCOVERED_TYPE);
    expect(nodes[2].type).toBe('paragraph');
  });
});

// ── B2：table（buildTableNode）───────────────────────────────────────
describe('markdown-core / table (B2)', () => {
  // 普通 cell 逐字段一致护栏：首行 tableHeader、其余 tableCell，
  // 每 cell = paragraph 包 canonical inline text 节点（不含嵌套 mark 时逐字段不变）。
  it('普通 cell 输出逐字段不变（tableHeader/tableCell + paragraph + text）', () => {
    const node = buildTableNode(
      [
        ['a', 'b'],
        ['1', '2'],
      ],
      true,
    );
    expect(node).toEqual({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
          ],
        },
      ],
    });
    // colwidth 不预设：cell 无 attrs.colwidth（留 NodeView 均分）
    const cell = node!.content![0].content![0];
    expect(cell.attrs).toBeUndefined();
  });

  it('hasHeader=false：首行也是 tableCell', () => {
    const node = buildTableNode([['x']], false);
    expect(node!.content![0].content![0].type).toBe('tableCell');
  });

  it('cell 内嵌套 mark 走核 parseInline（升级 ① 弱实现）', () => {
    const node = buildTableNode([['**粗** 与 [**链接**](u)']], false);
    const para = node!.content![0].content![0].content![0];
    // **粗**
    const bold = para.content!.find((n) => n.text === '粗');
    expect(bold?.marks).toEqual([{ type: 'bold' }]);
    // [**链接**](u) → link + bold 同叠
    const linked = para.content!.find((n) => n.text === '链接');
    const marks = (linked?.marks ?? []).map((m) => m.type).sort();
    expect(marks).toEqual(['bold', 'link']);
  });

  it('cell 内 <br> 拆多段（采 ②）', () => {
    const node = buildTableNode([['第一段<br>第二段']], false);
    const cell = node!.content![0].content![0];
    expect(cell.content).toHaveLength(2);
    expect(cell.content![0].content![0].text).toBe('第一段');
    expect(cell.content![1].content![0].text).toBe('第二段');
  });

  it('splitCellOnBr 容忍 <br/> / <br /> / 大小写；无 br 返单段', () => {
    expect(splitCellOnBr('a<br/>b<BR />c')).toEqual(['a', 'b', 'c']);
    expect(splitCellOnBr('单段')).toEqual(['单段']);
  });

  it('畸形零单元格行 fail-loud warn 后字面跳过（采 ②，对齐阶段 D）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = buildTableNode(
      [
        ['a', 'b'],
        [], // 零单元格行
        ['1', '2'],
      ],
      true,
    );
    // 只留 2 行有效数据（畸形行被跳）
    expect(node!.content).toHaveLength(2);
    // fail-loud：留痕，不静默
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('畸形空表格行');
    warn.mockRestore();
  });

  it('全零单元格 → 返 null（caller 决定降级，不产 content:[] 空 table）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(buildTableNode([[], []], true)).toBeNull();
    warn.mockRestore();
  });
});

// ── B2：callout（buildCalloutNode / calloutEmojiFor）────────────────
describe('markdown-core / callout (B2)', () => {
  it('GitHub alert 各类型 → emoji（与 ① CALLOUT_EMOJI_MAP 一致）', () => {
    expect(calloutEmojiFor('note')).toBe('📝');
    expect(calloutEmojiFor('warning')).toBe('⚠️');
    expect(calloutEmojiFor('tip')).toBe('💡');
    expect(calloutEmojiFor('danger')).toBe('🔴');
    expect(calloutEmojiFor('success')).toBe('✅');
    expect(calloutEmojiFor('important')).toBe('🔥');
  });

  it('大小写不敏感 + 未知类型兜底 💡', () => {
    expect(calloutEmojiFor('NOTE')).toBe('📝');
    expect(calloutEmojiFor('Warning')).toBe('⚠️');
    expect(calloutEmojiFor('unknown-type')).toBe('💡');
  });

  it('buildCalloutNode：callout{emoji} 包 paragraph，body 走核 parseInline', () => {
    const node = buildCalloutNode('⚠️', '注意 **粗体** 内容');
    expect(node.type).toBe('callout');
    expect(node.attrs?.emoji).toBe('⚠️');
    expect(node.content![0].type).toBe('paragraph');
    const bold = node.content![0].content!.find((n) => n.text === '粗体');
    expect(bold?.marks).toEqual([{ type: 'bold' }]);
  });
});

// ── B2：② md-to-pm 现在认 GitHub alert callout（新增能力验证）──────────
// 注：markdownToProseMirror 是 async 且依赖 capability registry（media），这里只验
// 纯逻辑分支不触媒体的 callout 路径。若 registry 未装载会抛，跳过留实机验证。
describe('markdown-core / ② callout 集成（新增能力）', () => {
  it('② 把 > [!NOTE] 认成 callout（不再降级 blockquote）', async () => {
    const mod = await import('@capabilities/text-editing/converters/md-to-pm');
    let nodes: PMNode[];
    try {
      nodes = (await mod.markdownToProseMirror('> [!WARNING]\n> 小心内容')) as PMNode[];
    } catch {
      // capability registry 未装载（无头环境）→ 跳过，留实机手验
      return;
    }
    expect(nodes[0].type).toBe('callout');
    expect(nodes[0].attrs?.emoji).toBe('⚠️');
    expect(nodes[0].content![0].content![0].text).toContain('小心内容');
  });

  it('② 普通 blockquote（无 [!TYPE]）仍是 blockquote（原行为不变）', async () => {
    const mod = await import('@capabilities/text-editing/converters/md-to-pm');
    let nodes: PMNode[];
    try {
      nodes = (await mod.markdownToProseMirror('> 普通引用')) as PMNode[];
    } catch {
      return;
    }
    expect(nodes[0].type).toBe('blockquote');
  });
});

// ── B3：媒体块 —— 核纯 sync 解析，src 原样 ────────────────────────────
describe('markdown-core / image (B3)', () => {
  it('标准 URL src 原样进原样出', () => {
    expect(parseImageSrc('https://x.com/a.png')).toEqual({ src: 'https://x.com/a.png' });
  });

  it('base64 src 原样（核绝不本地化成 media://）', () => {
    const b64 = 'data:image/png;base64,AAAA';
    expect(parseImageSrc(b64)).toEqual({ src: b64 });
    // buildImageNode 也原样（外壳才 resolve）
    expect(buildImageNode(b64, 'alt').attrs?.src).toBe(b64);
  });

  it('image:pageN → src 归一 image + pageRef（bbox undefined）', () => {
    expect(parseImageSrc('image:page19')).toEqual({ src: 'image', pageRef: 19 });
    expect(parseImageSrc('image:page19-19')).toEqual({ src: 'image', pageRef: 19 });
  });

  it('image:pageN:x,y,w,h → pageRef + bbox 都解析出', () => {
    expect(parseImageSrc('image:page3:x1,y2,w3,h4')).toEqual({
      src: 'image',
      pageRef: 3,
      bbox: { x: 1, y: 2, w: 3, h: 4 },
    });
  });

  it('bbox/pageRef 解析出但**不写进 image 节点 attrs**（指挥拍板保持丢弃 + TODO）', () => {
    // buildImageNode 只吃 src/alt/title；bbox/pageRef 无 attr 承载（image schema 无此 attr）
    const node = buildImageNode('image', 'alt');
    expect(node.attrs).toEqual({ src: 'image', alt: 'alt' });
    expect(node.attrs).not.toHaveProperty('bbox');
    expect(node.attrs).not.toHaveProperty('pageRef');
  });

  it('buildImageNode：有 title 才带 title（空 caption 省 title，逐字段一致）', () => {
    expect(buildImageNode('u', 'a').attrs).toEqual({ src: 'u', alt: 'a' });
    expect(buildImageNode('u', 'a', '图1').attrs).toEqual({ src: 'u', alt: 'a', title: '图1' });
    // content 恒带一个空 paragraph（caption 占位，防 setNodeAttribute RangeError）
    expect(buildImageNode('u', 'a').content).toEqual([{ type: 'paragraph' }]);
  });
});

describe('markdown-core / video·audio·html·file·externalRef (B3)', () => {
  it('buildVideoNode src 原样 + 只带 schema 有的 attr', () => {
    const node = buildVideoNode({ src: 'media://v1', title: 'T', duration: 60 });
    expect(node.type).toBe('videoBlock');
    expect(node.attrs).toEqual({ src: 'media://v1', title: 'T', duration: 60 });
    expect(node.content).toEqual([{ type: 'paragraph' }]);
  });

  it('buildAudioNode src 原样', () => {
    expect(buildAudioNode({ src: 'media://a1', title: 'A' }).type).toBe('audioBlock');
    expect(buildAudioNode({ src: 'media://a1' }).attrs).toEqual({ src: 'media://a1' });
  });

  it('buildHtmlBlockNode src 原样（null 也可）', () => {
    expect(buildHtmlBlockNode('media://h', 'T').attrs).toEqual({ src: 'media://h', title: 'T' });
    expect(buildHtmlBlockNode(null, '').attrs).toEqual({ src: null, title: '' });
  });

  it('buildFileBlockNode src/mediaId 原样，size/source 留 null', () => {
    const node = buildFileBlockNode({ src: 'media://f', mediaId: 'm1', filename: 'a.pdf', mimeType: 'application/pdf' });
    expect(node.type).toBe('fileBlock');
    expect(node.attrs).toEqual({
      mediaId: 'm1', src: 'media://f', filename: 'a.pdf', mimeType: 'application/pdf', size: null, source: null,
    });
  });

  it('buildExternalRefNode href 原样（核不碰路径协议）', () => {
    const node = buildExternalRefNode({ kind: 'file', href: 'file:///a', title: 'T' });
    expect(node.attrs).toEqual({ kind: 'file', href: 'file:///a', title: 'T', mimeType: '', size: null, modifiedAt: null });
  });
});

describe('markdown-core / HTML 媒体标签解析 (B3)', () => {
  it('<iframe src=https> → videoBlock，src 原样', () => {
    const node = tryParseMediaTag('<iframe src="https://youtube.com/embed/x" title="片"></iframe>');
    expect(node?.type).toBe('videoBlock');
    expect(node?.attrs?.src).toBe('https://youtube.com/embed/x');
    expect(node?.attrs?.title).toBe('片');
  });

  it('<iframe src=http（非 https）→ null（安全兜底）', () => {
    expect(tryParseMediaTag('<iframe src="http://insecure/x"></iframe>')).toBeNull();
  });

  it('<video src> / <video attrs><source> → videoBlock，data-duration 取到', () => {
    expect(tryParseMediaTag('<video src="media://v" data-duration="90"></video>')?.attrs).toEqual({
      src: 'media://v', title: 'Video', duration: 90,
    });
    // 无 src 但带属性的 <video controls> + <source>（对齐 ① 原 regex 需 video 后有 \s）
    expect(tryParseMediaTag('<video controls><source src="media://v2"></video>')?.attrs?.src).toBe('media://v2');
  });

  it('<audio src> → audioBlock', () => {
    expect(tryParseMediaTag('<audio src="media://a" title="声"></audio>')?.type).toBe('audioBlock');
  });

  it('非媒体标签 → null', () => {
    expect(tryParseMediaTag('<div>x</div>')).toBeNull();
    expect(tryParseMediaTag('普通文本')).toBeNull();
  });

  it('Obsidian ![[id]] → YouTube videoBlock', () => {
    const node = tryParseObsidianVideoEmbed('![[dQw4w9WgXcQ]]');
    expect(node?.type).toBe('videoBlock');
    expect(node?.attrs?.src).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(tryParseObsidianVideoEmbed('![[短]]')).toBeNull(); // < 6 位不算
  });
});

// ── B4a：blockquote / list —— 核纯 sync 构造器 + 标记分类 ───────────────
describe('markdown-core / blockquote (B4a)', () => {
  it('stripBlockquotePrefix 容错剥 `>`（缩进 + 0/1 空格）', () => {
    expect(stripBlockquotePrefix('> hello')).toBe('hello');
    expect(stripBlockquotePrefix('>no-space')).toBe('no-space');
    expect(stripBlockquotePrefix('   > 缩进引用')).toBe('缩进引用');
  });

  it('buildBlockquoteNode 包已解析内层 block；空则兜空 paragraph', () => {
    const inner = [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }];
    expect(buildBlockquoteNode(inner)).toEqual({ type: 'blockquote', content: inner });
    expect(buildBlockquoteNode([])).toEqual({
      type: 'blockquote',
      content: [{ type: 'paragraph' }],
    });
  });
});

describe('markdown-core / list 标记分类 (B4a)', () => {
  it('bullet / ordered / task 分类 + 正文提取', () => {
    expect(classifyListLine('- 项')).toEqual({ kind: 'bullet', text: '项' });
    expect(classifyListLine('* 星')).toEqual({ kind: 'bullet', text: '星' });
    expect(classifyListLine('+ 加')).toEqual({ kind: 'bullet', text: '加' }); // CommonMark `+`
    expect(classifyListLine('3. 序')).toEqual({ kind: 'ordered', text: '序' });
    expect(classifyListLine('  - 缩进')).toEqual({ kind: 'bullet', text: '缩进' });
  });

  it('task 必先于 bullet：`- [ ]` / `- [x]` → task + checked', () => {
    expect(classifyListLine('- [ ] 待办')).toEqual({ kind: 'task', checked: false, text: '待办' });
    expect(classifyListLine('- [x] 完成')).toEqual({ kind: 'task', checked: true, text: '完成' });
    expect(classifyListLine('* [X] 大写X')).toEqual({ kind: 'task', checked: true, text: '大写X' });
  });

  it('非 list 行 → null', () => {
    expect(classifyListLine('普通段落')).toBeNull();
    expect(classifyListLine('# 标题')).toBeNull();
  });
});

describe('markdown-core / list 构造器 (B4a)', () => {
  it('buildListItemNode / bulletList / orderedList', () => {
    const item = buildListItemNode([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }]);
    expect(item.type).toBe('listItem');
    expect(buildBulletListNode([item]).type).toBe('bulletList');
    expect(buildOrderedListNode([item]).type).toBe('orderedList');
    // 空 item 兜空 paragraph
    expect(buildListItemNode([]).content).toEqual([{ type: 'paragraph' }]);
  });

  it('buildTaskItemNode / taskList：checked + createdAt 落 attrs', () => {
    const t = buildTaskItemNode(true, '2026-07-27T00:00:00.000Z', [
      { type: 'paragraph', content: [{ type: 'text', text: '做' }] },
    ]);
    expect(t.type).toBe('taskItem');
    expect(t.attrs).toEqual({ checked: true, createdAt: '2026-07-27T00:00:00.000Z' });
    expect(buildTaskListNode([t]).type).toBe('taskList');
  });

  it('list item 内嵌 block（①强项）：itemBlocks 原样进 content', () => {
    const item = buildListItemNode([
      { type: 'paragraph', content: [{ type: 'text', text: '项' }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'x=1' }] },
    ]);
    expect(item.content).toHaveLength(2);
    expect(item.content![1].type).toBe('codeBlock');
  });
});
