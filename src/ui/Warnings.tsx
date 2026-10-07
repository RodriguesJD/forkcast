import type { Warning } from '../domain/types';

export function Warnings({ warnings, title = 'Warnings' }: { warnings: Warning[]; title?: string }) {
  if (warnings.length === 0) return null;
  return (
    <div className="warnings">
      <strong>{title}</strong>
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>
            {w.message} <code>{w.code}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
