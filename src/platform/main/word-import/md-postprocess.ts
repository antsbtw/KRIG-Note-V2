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
 * 拆 `![](data:image/...)trailing-text` → 图独占一行 + 空行 + trailing-text 独占一行
 *
 * 仅处理 src 是 data:image 的 inline base64 图(导入 pipeline 唯一出现的形态)。
 * 不动其他形态(外部 URL / 文件路径 / 已经独占的图)。
 *
 * 规则:整行以 `![..](data:image..)` 开头,后面还有非空白字符 → 拆。
 */
export function splitImageWithTrailingText(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    // 整行以 image 开头?(允许行首 0..N 空白)
    const m = /^(\s*)(!\[[^\]]*\]\(data:image\/[a-zA-Z+-]+;base64,[A-Za-z0-9+/=]+\))(.+)$/.exec(line);
    if (m) {
      const [, indent, imgPart, trailing] = m;
      const trailingTrim = trailing.trim();
      // 尾部全是空白 / 标点之类无意义符号 → 不拆(就让原行原样)
      if (!trailingTrim) {
        out.push(line);
        continue;
      }
      out.push(`${indent}${imgPart}`);
      out.push('');
      out.push(`${indent}${trailingTrim}`);
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}
