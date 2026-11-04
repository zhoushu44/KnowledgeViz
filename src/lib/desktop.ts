/** 桌面壳能力封装：在 Electron 里走真实文件系统，在浏览器里自动降级 */
export interface DesktopProjectDir {
  dir: string;
  dirPath: string;
  files: Record<string, string>;
  missing: string[];
}

export interface DesktopApi {
  isDesktop: true;
  list: () => Promise<DesktopProjectDir[]>;
  write: (dir: string, files: Record<string, string>) => Promise<{ ok: boolean; dirPath: string }>;
  remove: (dir: string) => Promise<{ ok: boolean }>;
  pickDir: () => Promise<{
    canceled: boolean;
    dirPath?: string;
    dirName?: string;
    files?: Record<string, string>;
    missing?: string[];
  }>;
  reveal: (dir: string) => Promise<{ ok: boolean }>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  info: () => Promise<{ version: string; projectsRoot: string; electron: string }>;
  onMenu: (cb: (m: { action: string; payload?: unknown }) => void) => () => void;
  /** 导出 Obsidian 知识库：写入「文档/Obsidian 知识库/<folder>/」，返回落盘路径 */
  writeVault?: (folder: string, files: { path: string; content: string }[]) => Promise<{ ok: boolean; path: string; reveal?: boolean }>;
  /** 在资源管理器中定位任意路径 */
  revealPath?: (p: string) => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    ksb?: DesktopApi;
  }
}

export const desktop: DesktopApi | undefined = typeof window !== 'undefined' ? window.ksb : undefined;

export const isDesktop = () => Boolean(desktop?.isDesktop);
