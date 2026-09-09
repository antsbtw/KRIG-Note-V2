/**
 * `web.dom` 对外接口(`06-data-model-and-interfaces.md` §3.3)
 *
 * ⭐⭐ `run` 只接受**预注册脚本 id + 参数**,不接受脚本字符串。
 *
 * 这是 `project-x-inject-template-escape` 的类型层面根治:
 * 调用方给不了原始字符串,就拼不出坏脚本。
 */

import type { Result } from '../result';
import type { PageId } from '../page/types';
import type { AnchorName, DomAnchor, ExtractId, ScriptId, ScriptParams, SelectionState } from './types';

export interface WebDom {
  /** 跑一个**预注册**脚本。⚠️ 第二参是 id 不是脚本文本 */
  run(pageId: PageId, scriptId: ScriptId, params?: ScriptParams): Promise<Result<unknown>>;

  /** 按提取器 id 取结构化数据 */
  read(pageId: PageId, extractId: ExtractId, params?: ScriptParams): Promise<Result<unknown>>;

  /** 查一个语义锚点。找不到返回 `found:false` 的 DomAnchor,不抛 */
  query(pageId: PageId, anchor: AnchorName): Promise<Result<DomAnchor>>;

  /** 取文本(给锚点则取锚点内文本,否则整页) */
  text(pageId: PageId, anchor?: AnchorName): Promise<Result<string>>;

  /** 当前选区。无选区返回 null(这是**如实说没有**,不是失败) */
  selection(pageId: PageId): Promise<Result<SelectionState | null>>;

  /**
   * ⚠️ **逃生口**(`06` §3.3):排查工具需要动态脚本。
   *
   * **显式标注 + 仅 dev** —— 符合铁律「只在显式标注的兼容场景才兜底」。
   * 本步只定义,不接消费者(那些是 X 侧的排查工具,属步 6)。
   */
  runDynamic(pageId: PageId, script: string, reason: string): Promise<Result<unknown>>;
}
