import { useState } from 'react';
import type { Recipe, RecipeDraft, RecipeIndex, RecipeInput, WeekPlan } from '../domain';
import { draftFromImport, RecipeForm, type RecipeFormDraft } from './RecipeForm';
import { RecipeView } from './RecipeView';
import { ImportView } from './ImportView';

interface Props {
  recipes: RecipeIndex;
  plan: WeekPlan;
  claudeEnabled: boolean;
  /** Open this recipe's read view first (from a planned meal). */
  openRecipeId?: string;
  onCreate: (input: RecipeInput) => Promise<void>;
  onUpdate: (id: string, input: RecipeInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'new'; draft?: RecipeFormDraft; note?: string }
  | { kind: 'edit'; id: string }
  | { kind: 'view'; id: string }
  | { kind: 'import' };

function importNote(d: RecipeDraft): string {
  const how = d.source === 'structured' ? 'the page’s recipe data' : d.source === 'claude' ? 'Claude' : 'the text';
  const parts = [`Read from ${how}. Check the amounts, units and store sections before saving.`];
  if (d.warnings.length) parts.push(d.warnings.join(' '));
  return parts.join(' ');
}

export function RecipesView({ recipes, plan, claudeEnabled, openRecipeId, onCreate, onUpdate, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>(() => (openRecipeId && recipes[openRecipeId] ? { kind: 'view', id: openRecipeId } : { kind: 'list' }));
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

  if (mode.kind === 'import') {
    return (
      <ImportView
        claudeEnabled={claudeEnabled}
        onDraft={(d) => setMode({ kind: 'new', draft: draftFromImport(d, plan.settings.householdSize), note: importNote(d) })}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }
  if (mode.kind === 'new') {
    return (
      <RecipeForm
        initialDraft={mode.draft}
        note={mode.note}
        defaultServings={plan.settings.householdSize}
        onSave={async (input) => {
          await onCreate(input);
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }
  const current = mode.kind === 'edit' || mode.kind === 'view' ? recipes[mode.id] : undefined;
  if (mode.kind === 'edit' && current) {
    return (
      <RecipeForm
        key={current.id}
        recipe={current}
        defaultServings={plan.settings.householdSize}
        onSave={async (input) => {
          await onUpdate(current.id, input);
          setMode({ kind: 'view', id: current.id });
        }}
        onCancel={() => setMode({ kind: 'view', id: current.id })}
      />
    );
  }
  if (mode.kind === 'view' && current) {
    return <RecipeView key={current.id} recipe={current} onEdit={() => setMode({ kind: 'edit', id: current.id })} onBack={() => setMode({ kind: 'list' })} />;
  }

  return (
    <div className="recipes">
      <div className="toolbar">
        <h2>Recipes</h2>
        <div className="buttons">
          <button type="button" onClick={() => setMode({ kind: 'import' })}>
            Import…
          </button>
          <button type="button" className="primary" onClick={() => setMode({ kind: 'new' })}>
            + New recipe
          </button>
        </div>
      </div>
      {deleteError && <div className="errors">{deleteError}</div>}
      {list.length === 0 && <p className="muted">No recipes yet. Add your first one, or import one from a web page or a photo.</p>}
      <ul className="recipe-list">
        {list.map((r) => (
          <li key={r.id}>
            <div className="info">
              <button type="button" className="link name" onClick={() => setMode({ kind: 'view', id: r.id })}>
                {r.name}
              </button>
              <span className="muted">
                {r.baseServings} servings · {r.activeMinutes} min hands-on, {r.totalMinutes} total · {r.ingredients.length}{' '}
                ingredient{r.ingredients.length === 1 ? '' : 's'}
                {r.advancePrep.length > 0 && ` · ${r.advancePrep.length} prep step${r.advancePrep.length === 1 ? '' : 's'}`}
                {(r.instructions?.length ?? 0) === 0 && ' · no steps yet'}
              </span>
            </div>
            <div className="buttons">
              <button type="button" onClick={() => setMode({ kind: 'view', id: r.id })}>
                View
              </button>
              <button type="button" onClick={() => setMode({ kind: 'edit', id: r.id })}>
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
