/** Runtime configuration, read lazily from process.env so tests and scripts can set it before use. */

/** Current Sonnet (see the claude-api reference); override with ANTHROPIC_MODEL. */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

const val = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

export const env = {
  anthropicKey: () => val('ANTHROPIC_API_KEY'),
  model: () => val('ANTHROPIC_MODEL') ?? DEFAULT_MODEL,
  /** `off` disables server-side refusal fallbacks (on by default for models that support them). */
  fallbacks: () => (val('ANTHROPIC_FALLBACKS') ?? 'default') !== 'off',
  databaseUrl: () => val('DATABASE_URL'),
  publicWebUrl: () => val('PUBLIC_WEB_URL'),
  port: () => Number(val('PORT') ?? 8787),
  corsOrigins: () =>
    (val('CORS_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
  storePath: () => val('STORE_PATH'),
  jira: (): JiraConfig | null => {
    const baseUrl = val('JIRA_BASE_URL');
    const email = val('JIRA_EMAIL');
    const apiToken = val('JIRA_API_TOKEN');
    const projectKey = val('JIRA_PROJECT_KEY');
    if (!baseUrl || !email || !apiToken || !projectKey) return null;
    return { baseUrl: baseUrl.replace(/\/+$/, ''), email, apiToken, projectKey };
  },
};
