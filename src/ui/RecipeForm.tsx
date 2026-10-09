import { useMemo, useState } from 'react';
import {
  ALL_UNITS,
  STORE_SECTION_ORDER,
  normalizeIngredientName,
  validateRecipe,
  type Recipe,
  type RecipeProblem,
  type StoreSection,
  type Unit,
} from '../domain';

/**
 * Form state keeps numbers as strings so a half-typed field never becomes 0 or
 * NaN under the user's cursor. Conversion happens once, in toRecipe, and
 * validateRecipe in the domain decides what is acceptable.
 */
interface IngredientDraft {
  name: string;
  amount: string;
  unit: Unit;
  section: StoreSection;
  prep: string;
}

interface StepDraft {
  id: string;
  description: string;
  leadDays: string;
  activeMinutes: string;
}

export interface RecipeDraft {
  id: string;
  name: string;
  baseServings: string;
  activeMinutes: string;
  totalMinutes: string;
  ingredients: IngredientDraft[];
  advancePrep: StepDraft[];
}

export function toDraft(recipe: Recipe): RecipeDraft {
  return {
    id: recipe.id,
    name: recipe.name,
    baseServings: String(recipe.baseServings),
    activeMinutes: String(recipe.activeMinutes),
    totalMinutes: String(recipe.totalMinutes),
    ingredients: recipe.ingredients.map((i) => ({
      name: i.name,
      amount: String(i.quantity.amount),
      unit: i.quantity.unit,
      section: i.section,
      prep: i.prep ?? '',
    })),
    advancePrep: recipe.advancePrep.map((s) => ({
      id: s.id,
      description: s.description,
      leadDays: String(s.leadDays),
      activeMinutes: String(s.activeMinutes),
    })),
  };
}

export function blankDraft(id: string, baseServings: number): RecipeDraft {
  return {
    id,
    name: '',
    baseServings: String(baseServings),
    activeMinutes: '',
    totalMinutes: '',
    ingredients: [blankIngredient()],
    advancePrep: [],
  };
}

function blankIngredient(): IngredientDraft {
  return { name: '', amount: '', unit: 'each', section: 'produce', prep: '' };
}

/** Empty strings become NaN on purpose: Number('') is 0, which would pass as a valid amount. */
function num(s: string): number {
  return s.trim() === '' ? NaN : Number(s);
}

export function toRecipe(d: RecipeDraft): Recipe {
  return {
    id: d.id,
    name: d.name.trim(),
    baseServings: num(d.baseServings),
    activeMinutes: num(d.activeMinutes),
    totalMinutes: num(d.totalMinutes),
    ingredients: d.ingredients.map((i) => {
      const prep = normalizeIngredientName(i.prep);
      return {
        name: normalizeIngredientName(i.name),
        quantity: { amount: num(i.amount), unit: i.unit },
        section: i.section,
        ...(prep ? { prep } : {}),
      };
    }),
    advancePrep: d.advancePrep.map((s) => ({
      id: s.id,
      description: s.description.trim(),
      leadDays: num(s.leadDays),
      activeMinutes: num(s.activeMinutes),
    })),
  };
}

interface Props {
  initial: RecipeDraft;
  title: string;
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
  newId: () => string;
}

