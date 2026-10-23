import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { ALL_UNITS, isUnit } from '../src/domain/units';
import { STORE_SECTION_ORDER } from '../src/domain/shopping';
import { guessSection, parseIngredientLine } from '../src/domain/ingredientText';
import type { RecipeDraft } from '../src/domain/importRecipe';
import { isStoreSection } from '../src/domain/recipeInput';
import type { StoreSection, Unit } from '../src/domain/types';

/**
 * The only code that talks to the Claude API. Turns a page's text or a photo
 * into a RecipeDraft for the person to review. Needs ANTHROPIC_API_KEY; without
 * it `claudeAvailable()` is false and the server falls back to rule-based
 * parsing (text, structured pages) or says photo import is off.
 */

export const CLAUDE_MODEL = 'claude-opus-5-5';

const RecipeSchema = z.object({
  found: z.boolean().describe('false when the input contains no recipe at all'),
  name: z.string(),
  servings: z.number().nullable(),
  activeMinutes: z.number().nullable().describe('hands-on minutes on the cook day'),
  totalMinutes: z.number().nullable().describe('start to table, including oven or simmer time'),
  ingredients: z.array(
    z.object({
      name: z.string().describe('the ingredient alone, e.g. "yellow onion", without amount, unit or prep'),
      amount: z.number().nullable().describe('numeric; fractions as decimals; null only if truly unknown'),
      unit: z.string().nullable().describe(`one of: ${ALL_UNITS.join(', ')}; null for whole items`),
      section: z.string().describe(`one of: ${STORE_SECTION_ORDER.join(', ')}`),
      prep: z.string().nullable().describe('e.g. "diced", "minced"; null when none'),
      original: z.string().describe('the line exactly as written in the source'),
    }),
  ),
  instructions: z.array(z.string()).describe('the cooking steps in order, one per entry, faithful to the source'),
  advancePrep: z.array(
    z.object({
      description: z.string(),
      leadDays: z.number().describe('whole days before the cook day, 1 to 6'),
      activeMinutes: z.number().describe('hands-on minutes, 0 or more'),
    }),
  ).describe('only steps the recipe says to do a day or more ahead: marinate overnight, soak beans, thaw'),
});

const SYSTEM = `You extract one cooking recipe into structured data for a weekly meal planner.
Rules:
- Units must be one of: ${ALL_UNITS.join(', ')}. Map synonyms (tablespoon -> tbsp, pound -> lb, ounce -> oz, fluid ounce -> floz). Whole items without a unit (2 eggs, 1 onion) use "each". "To taste" or "a pinch" is amount 1, unit "pinch". Do not convert between systems.
- Store sections must be one of: ${STORE_SECTION_ORDER.join(', ')}. Broth, stock, canned goods and tomato paste are "canned"; fresh herbs and vegetables "produce"; dried herbs and ground spices "spices"; oils, grains, pasta, baking goods and condiments "dry-goods".
- Keep ingredient names short and generic (what you would write on a shopping list). Put "diced", "minced", "peeled" into prep.
- Instructions: copy the steps in order as concise sentences; do not invent steps. Ignore ads, comments and unrelated text.
- If the input has no recipe, set found=false and leave the lists empty.`;

export function claudeAvailable(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0;
}

export class ExtractionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ExtractionError';
    this.status = status;
  }
}

/** Units the model may answer with that are not our exact names ("tablespoon", "pounds"). */
function normaliseUnit(value: string | null | undefined): Unit {
  if (!value) return 'each';
  const v = value.trim().toLowerCase();
  if (isUnit(v)) return v;
  const parsed = parseIngredientLine(`1 ${v} x`);
  return parsed?.quantity.unit ?? 'each';
}

