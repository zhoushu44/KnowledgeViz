const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ksb', {
  isDesktop: true,
  list: () => ipcRenderer.invoke('ksb:list'),
  write: (dir, files) => ipcRenderer.invoke('ksb:write', dir, files),
  remove: (dir) => ipcRenderer.invoke('ksb:delete', dir),
  pickDir: () => ipcRenderer.invoke('ksb:pickDir'),
  reveal: (dir) => ipcRenderer.invoke('ksb:reveal', dir),
  openExternal: (url) => ipcRenderer.invoke('ksb:openExternal', url),
  info: () => ipcRenderer.invoke('ksb:info'),
  writeVault: (folder, files) => ipcRenderer.invoke('ksb:writeVault', { folder, files }),
  revealPath: (p) => ipcRenderer.invoke('ksb:revealPath', p),
  onMenu: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('ksb:menu', handler);
    return () => ipcRenderer.removeListener('ksb:menu', handler);
  },
});

contextBridge.exposeInMainWorld('ksbLlm', {
  chat: (cfg, messages, requestId) => ipcRenderer.invoke('ksb:llmChat', { cfg, messages, requestId }),
  cancel: (requestId) => ipcRenderer.invoke('ksb:llmCancel', requestId),
  onDelta: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('ksb:llmDelta', handler);
    return () => ipcRenderer.removeListener('ksb:llmDelta', handler);
  },
});

/** 内置联网调研（TavilyMux）：search / extract / research / judge，全部并发 */
contextBridge.exposeInMainWorld('ksbNet', {
  search: (queries, opts) => ipcRenderer.invoke('ksb:netSearch', { queries, opts }),
  extract: (urls, opts) => ipcRenderer.invoke('ksb:netExtract', { urls, opts }),
  research: (task, opts) => ipcRenderer.invoke('ksb:netResearch', { task, ...(opts ?? {}) }),
  researchMany: (tasks, opts) => ipcRenderer.invoke('ksb:netResearchMany', { tasks, ...(opts ?? {}) }),
  judge: (claim, opts) => ipcRenderer.invoke('ksb:netJudge', { claim, ...(opts ?? {}) }),
  judgeMany: (claims, opts) => ipcRenderer.invoke('ksb:netJudgeMany', { claims, ...(opts ?? {}) }),
  onTick: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('ksb:netTick', handler);
    return () => ipcRenderer.removeListener('ksb:netTick', handler);
  },
});
