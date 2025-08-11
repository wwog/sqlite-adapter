import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

console.log("sqlite wasm worker started");

let modulePromise = sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});

/** 
  -  /u_123/common.sqlite => {dirName: "u_123", filename: "common"} 
  - /common.sqlite => {dirName: "def", filename: "common"} 
  - /tmm/u_63/dev/common.sqlite => {dirName: "tmm_u_63_dev", filename: "common"}
*/
function normalizePath(path) {
  const segments = path.split("/").filter(Boolean);
  let filename = segments.pop();
  //如果有扩展名去掉
  const extIndex = filename.lastIndexOf(".");
  if (extIndex !== -1) {
    filename = filename.slice(0, extIndex);
  }
  const dirName = segments.join("_");

  return {
    dirName: dirName !== "" ? dirName : "def", // 如果没有目录名，则使用默认值
    filename,
  };
}

function postErrorResponse(id, code, message, data) {
  const errorResponse = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, data },
  };
  self.postMessage(errorResponse);
}

function postResultResponse(id, result) {
  const response = {
    jsonrpc: "2.0",
    id,
    result,
  };
  self.postMessage(response);
}

class SqliteWorkerHandler {
  connected = false;
  constructor() {
    /** @type {import ('@sqlite.org/sqlite-wasm').Sqlite3Static | null} */
    this.sqlite3 = null;
    /** @type {import ('@sqlite.org/sqlite-wasm').SAHPoolUtil | null} */
    this.poolUtil = null;
    /** @type {import ('@sqlite.org/sqlite-wasm').OpfsSAHPoolDatabase | null} */
    this.db = null;
    /** @type {Map<string, import ("@sqlite.org/sqlite-wasm").PreparedStatement>} SQL -> 句柄 */
    this.sqlToStmtMap = new Map();
    this.stmtCounter = 1;
  }

  connect = async (path) => {
    if (this.connected) {
      throw new Error("Already connected to SQLite database");
    }
    if (path.startsWith("/") === false) {
      throw new Error("Invalid path, example /dev/u_123/common.db");
    }
    const { dirName, filename } = normalizePath(path);
    this.sqlite3 = await modulePromise;
    this.poolUtil = await this.sqlite3.installOpfsSAHPoolVfs({
      name: dirName,
    });
    const { OpfsSAHPoolDb } = this.poolUtil;
    this.db = new OpfsSAHPoolDb(filename);
    this.db.exec("pragma locking_mode=exclusive");
    this.db.exec("PRAGMA journal_mode=WAL");

    if (this.db && this.db.isOpen && this.db.isOpen()) {
      this.connected = true;
    } else {
      throw new Error("Failed to connect to SQLite database");
    }
  };
  disconnect = async () => {
    if (!this.connected) return;
    try {
      if (this.db && typeof this.db.close === "function") {
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        const fileNames = this.poolUtil.getFileNames();
        console.log("disconnect fileNames", fileNames);
        this.db.close();
      }
    } finally {
      this.db = null;
      this.poolUtil = null;
      this.sqlite3 = null;
      // 清理所有未释放的 statement
      try {
        for (const [sql, stmt] of this.sqlToStmtMap.entries()) {
          stmt.finalize();
        }
      } finally {
        this.sqlToStmtMap.clear();
      }
      this.connected = false;
      console.log("Disconnected from SQLite database");
    }
  };
  execute = async (sql, params) => {
    if (!this.connected) {
      throw new Error("Not connected to SQLite database");
    }
    const db = this.db;
    if (!db) throw new Error("DB not available");
    const options = {
      rowMode: "object",
    };
    if (params && Array.isArray(params) && params.length) {
      options.bind = params;
    }

    const result = this.db.exec(sql, options);
    return result;
  };
  prepare = async (sql) => {
    if (!this.connected) {
      throw new Error("Not connected to SQLite database");
    }
    const existing = this.sqlToStmtMap.get(sql);
    if (existing) return existing;
    const db = this.db;
    const stmt = db.prepare(sql);
    this.sqlToStmtMap.set(sql, stmt);
    return sql;
  };

  prepare_run = async (sql, params) => {
    const stmt = this.sqlToStmtMap.get(sql);
    if (!stmt) throw new Error(`Invalid statement sql: ${sql}`);
    if (params && Array.isArray(params) && params.length) {
      stmt.bind(params);
    }
    stmt.step();
    stmt.reset(true);
    return true;
  };

  prepare_get = async (sql, params) => {
    const stmt = this.sqlToStmtMap.get(sql);
    if (!stmt) throw new Error(`Invalid statement sql: ${sql}`);
    if (params && Array.isArray(params) && params.length) {
      stmt.bind(params);
    }
    const row = stmt.step() ? stmt.getJSON() : null;
    stmt.reset(true);
    return row;
  };

  prepare_all = async (sql, params) => {
    const stmt = this.sqlToStmtMap.get(sql);
    if (!stmt) throw new Error(`Invalid statement sql: ${sql}`);
    if (params && Array.isArray(params) && params.length) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.reset(true);
    return rows;
  };

  finalize = async (sql) => {
    const stmt = this.sqlToStmtMap.get(sql);
    if (stmt) {
      stmt.finalize?.();
      this.sqlToStmtMap.delete(sql);
    }
    return true;
  };
}

const handler = new SqliteWorkerHandler();

self.addEventListener("message", async (event) => {
  const request = event.data;

  if (!request || request.jsonrpc !== "2.0" || !request.method) {
    postErrorResponse(request?.id ?? null, -32600, "Invalid Request", request);
    return;
  }
  const params = Array.isArray(request.params) ? request.params : [];
  try {
    let result;
    switch (request.method) {
      case "connect":
        result = await handler.connect(params[0]);
        break;
      case "disconnect":
        result = await handler.disconnect();
        break;
      case "execute":
        result = await handler.execute(params[0], params[1]);
        break;
      case "prepare":
        result = await handler.prepare(params[0]);
        break;
      case "run":
        result = await handler.run(params[0], params[1]);
        break;
      case "get":
        result = await handler.get(params[0], params[1]);
        break;
      case "all":
        result = await handler.all(params[0], params[1]);
        break;
      case "finalize":
        result = await handler.finalize(params[0]);
        break;
      default:
        postErrorResponse(
          request.id ?? null,
          -32601,
          `Method not found: ${request.method}`
        );
        return;
    }
    postResultResponse(request.id, result);
  } catch (error) {
    postErrorResponse(
      request.id ?? null,
      error?.code ?? -32603,
      error?.message ?? "Internal error",
      error
    );
  }
});

// 错误处理
self.addEventListener("error", (error) => {
  console.error("Worker error:", error);
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("Worker unhandled rejection:", event.reason);
});
