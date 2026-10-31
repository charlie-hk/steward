import { httpApi, liveServiceAvailable } from './http';
import { browserApi } from './local';
import type { StewardApi } from './types';

// Served by the Node service, talk to it. Served as a static page, run the
// engine here instead. `?demo` forces the second even when a service is up.
export async function connect(): Promise<StewardApi> {
  const forced = new URLSearchParams(window.location.search).has('demo');
  if (!forced && (await liveServiceAvailable())) return httpApi();
  return browserApi();
}

export type { StewardApi } from './types';
