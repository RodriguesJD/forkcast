import type { ShoppingList } from '../domain';
import { formatQuantity } from './format';
import { Warnings } from './Warnings';

interface Props {
  list: ShoppingList;
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
  onClearChecked: () => void;
}

export function ShoppingListView({ list, checked, onToggle, onClearChecked }: Props) {
  const total = list.sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="shopping">
      <Warnings warnings={list.warnings} />
      {total === 0 && <p className="muted">Nothing to buy. Add meals to the week.</p>}
      {list.sections.map((section) => (
        <section key={section.section}>
          <h3>{section.section.replace('-', ' ')}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item.key} className={checked[item.key] ? 'checked' : ''}>
                <input
                  type="checkbox"
                  checked={!!checked[item.key]}
                  onChange={() => onToggle(item.key)}
                  id={item.key}
                />
                <label htmlFor={item.key}>
                  <span className="name">
                    <strong>{formatQuantity(item.quantity)}</strong> {item.name}
                  </span>{' '}
                  <span className="sources">
                    ({item.sources.map((s) => `${s.recipeName}: ${formatQuantity(s.quantity)}`).join('; ')})
                  </span>
                  {item.unmergedConflict && <span className="conflict"> · units differ, not merged</span>}
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {list.excludedStaples.length > 0 && (
        <p className="staples">Assumed in pantry: {list.excludedStaples.join(', ')}</p>
      )}
      {total > 0 && (
        <button type="button" onClick={onClearChecked}>
          Uncheck all
        </button>
      )}
    </div>
  );
}
