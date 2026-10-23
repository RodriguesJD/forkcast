import { normalizeIngredientName, scaleIngredients } from './recipes';
import { effectiveCookEntries } from './plan';
import type {
  ExtraShoppingItem,
  Quantity,
  RecipeIndex,
  ShoppingEdits,
  ShoppingItem,
  ShoppingList,
  ShoppingSection,
  ShoppingSource,
  StoreSection,
  Unit,
  Warning,
  WeekPlan,
} from './types';
import { chooseDisplayUnit, fromBase, toBase, unitFamily } from './units';

/** Walking order through a typical grocery store. */
export const STORE_SECTION_ORDER: readonly StoreSection[] = [
  'produce',
  'bakery',
  'meat',
  'seafood',
  'dairy',
  'dry-goods',
  'canned',
  'spices',
  'frozen',
  'other',
];

interface Bucket {
  key: string;
  normalizedName: string;
  displayName: string;
  section: StoreSection;
  baseTotal: number;
  /** Unit of the single largest contribution; decides the display system. */
  preferredUnit: Unit;
  largestContribution: number;
  sources: ShoppingSource[];
}

/** Grouping key: same name merges within a volume or mass family, or on an identical count unit. */
export function shoppingKey(normalizedName: string, unit: Unit): string {
  const family = unitFamily(unit);
  return `${normalizedName}|${family === 'count' ? unit : family}`;
}

/**
 * Build the week's shopping list from the plan.
 *
 * Only effective cook entries contribute (see effectiveCookEntries). Leftover
 * slots contribute nothing because their food is bought via the source entry.
 */
export function buildShoppingList(plan: WeekPlan, recipes: RecipeIndex): ShoppingList {
  const staples = new Set(plan.settings.pantryStaples.map(normalizeIngredientName));
  const buckets = new Map<string, Bucket>();
  const excluded = new Set<string>();
  const warnings: Warning[] = [];
  const sectionSeen = new Map<string, StoreSection>();
  const sectionWarned = new Set<string>();

  for (const entry of effectiveCookEntries(plan, recipes)) {
    const recipe = recipes[entry.recipeId];
    for (const ing of scaleIngredients(recipe, entry.servings)) {
      const normalizedName = normalizeIngredientName(ing.name);
      if (staples.has(normalizedName)) {
        excluded.add(normalizedName);
        continue;
      }

      const firstSection = sectionSeen.get(normalizedName);
      if (firstSection === undefined) {
        sectionSeen.set(normalizedName, ing.section);
      } else if (firstSection !== ing.section && !sectionWarned.has(normalizedName)) {
        sectionWarned.add(normalizedName);
        warnings.push({
          code: 'section-conflict',
          message: `"${ing.name}" is listed under both ${firstSection} and ${ing.section}; using ${firstSection}.`,
        });
      }

      const key = shoppingKey(normalizedName, ing.quantity.unit);
      const base = toBase(ing.quantity);
      const source: ShoppingSource = {
        entryId: entry.id,
        recipeId: recipe.id,
        recipeName: recipe.name,
        quantity: ing.quantity,
      };
      const bucket = buckets.get(key);
      if (!bucket) {
        buckets.set(key, {
          key,
          normalizedName,
          displayName: ing.name.trim(),
          section: sectionSeen.get(normalizedName) ?? ing.section,
          baseTotal: base,
          preferredUnit: ing.quantity.unit,
          largestContribution: base,
          sources: [source],
        });
      } else {
        bucket.baseTotal += base;
        bucket.sources.push(source);
        if (base > bucket.largestContribution) {
          bucket.largestContribution = base;
          bucket.preferredUnit = ing.quantity.unit;
        }
      }
    }
  }

  // Same name under incompatible units -> flag every bucket for that name.
  const bucketsByName = new Map<string, Bucket[]>();
  for (const b of buckets.values()) {
    const list = bucketsByName.get(b.normalizedName) ?? [];
    list.push(b);
    bucketsByName.set(b.normalizedName, list);
  }
  const conflicted = new Set<string>();
  for (const [name, list] of bucketsByName) {
    if (list.length > 1) {
      conflicted.add(name);
      const units = list.map((b) => b.preferredUnit).join(', ');
      warnings.push({
        code: 'unit-conflict',
        message: `"${list[0].displayName}" is needed in units that cannot be combined (${units}); listed separately.`,
      });
    }
  }

  const items: ShoppingItem[] = [...buckets.values()].map((b) => ({
    key: b.key,
    name: b.displayName,
    quantity: displayQuantity(b.baseTotal, b.preferredUnit),
    section: b.section,
    sources: b.sources,
    unmergedConflict: conflicted.has(b.normalizedName),
  }));

  const sections: ShoppingSection[] = STORE_SECTION_ORDER.map((section) => ({
    section,
    items: items
      .filter((i) => i.section === section)
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
  })).filter((s) => s.items.length > 0);

  return {
    sections,
    excludedStaples: [...excluded].sort(),
    warnings,
  };
}

function displayQuantity(baseTotal: number, preferred: Unit): Quantity {
  return fromBase(baseTotal, chooseDisplayUnit(baseTotal, preferred));
}

/** Flat list of all items, for tests and simple views. */
export function allItems(list: ShoppingList): ShoppingItem[] {
  return list.sections.flatMap((s) => s.items);
}

// ---------- user edits on top of the generated list ----------

export const EXTRA_KEY_PREFIX = 'extra:';

export function emptyShoppingEdits(): ShoppingEdits {
  return { extras: [], removed: [] };
}

export function extraItemKey(item: ExtraShoppingItem): string {
  return EXTRA_KEY_PREFIX + item.id;
}

/**
 * Layer the user's edits over a generated list: drop hidden items, add the
 * hand-written ones to their sections (in store order). Pure; the generated
 * list is never mutated, so un-hiding is just removing the key from `removed`.
 */
export function applyShoppingEdits(list: ShoppingList, edits: ShoppingEdits): ShoppingList {
  const removed = new Set(edits.removed);
  const bySection = new Map<StoreSection, ShoppingItem[]>();
  for (const section of list.sections) {
    bySection.set(
      section.section,
      section.items.filter((item) => !removed.has(item.key)),
    );
  }
  for (const extra of edits.extras) {
    const items = bySection.get(extra.section) ?? [];
    items.push({
      key: extraItemKey(extra),
      name: extra.name,
      quantity: extra.quantity,
      section: extra.section,
      sources: [],
      unmergedConflict: false,
    });
    bySection.set(extra.section, items);
  }
  const sections: ShoppingSection[] = STORE_SECTION_ORDER.map((section) => ({
    section,
    items: bySection.get(section) ?? [],
  })).filter((s) => s.items.length > 0);
  return { ...list, sections };
}

/** Generated items the user has hidden this week, for a "show hidden" control. */
export function hiddenShoppingItems(list: ShoppingList, edits: ShoppingEdits): ShoppingItem[] {
  const removed = new Set(edits.removed);
  return list.sections.flatMap((s) => s.items.filter((item) => removed.has(item.key)));
}
