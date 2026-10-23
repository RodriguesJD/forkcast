import type { AdvancePrepStep, Ingredient, StoreSection, Unit } from './types';
import { parseIngredientLine, parseIngredientLines } from './ingredientText';

/**
 * Importing recipes from outside: a web page's structured data (schema.org
 * Recipe in JSON-LD, which most recipe sites publish) or plain pasted text.
 *
 * The result is a RecipeDraft, not a Recipe: fields may be missing or
 * unparsed, because an import is always reviewed in the form before it is
 * saved. Nothing here fetches anything; the server hands in the HTML or text.
 */

export interface DraftIngredient {
  name: string;
  amount?: number;
  unit?: Unit;
  section?: StoreSection;
  prep?: string;
  /** The line as written, shown next to the parsed fields during review. */
  original?: string;
}

export interface RecipeDraft {
  name?: string;
  baseServings?: number;
  activeMinutes?: number;
  totalMinutes?: number;
  ingredients: DraftIngredient[];
  advancePrep: Omit<AdvancePrepStep, 'id'>[];
  instructions: string[];
  sourceUrl?: string;
  /** How the draft was produced, for the review note. */
  source: 'structured' | 'text' | 'claude';
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Minutes from an ISO 8601 duration such as PT1H30M, PT45M, P0DT0H20M. */
export function parseIsoDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  if (!d && !h && !min && !s) return undefined;
  return Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Math.round(Number(s ?? 0) / 60);
}

/** "4 servings", "Serves 6", ["8"], 4 -> the first whole number found. */
export function parseYield(value: unknown): number | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'number' && Number.isFinite(first) && first >= 1) return Math.round(first);
  if (typeof first !== 'string') return undefined;
  const m = /(\d+)/.exec(first);
  return m ? Number(m[1]) : undefined;
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (isRecord(v) && typeof v.text === 'string') return v.text;
  if (isRecord(v) && typeof v.name === 'string') return v.name;
  return '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&frac12;/g, '½')
    .replace(/&frac14;/g, '¼')
    .replace(/&frac34;/g, '¾')
    .replace(/&frac13;/g, '⅓')
    .replace(/&frac23;/g, '⅔')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** schema.org HowToStep / HowToSection trees to a flat list of step texts. */
function flattenInstructions(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const part of value.split(/\r?\n+/)) {
      const t = stripTags(part);
      if (t) out.push(t);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) flattenInstructions(v, out);
  } else if (isRecord(value)) {
    if (Array.isArray(value.itemListElement)) flattenInstructions(value.itemListElement, out);
    else {
      const t = stripTags(textOf(value));
      if (t) out.push(t);
    }
  }
  return out;
}

function isRecipeType(t: unknown): boolean {
  if (typeof t === 'string') return /(^|\/)Recipe$/.test(t);
  return Array.isArray(t) && t.some(isRecipeType);
}

/** Find the schema.org Recipe object anywhere in a parsed JSON-LD document. */
export function findSchemaRecipe(doc: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(doc)) {
    for (const d of doc) {
      const r = findSchemaRecipe(d);
      if (r) return r;
    }
    return undefined;
  }
  if (!isRecord(doc)) return undefined;
  if (isRecipeType(doc['@type'])) return doc;
  if (Array.isArray(doc['@graph'])) return findSchemaRecipe(doc['@graph']);
  return undefined;
}

/** The JSON-LD Recipe from a page's HTML, if it has one. */
export function extractJsonLdRecipe(html: string): Record<string, unknown> | undefined {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const recipe = findSchemaRecipe(JSON.parse(m[1].trim()));
      if (recipe) return recipe;
    } catch {
      // malformed block; keep looking
    }
  }
  return undefined;
}

function toDraftIngredient(ing: Ingredient, original: string): DraftIngredient {
  return { name: ing.name, amount: ing.quantity.amount, unit: ing.quantity.unit, section: ing.section, prep: ing.prep, original };
}

