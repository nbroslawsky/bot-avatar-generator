import OpenAI, { toFile } from 'openai';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import type { Config } from './config.js';
import { slugify, normalizeName, type Bot } from './bots.js';
import { buildPrompt, selectStyleRefs, imageTypeOf } from './style.js';

export type TraitSource = 'flags' | 'bots.yaml' | 'claude';

export interface RunRecord {
  name: string;
  slug: string;
  id: string;
  createdAt: string;
  bot: Bot;
  traitsFrom: TraitSource;
  model: string;
  prompt: string;
  styleRefs: string[];
  variants: string[];
  kept?: string;
}

export interface GenerateInput {
  bot: Bot;
  traitsFrom: TraitSource;
  variants: number;
}

export interface GenerateResult {
  dir: string;
  paths: string[];
  prompt: string;
  refs: string[];
  run: RunRecord;
}

export function runJsonPath(dir: string): string {
  return join(dir, 'run.json');
}

// Most recent run folder for a bot — timestamp names sort chronologically.
// Accepts the same loose naming as the registry, so "my chief of staff" finds
// the folder written as chief-of-staff.
export function findLatestRun(config: Config, name: string): { dir: string; run: RunRecord } | null {
  const candidates = [slugify(name), slugify(normalizeName(name))];
  const dir = candidates
    .map(slug => join(config.outputs_dir, slug))
    .find(d => existsSync(d));
  if (!dir) return null;
  const ids = readdirSync(dir).filter(d => /^\d+$/.test(d)).sort((a, b) => Number(b) - Number(a));
  for (const id of ids) {
    const runDir = join(dir, id);
    const run = readRun(runDir);
    if (run) return { dir: runDir, run };
  }
  return null;
}

export function readRun(dir: string): RunRecord | null {
  const file = runJsonPath(dir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as RunRecord;
  } catch {
    return null;
  }
}

export function writeRun(dir: string, run: RunRecord): void {
  writeFileSync(runJsonPath(dir), `${JSON.stringify(run, null, 2)}\n`);
}

function saveB64Image(b64: string, filePath: string): void {
  writeFileSync(filePath, Buffer.from(b64, 'base64'));
}

export async function generateAvatars(config: Config, input: GenerateInput): Promise<GenerateResult> {
  const client = new OpenAI();
  const { used: refs } = selectStyleRefs(config);
  const prompt = buildPrompt(config, input.bot);

  const slug = slugify(input.bot.name);
  const id = Date.now().toString();
  const dir = join(config.outputs_dir, slug, id);

  const common = {
    model: config.model,
    prompt,
    n: input.variants,
    size: config.size,
    quality: config.quality,
    background: config.background,
    output_format: 'png',
  } as const;

  // With refs on disk we go through the edit endpoint, which is the only way to
  // hand the model the rest of the family to match against.
  const response = refs.length > 0
    ? await client.images.edit({
      ...common,
      image: await Promise.all(refs.map(p => toFile(
        readFileSync(p),
        basename(p),
        { type: imageTypeOf(p) ?? 'image/png' },
      ))),
    })
    : await client.images.generate(common);

  // Only now that there is something to put in it — a failed call used to leave
  // an empty timestamp folder behind on every retry.
  mkdirSync(dir, { recursive: true });

  const items = response.data ?? [];
  const paths: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const filePath = join(dir, `v${i + 1}.png`);
    if (!item.b64_json) throw new Error(`No image data returned for variant ${i + 1}`);
    saveB64Image(item.b64_json, filePath);
    paths.push(filePath);
  }

  const run: RunRecord = {
    name: input.bot.name,
    slug,
    id,
    createdAt: new Date().toISOString(),
    bot: input.bot,
    traitsFrom: input.traitsFrom,
    model: config.model,
    prompt,
    styleRefs: refs,
    variants: paths.map(p => basename(p)),
  };
  writeRun(dir, run);

  return { dir, paths, prompt, refs, run };
}
