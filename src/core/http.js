/**
 * Lightweight fetch helper with retry logic that works in Node and browsers.
 */

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        let error;
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

const defaultHeaders = typeof window === 'undefined'
  ? { 'user-agent': 'registrar-pricelist/1.0 (+https://github.com/namewiz/registrar-pricelist)' }
  : {};

/**
 * @param {RequestInfo | URL} url
 * @param {Object} [options]
 * @param {number} [options.retries=3]
 * @param {number} [options.backoffMs=500]
 * @param {Record<string, string>} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @param {'info'|'warn'|'error'} [options.logLevel]
 * @param {(entry: { level?: string, message: string }) => void} [options.logger]
 */
export async function fetchWithRetry(url, {
  retries = 3,
  backoffMs = 500,
  headers,
  signal,
  logLevel = 'info',
  logger,
} = {}) {
  let lastErr;
  const log = logger || (() => {});
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...defaultHeaders, ...(headers || {}) },
        signal,
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.url = typeof url === 'string' ? url : url.toString();
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      log({ level: logLevel, message: `Retrying ${url} after error: ${err.message}` });
      await delay(backoffMs * Math.pow(2, attempt), signal).catch(() => { throw err; });
    }
  }
  throw lastErr;
}
