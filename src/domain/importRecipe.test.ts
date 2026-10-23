import { describe, expect, it } from 'vitest';
import { draftFromSchemaRecipe, draftFromText, extractJsonLdRecipe, htmlToText, parseIsoDuration, parseYield } from './importRecipe';

describe('parseIsoDuration / parseYield', () => {
  it('reads common durations', () => {
    expect(parseIsoDuration('PT1H30M')).toBe(90);
    expect(parseIsoDuration('PT45M')).toBe(45);
    expect(parseIsoDuration('P0DT0H20M')).toBe(20);
    expect(parseIsoDuration('PT0S')).toBe(0);
    expect(parseIsoDuration('tomorrow')).toBeUndefined();
    expect(parseIsoDuration(undefined)).toBeUndefined();
  });
  it('reads yields', () => {
    expect(parseYield('4 servings')).toBe(4);
    expect(parseYield(['6', '6 servings'])).toBe(6);
    expect(parseYield(8)).toBe(8);
    expect(parseYield('a lot')).toBeUndefined();
  });
});

const page = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"Lemon &amp; Garlic Pasta","recipeYield":["4"],"prepTime":"PT10M","cookTime":"PT20M","recipeIngredient":["1 lb spaghetti","3 cloves garlic, minced","&frac12; cup olive oil","Salt to taste"],"recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Boil the <b>pasta</b>."}]},{"@type":"HowToStep","text":"Toss with garlic oil."}]}]}</script>
</head><body><h1>Lemon Pasta</h1><p>Great dish.</p><script>alert(1)</script></body></html>`;

describe('extractJsonLdRecipe + draftFromSchemaRecipe', () => {
  it('finds the recipe inside @graph and maps it', () => {
    const recipe = extractJsonLdRecipe(page);
    expect(recipe).toBeDefined();
    const draft = draftFromSchemaRecipe(recipe!, 'https://example.com/pasta');
    expect(draft.name).toBe('Lemon & Garlic Pasta');
    expect(draft.baseServings).toBe(4);
    expect(draft.activeMinutes).toBe(10);
    expect(draft.totalMinutes).toBe(30);
    expect(draft.ingredients.map((i) => [i.name, i.amount, i.unit])).toEqual([
      ['spaghetti', 1, 'lb'],
      ['garlic', 3, 'clove'],
      ['olive oil', 0.5, 'cup'],
      ['Salt', 1, 'pinch'],
    ]);
    expect(draft.ingredients[1].prep).toBe('minced');
    expect(draft.instructions).toEqual(['Boil the pasta.', 'Toss with garlic oil.']);
    expect(draft.sourceUrl).toBe('https://example.com/pasta');
    expect(draft.source).toBe('structured');
  });

  it('returns undefined when there is no recipe data', () => {
    expect(extractJsonLdRecipe('<html><script type="application/ld+json">{"@type":"Article"}</script></html>')).toBeUndefined();
    expect(extractJsonLdRecipe('<html><script type="application/ld+json">not json</script></html>')).toBeUndefined();
  });
});

describe('draftFromText', () => {
  it('splits a pasted recipe into name, ingredients and steps', () => {
    const draft = draftFromText(`Grandma's Chili
Serves 6
Ingredients
1 lb ground beef
1 onion, diced
2 cans kidney beans
Directions
1. Brown the beef with the onion.
2. Add the beans and simmer for an hour.`);
    expect(draft.name).toBe("Grandma's Chili");
    expect(draft.baseServings).toBe(6);
    expect(draft.ingredients.map((i) => i.name)).toEqual(['ground beef', 'onion', 'kidney beans']);
    expect(draft.instructions).toEqual(['Brown the beef with the onion.', 'Add the beans and simmer for an hour.']);
  });

  it('works without headings by line shape', () => {
    const draft = draftFromText('Toast\n2 slices bread\nToast the bread until golden brown and spread with butter while hot.');
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.instructions).toHaveLength(1);
  });
});

describe('htmlToText', () => {
  it('drops scripts and tags and keeps line structure', () => {
    expect(htmlToText(page)).toBe('Lemon Pasta\nGreat dish.');
  });
});
