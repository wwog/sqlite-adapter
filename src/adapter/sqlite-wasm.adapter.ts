/* npm:@sqlite.org/sqlite-wasm */
import type { ISqlitePrepare, IAdapter } from "./base";
import { Worker as NodeWorker } from "worker_threads";

const isNode = typeof window === "undefined";

const RWorker = isNode ? NodeWorker : Worker;

export class SqliteWasmAdapter implements IAdapter {
  private worker = new RWorker(
    new URL("./sqlite-wasm.worker.mjs", import.meta.url),
    isNode ? {} : { type: "module" }
  );

  connect: (path: string) => Promise<void> = async (path: string) => {};
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
