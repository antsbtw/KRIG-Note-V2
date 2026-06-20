/**
 * Text section(L5-G5 / G5.5)— B/I/U + 对齐 + 列表 + 文字色
 *
 * **纯复用 note 既有 mark/命令**(G5-4 红线):全部走 ctx.runTextCommand,对整文字
 * 节点 doc 生效(view → text-editing.runNodeStyleCommand headless 改 doc)。
 *
 * ★ 面板内**无字号、无字体** —— note 原生模型就没有,刻意不放,保 note 复用菜单零污染。
 *   字号/字体是独立的 Type section(画板专属 instance 字段)。
 */

import type { SectionContext, SectionDef } from '../../types';

function TextPanel(ctx: SectionContext): React.ReactElement {
  const run = ctx.runTextCommand;
  return (
    <div>
      {/* B / I / U */}
      <div className="krig-node-toolbar__row">
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="加粗"
          style={{ fontWeight: 700 }}
          onClick={() => run({ kind: 'toggleMark', mark: 'bold' })}
        >
          B
        </button>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="斜体"
          style={{ fontStyle: 'italic' }}
          onClick={() => run({ kind: 'toggleMark', mark: 'italic' })}
        >
          I
        </button>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="下划线"
          style={{ textDecoration: 'underline' }}
          onClick={() => run({ kind: 'toggleMark', mark: 'underline' })}
        >
          U
        </button>
        <input
          type="color"
          className="krig-node-toolbar__color-input"
          title="文字颜色"
          defaultValue="#ffffff"
          onChange={(e) => run({ kind: 'setTextColor', color: e.target.value })}
        />
      </div>
      {/* 对齐 */}
      <div className="krig-node-toolbar__row">
        <span className="krig-node-toolbar__label">对齐</span>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="左对齐"
          onClick={() => run({ kind: 'setAlign', align: 'left' })}
        >
          ⬅
        </button>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="居中"
          onClick={() => run({ kind: 'setAlign', align: 'center' })}
        >
          ⬌
        </button>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="右对齐"
          onClick={() => run({ kind: 'setAlign', align: 'right' })}
        >
          ➡
        </button>
      </div>
      {/* 列表 */}
      <div className="krig-node-toolbar__row">
        <span className="krig-node-toolbar__label">列表</span>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="无序列表"
          onClick={() => run({ kind: 'toggleList', list: 'bullet' })}
        >
          •≡
        </button>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="有序列表"
          onClick={() => run({ kind: 'toggleList', list: 'ordered' })}
        >
          1≡
        </button>
      </div>
    </div>
  );
}

export const textSection: SectionDef = {
  id: 'text',
  title: '文字',
  icon: () => <span aria-hidden style={{ fontWeight: 600 }}>Aa</span>,
  Panel: TextPanel,
};
