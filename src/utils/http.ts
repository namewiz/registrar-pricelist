export interface FetchRetryOptions {
  retries?: number;
  backoffMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  logLevel?: 'info' | 'warn' | 'error';
  logger?: (entry: { level?: string; message: string }) => void;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        let error: Error;
        if (typeof DOMException === 'function') {
          error = new DOMException('Aborted', 'AbortError');
        } else {
          error = new Error('Aborted');
          error.name = 'AbortError';
        }
        reject(error);
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}

const defaultHeaders: Record<string, string> = typeof window === 'undefined'
  ? { 'user-agent': 'registrar-pricelist/2.0 (+https://github.com/namewiz/registrar-pricelist)' }
  : {};

export async function fetchWithRetry(url: RequestInfo | URL, {
  retries = 3,
  backoffMs = 500,
  headers,
  signal,
  logLevel = 'info',
  logger,
}: FetchRetryOptions = {}): Promise<Response> {
  let lastErr: unknown;
  const log = logger || (() => {});
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...defaultHeaders, ...(headers || {}) },
        signal,
      });
      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.url = typeof url === 'string' ? url : url.toString();
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) {
        break;
      }
      log({ level: logLevel, message: `Retrying ${typeof url === 'string' ? url : url.toString()} after error: ${(err as Error).message}` });
      await delay(backoffMs * Math.pow(2, attempt), signal).catch(() => {
        throw err;
      });
    }
  }
  throw lastErr;
}
