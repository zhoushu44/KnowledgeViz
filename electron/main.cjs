/**
 * Electron 主进程：窗口 / 原生菜单 / 本地 project 目录读写
 * 项目以目录组织：<userData>/projects/<项目名>/{domain,dimensions,knowledge_points,relation_types,scenarios}.yaml
 */
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('./net.cjs');

const BUNDLE_FILES = [
  'domain.yaml',
  'dimensions.yaml',
  'knowledge_points.yaml',
  'relation_types.yaml',
  'scenarios.yaml',
];

const projectsRoot = () => path.join(app.getPath('userData'), 'projects');

let win = null;
/** requestId -> ClientRequest，用于取消正在流式输出的模型调用 */
const llmJobs = new Map();

/**
 * 流式对话代理：OpenAI 兼容接口，逐块把 delta 推回渲染进程。
 * 放在主进程做，既避开浏览器 CORS，也能统一超时与取消。
 */
function llmChat({ cfg, messages, requestId }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      llmJobs.delete(requestId);
      resolve(payload);
    };

    let url;
    try {
      url = new URL(String(cfg.baseUrl).replace(/\/$/, '') + '/chat/completions');
    } catch {
      return finish({ ok: false, error: '接口地址不合法' });
    }
    const body = Buffer.from(
      JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature ?? 0.3,
        max_tokens: cfg.maxTokens ?? 12000,
        stream: cfg.stream !== false,
        ...(cfg.extraBody ?? {}),
      }),
      'utf8'
    );
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.apiKey,
          'Content-Length': body.length,
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (raw += c));
          res.on('end', () => finish({ ok: false, error: `HTTP ${res.statusCode}：${raw.slice(0, 300)}` }));
          return;
        }
        res.setEncoding('utf8');
        if (cfg.stream === false) {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              const j = JSON.parse(raw);
              const choice = j.choices?.[0];
              const text = choice?.message?.content ?? '';
              if (text) win?.webContents.send('ksb:llmDelta', { requestId, delta: text });
              // 思维链吃满 max_tokens 时 finish_reason=length 且 content 为空，
              // 这种「成功但没内容」必须当成失败上报，否则上层只能静默回退到本地模板
              if (!text) {
                const think = choice?.message?.reasoning_content ? '（思维链占满了 token 预算）' : '';
                finish({
                  ok: false,
                  error:
                    choice?.finish_reason === 'length'
                      ? `模型输出被截断：max_tokens=${cfg.maxTokens ?? 8000} 不够${think}`
                      : `模型返回空内容${think}`,
                });
                return;
              }
              finish({ ok: true, text });
            } catch (e) {
              finish({ ok: false, error: '响应解析失败：' + String(e?.message ?? e) });
            }
          });
          return;
        }
        let buf = '';
        let acc = '';
        res.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              const d = j.choices?.[0]?.delta ?? {};
              if (d.reasoning_content) win?.webContents.send('ksb:llmDelta', { requestId, reasoning: d.reasoning_content });
              if (d.content) {
                acc += d.content;
                win?.webContents.send('ksb:llmDelta', { requestId, delta: d.content });
              }
            } catch {
              /* 跳过不完整的行 */
            }
          }
        });
        res.on('end', () => finish({ ok: true, text: acc }));
        res.on('error', (e) => finish({ ok: false, error: String(e?.message ?? e) }));
      }
    );

    req.setTimeout(10 * 60 * 1000, () => {
      req.destroy(new Error('模型调用超时（10 分钟）'));
    });
    req.on('error', (e) => finish({ ok: false, error: String(e?.message ?? e) }));
    req.write(body);
    req.end();
    llmJobs.set(requestId, req);
  });
}

async function readBundle(dirPath) {
  const files = {};
  const missing = [];
  for (const name of BUNDLE_FILES) {
    try {
      files[name] = await fs.readFile(path.join(dirPath, name), 'utf8');
    } catch {
      missing.push(name);
    }
  }
  return { files, missing };
}

