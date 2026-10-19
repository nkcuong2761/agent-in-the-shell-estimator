/**
 * Public agent API. scripts/precompute-demo.ts imports this module dynamically with `--live`.
 *
 *   runScopeAgent(brief, { lessons })      → { scope, provenance }
 *   runPanel(brief, scope, analogs)        → { panel, provenance }
 *   runPostmortem(project, items)          → { result, provenance }   (falls back to the engine's template notes)
 *   runAsk(messages, context, seedData)    → AskResponse
 */
export { runScopeAgent, runScopeOffline } from './scope';
export { runPanel, runPanelOffline } from './panel';
export { runPostmortem } from './postmortem';
export { runAsk } from './ask';
