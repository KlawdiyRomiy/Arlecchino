export class CancellablePromise<T> extends Promise<T> {
  cancel(reason?: unknown): CancellablePromise<void>;
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): CancellablePromise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): CancellablePromise<T | TResult>;
  finally(onfinally?: (() => void) | undefined | null): CancellablePromise<T>;
}

export const Call: {
  ByID<T = unknown>(
    methodID: number,
    ...args: unknown[]
  ): CancellablePromise<T>;
  ByName<T = unknown>(
    methodName: string,
    ...args: unknown[]
  ): CancellablePromise<T>;
};

export const Create: {
  Any(source: unknown): any;
  Array<T>(createItem: (source: unknown) => T): (source: unknown) => T[];
  Map<TKey, TValue>(
    createKey: (source: unknown) => TKey,
    createValue: (source: unknown) => TValue,
  ): (source: unknown) => Record<string, TValue>;
  Nullable<T>(
    createItem: (source: unknown) => T,
  ): (source: unknown) => T | null;
  Events: Record<string, (source: unknown) => unknown>;
};

export interface WailsEvent<T = unknown> {
  name: string;
  data: T;
  sender?: string;
}

export const Events: {
  On(eventName: string, callback: (event: WailsEvent) => void): () => void;
  OnMultiple(
    eventName: string,
    callback: (event: WailsEvent) => void,
    maxCallbacks: number,
  ): () => void;
  Once(eventName: string, callback: (event: WailsEvent) => void): () => void;
  Off(eventName: string, ...additionalEventNames: string[]): void;
  OffAll(): void;
  Emit(eventName: string, data?: unknown): Promise<boolean>;
};

export const Browser: {
  OpenURL(url: string | URL): Promise<void>;
};

export const Clipboard: {
  Text(): Promise<string>;
  SetText(text: string): Promise<void>;
};

export const Application: {
  Hide(): Promise<void>;
  Show(): Promise<void>;
  Quit(): Promise<void>;
};

export const Window: {
  Fullscreen(): Promise<void>;
  UnFullscreen(): Promise<void>;
  IsFullscreen(): Promise<boolean>;
  Minimise(): Promise<void>;
};
