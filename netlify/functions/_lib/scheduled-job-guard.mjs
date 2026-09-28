const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_JOB_TIMEOUT_MS = 45_000;
const CIRCUIT_FAILURE_THRESHOLD = 2;
const CIRCUIT_COOLDOWN_MS = 10 * 60_000;

const runtimeEnv = (key) => globalThis.Netlify?.env?.get?.(key) || process.env[key] || '';
const state = globalThis.__tbgScheduledJobGuard ||= {
  running: new Map(),
  consecutiveDatabaseFailures: 0,
  circuitOpenUntil: 0
};

export class ScheduledFetchError extends Error {
  constructor(message, { cause = null, status = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScheduledFetchError';
    this.status = status;
  }
}

export async function scheduledFetch(url, options = {}, { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, label = 'Scheduled request' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: options.signal || controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new ScheduledFetchError(`${label} timed out after ${timeoutMs}ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function databaseHealthy() {
  const base = runtimeEnv('SUPABASE_URL');
  if (!base) return { healthy: false, reason: 'supabase_not_configured' };
  try {
    const response = await scheduledFetch(`${base}/auth/v1/health`, {
      headers: { accept: 'application/json' }
    }, { timeoutMs: 4_000, label: 'Supabase health check' });
    if (!response.ok) return { healthy: false, reason: `supabase_health_${response.status}` };
    return { healthy: true };
  } catch (error) {
    return { healthy: false, reason: error.message };
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

function noteDatabaseFailure() {
  state.consecutiveDatabaseFailures += 1;
  if (state.consecutiveDatabaseFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  }
}

function noteDatabaseSuccess() {
  state.consecutiveDatabaseFailures = 0;
  state.circuitOpenUntil = 0;
}

export async function runScheduledJob(name, handler, { timeoutMs = DEFAULT_JOB_TIMEOUT_MS, healthcheck = true } = {}) {
  if (state.running.has(name)) {
    return json({ ok: true, skipped: 'already_running', job: name });
  }
  if (state.circuitOpenUntil > Date.now()) {
    return json({ ok: true, skipped: 'database_circuit_open', job: name, retry_after_ms: state.circuitOpenUntil - Date.now() });
  }

  state.running.add(name);
  try {
    if (healthcheck) {
      const health = await databaseHealthy();
      if (!health.healthy) {
        noteDatabaseFailure();
        return json({ ok: true, skipped: 'database_unhealthy', job: name, reason: health.reason });
      }
    }

    let timer;
    let timedOut = false;
    const handlerPromise = Promise.resolve().then(handler);
    state.running.set(name, handlerPromise);
    try {
      const result = await Promise.race([
        handlerPromise,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            noteDatabaseFailure();
            resolve(json({ ok: false, error: `${name} exceeded ${timeoutMs}ms job budget` }, 503));
          }, timeoutMs);
        })
      ]);
      if (!timedOut) {
        if (result instanceof Response && result.status >= 500) noteDatabaseFailure();
        else noteDatabaseSuccess();
      }
      return result;
    } finally {
      clearTimeout(timer);
      if (timedOut) {
        handlerPromise.catch(() => null).finally(() => {
          if (state.running.get(name) === handlerPromise) state.running.delete(name);
        });
      }
    }
  } catch (error) {
    if (/Supabase|database|timed out|timeout|fetch failed|522|525/i.test(String(error?.message || ''))) noteDatabaseFailure();
    throw error;
  } finally {
    if (!(state.running.get(name) instanceof Promise)) state.running.delete(name);
    else if (state.running.get(name) === undefined) state.running.delete(name);
  }
}

export function schedulerGuardSnapshot() {
  return {
    running: [...state.running.keys()],
    consecutive_database_failures: state.consecutiveDatabaseFailures,
    circuit_open_until: state.circuitOpenUntil || null
  };
}
