/**
 * 静态守卫的公共工具 —— 读源码 / 剥注释 / 扫描命中
 *
 * 「静态守卫」= 把源码当**文本**读进来断言跨文件不变量的测试。它不 import 被测
 * 模块(那会触发运行时注册、还要 mock 一堆 Electron API),只做文本分析。
 * 适用于**类型系统管不了、违规又不会报错**的约束,例如:
 *
 * - 禁止各 view 重复实现槽分发(`slot-resource-guard.test.ts`)
 * - view 没有 NavSide 内容就必须声明 navSideDisabled(`navside-content-guard.test.ts`)
 *
 * ## ⚠️ 为什么必须剥注释(这一课被踩过两次)
 *
 * 守卫的文档注释里**经常故意写着反模式的样子**当反面教材,不剥注释就会把
 * 文档本身判成违规;反过来,view 的文档注释里写着正确声明的样子,不剥注释
 * 就会把注释当成真声明 —— 2026-08-28 的 navside 守卫第一版正是栽在后者:
 * 故意删掉真代码里的 `navSideDisabled` 做反向验证,守卫**依然全绿**,
 * 因为它匹配到了文件顶部注释里的那一行。
 *
 * 本模块存在的意义就是让这一课只需要学一次。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 剥掉块注释 / 行注释,但**保留行号**(把注释内容换成等量空白)。
 *
 * 保留行号是为了让失败信息能直接指到 `文件:行号` —— 「found 3 matches」式的
 * 报错没法指导修复,而守卫失败时开发者最需要的正是"去哪一行改"。
 *
 * 用字符状态机而非正则:正则版遇到**字符串里的 `//`**(URL、示例文本)会把
 * 后面的真实代码整段吃掉 —— 被吃掉的代码里若有违规,守卫就查不到,
 * 又是一次假保证。实测 `const s = "a // b"; const real = 1;` 经正则版处理后
 * `const real = 1;` 整段消失。
 */
export function stripComments(code: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'string' = 'code';
  let quote = '';
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        state = 'string';
        quote = c;
      }
      out += c;
      i++;
      continue;
    }
    if (state === 'string') {
      if (c === '\\') {
        out += c + (next ?? '');
        i += 2;
        continue;
      }
      if (c === quote) state = 'code';
      out += c;
      i++;
      continue;
    }
    // 注释中:只保留换行,其余替空格(行号不变)
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }
    // block
    if (c === '*' && next === '/') {
      state = 'code';
      out += '  ';
      i += 2;
      continue;
    }
    out += c === '\n' ? '\n' : ' ';
    i++;
  }
  return out;
}

/** 递归收集 .ts / .tsx 文件路径(跳过 .d.ts) */
export function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 递归读一个目录下全部 .ts/.tsx 的源码并拼接,**已剥注释**。
 *
 * 用于「这个目录里有没有出现过 X」式的判定(不关心具体在哪一行)。
 * 要定位到行号请用 {@link scanSources}。
 */
export function readSourcesConcat(dir: string): string {
  return collectSources(dir)
    .map((f) => stripComments(fs.readFileSync(f, 'utf-8')))
    .join('\n');
}

export interface Hit {
  /** repo 相对路径 */
  file: string;
  line: number;
  text: string;
}

/**
 * 在剥注释后的源码里逐行找 pattern,返回 repo 相对路径 + 行号 + 该行内容。
 *
 * @param repoRoot 用于把绝对路径换算成 repo 相对路径(失败信息更好读)
 */
export function scanSources(files: string[], pattern: RegExp, repoRoot: string): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, 'utf-8'));
    code.split('\n').forEach((line, idx) => {
      if (pattern.test(line)) {
        hits.push({
          file: path.relative(repoRoot, file),
          line: idx + 1,
          text: line.trim(),
        });
      }
      pattern.lastIndex = 0;
    });
  }
  return hits;
}

/** 把命中格式化成「文件:行号 + 该行内容」的多行文本(守卫失败信息用) */
export function formatHits(hits: Hit[]): string {
  return hits.map((h) => `  ${h.file}:${h.line}\n      ${h.text}`).join('\n');
}
