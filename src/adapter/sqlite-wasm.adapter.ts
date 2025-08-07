/* npm:@sqlite.org/sqlite-wasm */
import type { ISqlitePrepare, IAdapter } from "./base";
import { Worker as NodeWorker } from "worker_threads";
import type { JsonRpcRequest, JsonRpcResponse } from "./rpc";
const isNode = typeof window === "undefined";

const RWorker = isNode ? NodeWorker : Worker;

class SqliteWasmPrepare implements ISqlitePrepare {
  private sql: string;

  constructor(adapter: SqliteWasmAdapter, sql: string) {
    this.sql = sql;
  }
  run: (params?: any[]) => Promise<any>;
  get: (params?: any[]) => Promise<any>;
  all: (params?: any[]) => Promise<any[]>;
}

export class SqliteWasmAdapter implements IAdapter {
  private worker: Worker;
  private counter = 0;
  private prefix = Math.random().toString(16).substring(2, 6) + "-";
  private getNextId() {
    if (this.counter >= Number.MAX_SAFE_INTEGER) {
      this.counter = 0;
    }
    return this.prefix + this.counter++;
  }
  private requests: Map<
    string,
    {
      resolve: (response: any) => void;
      reject: (error: any) => void;
    }
  > = new Map();
  private preparedStatements: Map<string, SqliteWasmPrepare> = new Map();

  constructor() {
    this.worker = new RWorker(
      new URL("./sqlite-wasm.worker.mjs", import.meta.url),
      isNode ? {} : { type: "module" }
    ) as Worker;
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", (error) => {
      console.error("Worker error:", error);
      //当worker发生错误时，清理所有请求，避免内存泄漏
      this.requests.forEach(({ reject }) =>
        reject({ code: -1, message: "Worker error" })
      );
      this.requests.clear();
    });
  }

  private handleMessage = (event: MessageEvent<JsonRpcResponse<any>>) => {
    const response = event.data;
    if (response.id === null) {
      return; // Ignore notifications without an ID
    }
    if (typeof response.id === "number") {
      throw new Error(`Unexpected response ID type: ${typeof response.id}`);
    }
    const resolver = this.requests.get(response.id);
    if (resolver) {
      if (response.error) {
        resolver.reject(response.error);
      } else {
        resolver.resolve(response.result);
      }
      // Remove the request from the map after resolving or rejecting
      this.requests.delete(response.id);
    } else {
      console.warn(`Unhandled response: ${JSON.stringify(response)}`);
    }
  };

  private async request<T>(method: string, params: any[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.getNextId();
      const message: JsonRpcRequest<any[]> = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      this.worker.postMessage(message);
      this.requests.set(id, { resolve, reject });
    });
  }

  connect: (path: string) => Promise<void> = async (path: string) => {
    return await this.request<void>("connect", [path]);
  };

  disconnect: () => Promise<void> = async () => {
    return await this.request<void>("disconnect");
  };

  execute = async <T>(sql: string, params?: any[]): Promise<T> => {
    return await this.request<T>("execute", [sql, params]);
  };

  prepare: (sql: string) => Promise<ISqlitePrepare> = async (sql: string) => {
    if (this.preparedStatements.has(sql)) {
      return this.preparedStatements.get(sql)!;
    }
    await this.request<void>("prepare", [sql]);
    const stmt = new SqliteWasmPrepare(this, sql);
    this.preparedStatements.set(sql, stmt);
    return stmt;
  };
}
