/**
 * The owner's switch for who sees an account. Off: only them. On: the whole household sees the
 * account and its entries and can add entries to it; only the owner can change or delete it.
 */
export function ShareSwitch({ shared, onChange, disabled, compact }: { shared: boolean; onChange: (shared: boolean) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <div className={compact ? "share-switch compact" : "share-switch"}>
      <label className="switch-row">
        <span className="switch-text">
          Share with household
          {!compact && (
            <small className="muted">
              {shared
                ? "Everyone in your household sees this account and its entries, and can add entries to it. Only you can change or delete it."
                : "Only you see this account and its entries."}
            </small>
          )}
        </span>
        <input type="checkbox" role="switch" className="switch" checked={shared} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </label>
    </div>
  );
}
