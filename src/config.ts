import { readFileSync, existsSync, statSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { load } from 'js-yaml';

export interface DescriberConfig { model: string; }

export interface Config {
  model: string;
  size: string;
  quality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
  background: 'transparent' | 'opaque' | 'auto';
  variants: number;
  keep_sizes: number[];
  bots_file: string;
  style_notes_file: string;
  style_refs_dir: string;
  max_style_refs: number;
  outputs_dir: string;
  head_options: string[];
  describer?: DescriberConfig;
  /** Absolute path to the family folder — the directory holding this config. */
  root: string;
}

const PATH_KEYS = ['bots_file', 'style_notes_file', 'style_refs_dir', 'outputs_dir'] as const;

// The family used when --config is omitted. Any sibling family is one
// `--config <name>` away; this is only which one needs no flag.
export const DEFAULT_CONFIG = './personal';

// Paths resolve against the config file's own folder, not the shell's cwd. That
// is what lets a second family — work, a client, anything — live in its own
// directory (or its own repo) with nothing shared but the code: point --config
// at it and every path inside it still means what it says.
// Accepts a path to a config file, or just a family name — `--config work` and
// `--config work/config.yaml` mean the same thing.
function resolveConfigPath(configPath: string): string {
  const direct = resolve(configPath);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;

  const asFamily = resolve(configPath, 'config.yaml');
  if (existsSync(asFamily)) return asFamily;

  throw new Error(
    `No config at ${configPath}. Pass a family name like --config work, `
    + `a path to its config.yaml, or run from the project root for the default family.`,
  );
}

export function loadConfig(configPath = DEFAULT_CONFIG): Config {
  const file = resolveConfigPath(configPath);
  const config = load(readFileSync(file, 'utf-8')) as Config;
  const base = dirname(file);
  config.root = base;

  for (const key of PATH_KEYS) {
    const value = config[key];
    if (typeof value === 'string' && !isAbsolute(value)) config[key] = resolve(base, value);
  }
  return config;
}

export function requireEnv(name: string, why?: string): string {
  const val = process.env[name];
  if (!val) {
    const reason = why ? ` ${why}` : '';
    throw new Error(`Missing required env var: ${name}.${reason} Copy .env.example to .env and fill it in.`);
  }
  return val;
}
