import { useEffect, useState } from 'react';
import { parseRecipes, serializeRecipes, type Recipe, type Warning } from '../domain';
import { ALL_UNITS } from '../domain/units';
import { STORE_SECTIONS } from '../domain/recipeImport';
import { Warnings } from './Warnings';

interface Props {
  recipes: Recipe[];
  isSeed: boolean;
  onApply: (recipes: Recipe[]) => void;
  onReset: () => void;
}

/**
 * Recipes are edited as JSON. Deliberately minimal: the point is to get real
 * recipes into the planner, not to build a form. Apply is all-or-nothing.
 */
export function RecipesView({ recipes, isSeed, onApply, onReset }: Props) {
  const [text, setText] = useState(() => serializeRecipes(recipes));
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [status, setStatus] = useState<string>('');
  const dirty = text !== serializeRecipes(recipes);

  function apply() {
    const result = parseRecipes(text);
    setWarnings(result.warnings);
    if (result.warnings.length === 0) {
      onApply(result.recipes);
      setText(serializeRecipes(result.recipes));
      setStatus(`Saved ${result.recipes.length} recipes.`);
    } else {
      setStatus('Nothing saved. Fix the issues below and apply again.');
    }
  }

  function revert() {
    setText(serializeRecipes(recipes));
    setWarnings([]);
    setStatus('');
  }

  // When the parent swaps the recipe list (reset to built-ins), show the new list.
  useEffect(() => {
    setText(serializeRecipes(recipes));
  }, [recipes]);

  function reset() {
    onReset();
    setWarnings([]);
    setStatus('Restored the built-in recipes.');
  }

  return (
    <div className="recipes">
      <p className="muted">
        Edit the JSON and click Apply. The whole list is validated first; if anything is wrong, nothing changes.
        Meals in the plan that point at a removed recipe show an <code>unknown-recipe</code> warning.
      </p>
      <details className="muted">
        <summary>Recipe shape and allowed values</summary>
        <pre className="shape">{`{
  "id": "unique-slug",
  "name": "Display name",
  "baseServings": 4,
  "activeMinutes": 20,          // hands-on
  "totalMinutes": 45,           // start to table
  "ingredients": [
    { "name": "yellow onion", "quantity": { "amount": 1, "unit": "each" },
      "section": "produce", "prep": "diced" }   // prep is optional
  ],
  "advancePrep": [              // optional
    { "id": "thaw", "description": "Thaw chicken", "leadDays": 1, "activeMinutes": 2 }
  ]
}`}</pre>
        <div>Units: {ALL_UNITS.join(', ')}</div>
        <div>Sections: {STORE_SECTIONS.join(', ')}</div>
      </details>
      <textarea
        id="recipes-json"
        className="json"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus('');
        }}
      />
      <div className="actions">
        <button type="button" onClick={apply} disabled={!dirty}>
          Apply
        </button>
        <button type="button" onClick={revert} disabled={!dirty}>
          Revert edits
        </button>
        <button type="button" onClick={reset} disabled={isSeed}>
          Restore built-in recipes
        </button>
        <span className="muted">
          {recipes.length} recipes{isSeed ? ' (built-in)' : ' (yours)'}. {status}
        </span>
      </div>
      <Warnings warnings={warnings} title="Import problems" />
    </div>
  );
}
