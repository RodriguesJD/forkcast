import { useEffect, useMemo, useState } from 'react';
import {
  buildSchedule,
  buildShoppingList,
  clearSlot,
  plannableRecipes,
  removeRecipe,
  resolveRecipes,
  setArchived,
  setEntry,
  upsertRecipe,
  validatePlan,
  type PlanEntry,
  type Recipe,
  type RecipeLibrary,
  type SlotRef,
  type WeekPlan,
  type WeekSettings,
} from './domain';
import { SEED_RECIPE_INDEX } from './data/seedRecipes';
import {
  loadChecked,
  loadLibrary,
  loadPlan,
  newId,
  saveChecked,
  saveLibrary,
  savePlan,
} from './storage/localStorage';
import { WeekGrid } from './ui/WeekGrid';
import { ShoppingListView } from './ui/ShoppingListView';
import { ScheduleView } from './ui/ScheduleView';
import { SettingsView } from './ui/SettingsView';
import { RecipesView } from './ui/RecipesView';
import { Warnings } from './ui/Warnings';

type Tab = 'plan' | 'shop' | 'cook' | 'recipes' | 'settings';
const TABS: Tab[] = ['plan', 'shop', 'cook', 'recipes', 'settings'];

export default function App() {
  const [plan, setPlan] = useState<WeekPlan>(loadPlan);
  const [library, setLibrary] = useState<RecipeLibrary>(loadLibrary);
  const [checked, setChecked] = useState<Record<string, boolean>>(loadChecked);
  const [tab, setTab] = useState<Tab>('plan');

  useEffect(() => savePlan(plan), [plan]);
  useEffect(() => saveLibrary(library), [library]);
  useEffect(() => saveChecked(checked), [checked]);

  const recipes = useMemo(() => resolveRecipes(SEED_RECIPE_INDEX, library), [library]);
  const plannable = useMemo(() => plannableRecipes(recipes, library), [recipes, library]);
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
  function onSaveRecipe(recipe: Recipe) {
    setLibrary((l) => upsertRecipe(l, recipe));
  }
  function onRemoveRecipe(id: string) {
    setLibrary((l) => removeRecipe(l, id));
  }
  function onArchiveRecipe(id: string, archived: boolean) {
    setLibrary((l) => setArchived(l, id, archived));
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
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        {tab === 'plan' && (
          <button type="button" className="clear-week" onClick={resetWeek}>
            Clear week
          </button>
        )}
      </header>

      {tab === 'plan' && (
        <>
          <Warnings warnings={planWarnings} title="Plan issues" />
          <WeekGrid
            plan={plan}
            recipes={recipes}
            options={plannable}
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
          seed={SEED_RECIPE_INDEX}
          recipes={recipes}
          library={library}
          plan={plan}
          onSave={onSaveRecipe}
          onRemove={onRemoveRecipe}
          onArchive={onArchiveRecipe}
          newId={newId}
        />
      )}
      {tab === 'settings' && <SettingsView settings={plan.settings} onChange={onSettings} />}
    </div>
  );
}
