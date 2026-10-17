/**
 * Thin layer over the Anthropic SDK shared by every agent:
 *  - one client per process, model from ANTHROPIC_MODEL;
 *  - JSON-schema tools derived from zod schemas (z.toJSONSchema);
 *  - "call this tool" requests validated with zod, retried once with the validation error fed back;
 *  - typed SDK errors mapped to ApiError so routes return `{ error: { code, message } }`.
 *
 * Model-specific request shape: current models (Sonnet 5.5, Opus 5.5, Fable 5.1) reject forced tool_choice, so
 * the tool is requested with tool_choice auto plus an explicit instruction; older models get a forced choice.
 * Refusal fallbacks (`fallbacks: "default"`) are on for the models that accept them; ANTHROPIC_FALLBACKS=off
 * disables them. No temperature is sent (non-default sampling is rejected by current models).
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Provenance } from '@scopewise/shared';
import { env } from './env';
import { ApiError, claudeNotConfigured } from './errors';

export type Effort = 'low' | 'medium' | 'high';

let client: Anthropic | null = null;
let clientKey: string | undefined;

export function getClient(): Anthropic {
  const key = env.anthropicKey();
  if (!key) throw claudeNotConfigured();
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
    clientKey = key;
  }
  return client;
}

const NO_FORCED_TOOL_CHOICE = /^claude-(sonnet-5-5|opus-5-5|haiku-5-5|fable-5-1|mythos-5-1)/;
const SUPPORTS_EFFORT = /^claude-(opus-4-[5-9]|opus-5|sonnet-4-6|sonnet-5|haiku-5|fable-5|mythos-5)/;
const SUPPORTS_DEFAULT_FALLBACKS = /^claude-(sonnet-5-5|opus-5-5|opus-5(?!-\d)|fable-5-1)/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function modelTraits(model: string) {
  return {
    forcedToolChoice: !NO_FORCED_TOOL_CHOICE.test(model),
    effort: SUPPORTS_EFFORT.test(model),
    fallbacks: env.fallbacks() && SUPPORTS_DEFAULT_FALLBACKS.test(model),
  };
}

export function provenance(promptVersion: string, model: string): Provenance {
  return { promptVersion, generatedBy: 'claude', model, generatedAt: new Date().toISOString() };
}

/** JSON schema for a tool's input, from a zod object schema (input side, so defaults are optional). */
export function toolSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== 'object') throw new Error('Tool schemas must be JSON objects');
  return json as Anthropic.Tool.InputSchema;
}

export function defineTool(name: string, description: string, schema: z.ZodType): Anthropic.Tool {
  return { name, description, input_schema: toolSchema(schema) };
}

export interface CreateOptions {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  /** Ask for this tool specifically (forced where the model allows it). */
  requireTool?: string;
  maxTokens?: number;
  effort?: Effort;
  /** tool_choice none: the model must answer in text (tools stay declared for the history). */
  noTools?: boolean;
}

/** One Messages API call with the model-specific extras; maps SDK errors to ApiError. */
export async function createMessage(opts: CreateOptions): Promise<Anthropic.Message> {
  const c = getClient();
  const model = env.model();
  const traits = modelTraits(model);
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: opts.messages,
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
    ...(opts.requireTool && traits.forcedToolChoice ? { tool_choice: { type: 'tool', name: opts.requireTool } } : {}),
    ...(opts.requireTool && !traits.forcedToolChoice ? { tool_choice: { type: 'auto' } } : {}),
    ...(opts.noTools && opts.tools?.length ? { tool_choice: { type: 'none' } } : {}),
  };
  // Fields newer than this SDK's types: passed through in the JSON body.
  const extra: Record<string, unknown> = {};
  if (opts.effort && traits.effort) extra.output_config = { effort: opts.effort };
  if (traits.fallbacks) extra.fallbacks = 'default';
  const body = { ...params, ...extra } as Anthropic.MessageCreateParamsNonStreaming;
  try {
    const res = await c.messages.create(body, traits.fallbacks ? { headers: { 'anthropic-beta': FALLBACK_BETA } } : undefined);
    if (res.stop_reason === 'refusal') {
      throw new ApiError(502, 'claude_refusal', 'Claude declined this request. Try rephrasing the brief or removing unrelated content.');
    }
    return res;
  } catch (err) {
    throw mapClaudeError(err);
  }
}

