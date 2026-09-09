/**
 * ChatGPT 消息序列化行为快照 —— `buildChatGPTMessageBody` / `isChatGPTVisibleMessage`
 *
 * 同族文件说明见 `claude-conversation-query.test.ts`:为 Web 能力层重构钉安全网,
 * 只测行为(结构化消息进 → markdown body 出),不测实现。
 *
 * ⚠️ 覆盖边界(不含糊过去):
 *   `chatgpt-full-extraction.ts` 的 10 个内部函数里,`unwrapWidgets` / `normalizeMessage` /
 *   `walkMapping` / `chartWidgetToMarkdown` 等**均未导出**,唯一入口 `loadChatGPTConversation`
 *   需要真 `WebContents`(executeJavaScript 读页面 cache),vitest 里够不着。
 *   按铁律「不为测试改 export」,本文件只覆盖两个**已导出**的纯函数;
 *   未覆盖部分见交付报告的覆盖缺口一节。
 *
 * 这两个函数守的是 Note 落地质量:
 *  - `{{IMAGE_GROUP_N}}` 占位符必须在**原位置**换成图(错位 = 图文对不上)
 *  - 残留占位符**绝不能**漏进 Note(用户会看到 `{{IMAGE_GROUP_0}}` 字面量)
 *  - 工具调用消息(python / dalle.text2im)不计入可见轮次
 */
import { describe, it, expect } from 'vitest';
import {
  buildChatGPTMessageBody,
  isChatGPTVisibleMessage,
  type ChatGPTNormalizedMessage,
} from '@platform/main/ai/extractors/chatgpt-full-extraction';

function msg(over: Partial<ChatGPTNormalizedMessage> = {}): ChatGPTNormalizedMessage {
  return {
    id: 'm1',
    role: 'assistant',
    text: '',
    fileRefs: [],
    imageGroups: [],
    recipient: null,
    hidden: false,
    ...over,
  };
}

const emptyFiles = new Map<string, { dataUrl: string; mimeType: string }>();

function files(entries: Record<string, { dataUrl: string; mimeType: string }>) {
  return new Map(Object.entries(entries));
}

describe('buildChatGPTMessageBody —— 纯文本', () => {
  it('无图无文件时原样端出文本', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(msg({ text: '一段回答' }), emptyFiles);
    expect(body).toBe('一段回答');
    expect(artifactCount).toBe(0);
  });

  it('空消息产出空串(caller 据此跳过,不产空块)', () => {
    expect(buildChatGPTMessageBody(msg({ text: '' }), emptyFiles).body).toBe('');
    expect(buildChatGPTMessageBody(msg({ text: '   \n\n  ' }), emptyFiles).body).toBe('');
  });

  it('三个以上连续空行折叠成一个空行,首尾空白裁掉', () => {
    const { body } = buildChatGPTMessageBody(msg({ text: '\n\n上段\n\n\n\n下段\n\n' }), emptyFiles);
    expect(body).toBe('上段\n\n下段');
  });
});

describe('buildChatGPTMessageBody —— 代码块不被吃掉(project-markdown-import-unify)', () => {
  it('含嵌套 fence 的代码块逐字保留(不被折行/折空行规则破坏)', () => {
    const nested = '说明:\n\n````markdown\n```ts\nconst a = 1;\n```\n````';
    const { body } = buildChatGPTMessageBody(msg({ text: nested }), emptyFiles);
    expect(body).toBe(nested);
  });

  it('⚠️ 已知行为快照:代码块**内部**的连续空行也会被折叠', () => {
    // 这是 `body.replace(/\n{3,}/g, '\n\n')` 的既有行为(全文级替换,不区分是否在 fence 内)。
    // 钉下来是为了让重构**不会悄悄改变它** —— 若将来有意修,应连同本用例一起改并说明。
    const withBlankLines = '```ts\nconst a = 1;\n\n\n\nconst b = 2;\n```';
    const { body } = buildChatGPTMessageBody(msg({ text: withBlankLines }), emptyFiles);
    expect(body).toBe('```ts\nconst a = 1;\n\nconst b = 2;\n```');
  });
});

