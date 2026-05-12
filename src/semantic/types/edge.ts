/**
 * V2 语义层 Edge 通用接口
 * 详 docs/RefactorV2/data-model/relations/spec.md §2
 */

export type EdgePredicate = string;

export interface AtomRef {
  kind: 'atom';
  atomId: string;
}

export interface StringLiteral  { kind: 'literal'; type: 'string'; value: string }
export interface NumberLiteral  { kind: 'literal'; type: 'number'; value: number }
export interface BooleanLiteral { kind: 'literal'; type: 'boolean'; value: boolean }
export interface DateLiteral    { kind: 'literal'; type: 'date'; value: string }
export interface TypedLiteral   { kind: 'literal'; type: string; value: unknown }

export type LiteralValue = StringLiteral | NumberLiteral | BooleanLiteral | DateLiteral | TypedLiteral;

export type EdgeEndpoint = AtomRef | LiteralValue;

export interface EdgeAttrs {
  createdBy: string;
  createdAt: number;
  confidence?: number;
  confirmedAt?: number;
  confirmedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  comment?: string;
  [key: string]: unknown;
}

export interface Edge {
  predicate: EdgePredicate;
  subject: AtomRef;
  object: EdgeEndpoint;
  attrs: EdgeAttrs;
}
