/**
 * RangeInput — 数值范围输入框(编辑中用本地 state,失焦/回车时提交)
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/components/RangeInput.tsx`。
 * 零依赖,纯 UI。
 */

import React, { useState } from 'react';

export function RangeInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  if (!editing && text !== String(value)) {
    setText(String(value));
  }

  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (!isNaN(n) && isFinite(n)) {
      onCommit(n);
    } else {
      setText(String(value));
    }
  };

  return (
    <input
      className="mv-range-input"
      value={editing ? text : String(value)}
      onChange={(e) => { setEditing(true); setText(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        e.stopPropagation();
      }}
      onFocus={() => setEditing(true)}
    />
  );
}
