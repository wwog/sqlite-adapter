/* npm:@sqlite.org/sqlite-wasm */
import type { ISqlitePrepare, IAdapter } from "./base";

export class SqliteWasmAdapter implements IAdapter {
  private worker = new Worker(`
        import sqlite from "@sqlite.org/sqlite-wasm"
        let db = null;
    
  `);

  connect: (path: string) => Promise<void> = async (path: string) => {
    throw new Error("Method not implemented.");
  };
  disconnect: () => Promise<void> = async () => {
    throw new Error("Method not implemented.");
  };
  execute: <T>(sql: string, params?: any[]) => Promise<T> = async (
    sql: string,
    params?: any[]
  ) => {
    throw new Error("Method not implemented.");
  };
  prepare: (sql: string) => Promise<ISqlitePrepare> = async (sql: string) => {
    throw new Error("Method not implemented.");
  };
}
