/**
 * Vercel entry (Node.js runtime). scripts/bundle.mjs bundles this file with esbuild into api/index.js, the one
 * serverless function; vercel.json rewrites every path to it, so routes are the same as the local server
 * (/health, /scope, ...). Bundling is what lets Vercel run the workspace packages' TypeScript sources. `@hono/node-server/vercel` adapts Node's req/res to Hono;
 * `hono/vercel`'s `handle` expects the Web Request signature, which Vercel only passes on the Edge runtime,
 * and the Edge runtime can't run the Anthropic SDK + fs prompt loading as written.
 */
import { handle } from '@hono/node-server/vercel';
import { app } from './app';

export const config = { runtime: 'nodejs', api: { bodyParser: false } };

export default handle(app);
