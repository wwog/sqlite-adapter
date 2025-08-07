export interface ISqlitePrepare {
  run: (params?: any[]) => Promise<any>;
  get: (params?: any[]) => Promise<any>;
  all: (params?: any[]) => Promise<any[]>;
}

export interface IAdapter {
  connect: (path: string) => Promise<void>;
  disconnect: () => Promise<void>;
  execute: <T>(sql: string, params?: any[]) => Promise<T>;
  prepare: (sql: string) => Promise<ISqlitePrepare>;
}

export enum SqliteAdapterErrorCode {
  TIMEOUT = -1,
  WORKER_ERROR = -2,
}
