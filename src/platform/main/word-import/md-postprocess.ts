/**
 * markdown 后处理 — mammoth/pandoc 转出后的共用清洗
 *
 * 当前职责:
 * - splitImageWithTrailingText:把 `![](data:image/...;base64,...)文字` 这种
 *   "图后紧贴文字" 拆成"图独占一行 + 空行 + 文字独占一行"。
 *
 *   背景:V2 md-to-pm parser 的 block image regex 要求 `^!\[..\](..)\s*$`,
 *   一旦图后面紧贴文字(常见于 docx 里图 + caption 同段落)整行 image 匹配失败,
 *   退回当 raw text 渲染 → 用户看到一大坨 base64 字面字符串
 *   (2026-05-28 反馈,实测 120 张图 1 张踩坑)。
 */

/**
 * 把含 inline base64 image 的行拆成"图独占行"的合规结构。
 *
 * V2 md-to-pm parser 的 block image regex 要求 `^!\[..\](..)\s*$` 即图独占整行;
 * mammoth/pandoc 偶发产出图前/后紧贴文字的形态(docx caption 与图同段同 run),
 * 命中后整行退化成 raw text → 用户看到 base64 字面字符串。
 *
 * 处理三种模式(都用同一 regex 提取):
 *   1. `LEADING![..](data:..)`           → LEADING / image
 *   2. `![..](data:..)TRAILING`          → image / TRAILING
 *   3. `LEADING![..](data:..)TRAILING`   → LEADING / image / TRAILING
 *   4. `![..](data:..)![..](data:..)`    → 多图同行(罕见但也拆)
 *
 * 仅处理 src 是 data:image 的 inline base64 图;其他形态不动。
 */
export function splitImageWithTrailingText(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  const imgPattern = /!\[[^\]]*\]\(data:image\/[a-zA-Z+-]+;base64,[A-Za-z0-9+/=]+\)/g;

  for (const line of lines) {
    if (!imgPattern.test(line)) {
      out.push(line);
      continue;
    }
    imgPattern.lastIndex = 0; // reset stateful regex

    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch ? indentMatch[1] : '';

    // 找出所有 image 在该行的范围,然后切片(prefix / img / between / img / suffix)
    const parts: string[] = [];
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = imgPattern.exec(line)) !== null) {
      const before = line.slice(lastEnd, m.index);
      const beforeTrim = before.trim();
      if (beforeTrim) parts.push(beforeTrim);
      parts.push(m[0]);
      lastEnd = m.index + m[0].length;
    }
    const tail = line.slice(lastEnd).trim();
    if (tail) parts.push(tail);

    // 如果只有 1 个 part 且就是 image 自己,原样;否则按 image 独占行结构输出
    if (parts.length === 1) {
      out.push(line);
      continue;
    }
    // 多 part:每段一行,段间空行(让 PM 当独立 block 处理)
    parts.forEach((p, i) => {
      if (i > 0) out.push('');
      out.push(`${indent}${p}`);
    });
  }

  return out.join('\n');
}
