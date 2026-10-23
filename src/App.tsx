import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSchedule,
  buildShoppingList,
  clearSlot,
  setEntry,
  validatePlan,
  type PlanEntry,
  type RecipeIndex,
  type RecipeInput,
  type SlotRef,
  type WeekPlan,
  type WeekSettings,
} from './domain';
import { api, ApiError, type User, type UserState } from './api/client';
import { createSaver, type Saver, type SaveStatus } from './api/sync';
import { newId } from './ui/ids';
import { AuthView } from './ui/AuthView';
import { WeekGrid } from './ui/WeekGrid';
import { RecipesView } from './ui/RecipesView';
import { ShoppingListView } from './ui/ShoppingListView';
import { ScheduleView } from './ui/ScheduleView';
import { SettingsView } from './ui/SettingsView';
import { Warnings } from './ui/Warnings';

type Auth =
  | { status: 'loading' }
  | { status: 'out'; notice?: string }
  | { status: 'in'; user: User }
  | { status: 'error'; message: string };

export default function App() {
  const [auth, setAuth] = useState<Auth>({ status: 'loading' });

  const check = useCallback(() => {
    setAuth({ status: 'loading' });
    api
      .me()
      .then((user) => setAuth({ status: 'in', user }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAuth({ status: 'out' });
        else setAuth({ status: 'error', message: err instanceof Error ? err.message : 'Cannot reach the server.' });
      });
  }, []);
  useEffect(check, [check]);

  if (auth.status === 'loading') return <Centered>Loading…</Centered>;
  if (auth.status === 'error') {
    return (
      <Centered>
        <p>{auth.message}</p>
        <button type="button" onClick={check}>
          Try again
        </button>
      </Centered>
    );
  }
  if (auth.status === 'out') {
    return <AuthView notice={auth.notice} onSignedIn={(user) => setAuth({ status: 'in', user })} />;
  }
  return (
    <Workspace
      key={auth.user.id}
      user={auth.user}
      onSignedOut={(notice) => setAuth({ status: 'out', notice })}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}

type Tab = 'plan' | 'recipes' | 'shop' | 'cook' | 'settings';
const TABS: Tab[] = ['plan', 'recipes', 'shop', 'cook', 'settings'];

interface Loaded {
  state: UserState;
  recipes: RecipeIndex;
}

function Workspace({ user, onSignedOut }: { user: User; onSignedOut: (notice?: string) => void }) {
  const [loaded, setLoaded] = useState<Loaded | { error: string } | null>(null);

  const load = useCallback(() => {
    setLoaded(null);
    Promise.all([api.state(), api.listRecipes()])
      .then(([state, list]) => setLoaded({ state, recipes: Object.fromEntries(list.map((r) => [r.id, r])) }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) onSignedOut('Please sign in again.');
        else setLoaded({ error: err instanceof Error ? err.message : 'Could not load your data.' });
      });
  }, [onSignedOut]);
  useEffect(load, [load]);

  if (loaded === null) return <Centered>Loading your week…</Centered>;
  if ('error' in loaded) {
    return (
      <Centered>
        <p>{loaded.error}</p>
        <button type="button" onClick={load}>
          Try again
        </button>
      </Centered>
    );
  }
  return <Planner user={user} initial={loaded} onSignedOut={onSignedOut} />;
}

