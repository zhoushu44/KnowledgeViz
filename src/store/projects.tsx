import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Project } from '../lib/types';
import { AI_PROJECT } from '../data/ai';
import { buildMini, MINI_SPECS } from '../data/minis';
import { desktop } from '../lib/desktop';
import { parseBundle, serializeProject } from '../lib/ksb';

const STORAGE_KEY = 'ksb.projects.v1';
const LAST_KEY = 'ksb.last.v1';

function seedProjects(): Project[] {
  // 顺序与参考产品一致：土木、互联网产品经理、西方哲学、会计、思维、IT咨询、CIO、FDE、AI、金融、高中理科
  const order = ['civil', 'pm', 'philosophy', 'accounting', 'thinking', 'itconsult', 'cio', 'fde', 'finance', 'highschool'];
  const minis = order.map((id) => buildMini(MINI_SPECS.find((s) => s.id === id)!));
  return [...minis.slice(0, 8), AI_PROJECT, ...minis.slice(8)];
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedProjects();
    const parsed = JSON.parse(raw) as Project[];
    if (!Array.isArray(parsed) || !parsed.length) return seedProjects();
    return parsed;
  } catch {
    return seedProjects();
  }
}

function persist(projects: Project[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    /* 超出配额时静默降级：本次会话仍可用 */
  }
}

export interface LastOpen {
  projectId: string;
  view: 'mindmap' | 'matrix' | 'graph' | 'route';
}

export function readLastOpen(): LastOpen | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastOpen;
    if (!v?.projectId) return null;
    return v;
  } catch {
    return null;
  }
}

export function writeLastOpen(v: LastOpen | null) {
  try {
    if (v) localStorage.setItem(LAST_KEY, JSON.stringify(v));
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

interface ProjectStore {
  projects: Project[];
  getProject: (id: string) => Project | undefined;
  addProject: (p: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  /** 只改单个知识点的字段（学习内容、描述等），并写回 YAML */
  updateNode: (projectId: string, nodeId: string, patch: Partial<Project['nodes'][number]>) => void;
  /** 批量追加节点（联网扩展子节点用），自动重建边与统计 */
  addNodes: (projectId: string, nodes: Project['nodes'], edges?: Project['edges']) => void;
  /** 追加/替换学习路线（AI 重排路线用） */
  upsertRoute: (projectId: string, route: Project['routes'][number]) => void;
  removeProject: (id: string) => void;
  resetDemo: () => void;
  /** 把项目写成 5 个 YAML 落盘（桌面壳下生效） */
  saveToDisk: (p: Project) => Promise<string | null>;
  /** 从本地 projects 目录重新载入（桌面壳下生效） */
  reloadFromDisk: () => Promise<number>;
  diskRoot: string | null;
}

const Ctx = createContext<ProjectStore | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [diskRoot, setDiskRoot] = useState<string | null>(null);
  const mergedRef = useRef(false);

  const commit = useCallback((next: Project[]) => {
    setProjects(next);
    persist(next);
  }, []);

  /** 桌面壳：把磁盘上的 projects 目录并进列表（磁盘为准） */
  const reloadFromDisk = useCallback(async () => {
    if (!desktop) return 0;
    try {
      const dirs = await desktop.list();
      const info = await desktop.info();
      setDiskRoot(info.projectsRoot);
      const diskProjects: Project[] = [];
      for (const d of dirs) {
        if (d.missing?.length === 5) continue; // 空目录跳过
        const res = parseBundle(d.files, d.dir);
        if (res.ok && res.project) diskProjects.push({ ...res.project, id: d.dir });
      }
      if (diskProjects.length) {
        setProjects((prev) => {
          const merged = [...diskProjects, ...prev.filter((p) => !diskProjects.some((d) => d.id === p.id))];
          persist(merged);
          return merged;
        });
      }
      return diskProjects.length;
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    if (mergedRef.current) return;
    mergedRef.current = true;
    void reloadFromDisk();
  }, [reloadFromDisk]);

  const saveToDisk = useCallback(async (p: Project) => {
    if (!desktop) return null;
    try {
      const files = serializeProject(p);
      const res = await desktop.write(p.id, files);
      return res.dirPath;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<ProjectStore>(
    () => ({
      projects,
      getProject: (id) => projects.find((p) => p.id === id),
      addProject: (p) => {
        commit([p, ...projects.filter((x) => x.id !== p.id)]);
        void saveToDisk(p);
      },
      updateProject: (id, patch) => {
        const next = projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p));
        commit(next);
        const hit = next.find((p) => p.id === id);
        // 只要有实质改动就落盘（节点内容/学习内容编辑也要写回 5 个 YAML）
        if (hit && desktop) {
          const files = serializeProject(hit);
          void desktop.write(hit.id, files);
        }
      },
      updateNode: (projectId, nodeId, nodePatch) => {
        const prev = projects.find((p) => p.id === projectId);
        if (!prev) return;
        const next = projects.map((p) =>
          p.id !== projectId
            ? p
            : { ...p, updatedAt: new Date().toISOString(), nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, ...nodePatch } : n)) }
        );
        commit(next);
        const hit = next.find((p) => p.id === projectId);
        if (hit && desktop) void desktop.write(hit.id, serializeProject(hit));
      },
      addNodes: (projectId, newNodes, newEdges = []) => {
        const prev = projects.find((p) => p.id === projectId);
        if (!prev) return;
        // 去重：同 id 的节点不重复插入
        const exist = new Set(prev.nodes.map((n) => n.id));
        const added = newNodes.filter((n) => !exist.has(n.id));
        if (!added.length) return;
        const nodes = [...prev.nodes, ...added];
        const edges = [...prev.edges, ...newEdges];
        const next = projects.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                updatedAt: new Date().toISOString(),
                nodes,
                edges,
                stats: { ...p.stats, nodes: nodes.length, edges: edges.length },
              }
        );
        commit(next);
        const hit = next.find((p) => p.id === projectId);
        if (hit && desktop) void desktop.write(hit.id, serializeProject(hit));
      },
      upsertRoute: (projectId, route) => {
        // 用 setProjects 的函数式更新避免 stale closure（连续两次 AI 重排时第二次会读不到第一次的结果）
        setProjects((prev) => {
          const hit = prev.find((p) => p.id === projectId);
          if (!hit) return prev;
          const exists = hit.routes.some((r) => r.id === route.id);
          const routes = exists ? hit.routes.map((r) => (r.id === route.id ? route : r)) : [...hit.routes, route];
          const next = prev.map((p) =>
            p.id !== projectId ? p : { ...p, updatedAt: new Date().toISOString(), routes }
          );
          persist(next);
          const target = next.find((p) => p.id === projectId);
          if (target && desktop) void desktop.write(target.id, serializeProject(target));
          return next;
        });
      },
      removeProject: (id) => {
        commit(projects.filter((p) => p.id !== id));
        if (desktop) void desktop.remove(id);
      },
      resetDemo: () => commit(seedProjects()),
      saveToDisk,
      reloadFromDisk,
      diskRoot,
    }),
    [projects, commit, saveToDisk, reloadFromDisk, diskRoot]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjects() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useProjects must be used within ProjectProvider');
  return c;
}
