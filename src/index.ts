import { SqliteWasmAdapter } from "./adapter/sqlite-wasm.adapter";

const adapter = new SqliteWasmAdapter();

adapter.connect("wasmdata.sqlite");
