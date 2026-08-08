/**
 * per-slot 资源抽象 —— 守卫测试
 *
 * 抽象层(`src/workspace/workspace-state/slot-resource.ts`)只是「提供了正确的路」,
 * 本测试是「堵死错误的路」。用户诉求原话:
 *
 * > 确保未来不会各个 view 之间再单独绑定 navSide。
 *
 * 没有守卫的话,第三个 view(Web / Graph)接 per-slot 时会照着 note / eBook 再抄
 * 第三遍 —— note→eBook 那次就重踩了三个坑(✕ 关错栏 / 删资源只清 left /
 * 右键取错资源),平行实现不会自动继承前一份的修复。
 *
 * ## 两条断言
 *
 * 1. **禁止重复实现槽分发** —— `slot === 'right' ? … : …` 只允许在 slot-resource 层内
 * 2. **禁止靠 slotBinding 反推「我在哪一栏」** —— 见 memory `project-dont-guess-own-slot`
 *
 * ## 为什么要剥注释
 *
 * 两份 data-model 的文档里**故意**写着反模式的样子("各处不要自己写 `slot === 'right' ? …`")。
 * 那是教学用的反面例子,不剥注释就会把文档本身判成违规 —— 守卫必须只看真代码。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '../../src');

/** 递归收集 .ts / .tsx(跳过 .d.ts)*/
function collectSources(dir: string): string[] {
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
 * 剥掉块注释 / 行注释,但**保留行号**(把注释内容换成等量空白)。
 *
 * 保留行号是为了让失败信息能直接指到文件:行号 —— 「found 3 matches」式的报错
 * 没法指导修复,而这条测试失败时开发者需要的正是"去哪一行改"。
 */
function stripComments(code: string): string {
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

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** 在剥注释后的源码里逐行找 pattern,返回 repo 相对路径 + 行号 */
function scan(files: string[], pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, 'utf-8'));
    code.split('\n').forEach((line, idx) => {
      if (pattern.test(line)) {
        hits.push({
          file: path.relative(path.resolve(__dirname, '../..'), file),
          line: idx + 1,
          text: line.trim(),
        });
      }
      pattern.lastIndex = 0;
    });
  }
  return hits;
}

function format(hits: Hit[]): string {
  return hits.map((h) => `  ${h.file}:${h.line}\n      ${h.text}`).join('\n');
}

const ALL_SOURCES = collectSources(SRC);
const VIEW_SOURCES = ALL_SOURCES.filter((f) => f.includes(`${path.sep}views${path.sep}`));

