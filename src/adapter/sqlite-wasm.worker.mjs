import sqlite3InitModule, { Database } from "@sqlite.org/sqlite-wasm";

console.log("sqlite wasm worker started");

let modulePromise = sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});


