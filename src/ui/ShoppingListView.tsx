import { useState, type FormEvent } from 'react';
import { ALL_UNITS, EXTRA_KEY_PREFIX, STORE_SECTION_ORDER, type ExtraShoppingItem, type ShoppingItem, type ShoppingList, type StoreSection, type Unit } from '../domain';
import { formatQuantity } from './format';
import { Warnings } from './Warnings';

interface Props {
  /** The list with the user's edits applied. */
  list: ShoppingList;
  /** Generated items the user hid this week. */
  hidden: ShoppingItem[];
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
  onClearChecked: () => void;
  onHide: (key: string) => void;
  onUnhide: (key: string) => void;
  onAddExtra: (item: Omit<ExtraShoppingItem, 'id'>) => void;
  onDeleteExtra: (id: string) => void;
}

export function ShoppingListView({ list, hidden, checked, onToggle, onClearChecked, onHide, onUnhide, onAddExtra, onDeleteExtra }: Props) {
  const total = list.sections.reduce((n, s) => n + s.items.length, 0);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<Unit>('each');
  const [section, setSection] = useState<StoreSection>('other');
  const [addError, setAddError] = useState<string | null>(null);

  function addItem(e: FormEvent) {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    const a = Number(amount);
    if (!n) return setAddError('Give the item a name.');
    if (!(a > 0)) return setAddError('Amount must be more than 0.');
    onAddExtra({ name: n, quantity: { amount: a, unit }, section });
    setName('');
    setAmount('1');
    setAddError(null);
  }

  function removeItem(item: ShoppingItem) {
    if (item.key.startsWith(EXTRA_KEY_PREFIX)) onDeleteExtra(item.key.slice(EXTRA_KEY_PREFIX.length));
    else onHide(item.key);
  }

  return (
    <div className="shopping">
      <Warnings warnings={list.warnings} />
      {total === 0 && <p className="muted">Nothing to buy. Add meals to the week, or add an item below.</p>}
      {list.sections.map((section) => (
        <section key={section.section}>
          <h3>{section.section.replace('-', ' ')}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item.key} className={checked[item.key] ? 'checked' : ''}>
                <input type="checkbox" checked={!!checked[item.key]} onChange={() => onToggle(item.key)} id={item.key} />
                <label htmlFor={item.key}>
                  <span className="name">
                    <strong>{formatQuantity(item.quantity)}</strong> {item.name}
                  </span>{' '}
                  {item.sources.length > 0 && (
                    <span className="sources">
                      ({item.sources.map((s) => `${s.recipeName}: ${formatQuantity(s.quantity)}`).join('; ')})
                    </span>
                  )}
                  {item.sources.length === 0 && <span className="sources">(added by you)</span>}
                  {item.unmergedConflict && <span className="conflict"> · units differ, not merged</span>}
                </label>
                <button type="button" className="icon" aria-label={`Remove ${item.name}`} title={item.sources.length === 0 ? 'Delete' : "Don't need this week"} onClick={() => removeItem(item)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <form className="add-item" onSubmit={addItem}>
        <h3>Add something else</h3>
        <div className="fields">
          <input type="text" placeholder="paper towels" aria-label="Item name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" min={0} step="any" inputMode="decimal" aria-label="Item amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select aria-label="Item unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {ALL_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <select aria-label="Item section" value={section} onChange={(e) => setSection(e.target.value as StoreSection)}>
            {STORE_SECTION_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit">Add</button>
        </div>
        {addError && <div className="errors">{addError}</div>}
      </form>

      {hidden.length > 0 && (
        <details className="hidden-items">
          <summary>
            {hidden.length} item{hidden.length === 1 ? '' : 's'} hidden this week
          </summary>
          <ul>
            {hidden.map((item) => (
              <li key={item.key}>
                <span>
                  <strong>{formatQuantity(item.quantity)}</strong> {item.name}
                </span>
                <button type="button" className="link" onClick={() => onUnhide(item.key)}>
                  put back
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {list.excludedStaples.length > 0 && <p className="staples">Assumed in pantry: {list.excludedStaples.join(', ')}</p>}
      {total > 0 && (
        <button type="button" onClick={onClearChecked}>
          Uncheck all
        </button>
      )}
    </div>
  );
}
