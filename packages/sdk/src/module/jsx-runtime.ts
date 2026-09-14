export { jsx, jsxs, jsxDEV, Fragment } from "./template.js";
import type { Signal, TemplateChild, TemplateNode } from "./template.js";
type Reactive<T> = T | Signal<T> | (() => T);
type EventProps<E extends Element> = { [K in keyof GlobalEventHandlersEventMap as `on${Capitalize<K>}`]?: (event: GlobalEventHandlersEventMap[K] & { readonly currentTarget: E }) => void } & {
  onClick?: (event: MouseEvent & { readonly currentTarget: E }) => void;
  onKeyDown?: (event: KeyboardEvent & { readonly currentTarget: E }) => void;
  onKeyUp?: (event: KeyboardEvent & { readonly currentTarget: E }) => void;
  onMouseDown?: (event: MouseEvent & { readonly currentTarget: E }) => void;
  onMouseUp?: (event: MouseEvent & { readonly currentTarget: E }) => void;
};
type Attributes<E extends Element> = {
  [K in keyof E as E[K] extends string | number | boolean ? K extends "innerHTML" | "outerHTML" | "textContent" ? never : K : never]?: Reactive<E[K]>;
} & EventProps<E> & {
  children?: TemplateChild; key?: string | number; ref?: (element: E | null) => void;
  class?: Reactive<string>; className?: Reactive<string>; role?: Reactive<string>;
  style?: Partial<CSSStyleDeclaration>;
  [attribute: `data-${string}`]: Reactive<string | number | boolean> | undefined;
  [attribute: `aria-${string}`]: Reactive<string | number | boolean> | undefined;
};
export namespace JSX {
  export type Element = TemplateNode;
  export type ElementType = keyof IntrinsicElements | ((props: any) => TemplateChild);
  export interface ElementChildrenAttribute { children: unknown }
  export type IntrinsicElements = { [K in keyof HTMLElementTagNameMap]: Attributes<HTMLElementTagNameMap[K]> } & {
    [K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: Attributes<SVGElementTagNameMap[K]> & { [attribute: string]: unknown };
  };
}
