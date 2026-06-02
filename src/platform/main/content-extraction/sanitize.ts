/**
 * sanitize — 清理 Defuddle 输出 Markdown 中的 HTML 噪音
 *
 * 纯字符串处理,**直接搬自** mirro fullpage-capture.ts sanitizeDefuddleMarkdown()。
 * Defuddle 会保留 SVG、自定义 HTML 标签等,下游 markdownToAtoms 无法处理,
 * 在送入前清洗。
 */

/**
 * 清理 Defuddle 输出的 Markdown 中的 HTML 噪音。
 */
export function sanitizeDefuddleMarkdown(markdown: string): string {
  let text = markdown;

  // 0. 移除内联 base64 图片数据(可能非常长,不适合存为文本)
  // 匹配 ![...](data:image/...) 和裸 (data:image/...) 格式
  text = text.replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, '');
  text = text.replace(/\(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]{100,}\)/g, '');
  // 移除残留的裸 data:image URI(超过 200 字符的)
  text = text.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]{200,}/g, '');

  // 1. 移除完整的 SVG 块(可能跨多行)
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, '');

  // 2. 移除 <style> 块
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // 3. 移除 <script> 块
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');

  // 4. 移除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 5. 保留可转换的 HTML 标签,移除其他 HTML 标签
  //    保留: <center>, <img>, <br>, <hr>, <pre>, <code>, <em>, <strong>, <a>, <math>
  //    移除: <div>, <span>, <section>, <nav>, <footer>, <header>, <marker>, <path> 等
  const keepTags = /^\/?(center|img|br|hr|pre|code|em|strong|a|math|sup|sub|table|thead|tbody|tr|td|th|iframe|video|audio|source|blockquote)(\s|>|\/)/i;
  text = text.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*\/?>/g, (match) => {
    if (keepTags.test(match.slice(1))) return match;
    return '';
  });

  // 6. 修复 Defuddle 代码块语言标记格式
  //    Defuddle 输出: ```\nmermaidflowchart LR(语言名被推到内容第一行,且紧跟代码)
  //    期望格式:       ```mermaid\nflowchart LR(语言名紧跟 fence,代码在下一行)
  //    只匹配两行:``` 行 + 下一行以已知语言名开头
  const knownLangs = 'mermaid|javascript|typescript|python|java|go|rust|cpp|csharp|ruby|php|swift|kotlin|sql|html|css|json|yaml|xml|bash|shell|sh|zsh|markdown|md|latex|tex|scala|perl|lua|dart|elixir|haskell|ocaml|clojure|lisp|graphql|toml|ini|dockerfile|makefile|cmake|nginx|apache|diff|plaintext|text';
  text = text.replace(
    new RegExp(`^(\`\`\`)\\n(${knownLangs})(.*)$`, 'gm'),
    (_, fence, lang, restOfLine) => {
      // restOfLine 可能为空(纯语言行)或紧跟代码(mermaidflowchart LR)
      if (restOfLine) {
        return `${fence}${lang}\n${restOfLine}`;
      }
      return `${fence}${lang}`;
    },
  );

  // 7. 清理多余空行(3个以上连续空行压缩为2个)
  text = text.replace(/\n{4,}/g, '\n\n\n');

  return text;
}
