import { useEffect, useMemo, useState } from 'react';
import {
  buildSchedule,
  buildShoppingList,
  clearSlot,
  setEntry,
  validatePlan,
  type PlanEntry,
  type Recipe,
  type RecipeIndex,
  type SlotRef,
  type WeekPlan,
  type WeekSettings,
} from './domain';
import { SEED_RECIPES } from './data/seedRecipes';
import {
  clearRecipes,
  loadChecked,
  loadPlan,
  loadRecipes,
  newId,
  saveChecked,
  savePlan,
  saveRecipes,
} from './storage/localStorage';
import { RecipesView } from './ui/RecipesView';
import { WeekGrid } from './ui/WeekGrid';
import { ShoppingListView } from './ui/ShoppingListView';
import { ScheduleView } from './ui/ScheduleView';
import { SettingsView } from './ui/SettingsView';
import { Warnings } from './ui/Warnings';

type Tab = 'plan' | 'shop' | 'cook' | 'recipes' | 'settings';

export default function App() {
  const [plan, setPlan] = useState<WeekPlan>(loadPlan);
  const [checked, setChecked] = useState<Record<string, boolean>>(loadChecked);
  const [recipeList, setRecipeList] = useState<Recipe[]>(() => loadRecipes() ?? SEED_RECIPES);
  const [tab, setTab] = useState<Tab>('plan');
  const recipes: RecipeIndex = useMemo(
    () => Object.fromEntries(recipeList.map((r) => [r.id, r])),
    [recipeList],
  );

  useEffect(() => savePlan(plan), [plan]);
  useEffect(() => saveChecked(checked), [checked]);

  const planWarnings = useMemo(() => validatePlan(plan, recipes), [plan, recipes]);
  const shopping = useMemo(() => buildShoppingList(plan, recipes), [plan, recipes]);
  const schedule = useMemo(() => buildSchedule(plan, recipes), [plan, recipes]);

  function onSet(entry: PlanEntry) {
    setPlan((p) => setEntry(p, entry));
  }
  function onClear(slot: SlotRef) {
    setPlan((p) => clearSlot(p, slot));
  }
  function onSettings(settings: WeekSettings) {
    setPlan((p) => ({ ...p, settings }));
  }
  function onRecipes(next: Recipe[]) {
    setRecipeList(next);
    saveRecipes(next);
  }
  function onResetRecipes() {
    clearRecipes();
    setRecipeList(SEED_RECIPES);
  }
  function resetWeek() {
    if (window.confirm('Remove every meal from this week?')) {
      setPlan((p) => ({ ...p, entries: [] }));
      setChecked({});
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Forkcast</h1>
        <nav className="tabs">
          {(['plan', 'shop', 'cook', 'recipes', 'settings'] as Tab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <button type="button" onClick={resetWeek}>
          Clear week
        </button>
      </header>

      {tab === 'plan' && (
        <>
          <Warnings warnings={planWarnings} title="Plan issues" />
          <WeekGrid
            plan={plan}
            recipes={recipes}
            warnings={planWarnings}
            days={schedule.days}
            onSet={onSet}
            onClear={onClear}
            newId={newId}
          />
          <p className="muted">
            Pick a recipe to cook, or "Leftovers from" an earlier meal. Cook servings are the total made, including
            portions eaten later as leftovers.
          </p>
        </>
      )}
      {tab === 'shop' && (
        <ShoppingListView
          list={shopping}
          checked={checked}
          onToggle={(key) => setChecked((c) => ({ ...c, [key]: !c[key] }))}
          onClearChecked={() => setChecked({})}
        />
      )}
      {tab === 'cook' && <ScheduleView schedule={schedule} settings={plan.settings} />}
      {tab === 'recipes' && (
        <RecipesView
          recipes={recipeList}
          isSeed={recipeList === SEED_RECIPES}
          onApply={onRecipes}
          onReset={onResetRecipes}
        />
      )}
      {tab === 'settings' && <SettingsView settings={plan.settings} onChange={onSettings} />}
    </div>
  );
}
