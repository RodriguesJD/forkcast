import { useState } from 'react';
import { scaleIngredients, type Recipe } from '../domain';
import { formatQuantity } from './format';

interface Props {
  recipe: Recipe;
  onEdit: () => void;
  onBack: () => void;
}

/** A recipe laid out for reading while cooking: ingredients scaled to a chosen serving count, then the steps. */
export function RecipeView({ recipe, onEdit, onBack }: Props) {
  const [servings, setServings] = useState(recipe.baseServings);
  const safe = Number.isInteger(servings) && servings >= 1 ? servings : recipe.baseServings;
  const ingredients = scaleIngredients(recipe, safe);
  const steps = recipe.instructions ?? [];

  return (
    <article className="recipe-view">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← Recipes
        </button>
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      </div>
      <h2>{recipe.name}</h2>
      <p className="muted">
        {recipe.activeMinutes} min hands-on · {recipe.totalMinutes} min total
        {recipe.sourceUrl && (
          <>
            {' · '}
            <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">
              source
            </a>
          </>
        )}
      </p>

      <div className="servings">
        <span>Servings</span>
        <button type="button" className="icon" aria-label="Fewer servings" onClick={() => setServings(Math.max(1, safe - 1))}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={servings}
          aria-label="Servings"
          onChange={(e) => setServings(Number(e.target.value))}
        />
        <button type="button" className="icon" aria-label="More servings" onClick={() => setServings(safe + 1)}>
          +
        </button>
        {safe !== recipe.baseServings && (
          <button type="button" className="link" onClick={() => setServings(recipe.baseServings)}>
            reset to {recipe.baseServings}
          </button>
        )}
      </div>

      <h3>Ingredients</h3>
      <ul className="ingredients-read">
        {ingredients.map((ing, i) => (
          <li key={i}>
            <strong>{formatQuantity(ing.quantity)}</strong> {ing.name}
            {ing.prep && <span className="muted">, {ing.prep}</span>}
          </li>
        ))}
      </ul>

      {recipe.advancePrep.length > 0 && (
        <>
          <h3>Ahead of time</h3>
          <ul className="prep-read">
            {recipe.advancePrep.map((step) => (
              <li key={step.id}>
                {step.description}{' '}
                <span className="muted">
                  ({step.leadDays} day{step.leadDays === 1 ? '' : 's'} before, {step.activeMinutes} min)
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Steps</h3>
      {steps.length > 0 ? (
        <ol className="steps-read">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : (
        <p className="muted">
          No steps written down yet.{' '}
          <button type="button" className="link" onClick={onEdit}>
            Add them
          </button>
        </p>
      )}
    </article>
  );
}
