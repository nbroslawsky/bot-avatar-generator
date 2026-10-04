import 'dotenv/config';
import { Command } from 'commander';
import { existsSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import { createInterface, type Interface } from 'readline';
import ora from 'ora';
import { relative, join } from 'path';
import { loadConfig, requireEnv, DEFAULT_CONFIG, type Config } from './config.js';
import { readBots, findBot, upsertBot, slugify, normalizeName, SLOT_FIELDS, type Bot, type SlotField } from './bots.js';
import { selectStyleRefs, loadTemplate, templateSlots, missingSlots } from './style.js';
import { generateAvatars, findLatestRun, type GenerateResult, type TraitSource } from './generate.js';

// ── small helpers ──────────────────────────────────────────────────────────

function elapsed(startMs: number): string {
  return `${Math.round((Date.now() - startMs) / 1000)}s`;
}

async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  const spinner = ora(label).start();
  const start = Date.now();
  const timer = setInterval(() => { spinner.text = `${label} (${elapsed(start)})`; }, 1000);
  try {
    const result = await task();
    clearInterval(timer);
    spinner.succeed(`${label} — done in ${elapsed(start)}`);
    return result;
  } catch (err) {
    clearInterval(timer);
    spinner.fail(`${label} — failed`);
    throw err;
  }
}

// One interface for the whole session — opening a fresh one per question drops
// whatever is already buffered on stdin. Once stdin ends (piped input runs out,
// or Ctrl-D) every later question answers itself with the default rather than
// throwing, so a non-interactive invocation finishes instead of crashing.
let rl: Interface | undefined;
let stdinDone = false;

function ask(question: string): Promise<string> {
  if (stdinDone) { console.log(question); return Promise.resolve(''); }
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on('close', () => { stdinDone = true; });
  }
  // Race the answer against stdin ending — if input runs out while a question
  // is pending, readline closes and its callback simply never fires.
  return new Promise(resolve => {
    const onClose = (): void => resolve('');
    rl!.once('close', onClose);
    rl!.question(question, answer => {
      rl!.off('close', onClose);
      resolve(answer.trim());
    });
  });
}

function closePrompts(): void {
  stdinDone = true;
  rl?.close();
  rl = undefined;
}

// Echo --config back in guidance text, so a message about the work family
// doesn't read like advice about the one at the repo root.
function configSuffix(configPath?: string): string {
  return !configPath || configPath === DEFAULT_CONFIG ? '' : ` --config ${configPath}`;
}

function here(p: string): string {
  return relative(process.cwd(), p) || p;
}

// ── generate flow ──────────────────────────────────────────────────────────

type GenOptions = Partial<Record<SlotField, string>> & {
  name?: string;
  variations?: string;
  all?: boolean;
  redescribe?: boolean;
  config?: string;
  save: boolean;
};

interface Resolved {
  bot: Bot;
  traitsFrom: TraitSource;
}

function slotsFromFlags(opts: GenOptions): Partial<Bot> {
  const picked: Partial<Bot> = {};
  for (const field of SLOT_FIELDS) {
    const value = opts[field];
    if (value) picked[field] = value;
  }
  return picked;
}

function printTraits(bot: Bot, slots: SlotField[]): void {
  const width = Math.max(...slots.map(s => s.length));
  for (const slot of slots) {
    console.log(`  ${slot.padEnd(width)}  ${bot[slot] ?? '—'}`);
  }
}

