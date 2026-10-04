# bot-avatar-generator

TypeScript CLI that generates avatars for a family of bots, keeping them all in
one consistent style.

1. Takes a plain-words prompt (`"my chief of staff"`) and resolves its design
   slots — role, personality, head shape, primary and trim color, expression,
   prop, chest emblem — from CLI flags, from `bots.yaml`, or by asking Claude to
   design the ones still missing and to hand back a canonical name
2. Fills those slots into the prompt template in `references/style.md`
3. Sends it to OpenAI (`gpt-image-2.5-sunburst`) with the example avatars in
   `references/style-refs/` attached as reference images, and gets N variations back
4. Offers to keep one — which writes 512/256/128 downscales — and then to promote
   it into `references/style-refs/` so it steers every later bot

It is a deliberately smaller sibling of `../blog-post-image-generator`: no web
app, no concept-ideation step, no refinement loop.

## Architecture

```
src/cli.ts        — commander CLI (gen, keep, list), spinner and readline helpers, the interactive flow
src/config.ts     — config loading, config-relative path resolution, env vars
src/bots.ts       — bots.yaml read/write, slugify, loose-name matching, upsert-by-slug
src/style.ts      — the template engine: slot map, placeholder filling, reference-image selection
src/describe.ts   — claude-opus-5 via @anthropic-ai/sdk designs a new bot's slots (optional)
src/generate.ts   — OpenAI images.edit / images.generate, writes variants + run.json
src/keep.ts       — sharp downscales, promote a keeper into style-refs, review-loop grammar
```

## The template owns the prompt

`references/style.md` is the whole prompt, not a fragment the code decorates.
Everything outside the `[BRACKETED]` tokens is sent verbatim; each token is
filled from the matching `bots.yaml` field.

**Put new guidance in the template. The code's job is substitution, not authorship.**

Slots are discovered from the template at runtime via `templateSlots()`, so
adding a `[NEW SLOT]` needs only a row in the `SLOTS` map in `src/style.ts` and
a field on `Bot` in `src/bots.ts`. An unfilled slot is a hard error — a prompt
that still reads `[PRIMARY COLOR]` gets those words printed on the bot's chest.

`SLOTS` is many-to-one on purpose: `[HEAD SHAPE]` and `[HEAD HARDWARE]` both map
to `head`, `[CHEST SYMBOL]` and `[SIMPLE EMBOSSED SYMBOL]` both to `emblem`. That
is how two families with different vocabularies share one `Bot` type. A template
uses only the subset it names, so the root family never gets asked for a torso.

`describeBot()` is handed the family's whole template as context, so it writes in
that family's idiom rather than a hardcoded one, and `takenTraits()` reports the
slots that family actually uses. Neither has any notion of what a bot looks like.

## Conventions

- ESM, `"type": "module"`, `.js` extensions on relative imports, no build step —
  run with `tsx`.
- 2-space indent, single quotes, semicolons, trailing commas. No prettier or eslint.
- `interface` for object shapes, `type` for unions. Explicit return types on
  exported functions.
- Short `//` comments above functions explaining *why*. No JSDoc.
- Errors are plain `Error` with a message that names the fix, e.g.
  `Add them to bots.yaml, pass the matching --flags, or add a describer block`.
- Every `config.yaml` key gets a conversational `#` comment.
- Keep `CLAUDE.md` and `AGENTS.md` in sync — they differ only in the agent name.

## Gotchas

- Each family is a self-contained folder (`personal/`, `work/`) holding
  `config.yaml`, `style.md`, `style-refs/`, `bots.yaml` and `outputs/`. Nothing
  lives at the repo root but code and docs.
- `loadConfig(path)` resolves `bots_file`, `style_notes_file`, `style_refs_dir`
  and `outputs_dir` against the **config file's own folder**, not cwd, and sets
  `config.root` to that folder. That is the whole multi-family mechanism.
  `--config` takes a family name (`work`) or a path to a config.yaml. Adding a
  new path key means adding it to `PATH_KEYS` in `config.ts`, or it silently
  stays cwd-relative and breaks for every family but the one you tested.
- `bots.yaml` stores `kept:` **relative to `config.root`** via `keptPath()`.
  Never write an absolute path there — it pins a portable file to one machine
  and breaks the moment the family folder moves.
- User-facing guidance strings should pass `opts.config` through
  `configSuffix()` so a message about the work family doesn't print a command
  that would act on the root one.
- Reference images go **straight to the image model** via `images.edit`, not to a
  text model for description. That is the main lever on family resemblance.
  `input_fidelity` is in the OpenAI SDK types but the gpt-image-2.5 models reject
  it with a 400 — do not add it back.
- `background: transparent` requires a `png` or `webp` output format, and the
  template's Background section has to agree with it. Seed references may have
  backdrops, so the template tells the model explicitly to ignore them — drop
  that paragraph and the backdrop comes back.
- Transparent output looks like it has a dark background in most viewers, which
  composite alpha on black. Check the alpha channel or flatten onto a loud colour
  before concluding the model ignored the instruction — it usually hasn't.
- Interactive prompts share one readline interface and treat end-of-stdin as
  "take the default", so a non-interactive invocation finishes instead of
  hanging. Piping several answers in is still unreliable; that's readline.
- Downscales are written only for a kept variant, never per-variant.
- `gen` and `keep` share one review loop (`reviewVariants` in `cli.ts`): v1/s1/p,
  a bare number meaning save, Enter to finish. Its grammar is `parseReviewCommand`
  in `keep.ts` — kept pure and out of `cli.ts` precisely so it can be tested
  without a terminal, since importing `cli.ts` runs the program.
- References rank by leading number, **highest first**, and promotion numbers a
  new one above everything present — that is what lets the set migrate from
  seed images to your own bots without deleting anything. `refRank()` in
  `src/style.ts` is the single definition of what counts as a prefix; `1 - foo`
  and `06-foo.png` both parse, and `nextRefPrefix()` in `keep.ts` uses it too.
  Those two drifting apart silently makes promoted refs rank last.
- The describer is shown the existing bots so it won't hand two of them the same
  colour or head shape. That only works if `bots.yaml` is kept current.
- Bot lookup is loose: `normalizeName()` strips a leading article or possessive
  and a trailing "bot"/"assistant", so `"my chief of staff"` finds the stored
  `chief of staff`. Output folders are looked up the same way.
- Every `gen` run costs money. Use `--variations 1` while iterating.
