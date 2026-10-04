import Anthropic from '@anthropic-ai/sdk';
import type { Config } from './config.js';
import type { Bot, SlotField } from './bots.js';
import { takenTraits } from './bots.js';
import { loadTemplate, templateSlots } from './style.js';

const SLOT_GUIDANCE: Record<SlotField, string> = {
  role: 'The bot\'s job as a bare noun phrase — "research", "operations", "chief of staff". '
    + 'The template already supplies the words "assistant bot", so do not include "assistant", "bot", or "agent".',
  personality: 'Two or three adjectives, e.g. "curious and methodical".',
  head: 'The head. Choose from the bounded vocabulary below — nothing else.',
  torso: 'The torso, as a short concrete noun phrase in this family\'s idiom.',
  hardware: 'Two to four extra components that serve the role, comma-separated.',
  primary: 'The dominant suit color, a plain color name like "deep teal" or "burnt orange".',
  trim: 'A sparing accent color for rings and seams, e.g. "cyan" or "gold".',
  expression: 'The face, in a few words, e.g. "attentive with a slight smile".',
  tool: 'One handheld prop or gesture that reads at small size, e.g. "holding a magnifying lens".',
  emblem: 'A simple embossed chest symbol, two or three words, e.g. "magnifying lens".',
};

// Fills every slot the template asks for. Runs at most once per bot — the
// answer lands in bots.yaml and is reused and hand-editable from then on.
export async function describeBot(config: Config, name: string): Promise<Partial<Bot>> {
  if (!config.describer) throw new Error('No describer configured in config.yaml.');

  const slots = templateSlots(loadTemplate(config));
  if (slots.length === 0) return {};

  const properties: Record<string, unknown> = {
    name: {
      type: 'string',
      description: 'The bot\'s canonical short name, lowercase, no leading article or '
        + 'possessive and no trailing "bot"/"assistant" — "chief of staff", not "my chief of staff bot".',
    },
  };
  for (const slot of slots) {
    properties[slot] = slot === 'head'
      ? { type: 'string', enum: config.head_options, description: SLOT_GUIDANCE.head }
      : { type: 'string', description: SLOT_GUIDANCE[slot] };
  }

  const taken = takenTraits(config, slots, name);
  const client = new Anthropic();

  const response = await client.messages.create({
    model: config.describer.model,
    max_tokens: 2048,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: { type: 'object', properties, required: ['name', ...slots], additionalProperties: false },
      },
    },
    messages: [{
      role: 'user',
      content: `You are designing one member of a family of avatars. The family is defined by the
prompt template below — read it to understand the idiom, then pick traits that belong in it.
Do not restate the template; only fill the slots.

<template>
${loadTemplate(config)}
</template>

The request is: "${name}". Read it as the bot's job — strip any leading "my"/"the" and any
trailing "bot"/"assistant" to get its canonical name — then infer what it does and choose its
design traits. If the request is vague, commit to a sensible reading rather than hedging.

Head shape vocabulary — pick the one whose connotation fits the role:
${config.head_options.map(h => `- ${h}`).join('\n')}

${taken ? `Siblings that already exist — give this bot a clearly different dominant color, and a different head shape unless the role genuinely calls for the same one:\n${taken}\n` : ''}
The avatar is viewed small, so the role has to read from silhouette, color, and one prop — not fine detail. Keep every value short and concrete.`,
    }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to describe this bot. Fill the fields in bots.yaml by hand instead.');
  }

  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(block.text) as Partial<Bot>;
  } catch {
    throw new Error(`Could not parse the described traits as JSON:\n${block.text}`);
  }
}