// Flags win, then whatever bots.yaml already knows, and only the slots still
// empty after that are worth spending a Claude call on.
async function resolveBot(config: Config, name: string, opts: GenOptions): Promise<Resolved> {
  const stored = findBot(config, name);
  const flags = slotsFromFlags(opts);
  const slots = templateSlots(loadTemplate(config));

  let bot: Bot = { ...(opts.redescribe ? { name } : stored ?? { name }), name: stored?.name ?? normalizeName(name), ...flags };
  let traitsFrom: TraitSource = Object.keys(flags).length > 0 ? 'flags' : 'bots.yaml';

  if (missingSlots(config, bot).length > 0) {
    if (!config.describer) {
      throw new Error(
        `Missing traits for "${name}": ${missingSlots(config, bot).join(', ')}. `
        + `Add them to ${here(config.bots_file)}, pass the matching --flags, or add a describer block to config.yaml.`,
      );
    }
    const { describeBot } = await import('./describe.js');
    requireEnv('ANTHROPIC_API_KEY', 'It fills in a new bot\'s traits; pass every --flag yourself to skip it.');

    const filled = await withSpinner(`Designing "${name}"`, () => describeBot(config, name));
    // Anything you set explicitly still wins over what Claude picked. The name
    // it hands back is the canonical one — "my chief of staff" becomes
    // "chief of staff" — unless this bot was already in bots.yaml under its own.
    const canonical = stored?.name ?? filled.name ?? bot.name;
    bot = { ...bot, ...filled, ...flags, name: canonical };
    traitsFrom = 'claude';

    // A vague prompt can resolve onto a bot that already exists under its real
    // name, so look again before writing a duplicate entry.
    const already = findBot(config, canonical);
    if (already && !opts.redescribe && slugify(already.name) !== slugify(bot.name)) {
      bot = { ...already, ...flags };
    }

    console.log('\nProposed traits:');
    printTraits(bot, slots);
    const edit = await ask('\nPress Enter to accept, or name a slot to change (e.g. "primary"): ');
    if (edit) {
      const field = SLOT_FIELDS.find(f => f === edit.toLowerCase().trim());
      if (!field) console.log(`No slot called "${edit}" — using the traits above.`);
      else {
        const value = await ask(`${field}: `);
        if (value) bot = { ...bot, [field]: value };
      }
    }
  } else {
    console.log(`\nTraits for "${bot.name}" (from ${traitsFrom}):`);
    printTraits(bot, slots);
  }

  return { bot, traitsFrom };
}

async function generateFor(config: Config, resolved: Resolved, variants: number, interactive: boolean, save: boolean): Promise<void> {
  const refs = selectStyleRefs(config);
  if (refs.used.length > 0) {
    console.log(`\nStyle refs (${refs.used.length}/${refs.max}): ${refs.used.map(here).join(', ')}`);
    if (refs.skipped.length > 0) {
      console.log(`  skipped (over the cap): ${refs.skipped.map(here).join(', ')}`);
    }
  } else {
    console.log('\nNo style refs found — generating from the style notes alone.');
  }

  const result = await withSpinner(
    `Generating ${variants} avatar(s) for "${resolved.bot.name}" via ${config.model}`,
    () => generateAvatars(config, { ...resolved, variants }),
  );

  console.log(`\nPrompt sent:\n${result.prompt.split('\n').map(l => `  ${l}`).join('\n')}\n`);
  result.paths.forEach((p, i) => console.log(`  ${i + 1}. ${here(p)}`));

  if (save) upsertBot(config, resolved.bot);

  if (!interactive) return;
  await reviewVariants(config, result, save);
}

// ── variant review ─────────────────────────────────────────────────────────