async function listProjects() {
  const root = projectsRoot();
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dirPath = path.join(root, e.name);
    const { files, missing } = await readBundle(dirPath);
    out.push({ dir: e.name, dirPath, files, missing });
  }
  return out;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#F9FAFC',
    title: '知识体系可视化平台',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function send(action, payload) {
  win?.webContents.send('ksb:menu', { action, payload });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => send('create') },
        { label: '导入 YAML…', accelerator: 'CmdOrCtrl+I', click: () => send('import') },
        { type: 'separator' },
        { label: '返回我的项目', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('home') },
        { label: '打开项目目录', click: () => shell.openPath(projectsRoot()) },
        { type: 'separator' },
        { label: '内置大模型设置…', click: () => send('model') },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: '思维导图', accelerator: 'CmdOrCtrl+1', click: () => send('view', 'mindmap') },
        { label: '矩阵', accelerator: 'CmdOrCtrl+2', click: () => send('view', 'matrix') },
        { label: '图谱', accelerator: 'CmdOrCtrl+3', click: () => send('view', 'graph') },
        { label: '学习路线', accelerator: 'CmdOrCtrl+4', click: () => send('view', 'route') },
        { type: 'separator' },
        { label: '深入研究…', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('research') },
        { label: '事实核查…', accelerator: 'CmdOrCtrl+Shift+V', click: () => send('verify') },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: '关于知识体系可视化平台',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: '关于',
              message: '知识体系可视化平台',
              detail: `版本 ${app.getVersion()}\nKSB-YAML v1.0 · 项目目录：${projectsRoot()}`,
            }),
        },
        { label: '打开项目目录', click: () => shell.openPath(projectsRoot()) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('ksb:list', async () => listProjects());

ipcMain.handle('ksb:llmChat', (_e, payload) => llmChat(payload));
ipcMain.handle('ksb:llmCancel', (_e, requestId) => {
  const req = llmJobs.get(requestId);
  if (req) {
    req.destroy(new Error('已取消'));
    llmJobs.delete(requestId);
  }
  return { ok: true };
});

ipcMain.handle('ksb:write', async (_e, dir, files) => {
  if (!dir || /[\\/:*?"<>|]/.test(dir)) throw new Error('项目名不能用作目录名');
  const target = path.join(projectsRoot(), dir);
  await fs.mkdir(target, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (!BUNDLE_FILES.includes(name)) continue;
    await fs.writeFile(path.join(target, name), content, 'utf8');
  }
  return { ok: true, dirPath: target };
});

ipcMain.handle('ksb:delete', async (_e, dir) => {
  const target = path.join(projectsRoot(), dir);
  if (path.dirname(target) !== projectsRoot()) throw new Error('非法路径');
  await fs.rm(target, { recursive: true, force: true });
  return { ok: true };
});

ipcMain.handle('ksb:pickDir', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '选择包含 5 个 YAML 文件的项目目录',
    properties: ['openDirectory'],
    buttonLabel: '导入此目录',
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  const dirPath = res.filePaths[0];
  const { files, missing } = await readBundle(dirPath);
  return { canceled: false, dirPath, dirName: path.basename(dirPath), files, missing };
});

ipcMain.handle('ksb:reveal', async (_e, dir) => {
  const target = path.join(projectsRoot(), dir);
  if (existsSync(target)) await shell.openPath(target);
  return { ok: true };
});

ipcMain.handle('ksb:openExternal', async (_e, url) => {
  if (/^https?:/i.test(url)) await shell.openExternal(url);
  return { ok: true };
});

/**
 * 导出 Obsidian 知识库：
 *   默认落盘到 <Documents>/Obsidian 知识库/<folder>/
 *   首次导出时可直接「打开文件夹作为库」，不改动用户已有的库。
 */
ipcMain.handle('ksb:writeVault', async (_e, { folder, files }) => {
  if (!folder || /[\\/:*?"<>|]/.test(folder)) throw new Error('库名不能用作目录名');
  const root = path.join(app.getPath('documents'), 'Obsidian 知识库');
  const target = path.join(root, folder);
  await fs.mkdir(target, { recursive: true });
  for (const f of files ?? []) {
    const rel = String(f.path ?? '').replace(/\\/g, '/');
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) continue;
    const dest = path.join(target, rel);
    if (!dest.startsWith(target)) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, String(f.content ?? ''), 'utf8');
  }
  return { ok: true, path: target, reveal: true };
});

ipcMain.handle('ksb:revealPath', async (_e, p) => {
  if (typeof p === 'string' && existsSync(p)) await shell.openPath(p);
  return { ok: true };
});

ipcMain.handle('ksb:info', () => ({
  version: app.getVersion(),
  projectsRoot: projectsRoot(),
  electron: process.versions.electron,
}));

// ---------- 内置联网调研（TavilyMux） ----------

/** 联网搜索：多关键词并发 */
ipcMain.handle('ksb:netSearch', async (_e, { queries, opts }) => {
  const list = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q ?? '').trim()).filter(Boolean);
  if (!list.length) throw new Error('请至少输入一个关键词');
  return net.searchMany(list, opts ?? {});
});

