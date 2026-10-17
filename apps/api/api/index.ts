/**
 * Vercel entry (Node.js runtime). vercel.json rewrites every path to this function, so routes are the same
 * as the local server (/health, /scope, ...). `@hono/node-server/vercel` adapts Node's req/res to Hono;
 * `hono/vercel`'s `handle` expects the Web Request signature, which Vercel only passes on the Edge runtime,
 * and the Edge runtime can't run the Anthropic SDK + fs prompt loading as written.
 */
import { handle } from '@hono/node-server/vercel';
import { app } from '../src/app';

export const config = { runtime: 'nodejs', api: { bodyParser: false } };

export default handle(app);
