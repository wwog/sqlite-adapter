import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

console.log("sqlite wasm worker started");

let modulePromise = sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});

const ERR_TASK_EXPIRED = -32001;

const highQueue = new Array(); // priority=1
const normalQueue = new Array(); // priority=0 或未设置
const lowQueue = new Array(); // priority=-1

function normalizePriority(p) {
  if (p > 0) return 1;
  if (p < 0) return -1;
  return 0;
}

/* 
  /u_123/common.sqlite => {dirName: "u_123", filename: "common"}
  /common.sqlite => {dirName: "def", filename: "common"}
  /tmm/u_63/dev/common.sqlite => {dirName: "tmm_u_63_dev", filename: "common"}
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

function pickNextTask() {
  // 高优先 → 普通 → 低优先
  return highQueue.shift() || normalQueue.shift() || lowQueue.shift();
}

let processing = false;
/**
 * 处理任务队列
 * @param {SqliteWorkerHandler} handler
 * @returns
 */
async function processQueue(handler) {
  if (processing) return;
  processing = true;
  try {
    while (
      highQueue.length > 0 ||
      normalQueue.length > 0 ||
      lowQueue.length > 0
    ) {
      const task = pickNextTask();
      if (!task) break;

      const { id, method, params, rpc, enqueuedAt } = task;
      const now = Date.now();
      const ttl = rpc?.ttl;
      if (typeof ttl === "number" && ttl >= 0) {
        if (now - enqueuedAt > ttl) {
          // 过期，返回错误
          postErrorResponse(
            id,
            ERR_TASK_EXPIRED,
            `Task expired in queue (ttl=${ttl}ms)`,
            {
              method,
            }
          );
          continue;
        }
      }

      try {
        let result;
        const [p1, p2] = Array.isArray(params) ? params : [];
        switch (method) {
          case "connect":
            result = await handler.connect(p1);
            break;
          case "disconnect":
            result = await handler.disconnect();
            break;
          case "execute":
            result = await handler.execute(p1, p2);
            break;
          case "prepare":
            result = await handler.prepare(p1);
            break;
          default:
            postErrorResponse(id, -32601, `Method not found: ${method}`);
            continue;
        }
        postResultResponse(id, result);
      } catch (error) {
        postErrorResponse(
          id,
          error?.code ?? -32603,
          error?.message ?? "Internal error",
          error
        );
      }
    }
  } finally {
    processing = false;
  }
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
        this.db.close();
      }
    } finally {
      this.db = null;
      this.poolUtil = null;
      this.sqlite3 = null;
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

    const trimmed = (sql || "").trim();
    const isSelect = /^select\b/i.test(trimmed);

    // 使用 prepare 以支持参数绑定
    const stmt = db.prepare(sql);
    try {
      if (params && Array.isArray(params) && params.length) {
        stmt.bind(params);
      }

      if (isSelect) {
        const rows = [];
        while (stmt.step()) {
          // 以对象形式返回，列名为键
          rows.push(stmt.getAsObject());
        }
        return rows;
      } else {
        // 非查询：执行一次，随后返回影响行数与 last_insert_rowid
        // 对于非查询，step 一次以执行语句
        stmt.step();
        // 获取 changes 与 last_insert_rowid
        const meta = db.prepare(
          "SELECT changes() AS changes, last_insert_rowid() AS lastID"
        );
        try {
          let changes = 0;
          let lastID = 0;
          if (meta.step()) {
            const row = meta.getAsObject();
            changes = Number(row.changes) || 0;
            lastID = Number(row.lastID) || 0;
          }
          return { changes, lastID };
        } finally {
          meta.finalize?.();
        }
      }
    } finally {
      stmt.finalize?.();
    }
  };
  prepare = async (sql) => {
    if (!this.connected) {
      throw new Error("Not connected to SQLite database");
    }
    // 先按需实现但不暴露 statement 句柄（当前适配器侧未使用）
    // 这里仅做语法校验，若 prepare 失败会抛错
    const db = this.db;
    const stmt = db.prepare(sql);
    try {
      // 立即 finalize，当前不保存句柄
      return true;
    } finally {
      stmt.finalize?.();
    }
  };
}

const handler = new SqliteWorkerHandler();

self.addEventListener("message", async (event) => {
  const request = event.data;

  if (!request || request.jsonrpc !== "2.0" || !request.method) {
    postErrorResponse(request?.id ?? null, -32600, "Invalid Request", request);
    return;
  }

  const rpc = request.rpc || {}; // 兼容性处理：如果适配器未传，使用空对象
  const task = {
    id: request.id,
    method: request.method,
    params: Array.isArray(request.params) ? request.params : [],
    rpc,
    enqueuedAt: Date.now(),
  };
  const pri = normalizePriority(rpc.priority ?? 0);
  if (pri === 1) highQueue.push(task);
  else if (pri === -1) lowQueue.push(task);
  else normalQueue.push(task);
  processQueue(handler);
});

// 错误处理
self.addEventListener("error", (error) => {
  console.error("Worker error:", error);
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("Worker unhandled rejection:", event.reason);
});
