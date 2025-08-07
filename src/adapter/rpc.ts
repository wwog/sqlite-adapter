export type JsonRpcVersion = "2.0";

/**
 * null is intended for 1.0 and is avoided
 */
export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export type JsonRpcParams = any[] | Record<string, any>;

export interface JsonRpcRequest<P extends JsonRpcParams> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcResponse<T> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  result?: T | null;
  error?: JsonRpcError;
}
