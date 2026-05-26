/**
 * hooks/useFunctionManagement — 函数 CRUD + 自动重算参数集
 *
 * SSOT(单一真相源):全屏 LeftPanel 与 inline MathVisualComponent 应当共用。
 * 本 phase(PR3 Phase 2)仅 LeftPanel 接入,inline 待 PR4。
 *
 * 内部职责:
 * - 每次表达式变更走 capability.detectPlotType 归一化(plotType + expression +
 *   displayExpression)
 * - 每次 fns 变 → 重新 extractParameters 收集所有 free symbol → 合并保留原值
 * - addFunction / removeFunction / updateParameter / insertFromHelp(help-panel
 *   插入,自带 sourceLatex)
 *
 * **不**包含:compiledFns / curves(渲染派生 — 含 domain/canvas 依赖,inline 与全屏
 * 视图层不完全一致;Phase 3 在 sections 内消费 fns/parameters 自行编译)
 */

import { useCallback } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MathRenderingApi } from '@capabilities/math-rendering/types';
import type { MathVisualData, FunctionEntry, Parameter } from '../types';
import { createFunctionEntry } from '../types';

export interface UseFunctionManagementResult {
  /** 添加一条空函数(label/color 自动按当前 fns.length 分配) */
  addFunction: () => void;
  /** 更新某条函数;若 updates.expression 变化,自动 detectPlotType + 重算参数集 */
  updateFunction: (id: string, updates: Partial<FunctionEntry>) => void;
  /** 删除函数(至少保留 1 条;同时清理依附该 fn 的 annotations) */
  removeFunction: (id: string) => void;
  /** 更新单个参数值 */
  updateParameter: (name: string, value: number) => void;
  /** help-panel Insert:接 raw expression → 新建 + detectPlotType + 重算参数集 */
  insertFromHelp: (expr: string) => void;
}

export function useFunctionManagement(
  data: MathVisualData,
  onChange: (data: MathVisualData) => void,
): UseFunctionManagementResult {
  const math = requireCapabilityApi<MathRenderingApi>('math-rendering');
  const { functions: fns, parameters, annotations } = data;

  const recomputeParameters = useCallback(
    (newFns: FunctionEntry[]): Parameter[] => {
      const allExprs = newFns
        .filter((f) => f.plotType !== 'vertical-line')
        .map((f) => f.expression);
      const allVarNames = new Set<string>();
      for (const expr of allExprs) {
        for (const v of math.extractParameters(expr)) allVarNames.add(v);
      }
      const newParams: Parameter[] = [];
      for (const name of allVarNames) {
        const existing = parameters.find((p) => p.name === name);
        newParams.push(existing || { name, value: 1, min: -5, max: 5, step: 0.1 });
      }
      return newParams;
    },
    [parameters, math],
  );

  const updateFunction = useCallback(
    (id: string, updates: Partial<FunctionEntry>) => {
      let nextUpdates = updates;
      if (updates.expression !== undefined) {
        const detected = math.detectPlotType(updates.expression);
        nextUpdates = {
          ...updates,
          plotType: detected.plotType,
          expression: detected.expression,
        };
      }

      const newFns = fns.map((f) => (f.id === id ? { ...f, ...nextUpdates } : f));

      if (updates.expression !== undefined) {
        const newParams = recomputeParameters(newFns);
        onChange({ ...data, functions: newFns, parameters: newParams });
      } else {
        onChange({ ...data, functions: newFns });
      }
    },
    [data, fns, onChange, math, recomputeParameters],
  );

  const addFunction = useCallback(() => {
    const newFn = createFunctionEntry(fns.length);
    onChange({ ...data, functions: [...fns, newFn] });
  }, [data, fns, onChange]);

  const removeFunction = useCallback(
    (id: string) => {
      if (fns.length <= 1) return;
      const newFns = fns.filter((f) => f.id !== id);
      const newAnns = annotations.filter((a) => a.functionId !== id);
      onChange({ ...data, functions: newFns, annotations: newAnns });
    },
    [data, fns, annotations, onChange],
  );

  const updateParameter = useCallback(
    (name: string, value: number) => {
      const newParams = parameters.map((p) =>
        p.name === name ? { ...p, value } : p,
      );
      onChange({ ...data, parameters: newParams });
    },
    [data, parameters, onChange],
  );

  const insertFromHelp = useCallback(
    (expr: string) => {
      const newFn = createFunctionEntry(fns.length, expr);
      const detected = math.detectPlotType(expr);
      newFn.plotType = detected.plotType;
      newFn.expression = detected.expression;
      if (detected.plotType === 'parametric') {
        newFn.label = newFn.label.replace('(x)', '(t)');
      }
      const allFns = [...fns, newFn];
      const newParams = recomputeParameters(allFns);
      onChange({ ...data, functions: allFns, parameters: newParams });
    },
    [data, fns, onChange, math, recomputeParameters],
  );

  return {
    addFunction,
    updateFunction,
    removeFunction,
    updateParameter,
    insertFromHelp,
  };
}
