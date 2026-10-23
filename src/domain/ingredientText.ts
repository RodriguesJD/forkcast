import type { Ingredient, StoreSection, Unit } from './types';
import { STORE_SECTION_ORDER } from './shopping';

/**
 * Turn a human-written ingredient line ("1 ½ cups all-purpose flour, sifted")
 * into an Ingredient. Used for recipes imported from web pages that publish
 * their ingredients as text, and as the no-API fallback for pasted text.
 *
 * Deliberately forgiving: anything it cannot read becomes amount 1 "each"
 * with the whole line as the name, so the person reviewing the import sees
 * the original words and fixes the numbers rather than losing the line.
 */

const UNIT_WORDS: Record<string, Unit> = {
  cup: 'cup', cups: 'cup', c: 'cup',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tb: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp',
  floz: 'floz',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  gram: 'g', grams: 'g', g: 'g', gr: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  bunch: 'bunch', bunches: 'bunch',
  slice: 'slice', slices: 'slice',
  stalk: 'stalk', stalks: 'stalk', rib: 'stalk', ribs: 'stalk',
  head: 'head', heads: 'head',
  sprig: 'sprig', sprigs: 'sprig',
  pinch: 'pinch', pinches: 'pinch', dash: 'pinch', dashes: 'pinch',
};

const FRACTIONS: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

function toNumber(token: string): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(token);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/** "1 1/2" -> 1.5, "2" -> 2, "1/3" -> 0.333, "2-3" / "2 to 3" -> 2. Returns [amount, rest]. */
function readAmount(text: string): [number | null, string] {
  const m = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?))?\s*(.*)$/.exec(text);
  if (!m) return [null, text];
  const parts = m[1].trim().split(/\s+/);
  let amount = 0;
  for (const p of parts) {
    const n = toNumber(p);
    if (n === null) return [null, text];
    amount += n;
  }
  return [amount, m[2]];
}

