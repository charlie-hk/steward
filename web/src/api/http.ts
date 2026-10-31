import type { DecisionResult, Scenario, Snapshot, StewardApi } from './types';

// Talks to the Express API in src/server.js. This is the path taken when the
// panel is served by a running service rather than from GitHub Pages.
export function httpApi(base = ''): StewardApi {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${base}/api${path}`);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json() as Promise<T>;
  };

  return {
    mode: 'live',

    async snapshot(): Promise<Snapshot> {
      const [summary, approvals, jobs, audit] = await Promise.all([
        get<Snapshot['summary']>('/summary'),
        get<Snapshot['approvals']>('/approvals'),
        get<Snapshot['jobs']>('/jobs'),
        get<Snapshot['audit']>('/audit'),
      ]);
      return { summary, approvals, jobs, audit };
    },

    scenarios: () => get<Scenario[]>('/scenarios'),

    async runScenario(key) {
      await fetch(`${base}/api/scenarios/${key}`, { method: 'POST' });
    },

    async decide(id, action, by, note): Promise<DecisionResult> {
      const res = await fetch(`${base}/api/approvals/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ by, note }),
      });
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) return { ok: false, conflict: true, status: body.status, by: body.by ?? null };
      return { ok: false, conflict: false, error: body.error ?? `HTTP ${res.status}` };
    },

    async reset() {
      // A live service holds someone's real queue. Wiping it from a dashboard
      // button is not a feature.
      throw new Error('reset is only available in the browser demo');
    },
  };
}

// Is a service answering at /api? Used once at startup to decide which
// implementation to use, with a short timeout so GitHub Pages does not wait.
export async function liveServiceAvailable(base = ''): Promise<boolean> {
  // On GitHub Pages there is nothing at /api, and a failed probe would show up
  // in the console of a page that is working exactly as intended.
  if (!/^https?:$/.test(window.location.protocol)) return false;
  if (window.location.hostname.endsWith('github.io')) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${base}/api/summary`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
