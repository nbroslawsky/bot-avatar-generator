import { readFileSync, writeFileSync, existsSync } from 'fs';
import { load, dump } from 'js-yaml';
import { isAbsolute, relative } from 'path';
import type { Config } from './config.js';

// One field per [BRACKETED] slot in references/style.md, plus the bookkeeping
// the CLI needs. Keep this in sync with SLOTS in style.ts.
export interface Bot {
  name: string;
  role?: string;
  personality?: string;
  head?: string;
  torso?: string;
  hardware?: string;
  primary?: string;
  trim?: string;
  expression?: string;
  tool?: string;
  emblem?: string;
  kept?: string;
}

export const SLOT_FIELDS = [
  'role', 'personality', 'head', 'torso', 'hardware', 'primary', 'trim', 'expression', 'tool', 'emblem',
] as const;

export type SlotField = typeof SLOT_FIELDS[number];

interface BotsFile { bots: Bot[]; }

// "my chief of staff", "the LinkedIn poster bot" and "chief-of-staff" should all
// find the same bot, so leading filler and a trailing "bot" come off first.
const FILLER = /^(my|our|the|a|an)\s+/i;

export function normalizeName(text: string): string {
  let out = text.trim();
  let prev = '';
  while (out !== prev) { prev = out; out = out.replace(FILLER, ''); }
  return out.replace(/\s+(bot|agent|assistant)$/i, '').trim() || text.trim();
}

export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return slug || 'bot';
}

export function readBots(config: Config): Bot[] {
  if (!existsSync(config.bots_file)) return [];
  const parsed = load(readFileSync(config.bots_file, 'utf-8')) as BotsFile | null;
  if (!parsed || !Array.isArray(parsed.bots)) return [];
  // Drop anything malformed rather than crashing — the file is hand-editable.
  return parsed.bots.filter(b => b && typeof b.name === 'string');
}

export function findBot(config: Config, name: string): Bot | undefined {
  const bots = readBots(config);
  const exact = slugify(name);
  const loose = slugify(normalizeName(name));
  return bots.find(b => slugify(b.name) === exact)
    ?? bots.find(b => slugify(normalizeName(b.name)) === loose);
}

// The header comment is rewritten on every save, so a hand-edited file keeps it.
function writeBots(config: Config, bots: Bot[]): void {
  const header = [
    '# Every bot that has an avatar. One field per slot in references/style.md —',
    '# edit them by hand any time, then rerun to regenerate.',
    '',
  ].join('\n');
  const body = bots.length > 0 ? dump({ bots }, { lineWidth: 100 }) : 'bots: []\n';
  writeFileSync(config.bots_file, `${header}${body}`);
}

// Upsert by slug so "Chief of Staff" and "chief-of-staff" are the same bot.
export function upsertBot(config: Config, bot: Bot): void {
  const bots = readBots(config);
  const slug = slugify(bot.name);
  const i = bots.findIndex(b => slugify(b.name) === slug);
  if (i === -1) bots.push(bot);
  else bots[i] = { ...bots[i], ...bot };
  writeBots(config, bots);
}

// Stored relative to the family folder, never absolute — bots.yaml is meant to
// travel with its family, and an absolute path pins it to one machine.
export function keptPath(config: Config, fullPath: string): string {
  return isAbsolute(fullPath) ? relative(config.root, fullPath) : fullPath;
}

export function markKept(config: Config, name: string, fullPath: string): void {
  const bot = findBot(config, name);
  if (!bot) return;
  upsertBot(config, { ...bot, kept: keptPath(config, fullPath) });
}

// What the describer needs to avoid handing two bots the same traits. Reports
// whichever slots this family's template actually uses, rather than a fixed
// three — a family keyed on torso hardware needs to see torsos.
export function takenTraits(config: Config, slots: readonly SlotField[], excludeName?: string): string {
  const slug = excludeName ? slugify(excludeName) : '';
  const others = readBots(config).filter(b => slugify(b.name) !== slug);
  if (others.length === 0) return '';
  return others
    .map(b => `- ${b.name}: ${slots.map(s => `${s} ${b[s] ?? '?'}`).join('; ')}`)
    .join('\n');
}