describe('slot-resource 守卫 — 禁止重复实现槽分发', () => {
  /**
   * 槽分发的唯一合法实现处。这里**必须**有 `slot === 'right' ? … : …` ——
   * 抽象的全部价值就是"全仓只此一处"。
   */
  const SLOT_DISPATCH_OWNER = path.join(SRC, 'workspace', 'workspace-state', 'slot-resource.ts');

  it('`slot === \'right\' ? … : …` 不得出现在 src/views/**', () => {
    const hits = scan(VIEW_SOURCES, /slot\s*===\s*['"]right['"]\s*\?/);
    expect(
      hits.length,
      hits.length === 0
        ? ''
        : `\n发现 ${hits.length} 处在 view 层自行实现槽分发:\n${format(hits)}\n\n` +
          `→ 改用 workspace-state/slot-resource:\n` +
          `    const res = declareSlotResource<T>({ name, storeKey, leftField, rightField, fallback });\n` +
          `    res.get(ws, slot)                       // 读\n` +
          `    writePersistent(wsId, res.patch(slot, v)) // 写\n` +
          `  「哪个槽持有哪个资源」的字段分发只允许存在于 slot-resource 层内部 ——\n` +
          `  note→eBook 抄第二遍时重踩了三个坑,不要抄第三遍。\n`,
    ).toBe(0);
  });

  it('对侧槽三元式 `=== \'right\' ? \'left\' : \'right\'` 全仓只允许在 otherSlot() 内', () => {
    const offenders = ALL_SOURCES.filter((f) => f !== SLOT_DISPATCH_OWNER);
    const hits = scan(offenders, /===\s*['"]right['"]\s*\?\s*['"]left['"]\s*:\s*['"]right['"]/);
    expect(
      hits.length,
      hits.length === 0
        ? ''
        : `\n发现 ${hits.length} 处自行求对侧槽:\n${format(hits)}\n\n` +
          `→ 改用 otherSlot(slot)(workspace-state/slot-resource)。\n`,
    ).toBe(0);
  });

  it('slot-resource 层自身确实持有该分发(守卫的锚点还在)', () => {
    // 反向断言:若哪天有人把 slot-resource 删了 / 掏空了,上面两条会"因为无事可查
    // 而全绿",守卫静默失效。这条钉住锚点 —— 抽象层没了要立刻变红。
    const code = stripComments(fs.readFileSync(SLOT_DISPATCH_OWNER, 'utf-8'));

    // 分开钉两件事:**字段分发**(leftField/rightField)与**对侧槽**(otherSlot)。
    // 合成一条 /slot === 'right' ?/ 是不够的 —— 两者都能满足它,删掉任一条另一条
    // 仍让断言为真(实测:掏空 fieldFor 后本测仍绿)。守卫本身也要能真的失败。
    expect(
      /slot\s*===\s*['"]right['"]\s*\?\s*spec\.rightField\s*:\s*spec\.leftField/.test(code),
      'slot-resource 的字段分发(fieldFor)已不见 —— 抽象层被掏空,守卫将静默失效',
    ).toBe(true);
    expect(
      /slot\s*===\s*['"]right['"]\s*\?\s*['"]left['"]\s*:\s*['"]right['"]/.test(code),
      'slot-resource 的 otherSlot 已不见 —— 对侧槽守卫将无处可依',
    ).toBe(true);

    // 两个 view 确实各自 declare 了(而不是绕过本层自己写字段名)
    for (const [file, field] of [
      ['src/views/note/data-model.ts', 'activeNoteId'],
      ['src/views/ebook/data-model.ts', 'activeBookId'],
    ]) {
      const viewCode = stripComments(
        fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf-8'),
      );
      expect(
        new RegExp(`declareSlotResource[\\s\\S]{0,400}leftField:\\s*['"]${field}['"]`).test(
          viewCode,
        ),
        `${file} 未经 declareSlotResource 声明 ${field} —— 是否又绕过抽象层自己写了字段分发?`,
      ).toBe(true);
    }
  });
});

describe('slot-resource 守卫 — 禁止靠 slotBinding 反推「我在哪一栏」', () => {
  /**
   * 反模式(memory `project-dont-guess-own-slot`):
   *
   * ```ts
   * if (ws.slotBinding.right === 'note-view') bus.slot.closeRight();
   * else bus.slot.closeLeft();
   * ```
   *
   * 左右**双开同一 view** 时 `right === 'xxx-view'` 对两个实例都成立 → 点左栏的 ✕
   * 关掉右栏。信息方向搞反了:slotBinding 回答「哪个槽装了什么 view」,
   * 不能反过来回答「我这个实例在哪个槽」。
   *
   * ## 白名单:为什么不是一刀切禁 slotBinding
   *
   * `slotBinding.left === 'x-view'` 有两种截然不同的用法:
   *
   * - ✗ **反推自身槽位** —— 本守卫要禁的
   * - ✓ **查询布局**「某 view 是否在场 / 当前是不是某种左右组合」—— 与"我在哪一栏"
   *   无关,双开也不会误判,是合法问题
   *
   * 一刀切会把后者一起禁掉,逼出一堆无意义的绕道写法。故按**用途**白名单,
   * 每条注明理由;新增白名单需在此说明为什么它不是"反推自身槽位"。
   */
  const WHITELIST: Record<string, string> = {
    // ── 查询布局:某 view 是否在场(与"我在哪一栏"无关)──
    'src/views/note/note-commands.ts':
      'ensureNoteViewActive:查「note-view 是否已在任一槽」,不在才装 left。问的是在场性。',
    'src/views/web/web-commands.ts':
      'web view 已在任一槽就复用那一栏(否则会挤成分栏);pin-left 搬栏。问的是在场性与目标布局。',
    'src/views/x/x-commands.ts':
      'noteIsOpen:查「有没有 Note 在场」作为提取落点的前置条件。问的是在场性。',
    'src/views/ai/ai-commands.ts':
      '查 left=ai + right=note 这一**特定左右组合**(ai-sync 专用布局),非自身槽位。',
    'src/views/note/ai-sync-integration.ts':
      'matchesAISyncCombo:同上,匹配 left=ai + right=note 组合。反向组合刻意不触发。',
    // ── 真·自身槽位,但已有正解或属既有债 ──
    'src/views/note/note-commands.ts:close':
      'close 命令:已优先 getInvokingSlot(),仅在无调用栈上下文(快捷键/程序调用)时回落猜测。',
  };

  /**
   * **已知债** —— 确实是反模式,但尚未 per-slot 化的 view,本轮不在改造范围内。
   *
   * 本轮(2026-08-08)只抽 note + eBook 两份已存在的平行实现。Web / Social / X-Inbox
   * 至今**没接 slot prop**(`ViewComponentProps.slot` 由 SlotArea 传了,这三个 view 丢掉),
   * 要修得先给它们做 per-slot 化 —— 那是独立立项,不是本次重构的一部分。
   *
   * 为什么写成**逐条精确清单**而不是并进上面的 WHITELIST:
   * WHITELIST 表示"这样写是对的",而这里表示"这样写是错的,只是还没轮到修"。
   * 两者混在一起,债就被漂白成了合法用法 —— 那正是本次要消灭的东西。
   *
   * 清单被逐条锁死(下方断言按 file:line 精确比对):
   * - 新增违规 → 红(守卫仍然有效)
   * - 修好一条 → 也红,提示把它从清单删掉(债只减不增)
   *
   * 修法见 memory `project-dont-guess-own-slot`:槽由上层显式传入,view 用 slot prop。
   */
  const KNOWN_DEBT: readonly string[] = [
    'src/views/social/SocialView.tsx:54', // isInRightSlot:双开时两个实例都会认领
    'src/views/web/WebView.tsx:85', // isTranslateMode
    'src/views/web/WebView.tsx:429', // handleClose:✕ 关错栏(与 note c7720f37 同形)
    'src/views/web/WebView.tsx:441', // handleToggleTranslate
    'src/views/x-inbox/XInboxView.tsx:469', // isInRightSlot
  ];

  it('view 层不得用 slotBinding 反推自身槽位(白名单 + 已知债外零命中)', () => {
    const pattern = /slotBinding\s*\.\s*(left|right)\s*===/;
    const hits = scan(VIEW_SOURCES, pattern)
      .filter((h) => !Object.keys(WHITELIST).some((w) => h.file === w || h.file === w.split(':')[0]))
      .filter((h) => !KNOWN_DEBT.includes(`${h.file}:${h.line}`));
    expect(
      hits.length,
      hits.length === 0
        ? ''
        : `\n发现 ${hits.length} 处疑似靠 slotBinding 反推自身槽位:\n${format(hits)}\n\n` +
          `→ 槽必须由**上层显式传入**,不许自行推导:\n` +
          `    view 组件  ← SlotArea 传的 slot prop(ViewComponentProps.slot)\n` +
          `    命令       ← getInvokingSlot() ?? getActiveSlot(wsId)\n` +
          `    IPC        ← payload 带 { wsId, slot }\n` +
          `  双开同一 view 时 slotBinding.right === 'xxx-view' 对两个实例都成立,\n` +
          `  据此判断会关错栏 / 取错资源(note 与 eBook 已各踩一次)。\n` +
          `  若这处确实是在查「某 view 是否在场 / 某左右组合」而非自身槽位,\n` +
          `  请加进本测试的 WHITELIST 并注明理由。\n`,
    ).toBe(0);
  });

  it('已知债清单逐条锁死 —— 修好一条就要删一条(债只减不增)', () => {
    const pattern = /slotBinding\s*\.\s*(left|right)\s*===/;
    const actual = new Set(
      scan(VIEW_SOURCES, pattern)
        .filter((h) =>
          !Object.keys(WHITELIST).some((w) => h.file === w || h.file === w.split(':')[0]),
        )
        .map((h) => `${h.file}:${h.line}`),
    );
    const stale = KNOWN_DEBT.filter((d) => !actual.has(d));
    expect(
      stale,
      stale.length === 0
        ? ''
        : `\n已知债清单里这些条目已不再命中:\n  ${stale.join('\n  ')}\n\n` +
          `→ 若已修好(该 view 接了 slot prop / 改用显式传槽),请把它从 KNOWN_DEBT 删掉。\n` +
          `  若只是行号漂移,请更新行号 —— 清单必须与现实精确对齐,否则它会\n` +
          `  在下一处真违规出现时误放行。\n`,
    ).toEqual([]);
  });

  it('白名单只含确实存在的文件(防止条目腐烂后守卫静默放行)', () => {
    for (const key of Object.keys(WHITELIST)) {
      const file = key.split(':')[0];
      expect(fs.existsSync(path.resolve(__dirname, '../..', file)), `白名单条目已失效:${file}`).toBe(
        true,
      );
    }
  });
});
