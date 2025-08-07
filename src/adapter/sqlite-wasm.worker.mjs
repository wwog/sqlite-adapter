import sqlite3InitModule, { Database } from "@sqlite.org/sqlite-wasm";

console.log("sqlite wasm worker started");

let modulePromise = sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});
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

class SqliteWorkerHandler {
  connected = false;

  connect = async (path) => {
    if (this.connected) {
      throw new Error("Already connected to SQLite database");
    }
    if (path.startsWith("/") === false) {
      throw new Error("Invalid path, example /dev/u_123/common.db");
    }
    const { dirName, filename } = normalizePath(path);
    const sqlite3 = await modulePromise;
    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
      name: dirName,
    });
    const { OpfsSAHPoolDb } = poolUtil;
    const db = new OpfsSAHPoolDb(filename);
    if (db.isOpen()) {
      this.connected = true;
    } else {
      throw new Error("Failed to connect to SQLite database");
    }
  };
  disconnect = async () => {
    if (this.connected) {
      this.connected = false;
      // 释放资源或关闭数据库连接
      console.log("Disconnected from SQLite database");
    }
  };
  execute = async (sql, params) => {
    if (!this.connected) {
      throw new Error("Not connected to SQLite database");
    }
    // 执行SQL语句
    console.log(`Executing SQL: ${sql}, Params: ${JSON.stringify(params)}`);
  };
  prepare = async (sql) => {
    if (!this.connected) {
      throw new Error("Not connected to SQLite database");
    }
    // 准备SQL语句
    console.log(`Preparing SQL: ${sql}`);
  };
}

// 创建处理器实例
const handler = new SqliteWorkerHandler();

// 监听消息事件
self.addEventListener("message", async (event) => {
  const request = event.data;

  // 验证JSON-RPC格式
  if (!request || request.jsonrpc !== "2.0" || !request.method) {
    const errorResponse = {
      jsonrpc: "2.0",
      id: request?.id || null,
      error: {
        code: -32600,
        message: "Invalid Request",
        data: request,
      },
    };
    self.postMessage(errorResponse);
    return;
  }

  let response = {
    jsonrpc: "2.0",
    id: request.id,
  };

  try {
    const result = await handler.handleRequest(request.method, request.params);
    response.result = result;
  } catch (error) {
    response.error = {
      code: error.code || -32603,
      message: error.message || "Internal error",
      data: error.data || error,
    };
  }

  self.postMessage(response);
});

// 错误处理
self.addEventListener("error", (error) => {
  console.error("Worker error:", error);
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("Worker unhandled rejection:", event.reason);
});