function normaliseSection(value: string | undefined, name: string): StoreSection {
  const v = (value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return isStoreSection(v) ? v : guessSection(name);
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

let log: (line: string) => void = () => {};
/** Where to send diagnostics (the server's logger). Never logs the key or the input. */
export function setClaudeLogger(fn: (line: string) => void): void {
  log = fn;
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface ExtractInput {
  text?: string;
  image?: { data: string; mediaType: ImageMediaType };
  sourceUrl?: string;
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return client;
}

/**
 * Read a page through Claude's own web fetch tool, for sites that refuse the box's
 * direct request. Returns the page's recipe as plain text for extractRecipeWithClaude,
 * or throws an ExtractionError when the tool could not fetch it either.
 */
export async function fetchPageTextWithClaude(url: string): Promise<string> {
  if (!claudeAvailable()) throw new ExtractionError(503, 'Reading that page needs an ANTHROPIC_API_KEY on the server.');
  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 }],
      messages: [
        {
          role: 'user',
          content: `Fetch ${url} and write out the recipe it contains as plain text: the title, how many servings, prep/cook/total times, every ingredient line exactly as written, and the numbered steps. Nothing else; no commentary. If the page has no recipe, reply exactly: NO RECIPE`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      log(`claude web_fetch error ${err.status}: ${err.message}`);
      throw new ExtractionError(502, `Could not read that page (${err.status}).`);
    }
    throw err;
  }
  for (const block of response.content) {
    if (block.type === 'web_fetch_tool_result' && !Array.isArray(block.content) && 'error_code' in block.content) {
      log(`claude web_fetch refused: ${block.content.error_code}`);
      throw new ExtractionError(422, 'That site refuses automated readers. Copy the recipe text and paste it instead.');
    }
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text || /^NO RECIPE/i.test(text)) throw new ExtractionError(422, 'No recipe was found on that page.');
  return text;
}

export async function extractRecipeWithClaude(input: ExtractInput): Promise<RecipeDraft> {
  if (!claudeAvailable()) throw new ExtractionError(503, 'Photo and text import need an ANTHROPIC_API_KEY on the server.');
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.data } });
  }
  content.push({
    type: 'text',
    text: input.image
      ? 'Extract the recipe in this photo.' + (input.text ? `\n\nNotes from the user:\n${input.text}` : '')
      : `Extract the recipe from this text${input.sourceUrl ? ` (from ${input.sourceUrl})` : ''}:\n\n${input.text ?? ''}`,
  });

  let response;
  try {
    response = await getClient().messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(RecipeSchema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ExtractionError(503, 'The ANTHROPIC_API_KEY on the server was rejected.');
    if (err instanceof Anthropic.RateLimitError) throw new ExtractionError(429, 'Claude is busy right now. Try again in a minute.');
    if (err instanceof Anthropic.APIConnectionError) throw new ExtractionError(502, 'Could not reach Claude. Check the box has internet access.');
    if (err instanceof Anthropic.APIError) {
      log(`claude API error ${err.status}: ${err.message}`);
      throw new ExtractionError(502, `Claude returned an error (${err.status}): ${err.message.slice(0, 300)}`);
    }
    throw err;
  }
  log(`claude extraction: stop=${response.stop_reason} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  if (response.stop_reason === 'refusal') throw new ExtractionError(422, 'Claude declined to read that input.');
  const out = response.parsed_output;
  if (!out) throw new ExtractionError(502, 'Claude answered in an unexpected shape. Try again.');
  if (!out.found) throw new ExtractionError(422, 'No recipe was found in that input.');

  return {
    name: out.name.trim() || undefined,
    baseServings: out.servings === null ? undefined : Math.max(1, Math.round(out.servings)),
    activeMinutes: out.activeMinutes === null ? undefined : Math.max(0, Math.round(out.activeMinutes)),
    totalMinutes: out.totalMinutes === null ? undefined : Math.max(0, Math.round(out.totalMinutes)),
    ingredients: out.ingredients.map((i) => ({
      name: i.name.trim(),
      amount: i.amount === null ? undefined : i.amount,
      unit: normaliseUnit(i.unit),
      section: normaliseSection(i.section, i.name),
      prep: i.prep?.trim() || undefined,
      original: i.original,
    })),
    advancePrep: out.advancePrep.map((s) => ({
      description: s.description,
      leadDays: clampInt(s.leadDays, 1, 6),
      activeMinutes: clampInt(s.activeMinutes, 0, 7 * 24 * 60),
    })),
    instructions: out.instructions.map((s) => s.trim()).filter((s) => s.length > 0),
    sourceUrl: input.sourceUrl,
    source: 'claude',
    warnings: [],
  };
}
