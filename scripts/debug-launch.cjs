const { spawn } = require('node:child_process');
const path = require('node:path');
const root = process.cwd();
const electronBin = require(path.join(root, 'node_modules', 'electron'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = [root, '--remote-debugging-port=9444'];
const child = spawn(electronBin, args, { env, stdio: 'inherit', detached: false });
child.on('exit', (c) => process.exit(c ?? 0));
