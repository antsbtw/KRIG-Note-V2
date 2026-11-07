/**
 * sections/FrameSection — 分帧(题意图 P2,2026-11-07)
 *
 * 设计稿 §3.3:帧列表(改那句话、删帧)+ 在当前帧后加一帧;点一行切到那一帧。
 * 在第 i 帧新画的对象默认从第 i 帧开始出现(面板里 inCurrentFrame)。
 */

import React from 'react';
import type { FrameEntry } from '../../types';

interface FrameSectionProps {
  frames: FrameEntry[] | undefined;
  framed: boolean;
  currentFrame: number;
  onSelectFrame: (i: number) => void;
  onStartFraming: () => void;
  onAddFrame: () => void;
  onRemoveFrame: (i: number) => void;
  onUpdateText: (i: number, text: string) => void;
}

export const FrameSection: React.FC<FrameSectionProps> = ({
  frames, framed, currentFrame, onSelectFrame, onStartFraming, onAddFrame, onRemoveFrame, onUpdateText,
}) => (
  <div className="mv-fl-section">
    <div className="mv-fl-section-title">分帧</div>
    {!framed ? (
      <button className="mv-fl-add-btn" onClick={onStartFraming} title="把这张图拆成几步讲,每一帧配一句话">
        + 分帧(一步步讲)
      </button>
    ) : (
      <>
        <div className="mv-fr-ann-list" style={{ maxHeight: 'none' }}>
          {frames!.map((f, idx) => {
            const i = idx + 1;
            return (
              <div
                key={f.id}
                className={`mv-fr-ann-item ${i === currentFrame ? 'mv-fr-ann-item--selected' : ''}`}
                onClick={() => onSelectFrame(i)}
                style={{ alignItems: 'center' }}
              >
                <span className="mv-fr-ann-label" style={{ minWidth: 22 }}>{i}</span>
                <input
                  className="mv-fr-prop-input"
                  style={{ flex: 1, minWidth: 0, width: 0, maxWidth: 'none' }}
                  value={f.text}
                  placeholder="这一帧配的话,如题目原句"
                  onClick={(e) => { e.stopPropagation(); onSelectFrame(i); }}
                  onChange={(e) => onUpdateText(i, e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <button
                  className="mv-fr-ann-del"
                  onClick={(e) => { e.stopPropagation(); onRemoveFrame(i); }}
                  title="删掉这一帧(只在这一帧出现的图形会挪到相邻的帧,不会被删)"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button className="mv-fl-add-btn" style={{ marginTop: 6 }} onClick={onAddFrame}>
          + 在第 {currentFrame} 帧后加一帧
        </button>
      </>
    )}
  </div>
);
