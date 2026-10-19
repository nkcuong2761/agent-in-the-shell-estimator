/**
 * Build the Vercel function: one ESM file at api/index.js with the API, the workspace packages and the JSON data
 * inlined, plus a copy of prompts/ next to it (data.ts reads prompts with fs at runtime). npm packages stay
 * external so Vercel's file tracer ships them from node_modules as they are.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = resolve(here, '..');
const root = resolve(api, '..', '..');

rmSync(resolve(api, 'api'), { recursive: true, force: true });
mkdirSync(resolve(api, 'api'), { recursive: true });
rmSync(resolve(api, 'prompts'), { recursive: true, force: true });
cpSync(resolve(root, 'prompts'), resolve(api, 'prompts'), { recursive: true });

await build({
  entryPoints: [resolve(api, 'src/vercel.ts')],
  outfile: resolve(api, 'api/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  external: ['hono', 'hono/*', '@hono/node-server', '@hono/node-server/*', '@anthropic-ai/sdk', 'postgres', 'unpdf', 'zod'],
  // Some CommonJS dependencies reach for `require` even inside an ESM bundle.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
console.log('bundled api/index.js and copied prompts/');