/** 抓正文：多 URL 分批并发 */
ipcMain.handle('ksb:netExtract', async (_e, { urls, opts }) => {
  const list = (Array.isArray(urls) ? urls : [urls]).map((u) => String(u ?? '').trim()).filter(Boolean);
  if (!list.length) throw new Error('请至少提供一个 URL');
  return net.extractMany(list, opts ?? {});
});

/** 深入研究：单任务（提交后轮询，阶段事件推回渲染进程） */
ipcMain.handle('ksb:netResearch', async (e, { task, schema, model }) => {
  if (!String(task ?? '').trim()) throw new Error('请输入研究问题');
  const jobId = `r${Date.now()}`;
  const res = await net.research(String(task), {
    schema,
    model: model ?? 'mini',
    onTick: (tick) => {
      if (!e.sender.isDestroyed()) e.sender.send('ksb:netTick', { jobId, ...tick });
    },
  });
  return { jobId, ...res };
});

/** 批量深入研究：一次多个问题（限 4 条同时跑，闸门另有 6 路 research 上限） */
ipcMain.handle('ksb:netResearchMany', async (e, { tasks, model }) => {
  const list = (Array.isArray(tasks) ? tasks : [tasks]).map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!list.length) throw new Error('请至少输入一个问题');
  const jobId = `rm${Date.now()}`;
  const out = new Array(list.length);
  let cursor = 0;
  // 每条 research 还会补一次来源搜索，并发开太高会把网关拖到超时（实测 10 条全挂）
  const width = Math.max(1, Math.min(4, list.length));

  const worker = async () => {
    while (cursor < list.length) {
      const i = cursor++;
      try {
        out[i] = {
          task: list[i],
          ...(await net.research(list[i], {
            model: model ?? 'mini',
            onTick: (tick) => {
              if (!e.sender.isDestroyed()) e.sender.send('ksb:netTick', { jobId, task: list[i], ...tick });
            },
          })),
        };
      } catch (err) {
        out[i] = { task: list[i], error: String(err?.message ?? err) };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return out;
});

/** 事实核查：N 票并发 + 票型后验置信度 */
ipcMain.handle('ksb:netJudge', async (e, { claim, samples, mode }) => {
  if (!String(claim ?? '').trim()) throw new Error('请输入待核查的说法');
  const jobId = `j${Date.now()}`;
  return net.stableJudge(String(claim), {
    samples: Number(samples) || 3,
    mode: mode === 'fast' ? 'fast' : 'deep',
    onTick: (tick) => {
      if (!e.sender.isDestroyed()) e.sender.send('ksb:netTick', { jobId, ...tick });
    },
  });
});

/** 批量事实核查：多条说法 × 每条的 N 票全部并发 */
ipcMain.handle('ksb:netJudgeMany', async (e, { claims, samples, mode }) => {
  const list = (Array.isArray(claims) ? claims : [claims]).map((c) => String(c ?? '').trim()).filter(Boolean);
  if (!list.length) throw new Error('请至少输入一条说法');
  const jobId = `jm${Date.now()}`;
  const n = Number(samples) || 3;
  const md = mode === 'fast' ? 'fast' : 'deep';

  /**
   * 并发策略：说法之间限 3 条同时跑，每条内部再 n 票并发。
   * 这样总量 ≈ 3 × n 路 research；n=3 时是 9 路，正好压在 research 闸门（6）附近。
   * 之前不限流，10 条说法 × 3 票 = 30 路同时打，网关直接卡死（实测 221s 零返回）。
   */
  const width = Math.max(1, Math.min(3, list.length));
  const out = new Array(list.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const i = cursor++;
      try {
        out[i] = await net.stableJudge(list[i], {
          samples: n,
          mode: md,
          onTick: (tick) => {
            if (!e.sender.isDestroyed()) e.sender.send('ksb:netTick', { jobId, claim: list[i], ...tick });
          },
        });
      } catch (err) {
        out[i] = {
          claim: list[i],
          verdict: 'uncertain',
          confidence: 0,
          status: 'failed',
          votes: {},
          samples: 0,
          agreement: 0,
          reason: `核查失败：${String(err?.message ?? err)}`,
          evidence: [],
        };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return out;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