export function RecipeForm({ initial, title, onSave, onCancel, newId }: Props) {
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  // Problems stay hidden until the first save attempt, then track the draft live so fixes clear them.
  const [attempted, setAttempted] = useState(false);
  const problems = useMemo<RecipeProblem[] | null>(
    () => (attempted ? validateRecipe(toRecipe(draft)) : null),
    [attempted, draft],
  );

  function update(patch: Partial<RecipeDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }
  function updateIngredient(i: number, patch: Partial<IngredientDraft>) {
    setDraft((d) => ({ ...d, ingredients: d.ingredients.map((ing, j) => (j === i ? { ...ing, ...patch } : ing)) }));
  }
  function updateStep(i: number, patch: Partial<StepDraft>) {
    setDraft((d) => ({ ...d, advancePrep: d.advancePrep.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }

  function submit() {
    setAttempted(true);
    const recipe = toRecipe(draft);
    if (validateRecipe(recipe).length === 0) onSave(recipe);
  }

  const headerProblems = problems?.filter((p) => p.ingredientIndex === undefined && p.stepIndex === undefined) ?? [];
  const ingredientProblems = (i: number) => problems?.filter((p) => p.ingredientIndex === i) ?? [];
  const stepProblems = (i: number) => problems?.filter((p) => p.stepIndex === i) ?? [];

  return (
    <form
      className="recipe-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2>{title}</h2>

      <label className="field">
        Name
        <input value={draft.name} onChange={(e) => update({ name: e.target.value })} autoFocus />
      </label>

      <div className="field-row">
        <label className="field">
          Servings it makes
          <input type="number" inputMode="numeric" min={1} step={1} value={draft.baseServings} onChange={(e) => update({ baseServings: e.target.value })} />
        </label>
        <label className="field">
          Hands-on minutes
          <input type="number" inputMode="numeric" min={0} step={1} value={draft.activeMinutes} onChange={(e) => update({ activeMinutes: e.target.value })} />
        </label>
        <label className="field">
          Total minutes
          <input type="number" inputMode="numeric" min={1} step={1} value={draft.totalMinutes} onChange={(e) => update({ totalMinutes: e.target.value })} />
        </label>
      </div>
      <p className="muted">
        Hands-on is the time you are actually in the kitchen; total is start to table, including simmering or oven time.
      </p>
      <ProblemList problems={headerProblems} />

      <h3>Ingredients</h3>
      <p className="muted">
        Amounts are for the servings above. Use the same ingredient names across recipes so the shopping list merges
        them. "Prep" (diced, minced) lets Forkcast suggest batch prep when several recipes need the same thing.
      </p>
      <div className="ingredients">
        {draft.ingredients.map((ing, i) => (
          <div key={i} className={`ingredient${ingredientProblems(i).length > 0 ? ' invalid' : ''}`}>
            <input
              className="ing-name"
              placeholder="ingredient, e.g. yellow onion"
              value={ing.name}
              onChange={(e) => updateIngredient(i, { name: e.target.value })}
              aria-label="Ingredient name"
            />
            <input
              className="ing-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="amount"
              value={ing.amount}
              onChange={(e) => updateIngredient(i, { amount: e.target.value })}
              aria-label="Amount"
            />
            <select className="ing-unit" value={ing.unit} onChange={(e) => updateIngredient(i, { unit: e.target.value as Unit })} aria-label="Unit">
              {ALL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select
              className="ing-section"
              value={ing.section}
              onChange={(e) => updateIngredient(i, { section: e.target.value as StoreSection })}
              aria-label="Store section"
            >
              {STORE_SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {s.replace('-', ' ')}
                </option>
              ))}
            </select>
            <input
              className="ing-prep"
              placeholder="prep (optional), e.g. diced"
              value={ing.prep}
              onChange={(e) => updateIngredient(i, { prep: e.target.value })}
              aria-label="Prep"
            />
            <button
              type="button"
              className="remove"
              aria-label="Remove ingredient"
              title="Remove ingredient"
              onClick={() => update({ ingredients: draft.ingredients.filter((_, j) => j !== i) })}
            >
              ×
            </button>
            <ProblemList problems={ingredientProblems(i)} />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => update({ ingredients: [...draft.ingredients, blankIngredient()] })}>
        + Add ingredient
      </button>
      <ProblemList problems={problems?.filter((p) => p.code === 'no-ingredients') ?? []} />

      <h3>Prep ahead</h3>
      <p className="muted">
        Things to do a day or more before cooking: marinate, soak, thaw. Forkcast puts them on the right day in the
        cooking schedule.
      </p>
      <div className="steps">
        {draft.advancePrep.map((step, i) => (
          <div key={step.id} className={`step${stepProblems(i).length > 0 ? ' invalid' : ''}`}>
            <input
              className="step-desc"
              placeholder="e.g. Marinate the chicken"
              value={step.description}
              onChange={(e) => updateStep(i, { description: e.target.value })}
              aria-label="Prep step"
            />
            <label className="step-days">
              <input type="number" inputMode="numeric" min={1} step={1} value={step.leadDays} onChange={(e) => updateStep(i, { leadDays: e.target.value })} aria-label="Days ahead" />
              day(s) ahead
            </label>
            <label className="step-min">
              <input type="number" inputMode="numeric" min={0} step={1} value={step.activeMinutes} onChange={(e) => updateStep(i, { activeMinutes: e.target.value })} aria-label="Hands-on minutes" />
              min
            </label>
            <button
              type="button"
              className="remove"
              aria-label="Remove prep step"
              title="Remove prep step"
              onClick={() => update({ advancePrep: draft.advancePrep.filter((_, j) => j !== i) })}
            >
              ×
            </button>
            <ProblemList problems={stepProblems(i)} />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          update({ advancePrep: [...draft.advancePrep, { id: newId(), description: '', leadDays: '1', activeMinutes: '5' }] })
        }
      >
        + Add prep step
      </button>

      <div className="form-actions">
        <button type="submit" className="primary">
          Save recipe
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ProblemList({ problems }: { problems: RecipeProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="problems">
      {problems.map((p, i) => (
        <li key={i}>{p.message}</li>
      ))}
    </ul>
  );
}
