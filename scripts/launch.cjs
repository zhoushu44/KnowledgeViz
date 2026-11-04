/**
 * Electron 启动器：清掉可能继承的 ELECTRON_RUN_AS_NODE（否则 electron.exe 会退化成 node 解释器），
 * 然后加载桌面壳。用法：node scripts/launch.cjs [--dev]
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const electronBin = require(path.join(root, 'node_modules', 'electron')); // 返回 electron.exe 绝对路径

const dev = process.argv.includes('--dev');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
if (dev) env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

const child = spawn(electronBin, [root], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
