/**
 * foliate-js 类型声明(V1 → V2 直迁)
 *
 * foliate-js 没有官方 TS 类型,V1 自己写了 d.ts。V2 沿用,字段如有 v1.0.1
 * 之后的 API 变化按需扩展。
 */

declare module 'foliate-js/view.js' {
  export class View extends HTMLElement {
    book: any;
    renderer: any;
    lastLocation: any;
    history: any;
    isFixedLayout: boolean;
    open(book: any): Promise<void>;
    init(options: { lastLocation?: any; showTextStart?: boolean }): Promise<void>;
    prev(distance?: number): Promise<void>;
    next(distance?: number): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    resolveNavigation(target: any): any;
    goTo(target: any): Promise<void>;
    goToFraction(fraction: number): Promise<void>;
  }

  export function makeBook(file: File | Blob | string): Promise<any>;
}
