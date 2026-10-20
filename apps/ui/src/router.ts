import { useEffect, useState } from 'react';

export interface Route {
  runId?: string;
  testId?: string;
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  if (parts[0] !== 'runs' || !parts[1]) return {};
  if (parts[2] === 'test' && parts[3]) return { runId: parts[1], testId: parts[3] };
  return { runId: parts[1] };
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const runHref = (runId: string) => `#/runs/${encodeURIComponent(runId)}`;
export const testHref = (runId: string, testId: string) =>
  `#/runs/${encodeURIComponent(runId)}/test/${encodeURIComponent(testId)}`;

export function navigate(href: string) {
  if (window.location.hash !== href) window.location.hash = href;
}

export function useRoute(): Route {
  const [route, set] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => set(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
