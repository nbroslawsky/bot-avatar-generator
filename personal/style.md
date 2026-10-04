<!--
  This is the prompt template. Everything outside the [BRACKETS] is sent to the
  image model verbatim on every run; the bracketed slots are filled per bot from
  that bot's entry in bots.yaml.

  Slots: [BOT ROLE] [PERSONALITY TRAITS] [HEAD SHAPE] [PRIMARY COLOR]
         [TRIM COLOR] [EXPRESSION] [TOOL OR GESTURE] [SIMPLE EMBOSSED SYMBOL]

  Add or remove slots freely — any [UPPERCASE BRACKETED] token is matched to a
  bots.yaml field by the mapping in src/style.ts.

  These HTML comments are stripped before the model sees anything.
-->

Use case: stylized-concept
Asset type: square profile avatar for a coordinated family of AI assistant bots

Input images:
Use the supplied images as references for the shared design language, materials, proportions, mechanical construction, face style, claws, lighting, and rendering quality. Do not copy one reference character exactly. Create a distinct sibling within the same product family.

Primary request:
Create a [BOT ROLE] assistant bot. It should feel [PERSONALITY TRAITS] and be immediately distinguishable from the other bots at small avatar size.

FAMILY INVARIANTS — preserve across every bot:
- Clearly non-human, gender-neutral robot
- Premium contemporary 3D mascot design
- Glossy black digital face display inset into the head
- Simple luminous-blue geometric eyes, eyebrows, and mouth
- Neutral off-white rim surrounding the face display
- Dark graphite joints, neck, and flexible mechanical connections
- Two rounded three-part mechanical pincer hands
- Tactile matte body panels with subtle realistic reflections
- Small warm-yellow status light below the chest emblem
- Role emblem centered consistently on the upper chest
- Friendly, sophisticated proportions—not childish or humanoid
- Bright diffused studio lighting, with soft shading on the body itself but nothing behind it
- Fully transparent background — no backdrop, no halo, no cast shadow
- Centered chest-up portrait, readable at small size
- Square format and safe for circular cropping

ROLE-SPECIFIC VARIABLES:
- Role: [BOT ROLE]
- Personality: [PERSONALITY TRAITS]
- Head silhouette: [HEAD SHAPE]
- Dominant suit color: [PRIMARY COLOR]
- Secondary trim: [TRIM COLOR]
- Expression: [EXPRESSION]
- Tool or gesture: [TOOL OR GESTURE]
- Chest emblem: [SIMPLE EMBOSSED SYMBOL]

HEAD DESIGN:
Give this bot a distinctive [HEAD SHAPE] head silhouette. The shape should remain recognizable when reduced to a 64-pixel avatar.

The glossy black face display should follow the general contour of the head while preserving the family's luminous-blue facial graphics. Keep the neutral off-white face rim as a family identifier. The rear and side portions of the head casing may use the bot's dominant suit color.

COLOR DESIGN:
Use [PRIMARY COLOR] across approximately 60–75% of the visible torso armor, shoulder shells, forearm shells, rear head casing, and outer pincer shells.

Use [TRIM COLOR] sparingly across approximately 5–10% of the design for rings, seams, or small edge details.

Keep the face display black, facial graphics blue, face rim off-white, mechanical joints graphite, and status light warm yellow.

The dominant color must remain clearly visible when the avatar is displayed very small.

ROLE COMMUNICATION:
Communicate the bot's function through its head silhouette, dominant color, expression, pose, handheld tool, and chest emblem. Avoid relying on tiny details that disappear at avatar size.

Style and rendering:
Clean contemporary 3D mascot illustration with premium animated-film rendering. Soft tactile matte materials, polished industrial construction, subtle realistic reflections, and slightly cartoony proportions.

Composition:
Centered chest-up three-quarter portrait. Both pincer hands may be visible when useful, without obscuring the face or chest emblem. Strong, uncluttered silhouette. Square composition, safe for circular cropping.

Background:
The background must be fully transparent — a clean alpha cut-out with crisp edges around the bot. Do not add a backdrop, halo, gradient, glow, vignette, or ground shadow, even if a reference image has one. The references are for the character's design language only, never for its background.

Constraints:
Exactly two pincer hands. No human skin, hair, clothing, gendered anatomy, readable text, official platform logos, watermark, extra limbs, floating objects, weapons, armor, sharp claws, or excessive mechanical detail.
