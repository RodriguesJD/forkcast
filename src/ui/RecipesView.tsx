import { useState } from 'react';
import type { Recipe, RecipeIndex, RecipeInput, WeekPlan } from '../domain';
import { RecipeForm } from './RecipeForm';

interface Props {
  recipes: RecipeIndex;
  plan: WeekPlan;
  onCreate: (input: RecipeInput) => Promise<void>;
  onUpdate: (id: string, input: RecipeInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; recipe: Recipe };

export function RecipesView({ recipes, plan, onCreate, onUpdate, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const list = Object.values(recipes).sort((a, b) => a.name.localeCompare(b.name));

  function usesThisWeek(id: string): number {
    return plan.entries.filter((e) => e.kind === 'cook' && e.recipeId === id).length;
  }

  async function remove(recipe: Recipe) {
    const uses = usesThisWeek(recipe.id);
    const detail = uses > 0 ? ` It is planned ${uses} time${uses === 1 ? '' : 's'} this week; those meals will show a warning.` : '';
    if (!window.confirm(`Delete "${recipe.name}"?${detail}`)) return;
    setDeleteError(null);
    try {
      await onDelete(recipe.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete.');
    }
  }

  if (mode.kind === 'new') {
    return (
      <RecipeForm
        defaultServings={plan.settings.householdSize}
        onSave={async (input) => {
          await onCreate(input);
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }
  if (mode.kind === 'edit') {
    return (
      <RecipeForm
        key={mode.recipe.id}
        recipe={mode.recipe}
        defaultServings={plan.settings.householdSize}
        onSave={async (input) => {
          await onUpdate(mode.recipe.id, input);
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  return (
    <div className="recipes">
      <div className="toolbar">
        <h2>Recipes</h2>
        <button type="button" className="primary" onClick={() => setMode({ kind: 'new' })}>
          + New recipe
        </button>
      </div>
      {deleteError && <div className="errors">{deleteError}</div>}
      {list.length === 0 && <p className="muted">No recipes yet. Add your first one.</p>}
      <ul className="recipe-list">
        {list.map((r) => (
          <li key={r.id}>
            <div className="info">
              <strong>{r.name}</strong>
              <span className="muted">
                {r.baseServings} servings · {r.activeMinutes} min hands-on, {r.totalMinutes} total · {r.ingredients.length}{' '}
                ingredient{r.ingredients.length === 1 ? '' : 's'}
                {r.advancePrep.length > 0 && ` · ${r.advancePrep.length} prep step${r.advancePrep.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <div className="buttons">
              <button type="button" onClick={() => setMode({ kind: 'edit', recipe: r })}>
                Edit
              </button>
              <button type="button" onClick={() => remove(r)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
