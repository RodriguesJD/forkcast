import { useState, type FormEvent } from 'react';
import {
  ALL_UNITS,
  parseRecipeInput,
  STORE_SECTION_ORDER,
  type Recipe,
  type RecipeInput,
  type StoreSection,
  type Unit,
} from '../domain';

/**
 * Create / edit one recipe. The draft keeps numbers as text so a half-typed
 * field never snaps to a value behind the user's back; `parseRecipeInput`
 * (the same validation the server runs) turns the draft into a recipe or a
 * list of errors on submit.
 */

interface IngredientDraft {
  key: number;
  name: string;
  amount: string;
  unit: Unit;
  section: StoreSection;
  prep: string;
}

interface StepDraft {
  key: number;
  id: string;
  description: string;
  leadDays: string;
  activeMinutes: string;
}

interface Draft {
  name: string;
  baseServings: string;
  activeMinutes: string;
  totalMinutes: string;
  ingredients: IngredientDraft[];
  advancePrep: StepDraft[];
}

let keyCounter = 0;
const nextKey = () => ++keyCounter;

function blankIngredient(): IngredientDraft {
  return { key: nextKey(), name: '', amount: '', unit: 'each', section: 'produce', prep: '' };
}

function blankStep(): StepDraft {
  return { key: nextKey(), id: '', description: '', leadDays: '1', activeMinutes: '5' };
}

function draftFrom(recipe: Recipe | undefined, defaultServings: number): Draft {
  if (!recipe) {
    return {
      name: '',
      baseServings: String(defaultServings),
      activeMinutes: '',
      totalMinutes: '',
      ingredients: [blankIngredient()],
      advancePrep: [],
    };
  }
  return {
    name: recipe.name,
    baseServings: String(recipe.baseServings),
    activeMinutes: String(recipe.activeMinutes),
    totalMinutes: String(recipe.totalMinutes),
    ingredients: recipe.ingredients.map((i) => ({
      key: nextKey(),
      name: i.name,
      amount: String(i.quantity.amount),
      unit: i.quantity.unit,
      section: i.section,
      prep: i.prep ?? '',
    })),
    advancePrep: recipe.advancePrep.map((s) => ({
      key: nextKey(),
      id: s.id,
      description: s.description,
      leadDays: String(s.leadDays),
      activeMinutes: String(s.activeMinutes),
    })),
  };
}

function num(text: string): number {
  return text.trim() === '' ? NaN : Number(text);
}

function toRaw(d: Draft): unknown {
  return {
    name: d.name,
    baseServings: num(d.baseServings),
    activeMinutes: num(d.activeMinutes),
    totalMinutes: num(d.totalMinutes),
    ingredients: d.ingredients.map((i) => ({
      name: i.name,
      quantity: { amount: num(i.amount), unit: i.unit },
      section: i.section,
      prep: i.prep,
    })),
    advancePrep: d.advancePrep.map((s) => ({
      id: s.id,
      description: s.description,
      leadDays: num(s.leadDays),
      activeMinutes: num(s.activeMinutes),
    })),
  };
}

interface Props {
  recipe?: Recipe;
  defaultServings: number;
  /** Resolves when saved; rejects with an Error whose message is shown. */
  onSave: (input: RecipeInput) => Promise<void>;
  onCancel: () => void;
}

