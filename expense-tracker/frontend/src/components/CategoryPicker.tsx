import { useMemo } from "react";
import type { Category, Kind } from "../api";

interface Props {
  categories: Category[];
  kind: Kind;
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
}

/** Two-step picker (parent, then sub), like the Sheet's dependent dropdown. */
export function CategoryPicker({ categories, kind, value, onChange, id }: Props) {
  const options = useMemo(() => categories.filter((c) => c.kind === kind), [categories, kind]);
  const parents = useMemo(() => [...new Set(options.map((c) => c.parent_name))], [options]);
  const selected = options.find((c) => c.id === value);
  const parent = selected?.parent_name ?? "";

  return (
    <span className="picker">
      <select
        id={id}
        aria-label="Category group"
        value={parent}
        onChange={(e) => {
          const subs = options.filter((c) => c.parent_name === e.target.value);
          onChange(subs.length === 1 ? subs[0].id : (subs[0]?.id ?? null));
        }}
      >
        <option value="">Uncategorized</option>
        {parents.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      {parent && (
        <select aria-label="Category" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          {options
            .filter((c) => c.parent_name === parent)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.sub_name}
              </option>
            ))}
        </select>
      )}
    </span>
  );
}
