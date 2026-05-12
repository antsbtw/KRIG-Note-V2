/**
 * V2 语义层 Atom 通用接口
 * 详 docs/RefactorV2/data-model/atom/spec.md §1
 */

export type AtomDomain = string;

export interface Atom<D extends AtomDomain = AtomDomain> {
  domain: D;
  payload: AtomPayloadOf<D>;
}

export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'        ? PmPayload :
  D extends 'rdf'       ? RdfPayload :
  D extends 'embedding' ? EmbeddingPayload :
  D extends 'three'     ? ThreePayload :
  unknown;

export interface PmPayload {
  type: string;
  content?: PmPayload[];
  attrs?: Record<string, unknown>;
  marks?: Mark[];
  text?: string;
}

export interface RdfPayload {
  subject: string;
  predicate: string;
  object: string;
}

export interface EmbeddingPayload {
  vector: number[];
  dim: number;
  model: string;
}

export interface ThreePayload {
  kind: 'node' | 'edge' | 'face';
  position?: { x: number; y: number; z?: number };
  shape?: string;
  size?: { w: number; h: number; d?: number };
}

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight'; attrs?: { color?: string } }
  | { type: 'textStyle'; attrs?: { color?: string } }
  | { type: 'link'; attrs: { href: string; title?: string } };
