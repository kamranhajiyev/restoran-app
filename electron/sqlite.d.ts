// Types for node:sqlite, which @types/node@20 does not yet describe.
//
// The runtime is Node 24 (Electron 44 embeds it), where node:sqlite is built in
// — which is the whole reason it is used instead of better-sqlite3: a native
// module would have to be rebuilt against Electron's ABI on the Windows runner,
// and that is the step that breaks installers.
//
// Only the surface electron/db.ts actually calls is declared. Widen it when a
// call needs more, rather than pulling in a types package for one module.

declare module 'node:sqlite' {
  interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): StatementResultingChanges;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
