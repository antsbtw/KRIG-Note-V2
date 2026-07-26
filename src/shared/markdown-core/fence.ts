/**
 * 代码块 fence 长度配对 —— B1 的核心「坑固化点」。
 *
 * 同一个嵌套 fence bug 在 ①(ResultParser.collectCodeBlock)②(markdownToProseMirror)
 * 各修过一次（2026-07-25）。本文件把两份已修实现合并为**唯一真源**：
 *
 * 契约（两个已知坑，契约测试锁死）：
 *  1. **嵌套 fence 按开栏 backtick 长度配对**：开栏 N 个 backtick（N≥3），闭栏起始连续
 *     backtick 数须 ≥N。否则 ````markdown 里内层 ```mermaid（3<4）会被误当闭栏 →
 *     产出空 codeBlock + 内容漏成正文。
 *  2. **闭栏只看「起始连续 backtick 数 ≥ 开栏」，不要求整行纯 backtick**：否则闭栏行带
 *     残留（``` 后跟空格/文字/语言标记）会被当正文 → 从首个 fence 一路吞到文末。
 *
 * 媒体本地化、markdown-wrapper 展开（①的 unwrapMarkdownWrapperBlocks）等**不在核内**，
 * 属各自外壳的前/后处理。核只按 fence 规则切出 { language, textContent }。
 */

export interface FencedCode {
  /** 开栏语言标记（首个空白前的 token），无则空串 */
  language: string;
  /** 代码正文（fence 之间各行以 \n 拼接，可为空串） */
  textContent: string;
  /** 消费到的下一行索引（已跳过闭栏行） */
  nextIndex: number;
}

/**
 * 判断 `lines[startIdx]` 是否为代码块开栏；是则解析到闭栏，返回 FencedCode。
 * 不是开栏返回 null（caller 继续尝试其它 block）。
 *
 * @param lines 全文按 \n 切的行数组
 * @param startIdx 当前行索引（疑似开栏）
 */
export function tryParseFencedCode(lines: string[], startIdx: number): FencedCode | null {
  const line = lines[startIdx];
  const openFence = line.trimStart().match(/^(`{3,})/);
  if (!openFence) return null;

  const openLen = openFence[1].length;
  // 语言 = 开栏 backtick 之后、首个空白前的 token（对齐 ② 现有行为）。
  const language = line.trimStart().slice(openLen).trim().split(/\s+/)[0] ?? '';

  const isClosingFence = (raw: string): boolean => {
    const m = raw.trimStart().match(/^(`{3,})/);
    return m !== null && m[1].length >= openLen;
  };

  const codeLines: string[] = [];
  let i = startIdx + 1;
  while (i < lines.length && !isClosingFence(lines[i])) {
    codeLines.push(lines[i]);
    i++;
  }
  i++; // 跳过闭栏行（若已到文末，i 越界不影响 caller 的 while 边界判断）

  return {
    language,
    textContent: codeLines.join('\n'),
    nextIndex: i,
  };
}
