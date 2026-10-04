import { readFileSync, readdirSync, existsSync, openSync, readSync, closeSync, statSync } from 'fs';
import { join } from 'path';
import type { Config } from './config.js';
import type { Bot, SlotField } from './bots.js';

// Each [BRACKETED] token in references/style.md maps to one bots.yaml field.
// Add a slot by adding a row here and using the token in the template.
export const SLOTS: Record<string, SlotField> = {
  'BOT ROLE': 'role',
  'ROLE': 'role',
  'PERSONALITY TRAITS': 'personality',
  'HEAD SHAPE': 'head',
  'HEAD HARDWARE': 'head',
  'TORSO HARDWARE': 'torso',
  'ROLE-SPECIFIC HARDWARE': 'hardware',
  'PRIMARY COLOR': 'primary',
  'ROLE COLOR': 'primary',
  'TRIM COLOR': 'trim',
  'EXPRESSION': 'expression',
  'TOOL OR GESTURE': 'tool',
  'SIMPLE EMBOSSED SYMBOL': 'emblem',
  'CHEST SYMBOL': 'emblem',
};

const PLACEHOLDER = /\[([A-Z][A-Z0-9 -]*)\]/g;

const IMAGE_MAGIC: Array<[string, (h: Buffer) => boolean]> = [
  ['image/png', h => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', h => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff],
  ['image/webp', h => h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP'],
];

export interface RefSelection {
  used: string[];
  skipped: string[];
  max: number;
}

// Sniff the header rather than trust the extension — images dragged out of a
// chat or a download often arrive with no suffix at all, and silently skipping
// one of your references is worse than reading twelve bytes.
export function imageTypeOf(path: string): string | null {
  let fd: number | undefined;
  try {
    if (!statSync(path).isFile()) return null;
    fd = openSync(path, 'r');
    const head = Buffer.alloc(12);
    if (readSync(fd, head, 0, 12, 0) < 12) return null;
    return IMAGE_MAGIC.find(([, match]) => match(head))?.[0] ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// HTML comments in the template are addressed to the human editing it, so they
// never reach the model.
export function loadTemplate(config: Config): string {
  if (!existsSync(config.style_notes_file)) {
    throw new Error(`No prompt template at ${config.style_notes_file}. It holds the family style — restore it before generating.`);
  }
  return readFileSync(config.style_notes_file, 'utf-8').replace(/<!--[\s\S]*?-->/g, '').trim();
}

// Which slots the template actually uses. The template is the source of truth,
// so adding a [NEW SLOT] there is picked up without touching the CLI.
export function templateSlots(template: string): SlotField[] {
  const found = new Set<SlotField>();
  for (const [, token] of template.matchAll(PLACEHOLDER)) {
    const field = SLOTS[token];
    if (field) found.add(field);
  }
  return [...found];
}

export function missingSlots(config: Config, bot: Bot): SlotField[] {
  return templateSlots(loadTemplate(config)).filter(f => !bot[f]);
}

// A leading number, however it is separated from the rest of the name — your
// own files may be "1 - writing assistant" while promoted ones are "06-foo.png".
export function refRank(file: string): number {
  const m = /^(\d+)\s*[-_.]?\s*/.exec(file);
  return m ? parseInt(m[1], 10) : -1;
}

// Highest number wins the cap. Promoting an avatar gives it the next number up,
// so the set drifts towards your own bots as you make them — the originals fall
// out of the cap on their own instead of needing to be deleted. Anything with no
// numeric prefix ranks last.
export function selectStyleRefs(config: Config): RefSelection {
  const max = config.max_style_refs ?? 4;
  if (!existsSync(config.style_refs_dir)) return { used: [], skipped: [], max };

  const files = readdirSync(config.style_refs_dir)
    .filter(f => imageTypeOf(join(config.style_refs_dir, f)) !== null)
    .sort((a, b) => refRank(b) - refRank(a) || b.localeCompare(a, undefined, { numeric: true }))
    .map(f => join(config.style_refs_dir, f));

  return { used: files.slice(0, max), skipped: files.slice(max), max };
}

// Fill the template from the bot's fields. Every unfilled slot is an error —
// a prompt that still says "[PRIMARY COLOR]" produces a bot with the word
// printed on its chest.
export function buildPrompt(config: Config, bot: Bot): string {
  const template = loadTemplate(config);
  const missing = new Set<string>();

  const prompt = template.replace(PLACEHOLDER, (match, token: string) => {
    const field = SLOTS[token];
    if (!field) return match;
    const value = bot[field];
    if (!value) { missing.add(token); return match; }
    return value;
  });

  if (missing.size > 0) {
    throw new Error(
      `Unfilled slots for "${bot.name}": ${[...missing].join(', ')}. `
      + `Add them to ${config.bots_file.replace(process.cwd() + '/', '')}, or pass the matching --flag.`,
    );
  }
  return prompt;
}
