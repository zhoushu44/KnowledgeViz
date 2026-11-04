const { buildSync } = require('../node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js');
const entry = process.argv[2] || 'scripts/unit-learning.mts';
const out = process.argv[3] || 'scripts/.unit-learning.built.mjs';
buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile: out,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  define: {
    'import.meta.env.VITE_KSB_LLM_BASE_URL': '""',
    'import.meta.env.VITE_KSB_LLM_API_KEY': '""',
    'import.meta.env.VITE_KSB_LLM_MODEL': '"test"',
  },
  logLevel: 'warning',
});
console.log('built', out);
