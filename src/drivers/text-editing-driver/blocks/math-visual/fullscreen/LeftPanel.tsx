/**
 * fullscreen/LeftPanel — 全屏模式左侧面板(sections 组合外壳)
 *
 * 职责拆为 4 个 section:
 * - FunctionListSection — 函数列表 + 添加/编辑(走 ExpressionDialog)
 * - ParametersSection — 参数滑块 + 动画播放
 * - ToolbarSection — 7 件工具按钮
 * - ExportSection — 导出三件套
 *
 * 函数 CRUD 经 useFunctionManagement hook 统一(SSOT,inline 待 PR4 复用)。
 * LeftPanel 自身仅做"数据流装配 + props 转发",不持业务状态。
 */

import React from 'react';
import type { MathVisualData, ToolMode, ShapeKind } from '../types';
import { useFunctionManagement } from '../hooks/useFunctionManagement';
import { FunctionListSection } from './sections/FunctionListSection';
import { ParametersSection } from './sections/ParametersSection';
import { ToolbarSection } from './sections/ToolbarSection';
import { ExportSection } from './sections/ExportSection';
import { ShapeSection } from './sections/ShapeSection';
import { ViewSection } from './sections/ViewSection';
import { FrameSection } from './sections/FrameSection';

interface LeftPanelProps {
  data: MathVisualData;
  onChange: (data: MathVisualData) => void;
  toolMode: ToolMode;
  onToolChange: (mode: ToolMode) => void;
  onExport: (mode: 'copy' | 'download') => void;
  onExportSvg: () => void;
  onRerunFeatures: () => void;
  animating: { paramName: string; speed: number } | null;
  onStartAnimation: (paramName: string, speed?: number) => void;
  onStopAnimation: () => void;
  // 几何对象(题意图 P1)
  shapeKind: ShapeKind;
  onPickShapeKind: (kind: ShapeKind) => void;
  shapeErrors: Record<string, string>;
  selectedShapeIds: string[];
  onSelectShape: (id: string, additive: boolean) => void;
  onRemoveShape: (id: string) => void;
  onShapeContextMenu: (id: string, x: number, y: number) => void;
  // 分帧(题意图 P2)
  framed: boolean;
  currentFrame: number;
  onSelectFrame: (i: number) => void;
  onStartFraming: () => void;
  onAddFrame: () => void;
  onRemoveFrame: (i: number) => void;
  onUpdateFrameText: (i: number, text: string) => void;
}

export const LeftPanel: React.FC<LeftPanelProps> = ({
  data,
  onChange,
  toolMode,
  onToolChange,
  onExport,
  onExportSvg,
  onRerunFeatures,
  animating,
  onStartAnimation,
  onStopAnimation,
  shapeKind,
  onPickShapeKind,
  shapeErrors,
  selectedShapeIds,
  onSelectShape,
  onRemoveShape,
  onShapeContextMenu,
  framed,
  currentFrame,
  onSelectFrame,
  onStartFraming,
  onAddFrame,
  onRemoveFrame,
  onUpdateFrameText,
}) => {
  const fnMgmt = useFunctionManagement(data, onChange);

  return (
    <div className="mv-fullscreen-left">
      <FunctionListSection
        functions={data.functions}
        insertFromHelp={fnMgmt.insertFromHelp}
        updateFunction={fnMgmt.updateFunction}
        removeFunction={fnMgmt.removeFunction}
        allowRemoveLast={(data.shapes?.length ?? 0) > 0}
      />
      <ShapeSection
        shapes={data.shapes ?? []}
        errors={shapeErrors}
        toolMode={toolMode}
        shapeKind={shapeKind}
        onPickKind={onPickShapeKind}
        selectedShapeIds={selectedShapeIds}
        onSelectShape={onSelectShape}
        onRemoveShape={onRemoveShape}
        onContextMenu={onShapeContextMenu}
      />
      <ParametersSection
        parameters={data.parameters}
        updateParameter={fnMgmt.updateParameter}
        animating={animating}
        onStartAnimation={onStartAnimation}
        onStopAnimation={onStopAnimation}
      />
      <ToolbarSection
        toolMode={toolMode}
        onToolChange={onToolChange}
        onRerunFeatures={onRerunFeatures}
      />
      <FrameSection
        frames={data.frames}
        framed={framed}
        currentFrame={currentFrame}
        onSelectFrame={onSelectFrame}
        onStartFraming={onStartFraming}
        onAddFrame={onAddFrame}
        onRemoveFrame={onRemoveFrame}
        onUpdateText={onUpdateFrameText}
      />
      <ViewSection data={data} onChange={onChange} />
      <ExportSection onExport={onExport} onExportSvg={onExportSvg} />
    </div>
  );
};