describe('buildChatGPTMessageBody —— image_group 占位符', () => {
  it('⭐ 图插在 {{IMAGE_GROUP_N}} 的**原位置**,不是追加到末尾', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(
      msg({ text: '前文\n\n{{IMAGE_GROUP_0}}\n\n后文', imageGroups: [['https://img/a.png']] }),
      emptyFiles,
    );
    expect(body).toBe('前文\n\n![](https://img/a.png)\n\n后文');
    expect(artifactCount).toBe(1);
  });

  it('多组图各就各位,不串组', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(
      msg({
        text: 'A\n\n{{IMAGE_GROUP_0}}\n\nB\n\n{{IMAGE_GROUP_1}}\n\nC',
        imageGroups: [['https://img/0.png'], ['https://img/1a.png', 'https://img/1b.png']],
      }),
      emptyFiles,
    );
    expect(body).toBe(
      'A\n\n![](https://img/0.png)\n\nB\n\n![](https://img/1a.png)\n\n![](https://img/1b.png)\n\nC',
    );
    expect(artifactCount).toBe(3);
  });

  it('⭐ 占位符多于实际图组时,残留占位符被删干净 —— 绝不漏进 Note', () => {
    const { body } = buildChatGPTMessageBody(
      msg({ text: '前\n\n{{IMAGE_GROUP_0}}\n\n中\n\n{{IMAGE_GROUP_1}}\n\n后', imageGroups: [['https://img/a.png']] }),
      emptyFiles,
    );
    expect(body).toContain('![](https://img/a.png)');
    expect(body).not.toContain('{{IMAGE_GROUP_');
    expect(body).toBe('前\n\n![](https://img/a.png)\n\n中\n\n后');
  });

  it('文本里根本没有占位符时,图组不会被凭空插入', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(
      msg({ text: '只有文字', imageGroups: [['https://img/a.png']] }),
      emptyFiles,
    );
    expect(body).toBe('只有文字');
    expect(artifactCount).toBe(1); // 计数按数据算,与是否落地无关(既有行为)
  });
});

describe('buildChatGPTMessageBody —— fileRefs(上传图 / DALL-E / Code Interpreter)', () => {
  it('图片文件追加到正文末尾,用 dataUrl', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(
      msg({ text: '看这张图', fileRefs: ['file_A'] }),
      files({ file_A: { dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png' } }),
    );
    expect(body).toBe('看这张图\n\n![file_A](data:image/png;base64,AAA)');
    expect(artifactCount).toBe(1);
  });

  it('非图片文件降级成 📎 文本条目,不当图片嵌', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(
      msg({ text: '附件', fileRefs: ['file_B'] }),
      files({ file_B: { dataUrl: 'data:application/pdf;base64,BBB', mimeType: 'application/pdf' } }),
    );
    expect(body).toBe('附件\n\n[📎 file_B (application/pdf)]');
    expect(artifactCount).toBe(1);
  });

  it('fileMap 里没有的 fileRef 被静默跳过,不产坏链接、不计数', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(
      msg({ text: '正文', fileRefs: ['file_MISSING'] }),
      emptyFiles,
    );
    expect(body).toBe('正文');
    expect(artifactCount).toBe(0);
  });

  it('正文为空但有图时,图就是全部内容(不留前导空行)', () => {
    const { body } = buildChatGPTMessageBody(
      msg({ text: '', fileRefs: ['file_A'] }),
      files({ file_A: { dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png' } }),
    );
    expect(body).toBe('![file_A](data:image/png;base64,AAA)');
  });

  it('多个文件按 fileRefs 顺序追加', () => {
    const { body, artifactCount } = buildChatGPTMessageBody(
      msg({ text: 'x', fileRefs: ['file_A', 'file_B'] }),
      files({
        file_A: { dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png' },
        file_B: { dataUrl: 'data:image/jpeg;base64,BBB', mimeType: 'image/jpeg' },
      }),
    );
    expect(body).toBe('x\n\n![file_A](data:image/png;base64,AAA)\n\n![file_B](data:image/jpeg;base64,BBB)');
    expect(artifactCount).toBe(2);
  });
});

describe('isChatGPTVisibleMessage —— 过滤工具调用', () => {
  it('user / assistant 且 recipient 为 all 或空 → 可见', () => {
    expect(isChatGPTVisibleMessage(msg({ role: 'user' }))).toBe(true);
    expect(isChatGPTVisibleMessage(msg({ role: 'assistant' }))).toBe(true);
    expect(isChatGPTVisibleMessage(msg({ role: 'assistant', recipient: 'all' }))).toBe(true);
  });

  it('⭐ 工具调用(recipient=python / dalle.text2im)不计入可见轮次', () => {
    expect(isChatGPTVisibleMessage(msg({ role: 'assistant', recipient: 'python' }))).toBe(false);
    expect(isChatGPTVisibleMessage(msg({ role: 'assistant', recipient: 'dalle.text2im' }))).toBe(false);
  });

  it('tool / system 角色不可见', () => {
    expect(isChatGPTVisibleMessage(msg({ role: 'tool' }))).toBe(false);
    expect(isChatGPTVisibleMessage(msg({ role: 'system' }))).toBe(false);
  });
});
