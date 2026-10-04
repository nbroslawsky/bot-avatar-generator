# bot-avatar-generator

A small CLI for giving every bot in a family an avatar that looks like it came
from the same set. You write the style once, drop in a couple of examples, and
each new bot is one command.

## Setup

```bash
npm install
cp .env.example .env    # fill in OPENAI_API_KEY
```

Each family is one self-contained folder:

```
personal/            work/
  config.yaml          config.yaml      settings and paths
  style.md             style.md         the prompt template
  style-refs/          style-refs/      references sent to the model
  bots.yaml            bots.yaml        the registry
  outputs/             outputs/         generated runs
```

`personal/` is the default; `work/` is a second family in a completely different
style. Nothing in `src/` knows what either looks like.

Run everything from the project root — `config.yaml` is read relative to cwd.

## Usage

```bash
npm run gen -- "my chief of staff"             # the default family (personal/)
npm run gen -- "vendor manager" --config work  # any other family, by name
npm run gen -- "linkedin poster"
npm run gen -- "research" --primary "deep teal" --head "rounded hexagon"
npm run gen -- "research" --redescribe         # throw out the stored traits, start over
npm run gen -- --all                           # rebuild every bot, non-interactive
npm run keep -- "chief of staff"               # review an earlier run, no new spend
npm run list                                   # every bot, and which have an avatar

npm run gen:work -- "vendor manager"           # shorthands for the work family
npm run list:work
```

Say what the bot is in plain words and it infers the rest: role, personality,
head shape, colors, expression, prop, and chest emblem — picking a head from the
bounded vocabulary in `config.yaml` and steering clear of colors its siblings
already use. Leading "my"/"the" and a trailing "bot" are stripped, so
`"my chief of staff"` is filed as `chief of staff`. It shows you the traits
before spending anything, and any slot you pass as a flag wins.

Accepted traits are saved to `bots.yaml`, so the design step happens once per bot
and the file stays hand-editable afterwards.

A run then generates N variations and drops you into a review loop:

```
  v1-v4 view · s1-s4 save · p promote the last save · Enter when done

> v2            opens v2 in your image viewer
> v3
> s2            saves v2 — final/<bot>.png plus 512/256/128 copies
> p             adds it to the style refs
> <Enter>       done
```

Look at as many as you like, save more than one, all without leaving the command.
A bare number saves, so `2` and `s2` are the same thing. `npm run keep -- "<bot>"`
drops into the identical loop for an earlier run, so a bot you decide you like
later doesn't have to be regenerated.

### Growing the reference set

References are ranked by their leading number, **highest first**, and only the
top `max_style_refs` are sent. Promoting an avatar numbers it one above
everything already there, so it goes straight to the front and the oldest
reference falls out of the cap on its own. Seed the folder with whatever you
have, then promote your own bots as you make them — the set migrates to your
own work without you having to delete anything.

### Slots

| Slot | Flag | Template tokens | Example |
| --- | --- | --- | --- |
| role | `--role` | `[BOT ROLE]` `[ROLE]` | `research` |
| personality | `--personality` | `[PERSONALITY TRAITS]` | `curious and methodical` |
| head | `--head` | `[HEAD SHAPE]` `[HEAD HARDWARE]` | `rounded hexagon` |
| torso | `--torso` | `[TORSO HARDWARE]` | `small NAS chassis` |
| hardware | `--hardware` | `[ROLE-SPECIFIC HARDWARE]` | `drive caddies, data cables` |
| primary | `--primary` | `[PRIMARY COLOR]` `[ROLE COLOR]` | `deep teal` |
| trim | `--trim` | `[TRIM COLOR]` | `gold` |
| expression | `--expression` | `[EXPRESSION]` | `attentive with a slight smile` |
| tool | `--tool` | `[TOOL OR GESTURE]` | `holding a magnifying lens` |
| emblem | `--emblem` | `[SIMPLE EMBOSSED SYMBOL]` `[CHEST SYMBOL]` | `open book` |

A template uses whatever subset it needs — a slot it never mentions is never
asked for. Several tokens can map to one field, so two families can call the
same slot `[HEAD SHAPE]` and `[HEAD HARDWARE]` and still share the code.

Slots are defined by the `[BRACKETED]` tokens in `references/style.md` and mapped
to fields by `SLOTS` in `src/style.ts`. Add a token there and a row in that map
and the CLI picks it up.

## How it works

```
  --flags ────┐
  bots.yaml ──┼──► the eight slots ──┐
  Claude ─────┘                      │
                                     ├──► filled prompt ──► gpt-image-2.5 ──► v1..vN.png
  references/style.md (template) ────┘            ▲
  references/style-refs/ ─────────────────────────┘ (sent as reference images)
```

With reference images present it calls the image **edit** endpoint, handing the
model the rest of the family to match. Without them it falls back to plain
generation. Any slot left unfilled is an error rather than a prompt that still
says `[PRIMARY COLOR]`.

## More than one family

Everything style-specific lives in four config keys — `bots_file`,
`style_notes_file`, `style_refs_dir`, `outputs_dir` — plus `head_options` and the
template. They resolve **next to the config file**, not the shell's cwd, so a
family is just a folder with a config in it:

```bash
npm run gen -- "deploy bot" --config work                  # by family name
npm run gen -- "deploy bot" --config work/config.yaml      # same thing
npm run gen -- "deploy bot" --config ~/other/config.yaml   # anywhere on disk
```

Add a family by copying one of the folders, emptying `bots.yaml`, `style-refs/`
and `outputs/`, and rewriting `style.md`. To move one into its own repo so
colleagues can use it, `mv` the folder and point `--config` at where it landed —
`bots.yaml` stores paths relative to its own family, so nothing breaks. Give it
its own `.env` if it needs a separate API key.

`personal` is the default only in the sense that it needs no flag
(`DEFAULT_CONFIG` in `src/config.ts`). The families are otherwise equal.

The two already use different slot sets — work keys on torso and role hardware,
personal on personality and trim — out of one shared map in `src/style.ts`. The
describer reads each family's template before designing a bot, so the same prompt
yields a rounded-hexagon mascot in one and a rack-mount UPS chassis in the other.

## Config

Every key in `config.yaml` is commented. The ones you'll actually touch:

| Key | Why you'd change it |
| --- | --- |
| `model` | `gpt-image-2.5-sunburst` holds the reference style tightest; `-flare` is faster and cheaper |
| `quality` | `high` is the default — `xhigh`/`max` multiply by the variant count |
| `background` | `transparent` by default; `opaque` if your style wants a filled backdrop |
| `variants` | How many to generate per run, 1-10, in a single API call |
| `max_style_refs` | How many examples get sent. Numeric filename prefixes decide which ones win |
| `head_options` | The bounded head vocabulary the describer picks from |
| `describer` | Delete the block to turn off the design step — then every slot must come from `bots.yaml` or a flag |

## Output

```
outputs/<bot-slug>/<timestamp>/
  v1.png … vN.png      the variations
  run.json             what was generated, from which prompt and which refs
  final/               written only when you keep one
    <bot>.png  <bot>-512.png  <bot>-256.png  <bot>-128.png
```

## Cost

Every `gen` run hits a paid image API, and cost scales with `variants` × `quality`.
Use `--variations 1` while you're dialing in the style prompt.
