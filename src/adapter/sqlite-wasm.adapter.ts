/* npm:@sqlite.org/sqlite-wasm */
import {
  type ISqlitePrepare,
  type IAdapter,
  SqliteAdapterErrorCode,
} from "./base";
import { Worker as NodeWorker } from "worker_threads";
import type { JsonRpcRequest, JsonRpcResponse } from "./rpc";

const isNode = typeof window === "undefined";
const RWorker = isNode ? NodeWorker : Worker;

// 请求状态管理接口
interface PendingRequest {
  resolve: (response: any) => void;
  reject: (error: any) => void;
  timer: NodeJS.Timeout;
}

// 预处理语句实现
class SqliteWasmPrepare implements ISqlitePrepare {
  constructor(private adapter: SqliteWasmAdapter, private sql: string) {}

  run = async (params?: any[]): Promise<any> => {
    throw new Error("Method not implemented.");
  };

  get = async (params?: any[]): Promise<any> => {
    throw new Error("Method not implemented.");
  };

  all = async (params?: any[]): Promise<any[]> => {
    throw new Error("Method not implemented.");
  };
}

export interface SqliteWasmOptions {
  timeout?: number; // 请求超时时间（毫秒）
  workerUrl?: string; // Worker脚本URL
}

export class SqliteWasmAdapter implements IAdapter {
  private worker: Worker;
  private requestCounter = 0;
  private readonly requestPrefix: string;
  private pendingRequests = new Map<string, PendingRequest>();
  private timedOutRequests = new Set<string>();
  private preparedStatements = new Map<string, SqliteWasmPrepare>();
  private isDisposed = false;

  constructor(private options: SqliteWasmOptions = {}) {
    this.options = {
      timeout: 10_000,
      ...options,
    };

    // 生成唯一的请求前缀，避免不同实例间的ID冲突
    this.requestPrefix = Math.random().toString(16).substring(2, 6) + "-";

    this.initializeWorker();
  }

  /**
   * 初始化Web Worker
   */
  private initializeWorker(): void {
    this.worker = this.options.workerUrl
      ? (new RWorker(
          new URL(this.options.workerUrl!, import.meta.url),
          isNode ? {} : { type: "module" }
        ) as Worker)
      : //不清楚如果不显示传递url路径会不会影响上层打包，这里不给workerUrl默认值而是显式传递
        (new RWorker(
          new URL("./sqlite-wasm.worker.mjs", import.meta.url),
          isNode ? {} : { type: "module" }
        ) as Worker);

    this.worker.addEventListener("message", this.handleWorkerMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  /**
   * 生成唯一的请求ID
   */
  private generateRequestId(): string {
    if (this.requestCounter >= Number.MAX_SAFE_INTEGER) {
      this.requestCounter = 0;
    }
    return this.requestPrefix + this.requestCounter++;
  }

  /**
   * 处理Worker消息
   */
  private handleWorkerMessage = (
    event: MessageEvent<JsonRpcResponse<any>>
  ): void => {
    const response = event.data;

    // 忽略没有ID的通知消息
    if (response.id === null || response.id === undefined) {
      return;
    }

    if (typeof response.id === "number") {
      console.error(`意外的响应ID类型: ${typeof response.id}`);
      return;
    }

    // 处理超时请求的延迟响应
    if (this.timedOutRequests.has(response.id)) {
      this.timedOutRequests.delete(response.id);
      return;
    }

    // 处理正常请求响应
    const pendingRequest = this.pendingRequests.get(response.id);
    if (pendingRequest) {
      clearTimeout(pendingRequest.timer);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pendingRequest.reject(response.error);
      } else {
        pendingRequest.resolve(response.result);
      }
    } else {
      console.warn(`收到未处理的响应: ${JSON.stringify(response)}`);
    }
  };

  /**
   * 处理Worker错误
   */
  private handleWorkerError = (error: ErrorEvent): void => {
    console.error("Worker错误:", error);
    this.dispose("Worker发生错误");
  };

  /**
   * 发送请求到Worker
   */
  private async sendRequest<T>(method: string, params: any[] = []): Promise<T> {
    if (this.isDisposed) {
      throw new Error("适配器已被释放");
    }

    return new Promise<T>((resolve, reject) => {
      const id = this.generateRequestId();

      // 设置超时处理
      const timer = setTimeout(() => {
        this.timedOutRequests.add(id);
        this.pendingRequests.delete(id);
        reject({
          code: SqliteAdapterErrorCode.TIMEOUT,
          message: `请求超时 (${this.options.timeout}ms)`,
        });
      }, this.options.timeout);

      // 保存请求信息
      this.pendingRequests.set(id, {
        resolve: (result: T) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error: any) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });

      // 发送消息到Worker
      const message: JsonRpcRequest<any[]> = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.worker.postMessage(message);
    });
  }

  /**
   * 释放所有资源
   */
  private dispose(reason = "适配器被释放"): void {
    if (this.isDisposed) return;

    this.isDisposed = true;

    // 拒绝所有待处理的请求
    this.pendingRequests.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject({
        code: SqliteAdapterErrorCode.WORKER_ERROR,
        message: reason,
      });
    });

    // 清理所有状态
    this.pendingRequests.clear();
    this.timedOutRequests.clear();
    this.preparedStatements.clear();
  }

  // 公共API方法
  connect = async (path: string): Promise<void> => {
    return this.sendRequest<void>("connect", [path]);
  };

  disconnect = async (): Promise<void> => {
    this.dispose("连接已断开");
    if (!this.isDisposed) {
      await this.sendRequest<void>("disconnect");
    }

    // 终止Worker
    this.worker?.terminate?.();
  };

  execute = async <T>(sql: string, params?: any[]): Promise<T> => {
    return this.sendRequest<T>("execute", [sql, params]);
  };

  prepare = async (sql: string): Promise<ISqlitePrepare> => {
    // 复用已存在的预处理语句
    if (this.preparedStatements.has(sql)) {
      return this.preparedStatements.get(sql)!;
    }

    // 准备新的语句
    await this.sendRequest<void>("prepare", [sql]);
    const statement = new SqliteWasmPrepare(this, sql);
    this.preparedStatements.set(sql, statement);

    return statement;
  };
}
