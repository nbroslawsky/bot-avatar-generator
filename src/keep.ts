import sharp from 'sharp';
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { Config } from './config.js';
import { markKept } from './bots.js';
import { writeRun, type GenerateResult } from './generate.js';
import { refRank } from './style.js';

export interface KeptResult {
  full: string;
  written: string[];
}

// Downscales are only written for a keeper — doing it per variant would bury
// every run in files you never use.
export async function keepVariant(
  config: Config,
  result: GenerateResult,
  index: number,
  save: boolean,
): Promise<KeptResult> {
  const source = result.paths[index];
  if (!source) throw new Error(`No variant ${index + 1} in ${result.dir}`);

  const finalDir = join(result.dir, 'final');
  mkdirSync(finalDir, { recursive: true });

  const full = join(finalDir, `${result.run.slug}.png`);
  copyFileSync(source, full);
  const written = [full];

  for (const size of config.keep_sizes ?? []) {
    const out = join(finalDir, `${result.run.slug}-${size}.png`);
    // fit: 'contain' with a transparent pad keeps the avatar square even if the
    // model returned something a pixel off.
    await sharp(source)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    written.push(out);
  }

  writeRun(result.dir, { ...result.run, kept: full });
  if (save) markKept(config, result.run.name, full);

  return { full, written };
}

// One past the highest number already there, so a promoted avatar outranks
// every existing ref and the cap drops the oldest instead of the newest.
function nextRefPrefix(dir: string): string {
  if (!existsSync(dir)) return '01';
  const ranks = readdirSync(dir).map(refRank).filter(r => r >= 0);
  const next = ranks.length > 0 ? Math.max(...ranks) + 1 : 1;
  return String(next).padStart(2, '0');
}

export function promoteToStyleRefs(config: Config, imagePath: string, slug: string): string {
  mkdirSync(config.style_refs_dir, { recursive: true });
  const dest = join(config.style_refs_dir, `${nextRefPrefix(config.style_refs_dir)}-${slug}.png`);
  copyFileSync(imagePath, dest);
  return dest;
}

// ── variant review grammar ─────────────────────────────────────────────────

export type ReviewCommand =
  | { kind: 'done' }
  | { kind: 'promote' }
  | { kind: 'view'; index: number }
  | { kind: 'save'; index: number }
  | { kind: 'unknown' }
  | { kind: 'out-of-range'; index: number };

// Pure so the grammar can be tested without driving a terminal. "v2" views,
// "s2" saves, a bare "2" saves too — the common case shouldn't need a prefix.
export function parseReviewCommand(input: string, count: number): ReviewCommand {
  const answer = input.trim().toLowerCase();
  if (!answer || answer === 'q') return { kind: 'done' };
  if (answer === 'p') return { kind: 'promote' };

  const m = /^([vs]?)\s*(\d+)$/.exec(answer);
  if (!m) return { kind: 'unknown' };

  const index = parseInt(m[2], 10);
  if (index < 1 || index > count) return { kind: 'out-of-range', index };
  return { kind: m[1] === 'v' ? 'view' : 'save', index };
}
