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
import type { MathVisualData, ToolMode } from '../types';
import { useFunctionManagement } from '../hooks/useFunctionManagement';
import { FunctionListSection } from './sections/FunctionListSection';
import { ParametersSection } from './sections/ParametersSection';
import { ToolbarSection } from './sections/ToolbarSection';
import { ExportSection } from './sections/ExportSection';

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
}) => {
  const fnMgmt = useFunctionManagement(data, onChange);

  return (
    <div className="mv-fullscreen-left">
      <FunctionListSection
        functions={data.functions}
        insertFromHelp={fnMgmt.insertFromHelp}
        updateFunction={fnMgmt.updateFunction}
        removeFunction={fnMgmt.removeFunction}
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
      <ExportSection onExport={onExport} onExportSvg={onExportSvg} />
    </div>
  );
};