function normaliseLine(line: string): string {
  let s = line.trim();
  s = s.replace(/^[-*•▢☐]\s*/, '').replace(/^\d+[.)]\s+(?=[A-Za-z])/, '');
  s = s.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (f) => ` ${FRACTIONS[f]} `);
  s = s.replace(/(\d)\s+(\d\/\d)/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

export function parseIngredientLine(line: string): Ingredient | null {
  const original = normaliseLine(line);
  if (original.length === 0) return null;

  // "(about 2 cups)" / "(14 oz)" notes are not part of the name.
  let text = original.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const toTaste = /\bto taste\b/i.test(text);
  text = text.replace(/,?\s*to taste\b/i, '').trim();

  let [amount, rest] = readAmount(text);
  let unit: Unit | null = null;
  if (amount !== null) {
    const m = /^([A-Za-z.]+)\.?\s+(.*)$/.exec(rest);
    if (m) {
      const word = m[1].toLowerCase().replace(/\./g, '');
      if (word === 'fl' && /^oz\b/i.test(m[2])) {
        unit = 'floz';
        rest = m[2].replace(/^oz\.?\s*/i, '');
      } else if (UNIT_WORDS[word] !== undefined) {
        unit = UNIT_WORDS[word];
        rest = m[2];
      }
    }
    rest = rest.replace(/^of\s+/i, '');
  } else if (/^(a|an|one)\s+/i.test(rest)) {
    amount = 1;
    rest = rest.replace(/^(a|an|one)\s+/i, '');
    const m = /^([A-Za-z]+)\s+(?:of\s+)?(.*)$/.exec(rest);
    if (m && UNIT_WORDS[m[1].toLowerCase()] !== undefined) {
      unit = UNIT_WORDS[m[1].toLowerCase()];
      rest = m[2];
    }
  }

  let name = rest;
  let prep: string | undefined;
  const comma = rest.indexOf(',');
  if (comma > 0) {
    name = rest.slice(0, comma);
    const p = rest.slice(comma + 1).trim();
    if (p.length > 0) prep = p;
  }
  name = name.trim().replace(/\s+/g, ' ');
  if (name.length === 0) name = original;

  if (amount === null) {
    amount = 1;
    unit = toTaste ? 'pinch' : 'each';
  } else if (unit === null) {
    unit = 'each';
  }
  return {
    name,
    quantity: { amount, unit },
    section: guessSection(name),
    ...(prep !== undefined ? { prep } : {}),
  };
}

const SECTION_WORDS: [StoreSection, string[]][] = [
  ['canned', ['canned', 'can ', 'tinned', 'broth', 'stock', 'coconut milk', 'tomato paste', 'crushed tomatoes', 'diced tomatoes', 'beans', 'chickpeas', 'tomato sauce']],
  ['seafood', ['shrimp', 'prawn', 'salmon', 'tuna', 'cod', 'tilapia', 'fish', 'scallop', 'clam', 'mussel', 'crab', 'lobster', 'anchov']],
  ['meat', ['chicken', 'beef', 'pork', 'steak', 'turkey', 'lamb', 'sausage', 'bacon', 'ham', 'mince', 'brisket', 'ribs', 'chop', 'thigh', 'breast', 'prosciutto', 'pancetta', 'chorizo', 'veal', 'duck']],
  ['dairy', ['milk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'ricotta', 'butter', 'cream', 'yogurt', 'yoghurt', 'egg', 'sour cream', 'half-and-half', 'buttermilk', 'ghee']],
  ['bakery', ['bread', 'bun', 'roll', 'tortilla', 'pita', 'naan', 'bagel', 'baguette', 'croissant', 'crust', 'wrap']],
  ['frozen', ['frozen', 'ice cream', 'puff pastry']],
  ['spices', ['salt', 'pepper', 'cumin', 'paprika', 'oregano', 'thyme', 'cinnamon', 'nutmeg', 'chili powder', 'curry powder', 'turmeric', 'coriander seed', 'ground coriander', 'cayenne', 'bay leaf', 'bay leaves', 'garlic powder', 'onion powder', 'red pepper flakes', 'allspice', 'clove', 'cardamom', 'seasoning', 'italian seasoning', 'dried']],
  ['dry-goods', ['flour', 'sugar', 'rice', 'pasta', 'spaghetti', 'noodle', 'oil', 'vinegar', 'soy sauce', 'honey', 'oats', 'lentil', 'quinoa', 'couscous', 'baking', 'cornstarch', 'vanilla', 'chocolate', 'nuts', 'almond', 'walnut', 'peanut', 'cereal', 'cracker', 'breadcrumb', 'panko', 'mustard', 'ketchup', 'mayonnaise', 'hot sauce', 'fish sauce', 'sesame', 'maple syrup', 'tahini', 'stock cube', 'bouillon', 'wine', 'beer']],
  ['produce', ['onion', 'garlic', 'tomato', 'potato', 'carrot', 'celery', 'pepper', 'lettuce', 'spinach', 'kale', 'broccoli', 'cauliflower', 'zucchini', 'squash', 'cucumber', 'lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'berries', 'avocado', 'ginger', 'cilantro', 'parsley', 'basil', 'mint', 'dill', 'scallion', 'green onion', 'leek', 'shallot', 'mushroom', 'cabbage', 'corn', 'pea', 'bean sprout', 'herb', 'chili', 'chile', 'jalapeño', 'jalapeno', 'eggplant', 'asparagus', 'fresh', 'greens', 'arugula', 'radish', 'beet', 'sweet potato', 'pumpkin', 'grape', 'melon', 'pear', 'peach', 'mango', 'pineapple', 'cherry', 'fruit', 'vegetable']],
];

/** Best-effort store section from an ingredient name. Produce wins over spices for "fresh …". */
export function guessSection(name: string): StoreSection {
  const n = ` ${name.toLowerCase()} `;
  if (/\bfresh\b/.test(n)) return 'produce';
  // "black pepper" is a spice; "bell pepper" is produce. Check spices' multi-word terms via the ordered list.
  for (const [section, words] of SECTION_WORDS) {
    for (const w of words) {
      if (n.includes(w)) {
        if (section === 'produce' && w === 'pepper' && /black pepper|white pepper|peppercorn/.test(n)) return 'spices';
        if (section === 'spices' && w === 'pepper' && /bell pepper|red pepper|green pepper|yellow pepper/.test(n)) return 'produce';
        if (section === 'spices' && w === 'clove' && /garlic/.test(n)) return 'produce';
        return section;
      }
    }
  }
  return 'other';
}

export function isKnownSection(value: string): value is StoreSection {
  return (STORE_SECTION_ORDER as readonly string[]).includes(value);
}

/** Every non-empty line of `text` as an ingredient. */
export function parseIngredientLines(text: string): Ingredient[] {
  return text
    .split(/\r?\n/)
    .map(parseIngredientLine)
    .filter((i): i is Ingredient => i !== null);
}
