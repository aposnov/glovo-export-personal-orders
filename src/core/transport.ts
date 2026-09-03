export interface RawResult {
  status: number;
  ok: boolean;
  body: unknown;
  error?: string;
}

export interface Transport {
  request(path: string): Promise<RawResult>;
  recoverFromUnauthorized(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}