export function RecipeForm({ recipe, defaultServings, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(recipe, defaultServings));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function patchIngredient(key: number, p: Partial<IngredientDraft>) {
    setDraft((d) => ({ ...d, ingredients: d.ingredients.map((i) => (i.key === key ? { ...i, ...p } : i)) }));
  }
  function patchStep(key: number, p: Partial<StepDraft>) {
    setDraft((d) => ({ ...d, advancePrep: d.advancePrep.map((s) => (s.key === key ? { ...s, ...p } : s)) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = parseRecipeInput(toRaw(draft));
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await onSave(parsed.recipe);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not save. Try again.']);
      setBusy(false);
    }
  }

  return (
    <form className="recipe-form" onSubmit={submit}>
      <h2>{recipe ? `Edit ${recipe.name}` : 'New recipe'}</h2>

      <label>
        Name
        <input type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} autoFocus required />
      </label>

      <div className="row">
        <label>
          Servings
          <input type="number" min={1} step={1} inputMode="numeric" value={draft.baseServings} onChange={(e) => patch({ baseServings: e.target.value })} />
        </label>
        <label>
          Hands-on minutes
          <input type="number" min={0} step={1} inputMode="numeric" value={draft.activeMinutes} onChange={(e) => patch({ activeMinutes: e.target.value })} />
        </label>
        <label>
          Total minutes
          <input type="number" min={0} step={1} inputMode="numeric" value={draft.totalMinutes} onChange={(e) => patch({ totalMinutes: e.target.value })} />
        </label>
      </div>
      <p className="muted">Hands-on is time at the stove or the cutting board; total is start to table, including oven or simmer time.</p>

      <h3>Ingredients</h3>
      <div className="ingredients">
        <div className="ingredient head">
          <span>Ingredient</span>
          <span>Amount</span>
          <span>Unit</span>
          <span>Store section</span>
          <span>Prep (optional)</span>
          <span />
        </div>
        {draft.ingredients.map((ing, i) => (
          <div className="ingredient" key={ing.key}>
            <input type="text" placeholder="yellow onion" aria-label={`Ingredient ${i + 1} name`} value={ing.name} onChange={(e) => patchIngredient(ing.key, { name: e.target.value })} />
            <input type="number" min={0} step="any" inputMode="decimal" aria-label={`Ingredient ${i + 1} amount`} value={ing.amount} onChange={(e) => patchIngredient(ing.key, { amount: e.target.value })} />
            <select aria-label={`Ingredient ${i + 1} unit`} value={ing.unit} onChange={(e) => patchIngredient(ing.key, { unit: e.target.value as Unit })}>
              {ALL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select aria-label={`Ingredient ${i + 1} section`} value={ing.section} onChange={(e) => patchIngredient(ing.key, { section: e.target.value as StoreSection })}>
              {STORE_SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input type="text" placeholder="diced" aria-label={`Ingredient ${i + 1} prep`} value={ing.prep} onChange={(e) => patchIngredient(ing.key, { prep: e.target.value })} />
            <button
              type="button"
              className="icon"
              aria-label={`Remove ingredient ${i + 1}`}
              title="Remove"
              onClick={() => setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((x) => x.key !== ing.key) }))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setDraft((d) => ({ ...d, ingredients: [...d.ingredients, blankIngredient()] }))}>
        + Add ingredient
      </button>

      <h3>Advance prep</h3>
      <p className="muted">Things to do on an earlier day: marinate, thaw, soak. They show up on the cook schedule.</p>
      {draft.advancePrep.map((step, i) => (
        <div className="step" key={step.key}>
          <input type="text" placeholder="Marinate the chicken" aria-label={`Step ${i + 1} description`} value={step.description} onChange={(e) => patchStep(step.key, { description: e.target.value })} />
          <label>
            <input type="number" min={1} max={6} step={1} inputMode="numeric" aria-label={`Step ${i + 1} days before`} value={step.leadDays} onChange={(e) => patchStep(step.key, { leadDays: e.target.value })} />{' '}
            day(s) before
          </label>
          <label>
            <input type="number" min={0} step={1} inputMode="numeric" aria-label={`Step ${i + 1} minutes`} value={step.activeMinutes} onChange={(e) => patchStep(step.key, { activeMinutes: e.target.value })} />{' '}
            min
          </label>
          <button
            type="button"
            className="icon"
            aria-label={`Remove step ${i + 1}`}
            title="Remove"
            onClick={() => setDraft((d) => ({ ...d, advancePrep: d.advancePrep.filter((x) => x.key !== step.key) }))}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setDraft((d) => ({ ...d, advancePrep: [...d.advancePrep, blankStep()] }))}>
        + Add prep step
      </button>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : recipe ? 'Save changes' : 'Add recipe'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
