import { useState } from 'react';
import {
  isArchived,
  recipeOrigin,
  recipeUsage,
  type Recipe,
  type RecipeIndex,
  type RecipeLibrary,
  type RecipeOrigin,
  type WeekPlan,
} from '../domain';
import { RecipeForm, blankDraft, toDraft, type RecipeDraft } from './RecipeForm';

interface Props {
  seed: RecipeIndex;
  recipes: RecipeIndex;
  library: RecipeLibrary;
  plan: WeekPlan;
  onSave: (recipe: Recipe) => void;
  onRemove: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  newId: () => string;
}

type Editing = { draft: RecipeDraft; title: string } | null;

const ORIGIN_LABEL: Record<RecipeOrigin, string> = {
  seed: 'built in',
  'edited-seed': 'built in, edited',
  custom: 'yours',
};

export function RecipesView({ seed, recipes, library, plan, onSave, onRemove, onArchive, newId }: Props) {
  const [editing, setEditing] = useState<Editing>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (editing) {
    return (
      <RecipeForm
        initial={editing.draft}
        title={editing.title}
        newId={newId}
        onCancel={() => setEditing(null)}
        onSave={(recipe) => {
          onSave(recipe);
          setEditing(null);
        }}
      />
    );
  }

  const all = Object.values(recipes).sort((a, b) => a.name.localeCompare(b.name));
  const archivedCount = all.filter((r) => isArchived(library, r.id)).length;
  const visible = showArchived ? all : all.filter((r) => !isArchived(library, r.id));

  function startNew() {
    setEditing({ draft: blankDraft(newId(), plan.settings.householdSize), title: 'New recipe' });
  }
  function startEdit(recipe: Recipe) {
    setEditing({ draft: toDraft(recipe), title: `Edit ${recipe.name}` });
  }
  function startDuplicate(recipe: Recipe) {
    setEditing({
      draft: toDraft({ ...recipe, id: newId(), name: `${recipe.name} (copy)` }),
      title: `Copy of ${recipe.name}`,
    });
  }
  function remove(recipe: Recipe, origin: RecipeOrigin) {
    const used = recipeUsage(plan, recipe.id);
    const inPlan = used > 0 ? ` It is on this week's plan ${used === 1 ? 'once' : `${used} times`}.` : '';
    const question =
      origin === 'custom'
        ? `Delete "${recipe.name}"?${inPlan ? `${inPlan} Those meals will show as unknown until you change them.` : ''}`
        : `Discard your changes to "${recipe.name}" and go back to the built-in version?${inPlan}`;
    if (window.confirm(question)) onRemove(recipe.id);
  }

  return (
    <div className="recipes">
      <div className="toolbar">
        <button type="button" className="primary" onClick={startNew}>
          + New recipe
        </button>
        {archivedCount > 0 && (
          <label className="muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show{' '}
            {archivedCount} archived
          </label>
        )}
      </div>
      <p className="muted">
        Recipes you add or edit here are offered on the plan tab. Archive the ones you never cook to keep that list
        short; meals already planned keep working.
      </p>
      <ul className="recipe-list">
        {visible.map((recipe) => {
          const origin = recipeOrigin(seed, library, recipe.id) ?? 'custom';
          const archived = isArchived(library, recipe.id);
          const used = recipeUsage(plan, recipe.id);
          return (
            <li key={recipe.id} className={archived ? 'archived' : ''}>
              <div className="recipe-main">
                <div className="recipe-title">
                  <strong>{recipe.name}</strong>
                  <span className={`badge ${origin}`}>{ORIGIN_LABEL[origin]}</span>
                  {archived && <span className="badge archived">archived</span>}
                  {used > 0 && <span className="badge used">on the plan</span>}
                </div>
                <div className="recipe-sub">
                  {recipe.baseServings} servings · {recipe.activeMinutes} min hands-on, {recipe.totalMinutes} min total ·{' '}
                  {recipe.ingredients.length} ingredients
                  {recipe.advancePrep.length > 0 && ` · ${recipe.advancePrep.length} prep ahead`}
                </div>
              </div>
              <div className="recipe-actions">
                <button type="button" onClick={() => startEdit(recipe)}>
                  Edit
                </button>
                <button type="button" onClick={() => startDuplicate(recipe)}>
                  Duplicate
                </button>
                <button type="button" onClick={() => onArchive(recipe.id, !archived)}>
                  {archived ? 'Restore' : 'Archive'}
                </button>
                {origin !== 'seed' && (
                  <button type="button" className="danger" onClick={() => remove(recipe, origin)}>
                    {origin === 'custom' ? 'Delete' : 'Revert'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p className="muted">No recipes. Add one above.</p>}
    </div>
  );
}
