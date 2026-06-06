/**
 * expand-dirty-math — eBook PDF 导入专用兼容垫片(2026-06-05)
 *
 * 问题:glm-ocr-service(后端 OCR)有时把「公式 + 正文 + 行内公式」混合内容囫囵塞进
 * 一个 mathBlock 的 latex 字段,还留着 `$$` / `$` 分隔符,例如:
 *   "y = f[g(x)]$$，$x \in D_g$"
 *   "\lim_{x \to x_0} f(x) = f(x_0),$$  (8-2)"
 * 契约 v2.1 要求 mathBlock.latex 是纯 LaTeX(不含 `$$`/`$`),这些脏值喂给 KaTeX 会
 * 渲染报错变红。整本书 329 个公式里仅 ~7 个(2%)如此 —— OCR 漏网,非普遍。
 *
 * 本垫片在 PM 节点层(atomsToProseMirror 之后)扫 mathBlock,latex 含 `$` 的:
 *   1. 规范成合法 markdown(第一个 `$$` 之前是主公式 → `$$主公式$$`;之后混合内容
 *      原样接,它已含合法 `$inline$` / 正文;尾部纯编号 (N-N)/孤立标点剥掉)
 *   2. 走标准 markdownToProseMirror 重解 → mathBlock + paragraph(含 inline math)
 *   3. 用重解结果替换原脏 mathBlock 节点
 *
 * 设计意图(用户拍板):eBook 导入做一次数据清洗转成前端标准格式;未来后端 OCR
 * 产出干净 latex 后,本垫片整段可撤。纯净 mathBlock(98%)不触发,零影响。
 */

import { markdownToProseMirror } from '@capabilities/text-editing/converters/md-to-pm';
import type { PmPayload } from '@semantic/types';

/** 从 mathBlock PM 节点取 latex(content 是 [{type:'text', text: latex}])*/
function readMathLatex(node: PmPayload): string {
  if (node.type !== 'mathBlock') return '';
  const first = Array.isArray(node.content) ? node.content[0] : undefined;
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

/**
 * 把脏 latex(含 `$$`/`$`)规范成合法 markdown。
 * 规则见文件头;返回可直接喂 markdownToProseMirror 的字符串。
 */
function normalizeDirtyLatex(latex: string): string {
  const idx = latex.indexOf('$$');
  if (idx < 0) {
    // 不含 $$ 但含单 $(罕见)→ 整条当 markdown(可能是 inline 混合)
    return latex;
  }
  const head = latex.slice(0, idx).trim();
  let tail = latex.slice(idx + 2).trim();
  // 尾部剥纯公式编号 (N-N)
  tail = tail.replace(/\(\d+-\d+\)\s*$/, '').trim();
  // $$ 后只剩标点/空 → 纯公式块
  if (!tail || /^[,，.。;；]+$/.test(tail)) {
    return `$$${head}$$`;
  }
  // 有混合尾部:主公式包 $$,尾部原样接(已含 $inline$ / 正文)
  return `$$${head}$$\n\n${tail}`;
}

/**
 * 扫 PM 节点序列,展开脏 mathBlock(latex 含 `$`)为标准节点。
 * 纯净 mathBlock 及其它节点原样保留。返回新节点数组。
 */
export async function expandDirtyMathBlocks(nodes: PmPayload[]): Promise<PmPayload[]> {
  const out: PmPayload[] = [];
  for (const node of nodes) {
    const latex = readMathLatex(node);
    if (!latex || !latex.includes('$')) {
      out.push(node);
      continue;
    }
    // 脏 mathBlock:规范 → markdown 重解 → 替换
    try {
      const md = normalizeDirtyLatex(latex);
      const reparsed = (await markdownToProseMirror(md)) as unknown as PmPayload[];
      if (reparsed.length > 0) {
        out.push(...reparsed);
        continue;
      }
    } catch {
      /* 重解失败 → 回退原节点(至少不丢内容)*/
    }
    out.push(node);
  }
  return out;
}
