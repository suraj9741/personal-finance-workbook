/**
 * Whose account this is, when it isn't yours: a small initial badge and their first name. Your
 * own accounts carry nothing, so the tag only ever marks someone else's.
 */
export function OwnerTag({ name, compact = false }: { name: string | undefined; compact?: boolean }) {
  if (!name) return null;
  return (
    <span className="owner-tag" title={`${name}'s account`}>
      <span className="owner-initial" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      {compact ? <span className="sr-only">{name}'s</span> : name}
    </span>
  );
}