export function mapClaudeError(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ApiError(502, 'claude_auth', 'The API could not authenticate with Anthropic. Check ANTHROPIC_API_KEY.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ApiError(429, 'claude_rate_limited', 'Anthropic rate limit reached. Wait a minute and try again.');
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new ApiError(502, 'claude_model_not_found', `Model "${env.model()}" was not found. Check ANTHROPIC_MODEL.`);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ApiError(502, 'claude_bad_request', `Anthropic rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiError(504, 'claude_timeout', 'The request to Anthropic timed out. Try again.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ApiError(502, 'claude_unreachable', 'Could not reach the Anthropic API.');
  }
  if (err instanceof Anthropic.APIError) {
    return new ApiError(502, 'claude_error', `Anthropic API error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
  }
  return err;
}

export function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export function formatZodError(err: z.ZodError): string {
  return z.prettifyError(err);
}

export interface StructuredCall<T> {
  system: string;
  user: Anthropic.MessageParam['content'];
  tool: { name: string; description: string; schema: z.ZodType<T> };
  /** Extra semantic checks after zod parsing; return human-readable problems (empty = valid). */
  check?: (value: T) => string[];
  /** Silent clean-ups before validation (e.g. sort o ≤ m ≤ p). */
  repair?: (input: unknown) => unknown;
  maxTokens?: number;
  effort?: Effort;
  /** Label used in error messages. */
  label: string;
}

/**
 * Ask Claude to call one tool and return its validated input. On a zod or semantic failure, the error is sent
 * back as a tool_result with is_error and Claude gets exactly one more attempt; then a clear 502 is thrown.
 * Conversation history is append-only (the assistant turn is passed back unchanged).
 */
export async function callStructured<T>(call: StructuredCall<T>): Promise<{ value: T; model: string }> {
  const tool = defineTool(call.tool.name, call.tool.description, call.tool.schema);
  const system = `${call.system}\n\nRespond by calling the \`${call.tool.name}\` tool exactly once with the complete result.`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: call.user }];
  let lastProblem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await createMessage({ system, messages, tools: [tool], requireTool: call.tool.name, maxTokens: call.maxTokens, effort: call.effort });
    if (res.stop_reason === 'max_tokens') {
      // A cut-off tool_use block can't be paired with a result, so start again from the original request.
      lastProblem = 'The response was cut off at the output limit.';
      const blocks: Anthropic.ContentBlockParam[] = typeof call.user === 'string' ? [{ type: 'text', text: call.user }] : [...call.user];
      blocks.push({ type: 'text', text: `A previous attempt exceeded the output limit. Keep reasons, quotes and the email short.` });
      messages.splice(0, messages.length, { role: 'user', content: blocks });
      continue;
    }
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === call.tool.name);
    messages.push({ role: 'assistant', content: res.content });
    if (!use) {
      lastProblem = `No \`${call.tool.name}\` tool call in the response.`;
      const others = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      messages.push({
        role: 'user',
        content: [
          ...others.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, is_error: true, content: 'Unknown tool.' })),
          { type: 'text' as const, text: `You must answer by calling the \`${call.tool.name}\` tool.` },
        ],
      });
      continue;
    }
    const input = call.repair ? call.repair(use.input) : use.input;
    const parsed = call.tool.schema.safeParse(input);
    const problems = parsed.success ? (call.check?.(parsed.data) ?? []) : [formatZodError(parsed.error)];
    if (parsed.success && problems.length === 0) return { value: parsed.data, model: res.model ?? env.model() };
    lastProblem = problems.join('\n');
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: `The ${call.label} did not pass validation. Fix these problems and call \`${call.tool.name}\` again with the complete corrected result:\n${lastProblem}`,
        },
      ],
    });
  }
  throw new ApiError(502, 'claude_invalid_output', `The ${call.label} returned invalid output twice. Last problems: ${lastProblem.slice(0, 1500)}`);
}
