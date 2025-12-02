declare module 'node:assert' {
  import assert = require('assert');
  export = assert;
}

declare module 'node:test' {
  export interface MockCall {
    arguments: any[];
  }

  export interface MockFunction {
    (...args: any[]): any;
    mock: { calls: MockCall[] };
  }

  export const mock: {
    fn: (implementation?: (...args: any[]) => any) => MockFunction;
    module: (specifier: string, factory: () => any) => void;
  };

  type TestFn = (name: string, fn: (...args: any[]) => any) => any;
  const test: TestFn;
  export default test;
}

declare const global: any;

declare module 'vscode' {
  export interface Disposable {
    dispose(): void;
  }

  export interface ChatResponseStream {
    markdown(value: string): void;
  }

  export interface CancellationToken {
    isCancellationRequested: boolean;
    onCancellationRequested(callback: () => void): Disposable;
  }

  export interface ExtensionContext {
    subscriptions: Array<Disposable>;
  }

  export interface ConfigurationChangeEvent {
    affectsConfiguration(section: string): boolean;
  }

  export const workspace: any;
  export const window: any;
  export const commands: any;
  export const lm: any;
  export enum ConfigurationTarget {
    Workspace,
  }
}

declare module 'node:module' {
  const Module: any;
  export = Module;
}
