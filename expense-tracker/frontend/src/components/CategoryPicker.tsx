import type { Category, Kind } from "../api";
import { SearchPicker } from "./SearchPicker";

interface Props {
  categories: Category[];
  kind: Kind;
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
}

/** One searchable list of "Group › Category": typing "pharm" offers Health › Pharmacy and Gotu › Pharmacy. */
export function CategoryPicker({ categories, kind, value, onChange, id }: Props) {
  const items = categories
    .filter((c) => c.kind === kind)
    .map((c) => ({ id: c.id, label: c.sub_name, group: c.parent_name }));
  return <SearchPicker id={id} label="Category" items={items} value={value} onChange={onChange} none="Uncategorized" showGroup />;
}
