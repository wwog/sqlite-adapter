/* npm : sqlite3 */

import type { ISqlitePrepare, IAdapter } from "./base";
import _sqlite3, { Database } from "sqlite3";

const isDev = process.env.NODE_ENV !== "production";

const sqlite3 = isDev ? _sqlite3.verbose() : _sqlite3;

class SqliteNodePrepare implements ISqlitePrepare {
  public sql: string;
  private stmt: _sqlite3.Statement;
  constructor(db: Database, sql: string) {
    this.sql = sql;
    this.stmt = db!.prepare(sql);
  }

  run = async (params?: any[]): Promise<any> => {
    return new Promise((res, rej) => {
      this.stmt.run(...(params || []), (err) => {
        if (err) {
          return rej(err);
        }
        res([]);
      });
    });
  };

  get = async (params?: any[]): Promise<any> => {
    return new Promise((res, rej) => {
      this.stmt.get(...(params || []), (err, rows) => {
        if (err) {
          return rej(err);
        }
        res(rows);
      });
    });
  };

  all = async (params?: any[]): Promise<any[]> => {
    return new Promise((res, rej) => {
      this.stmt.all(...(params || []), (err, rows) => {
        if (err) {
          return rej(err);
        }
        res(rows);
      });
    });
  };
}

export class SqliteNodeAdapter implements IAdapter {
  private db: Database | null = null;

  private prepareStatement: Map<string, SqliteNodePrepare>;

  constructor() {
    this.prepareStatement = new Map();
  }

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
    this.prepareStatement.clear();
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

  private exec: <T>(sql: string, params?: any[]) => Promise<T> = async (
    sql: string,
    params?: any[]
  ) => {
    if (!this.db) throw new Error("Not connected to a database.");
    if (/RETURNING|SELECT|PRAGMA|WITH/i.test(sql)) {
      return new Promise<any[]>((res, rej) => {
        console.log("invoke db.all");
        this.db!.all(sql, params, (err, rows) => {
          if (err) {
            return rej(err);
          }
          res(rows);
        });
      });
    }
    return new Promise<any>((res, rej) => {
      console.log("invoke db.run");
      this.db!.run(sql, params, (err) => {
        if (err) {
          return rej(err);
        }
        res([]);
      });
    });
  };

  execute: <T>(sql: string, params?: any[]) => Promise<T> = async <T>(
    sql: string,
    params?: any[]
  ) => {
    const sqlArr = sql.split(";");
    let idx = 0;
    let result: any[] = [];
    for (const item of sqlArr) {
      if (item.trim()) {
        const count = item.replace(/[^\?]/g, "").length;
        const res = await this.exec<T>(item, params?.slice(idx, idx + count));
        idx += count;
        result = result.concat(res);
      }
    }
    return result as T;
  };
  prepare: (sql: string) => Promise<ISqlitePrepare> = async (sql: string) => {
    if (!this.db) throw new Error("Not connected to a database.");
    if (this.prepareStatement.get(sql)) {
      return this.prepareStatement.get(sql)!;
    }
    const stmt = new SqliteNodePrepare(this.db!, sql);
    this.prepareStatement.set(sql, stmt);
    return stmt;
  };
}