function Planner({ user, initial, onSignedOut }: { user: User; initial: Loaded; onSignedOut: (notice?: string) => void }) {
  const [plan, setPlanState] = useState<WeekPlan>(initial.state.plan);
  const [checked, setCheckedState] = useState<Record<string, boolean>>(initial.state.checked);
  const [recipes, setRecipes] = useState<RecipeIndex>(initial.recipes);
  const [tab, setTab] = useState<Tab>('plan');
  const [status, setStatus] = useState<{ plan: SaveStatus; checked: SaveStatus }>({ plan: 'saved', checked: 'saved' });
  const [sessionLost, setSessionLost] = useState(false);

  // Latest values live in refs so edit handlers can read-modify-write without
  // putting side effects inside React state updaters.
  const planRef = useRef(plan);
  const checkedRef = useRef(checked);

  // The save queues live for exactly as long as this component is mounted (created in an
  // effect, not useMemo, so StrictMode's mount/unmount/mount in dev gets fresh ones too).
  const saversRef = useRef<{ plan: Saver<WeekPlan>; checked: Saver<Record<string, boolean>> } | null>(null);
  useEffect(() => {
    const isFatal = (err: unknown) => err instanceof ApiError && !err.retryable;
    const onStatus = (key: 'plan' | 'checked') => (s: SaveStatus, detail: { error?: unknown }) => {
      setStatus((prev) => ({ ...prev, [key]: s }));
      if (s === 'failed' && detail.error instanceof ApiError && detail.error.status === 401) setSessionLost(true);
    };
    const savers = {
      plan: createSaver(api.savePlan, { isFatal, onStatus: onStatus('plan') }),
      checked: createSaver(api.saveChecked, { isFatal, onStatus: onStatus('checked') }),
    };
    saversRef.current = savers;
    const warn = (e: BeforeUnloadEvent) => {
      if (!savers.plan.hasPending() && !savers.checked.hasPending()) return;
      savers.plan.flush();
      savers.checked.flush();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      savers.plan.dispose();
      savers.checked.dispose();
      if (saversRef.current === savers) saversRef.current = null;
    };
  }, []);
  const hasPending = () =>
    saversRef.current !== null && (saversRef.current.plan.hasPending() || saversRef.current.checked.hasPending());

  function updatePlan(fn: (p: WeekPlan) => WeekPlan) {
    const next = fn(planRef.current);
    planRef.current = next;
    setPlanState(next);
    saversRef.current?.plan.set(next);
  }
  function updateChecked(fn: (c: Record<string, boolean>) => Record<string, boolean>) {
    const next = fn(checkedRef.current);
    checkedRef.current = next;
    setCheckedState(next);
    saversRef.current?.checked.set(next);
  }

  const planWarnings = useMemo(() => validatePlan(plan, recipes), [plan, recipes]);
  const shopping = useMemo(() => buildShoppingList(plan, recipes), [plan, recipes]);
  const schedule = useMemo(() => buildSchedule(plan, recipes), [plan, recipes]);

  function onSet(entry: PlanEntry) {
    updatePlan((p) => setEntry(p, entry));
  }
  function onClear(slot: SlotRef) {
    updatePlan((p) => clearSlot(p, slot));
  }
  function onSettings(settings: WeekSettings) {
    updatePlan((p) => ({ ...p, settings }));
  }
  function resetWeek() {
    if (window.confirm('Remove every meal from this week?')) {
      updatePlan((p) => ({ ...p, entries: [] }));
      updateChecked(() => ({}));
    }
  }

  function recipeError(err: unknown): never {
    if (err instanceof ApiError && err.status === 401) {
      setSessionLost(true);
      throw new Error('Your session has ended. Sign in again to keep working.');
    }
    throw err instanceof ApiError ? new Error(err.errors.join(' ')) : err;
  }
  async function createRecipe(input: RecipeInput) {
    try {
      const recipe = await api.createRecipe(input);
      setRecipes((r) => ({ ...r, [recipe.id]: recipe }));
    } catch (err) {
      recipeError(err);
    }
  }
  async function updateRecipe(id: string, input: RecipeInput) {
    try {
      const recipe = await api.updateRecipe(id, input);
      setRecipes((r) => ({ ...r, [recipe.id]: recipe }));
    } catch (err) {
      recipeError(err);
    }
  }
  async function deleteRecipe(id: string) {
    try {
      await api.deleteRecipe(id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) recipeError(err);
    }
    setRecipes((r) => {
      const { [id]: _gone, ...rest } = r;
      return rest;
    });
  }

  async function signOut() {
    if (hasPending() && !window.confirm('Some changes have not been saved yet. Sign out anyway?')) {
      return;
    }
    try {
      await api.logout();
    } catch {
      // The cookie may already be gone; either way, show the sign-in screen.
    }
    onSignedOut();
  }

  const worst: SaveStatus = (['failed', 'retrying', 'saving', 'saved'] as SaveStatus[]).find(
    (s) => status.plan === s || status.checked === s,
  )!;

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
        <span className={`save-status ${worst}`} role="status">
          {worst === 'saved' && 'Saved'}
          {worst === 'saving' && 'Saving…'}
          {worst === 'retrying' && 'Not saved yet – retrying'}
          {worst === 'failed' && 'Not saved'}
        </span>
        <span className="spacer" />
        <span className="muted who">{user.username}</span>
        <button type="button" className="signout" onClick={signOut}>
          Sign out
        </button>
      </header>

      {sessionLost && (
        <div className="errors">
          Your session has ended, so changes are no longer being saved.{' '}
          <button type="button" className="link" onClick={() => onSignedOut('Please sign in again.')}>
            Sign in again
          </button>
        </div>
      )}

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
            portions eaten later as leftovers.{' '}
            <button type="button" className="link" onClick={resetWeek}>
              Clear the week
            </button>
          </p>
        </>
      )}
      {tab === 'recipes' && (
        <RecipesView recipes={recipes} plan={plan} onCreate={createRecipe} onUpdate={updateRecipe} onDelete={deleteRecipe} />
      )}
      {tab === 'shop' && (
        <ShoppingListView
          list={shopping}
          checked={checked}
          onToggle={(key) => updateChecked((c) => ({ ...c, [key]: !c[key] }))}
          onClearChecked={() => updateChecked(() => ({}))}
        />
      )}
      {tab === 'cook' && <ScheduleView schedule={schedule} settings={plan.settings} />}
      {tab === 'settings' && <SettingsView settings={plan.settings} onChange={onSettings} />}
    </div>
  );
}
