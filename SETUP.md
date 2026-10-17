# Setup: the steps only you can do

The app already works without any of this: `npm install && npm run dev` gives you the full demo locally. These steps put it online and turn on the live features. Each step is independent of the ones after it.

## 1. Publish the demo on GitHub Pages (needed for judges)

1. Open GitHub → **Settings → General**. Under **Danger Zone**, choose **Change visibility → Make public**. Free GitHub Pages requires a public repo.
2. Open **Settings → Pages**. Under **Build and deployment**, set **Source: GitHub Actions**.
3. Merge this branch into `main`, or push to `main`. The **Deploy web to GitHub Pages** workflow (`.github/workflows/pages.yml`) builds `apps/web` with `VITE_BASE=/<repo-name>/` and deploys it.
4. The URL appears on the workflow run and under **Settings → Pages**: `https://<user>.github.io/agent-in-the-shell-estimator/`.

If you rename the repo, nothing needs to change: the workflow uses the repo name for the base path.

## 2. Anthropic API key (API only)

1. Go to https://console.anthropic.com → **API Keys → Create Key**.
2. Put it in `ANTHROPIC_API_KEY`. Use `apps/api/.env` locally (git-ignored), or the Vercel environment variables (step 5). Never put it in `apps/web`.
3. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
4. Regenerate the demo cache with real Claude output, then commit the result:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm run precompute -- --live
   npm run eval
   ```

## 3. Jira Cloud site with fake history

1. Create a free site at https://www.atlassian.com/software/jira/free.
2. Create a **Scrum** or **Kanban** project with key `SCOPE`, or any key you like.
3. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens.
4. Set these variables, in `apps/api/.env` or Vercel:
   ```
   JIRA_BASE_URL=https://<your-site>.atlassian.net
   JIRA_EMAIL=<the email you log in with>
   JIRA_API_TOKEN=<token>
   JIRA_PROJECT_KEY=SCOPE
   ```
5. Load the seed history. It is idempotent and skips issues that already exist, using `seed:<id>` labels:
   ```bash
   npm run push-to-jira -- --dry-run   # see what it will create
   npm run push-to-jira                 # create 43 epics, 415 stories with estimates and worklogs
   ```
6. If time tracking is off in your project, turn it on under **Project settings → Features**, or **Issue types → Fields → Time tracking**.

## 4. (Optional) Supabase Postgres for lessons

1. Create a project at https://supabase.com.
2. Go to **Project settings → Database → Connection string → URI**, and use the pooled connection string.
3. Set `DATABASE_URL=postgresql://...`. The API creates its two tables on first use.

Without it, lessons are stored in a JSON file. On Vercel that file is in `/tmp`, so it resets on cold start.

## 5. Deploy the API to Vercel and connect the site

1. Go to https://vercel.com/new and import this repository.
2. Set **Root Directory** to `apps/api`, and enable **Include files outside the root directory in the Build Step**. The API imports `packages/*`, `prompts/` and `data/`.
3. Set Framework Preset to **Other**. `apps/api/vercel.json` routes every path to `api/index.ts`.
4. Under **Environment Variables**, add the variables from steps 2–4, plus:
   - `CORS_ORIGINS=https://<user>.github.io`
   - `PUBLIC_WEB_URL=https://<user>.github.io/agent-in-the-shell-estimator/`
5. Deploy, then open `https://<your-api>.vercel.app/health`. It should return `{"ok":true,...}` and list which features are on.
6. In GitHub, go to **Settings → Secrets and variables → Actions → Variables → New repository variable**: `VITE_API_BASE_URL=https://<your-api>.vercel.app`. Re-run the Pages workflow.

The site now shows **Live mode**. Uploading a brief, Jira sync, Push to Jira and live Ask turn on according to what `/health` reports.

If the Vercel build fails on TypeScript imports from the workspace packages, bundle the function first:

```bash
npx esbuild apps/api/api/index.ts --bundle --platform=node --format=esm --outfile=apps/api/dist/index.mjs
```

Then point `vercel.json` at the bundle.

## Run everything locally

```bash
npm install
cp apps/api/.env.example apps/api/.env       # fill in what you have
npm run dev:api                              # http://localhost:8787
VITE_API_BASE_URL=http://localhost:8787 npm run dev   # http://localhost:5173
```
