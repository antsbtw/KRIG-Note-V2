/**
 * FolderTree 视觉常量
 *
 * 1:1 沿用 V1 src/renderer/navside/components/FolderTree/styles.ts。
 */

import type { CSSProperties } from 'react';

export const TREE_ROW_HEIGHT = 28;
export const TREE_INDENT_PX = 16;

export const styles = {
  container: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    outline: 'none',
  } as CSSProperties,

  empty: {
    padding: '24px 16px',
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
  } as CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    height: TREE_ROW_HEIGHT,
    padding: '0 8px',
    cursor: 'pointer',
    userSelect: 'none',
    color: '#ccc',
    fontSize: 13,
    gap: 6,
  } as CSSProperties,

  rowHover: {
    background: 'rgba(255,255,255,0.05)',
  } as CSSProperties,

  rowSelected: {
    background: 'rgba(74, 144, 226, 0.25)',
    color: '#fff',
  } as CSSProperties,

  rowDropTarget: {
    background: 'rgba(74, 144, 226, 0.18)',
    outline: '1px dashed rgba(74, 144, 226, 0.6)',
    outlineOffset: -1,
  } as CSSProperties,

  caret: {
    width: 12,
    color: '#888',
    fontSize: 10,
    flexShrink: 0,
    textAlign: 'center',
  } as CSSProperties,

  icon: {
    width: 18,
    flexShrink: 0,
    fontSize: 14,
    textAlign: 'center',
  } as CSSProperties,

  title: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,

  rightHint: {
    flexShrink: 0,
    color: '#666',
    fontSize: 10,
    paddingLeft: 8,
  } as CSSProperties,
};