export function draftFromSchemaRecipe(recipe: Record<string, unknown>, sourceUrl?: string): RecipeDraft {
  const warnings: string[] = [];
  const lines = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient
    : Array.isArray(recipe.ingredients)
      ? recipe.ingredients
      : [];
  const ingredients: DraftIngredient[] = [];
  for (const raw of lines) {
    const line = stripTags(textOf(raw));
    const ing = parseIngredientLine(line);
    if (ing) ingredients.push(toDraftIngredient(ing, line));
  }
  if (ingredients.length === 0) warnings.push('No ingredients were found on the page.');

  const active = parseIsoDuration(recipe.prepTime) ?? parseIsoDuration(recipe.cookTime);
  let total = parseIsoDuration(recipe.totalTime);
  if (total === undefined) {
    const prep = parseIsoDuration(recipe.prepTime) ?? 0;
    const cook = parseIsoDuration(recipe.cookTime) ?? 0;
    if (prep + cook > 0) total = prep + cook;
  }
  const name = stripTags(textOf(recipe.name) || textOf(recipe.headline));
  return {
    name: name || undefined,
    baseServings: parseYield(recipe.recipeYield),
    activeMinutes: active,
    totalMinutes: total,
    ingredients,
    advancePrep: [],
    instructions: flattenInstructions(recipe.recipeInstructions),
    sourceUrl,
    source: 'structured',
    warnings,
  };
}

const AMOUNT_LINE = /^\s*(?:[-*•]\s*)?(?:\d|[½⅓⅔¼¾⅛]|a |an |one |pinch|salt|pepper)/i;
const HEADING = /^(ingredients|directions|instructions|method|steps|preparation|notes?)\b:?/i;

/**
 * Plain text (a pasted recipe, a note) to a draft by shape: the first line is
 * the name, lines that start with a quantity are ingredients, everything after
 * an "Instructions"/"Directions" heading (or every remaining long line) is a step.
 */
export function draftFromText(text: string): RecipeDraft {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const warnings: string[] = [];
  if (lines.length === 0) return { ingredients: [], advancePrep: [], instructions: [], source: 'text', warnings: ['Nothing to read.'] };

  let name: string | undefined;
  let mode: 'auto' | 'ingredients' | 'steps' = 'auto';
  const ingredientLines: string[] = [];
  const steps: string[] = [];
  let servings: number | undefined;
  let total: number | undefined;

  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) {
      const w = h[1].toLowerCase();
      mode = w === 'ingredients' ? 'ingredients' : w.startsWith('note') ? 'auto' : 'steps';
      continue;
    }
    const sv = /serv(?:es|ings?)[:\s]*(\d+)|(\d+)\s*servings?/i.exec(line);
    if (sv && line.length < 40) {
      servings = Number(sv[1] ?? sv[2]);
      continue;
    }
    const tm = /total(?: time)?[:\s]*(\d+)\s*(?:min|minutes)/i.exec(line);
    if (tm && line.length < 40) {
      total = Number(tm[1]);
      continue;
    }
    if (name === undefined) {
      name = line;
      continue;
    }
    if (mode === 'ingredients' || (mode === 'auto' && AMOUNT_LINE.test(line) && line.length < 120)) ingredientLines.push(line);
    else if (mode === 'steps' || line.length >= 40) steps.push(line.replace(/^\d+[.)]\s*/, ''));
    else ingredientLines.push(line);
  }
  const ingredients = parseIngredientLines(ingredientLines.join('\n')).map((ing, i) => toDraftIngredient(ing, ingredientLines[i] ?? ''));
  if (ingredients.length === 0) warnings.push('No ingredient lines were recognised; add them by hand.');
  return { name, baseServings: servings, totalMinutes: total, ingredients, advancePrep: [], instructions: steps, source: 'text', warnings };
}

/** HTML to readable text for a model: scripts, styles and tags gone, whitespace collapsed, capped. */
export function htmlToText(html: string, maxChars = 60_000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
  return lines.join('\n').slice(0, maxChars);
}
