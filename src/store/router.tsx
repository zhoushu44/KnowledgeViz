import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'research' }
  | { name: 'workspace'; projectId: string };

interface RouterCtx {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
}

const Ctx = createContext<RouterCtx | null>(null);

function parseHash(): Route {
  const h = window.location.hash.replace(/^#/, '');
  const [path, query] = h.split('?');
  void new URLSearchParams(query ?? '');
  if (path.startsWith('/project/')) {
    return { name: 'workspace', projectId: decodeURIComponent(path.slice('/project/'.length)) };
  }
  if (path === '/create') return { name: 'create' };
  if (path === '/research') return { name: 'research' };
  if (!path) {
    // 关闭重开：恢复上次打开的项目（PRD 10.4）
    try {
      const raw = localStorage.getItem('ksb.last.v1');
      const last = raw ? (JSON.parse(raw) as { projectId?: string }) : null;
      if (last?.projectId) return { name: 'workspace', projectId: last.projectId };
    } catch {
      /* ignore */
    }
  }
  return { name: 'home' };
}

function toHash(r: Route): string {
  if (r.name === 'workspace') return `#/project/${encodeURIComponent(r.projectId)}`;
  if (r.name === 'create') return '#/create';
  if (r.name === 'research') return '#/research';
  return '#/';
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseHash());
  const stack = useRef<Route[]>([]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const push = useCallback((r: Route) => {
    stack.current.push(route);
    window.location.hash = toHash(r);
    setRoute(r);
  }, [route]);

  const back = useCallback(() => {
    const prev = stack.current.pop() ?? { name: 'home' as const };
    window.location.hash = toHash(prev);
    setRoute(prev);
  }, []);

  return <Ctx.Provider value={{ route, push, back }}>{children}</Ctx.Provider>;
}

export function useRouter() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRouter must be used within RouterProvider');
  return c;
}
