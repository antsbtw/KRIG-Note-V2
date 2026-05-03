# 已知问题：parseInlineMarkdown 不支持嵌套 inline 元素

> 创建日期：2026-04-21
> 影响范围：Claude / ChatGPT / Gemini 三平台提取
> 严重程度：中（公式显示不完整，但不影响文本内容）
> 建议修复分支：`fix/inline-nesting`

---

## 问题描述

`src/plugins/web-bridge/pipeline/result-parser.ts` 的 `parseInlineMarkdown()` 使用一个扁平正则一次性匹配所有 inline 元素（link、math、code、bold、italic），不支持嵌套。

当 bold 包裹 math 时（如 `**$e$**`），整体被匹配为 bold 文本 `$e$`，内部的 `$...$` 不会被识别为 math-inline。

## 复现场景

Gemini 返回的 Markdown：

```markdown
1. **$0$**：算术中的加法单位元。
2. **$1$**：算术中的乘法单位元。
3. **$e$**：微积分的基石，代表了自然增长。
4. **$\pi$**：几何学的核心，代表了圆的周长与直径之比。
5. **$i$**：复数的灵魂，将数字系统从一维数轴扩展到了二维复平面。
```

期望解析为：bold → math-inline（嵌套）

实际解析为：bold → 纯文本 `$0$`（丢失 math 语义）

## 根因

第 780 行的正则：

```javascript
const inlineRegex = /\[([^\]]+)\]\(([^)]+)\)|\$([^$\n]+)\$|`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
```

`\*\*([^*]+)\*\*` 会先匹配 `**$0$**`，把 `$0$` 作为 bold 的纯文本内容。后续不会对 bold 内容递归解析 inline 元素。

## 修复方向

`parseInlineMarkdown` 对 bold/italic 匹配结果递归调用自身，支持 inline 嵌套：

```typescript
// 当前
inlines.push({ type: 'bold', text: match[5] });

// 修复后
inlines.push({ type: 'bold', children: this.parseInlineMarkdown(match[5]) });
```

需要同步修改 `ExtractedInline` 类型和 `content-to-atoms.ts` 的转换逻辑。

## 影响的类型定义

- `src/shared/types/extraction-types.ts` — `ExtractedInline` 需要支持 children
- `src/plugins/web-bridge/pipeline/result-parser.ts` — `parseInlineMarkdown` 递归
- `src/plugins/web-bridge/pipeline/content-to-atoms.ts` — bold/italic 转 Atom 时处理 children
