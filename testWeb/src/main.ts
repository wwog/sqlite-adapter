import "./style.css";
import { SqliteWasmAdapter } from "../../src/adapter/sqlite-wasm.adapter.ts";

const adapter = new SqliteWasmAdapter();

adapter.connect("/dev/u_123/common.db");

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    Test
  </div>
`;
