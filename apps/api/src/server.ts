/** Local Node server: `npm run dev:api` (PORT, default 8787). Loads apps/api/.env if present. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadDotEnv } from './dotenv';
import { app } from './app';
import { env } from './env';

loadDotEnv(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));

const port = env.port();
serve({ fetch: app.fetch, port }, (info) => {
  const f = { claude: Boolean(env.anthropicKey()), jira: env.jira() !== null, database: Boolean(env.databaseUrl()) };
  console.log(`Scopewise API on http://localhost:${info.port}  (claude: ${f.claude}, jira: ${f.jira}, database: ${f.database}, model: ${env.model()})`);
});
