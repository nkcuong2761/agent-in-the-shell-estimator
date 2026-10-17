/** Brief-pack uploads: multipart files (.md/.txt/.eml as text, .pdf via unpdf) → BriefPack. */
import type { BriefPack, SourceKind } from '@scopewise/shared';
import { BriefPack as BriefPackSchema } from '@scopewise/shared';
import { ApiError } from './errors';

export const UPLOAD_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 6 * 1024 * 1024,
  maxFiles: 10,
  /** Text sent to Claude across all sources. */
  maxTotalChars: 300_000,
};

const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'eml']);

export function kindFor(name: string): SourceKind {
  const n = name.toLowerCase();
  const ext = n.split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'eml' || /e-?mail/.test(n)) return 'email';
  if (/transcript/.test(n)) return 'transcript';
  if (/jira|ticket/.test(n)) return 'jira';
  return 'notes';
}

async function pdfText(bytes: Uint8Array, name: string): Promise<string> {
  try {
    const { extractText } = await import('unpdf');
    const { text } = await extractText(bytes, { mergePages: true });
    return text;
  } catch (err) {
    throw new ApiError(422, 'pdf_unreadable', `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type BodyValue = string | File | (string | File)[];

export async function briefFromForm(body: Record<string, BodyValue>): Promise<BriefPack> {
  const field = (k: string) => {
    const v = body[k];
    return typeof v === 'string' ? v.trim() : undefined;
  };
  const files = Object.values(body)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is File => typeof v !== 'string');
  if (files.length === 0 && !field('text')) {
    throw new ApiError(400, 'no_files', 'Upload at least one file (.md, .txt, .eml or .pdf) or a "text" field.');
  }
  if (files.length > UPLOAD_LIMITS.maxFiles) throw new ApiError(413, 'too_many_files', `At most ${UPLOAD_LIMITS.maxFiles} files per brief.`);
  let total = 0;
  const sources: BriefPack['sources'] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const name = f.name || `upload-${sources.length + 1}.txt`;
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (f.size > UPLOAD_LIMITS.maxFileBytes) throw new ApiError(413, 'file_too_large', `${name} is ${(f.size / 1048576).toFixed(1)} MB; the limit is 2 MB per file.`);
    total += f.size;
    if (total > UPLOAD_LIMITS.maxTotalBytes) throw new ApiError(413, 'upload_too_large', 'Uploads are limited to 6 MB in total.');
    let text: string;
    if (ext === 'pdf') text = await pdfText(new Uint8Array(await f.arrayBuffer()), name);
    else if (TEXT_EXT.has(ext)) text = await f.text();
    else throw new ApiError(415, 'unsupported_file', `${name}: only .md, .txt, .eml and .pdf files are supported.`);
    text = text.split(String.fromCharCode(0)).join('').trim();
    if (!text) throw new ApiError(422, 'empty_file', `${name} has no readable text${ext === 'pdf' ? ' (is it a scanned image?)' : ''}.`);
    let unique = name;
    for (let k = 2; seen.has(unique); k++) unique = name.replace(/(\.[^.]+)?$/, `-${k}$1`);
    seen.add(unique);
    sources.push({ kind: kindFor(name), name: unique, text });
  }
  const pasted = field('text');
  if (pasted) sources.push({ kind: 'notes', name: 'pasted-notes.txt', text: pasted });
  const chars = sources.reduce((s, x) => s + x.text.length, 0);
  if (chars > UPLOAD_LIMITS.maxTotalChars) {
    throw new ApiError(413, 'brief_too_long', `The brief has ${chars.toLocaleString('en-US')} characters of text; the limit is ${UPLOAD_LIMITS.maxTotalChars.toLocaleString('en-US')}.`);
  }
  return BriefPackSchema.parse({
    id: field('id') || `upload-${Date.now().toString(36)}`,
    title: field('title') || sources[0]?.name.replace(/\.[^.]+$/, '') || 'Uploaded brief',
    ...(field('clientDeadline') ? { clientDeadline: field('clientDeadline') } : {}),
    sources,
  });
}

export function checkBriefSize(brief: BriefPack): void {
  if (brief.sources.length > UPLOAD_LIMITS.maxFiles + 1) throw new ApiError(413, 'too_many_sources', `At most ${UPLOAD_LIMITS.maxFiles} sources per brief.`);
  const chars = brief.sources.reduce((s, x) => s + x.text.length, 0);
  if (chars > UPLOAD_LIMITS.maxTotalChars) throw new ApiError(413, 'brief_too_long', `The brief is ${chars} characters; the limit is ${UPLOAD_LIMITS.maxTotalChars}.`);
}