// Open a file in whatever the desktop uses. Detached and ignored, so a slow
// image viewer never holds up the prompt.
function openFile(path: string): boolean {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(opener, [path], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

// One loop for both `gen` and `keep`: look at variants and save the ones worth
// having, without leaving the command or retyping which bot you meant.
async function reviewVariants(config: Config, result: GenerateResult, save: boolean): Promise<void> {
  const n = result.paths.length;
  const { keepVariant, promoteToStyleRefs, parseReviewCommand } = await import('./keep.js');
  let lastKept: { full: string } | undefined;

  console.log(`\n  v1-v${n} view · s1-s${n} save · p promote the last save · Enter when done`);

  for (;;) {
    const command = parseReviewCommand(await ask('\n> '), n);

    if (command.kind === 'done') break;

    if (command.kind === 'unknown') {
      console.log('  Didn\'t follow that. Try v1 to view, s1 to save, p to promote, or Enter to finish.');
      continue;
    }

    if (command.kind === 'out-of-range') {
      console.log(`  There ${n === 1 ? 'is only 1 variant' : `are only ${n} variants`}.`);
      continue;
    }

    if (command.kind === 'promote') {
      if (!lastKept) { console.log('  Nothing saved yet — save one first with s1.'); continue; }
      console.log(`  Promoted to ${here(promoteToStyleRefs(config, lastKept.full, result.run.slug))}`);
      continue;
    }

    const path = result.paths[command.index - 1];

    if (command.kind === 'view') {
      console.log(openFile(path) ? `  Opening ${here(path)}` : `  Couldn't open it — ${here(path)}`);
      continue;
    }

    const kept = await keepVariant(config, result, command.index - 1, save);
    lastKept = kept;
    console.log(`  Saved v${command.index}:\n${kept.written.map(f => `    ${here(f)}`).join('\n')}`);
    console.log('  p to add it to the style refs.');
  }
}

async function runGen(opts: GenOptions): Promise<void> {
  const config = loadConfig(opts.config);
  requireEnv('OPENAI_API_KEY');
  const variants = opts.variations ? parseInt(opts.variations, 10) : config.variants;

  if (opts.all) {
    const bots = readBots(config);
    if (bots.length === 0) throw new Error(`No bots in ${here(config.bots_file)} yet. Make one first, e.g. npm run gen -- "chief of staff"${configSuffix(opts.config)}.`);
    console.log(`Regenerating ${bots.length} bot(s) — the keep step is skipped in --all.`);
    for (const bot of bots) {
      const gaps = missingSlots(config, bot);
      if (gaps.length > 0) {
        console.log(`\nSkipping "${bot.name}" — missing ${gaps.join(', ')}. Fill those in ${here(config.bots_file)} first.`);
        continue;
      }
      await generateFor(config, { bot, traitsFrom: 'bots.yaml' }, variants, false, false);
    }
    return;
  }

  if (!opts.name) {
    throw new Error('Say what the bot is, e.g. npm run gen -- "my chief of staff". Or --all to rebuild every bot in bots.yaml.');
  }
  const resolved = await resolveBot(config, opts.name, opts);
  await generateFor(config, resolved, variants, true, opts.save);
}

// ── keep flow ──────────────────────────────────────────────────────────────

// Curate an earlier run without paying to generate it again — the usual way a
// bot you like ends up steering the rest of the family.
async function runKeep(prompt: string[], opts: { variant?: string; config?: string }): Promise<void> {
  const config = loadConfig(opts.config);
  const name = prompt.join(' ').trim();
  if (!name) throw new Error('Say which bot, e.g. npm run keep -- "chief of staff"');

  const found = findLatestRun(config, name);
  if (!found) {
    // Almost always one of two things: the bot was never generated, or the name
    // doesn't match what the run was filed under. Answer both at once.
    const suffix = configSuffix(opts.config);
    const generated = existsSync(config.outputs_dir)
      ? readdirSync(config.outputs_dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
      : [];
    const alsoHave = generated.length > 0
      ? `\n\nRuns that do exist in ${here(config.outputs_dir)}:\n${generated.map(g => `  ${g}`).join('\n')}`
      : '';
    throw new Error(
      `No runs for "${name}" in ${here(config.outputs_dir)} — nothing has been generated for it yet.\n`
      + `Make one with: npm run gen -- "${name}"${suffix}${alsoHave}`,
    );
  }

  const paths = found.run.variants.map(v => join(found.dir, v)).filter(p => existsSync(p));
  if (paths.length === 0) {
    throw new Error(
      `The latest run for "${name}" (${here(found.dir)}) has no variant images left on disk.\n`
      + `Regenerate with: npm run gen -- "${name}"${configSuffix(opts.config)}`,
    );
  }

  console.log(`\nLatest run for "${found.run.name}" — ${here(found.dir)}`);
  paths.forEach((p, i) => console.log(`  ${i + 1}. ${here(p)}`));

  const result: GenerateResult = {
    dir: found.dir, paths, prompt: found.run.prompt, refs: found.run.styleRefs, run: found.run,
  };

  // --variant keeps one outright; otherwise fall into the same review loop
  // `gen` uses, so there is only ever one set of keystrokes to remember.
  if (opts.variant) {
    const index = parseInt(opts.variant, 10);
    if (Number.isNaN(index) || index < 1 || index > paths.length) {
      throw new Error(`--variant must be between 1 and ${paths.length}.`);
    }
    const { keepVariant } = await import('./keep.js');
    const kept = await keepVariant(config, result, index - 1, true);
    console.log(`\nKept:\n${kept.written.map(p => `  ${here(p)}`).join('\n')}`);
    return;
  }

  await reviewVariants(config, result, true);
}

// ── list flow ──────────────────────────────────────────────────────────────

function runList(opts: { config?: string }): void {
  const config = loadConfig(opts.config);
  const bots = readBots(config);
  if (bots.length === 0) {
    console.log(`No bots in ${here(config.bots_file)} yet. Add one with:\n  npm run gen -- "chief of staff"${configSuffix(opts.config)}`);
    return;
  }
  console.log(`${bots.length} bot(s) in ${here(config.bots_file)}:\n`);
  for (const bot of bots) {
    const gaps = missingSlots(config, bot);
    const mark = bot.kept ? '✓' : '·';
    console.log(`  ${mark} ${slugify(bot.name)}  —  ${bot.head ?? '?'}, ${bot.primary ?? '?'}`);
    console.log(`      ${bot.role ?? 'no role'}${bot.emblem ? `, ${bot.emblem} emblem` : ''}`);
    if (gaps.length > 0) console.log(`      missing: ${gaps.join(', ')}`);
    console.log(`      ${bot.kept ? here(bot.kept) : 'no avatar kept yet'}\n`);
  }
}

// ── wiring ─────────────────────────────────────────────────────────────────

const program = new Command();
program
  .name('bot-avatar')
  .description('Generate a family of bot avatars in one consistent style')
  .version('1.0.0');

program
  .command('gen')
  .description('Generate avatar variations for a bot, named in plain words')
  .argument('[prompt...]', 'What the bot is, e.g. "my chief of staff" or "linkedin poster"')
  .option('--role <text>', 'What the bot does, e.g. "research"')
  .option('--personality <text>', 'A couple of adjectives')
  .option('--head <text>', 'The head, from head_options in config.yaml')
  .option('--torso <text>', 'The torso')
  .option('--hardware <text>', 'Extra role-specific components')
  .option('--primary <color>', 'Dominant color')
  .option('--trim <color>', 'Sparing accent color')
  .option('--expression <text>', 'The face, in a few words')
  .option('--tool <text>', 'A handheld prop or gesture')
  .option('--emblem <text>', 'Simple embossed chest symbol')
  .option('--variations <n>', 'How many variations to generate (1-10)')
  .option('--redescribe', 'Ignore the stored traits and design the bot fresh')
  .option('--all', 'Regenerate every bot in bots.yaml')
  .option('--no-save', "Don't write the bot back to bots.yaml")
  .option('--config <family>', 'Which family — a name like "work", or a path to its config.yaml', DEFAULT_CONFIG)
  .action((prompt: string[], opts: GenOptions) => runGen({ ...opts, name: prompt.join(' ').trim() || undefined }));

program
  .command('keep')
  .description('Keep a variant from an earlier run, and optionally promote it into the style refs')
  .argument('[prompt...]', 'Which bot, e.g. "chief of staff"')
  .option('--variant <n>', 'Skip the prompt and keep this variant')
  .option('--config <family>', 'Which family — a name like "work", or a path to its config.yaml', DEFAULT_CONFIG)
  .action(runKeep);

program
  .command('list')
  .description('Show every bot and whether it has a kept avatar')
  .option('--config <family>', 'Which family — a name like "work", or a path to its config.yaml', DEFAULT_CONFIG)
  .action(runList);

program.parseAsync()
  .then(closePrompts)
  .catch((err: Error) => {
    closePrompts();
    console.error(`\n${err.message}`);
    process.exit(1);
  });
