/**
 * clipboard capability — 对外类型(Wave 5 / D4)
 */

export type {
  ClipboardFormat,
  SerializerRegistration,
  PasteHandlerRegistration,
} from './index';

/** view 诊断路径用 */
export interface ClipboardDiagnosticApi {
  readonly serializerCount: number;
  readonly pasteHandlerCount: number;
}
