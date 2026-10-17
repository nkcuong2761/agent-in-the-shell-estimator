/** Errors that carry an HTTP status and a stable machine-readable code: `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorBody = (code: string, message: string, details?: unknown) => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

export function claudeNotConfigured(): ApiError {
  return new ApiError(
    503,
    'claude_not_configured',
    'ANTHROPIC_API_KEY is not set on the API, so AI features are off. Set it in apps/api/.env (local) or the Vercel project settings. The web app keeps working in demo mode.',
  );
}

export function jiraNotConfigured(): ApiError {
  return new ApiError(
    503,
    'jira_not_configured',
    'Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY on the API to read history and push estimates.',
  );
}
