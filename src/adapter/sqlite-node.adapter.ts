/* npm : sqlite3 */

import type { ISqlitePrepare, IAdapter } from "./base";
import _sqlite3, { Database } from "sqlite3";

const isDev = process.env.NODE_ENV !== "production";

const sqlite3 = isDev ? _sqlite3.verbose() : _sqlite3;

export class SqliteNodeAdapter implements IAdapter {
  private db: Database | null = null;

  constructor() {}

  connect: (path: string) => Promise<void> = async (path: string) => {
    if (this.db) {
      throw new Error("Already connected to a database.");
    }
    return new Promise((res, rej) => {
      this.db = new sqlite3.Database(path, (err) => {
        if (err) {
          return rej(err);
        }
        res();
      });
    });
  };
  disconnect: () => Promise<void> = async () => {
    return new Promise((res, rej) => {
      if (!this.db) {
        return res();
      }
      this.db.close((err) => {
        if (err) {
          return rej(err);
        }
        this.db = null;
        res();
      });
    });
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
