import type { Category, Kind } from "../api";
import { SearchPicker } from "./SearchPicker";

interface Props {
  categories: Category[];
  kind: Kind;
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  /** Leave out the tag block at the left, where a column of pickers would repeat it (table rows). */
  plain?: boolean;
}

/** One searchable list of "Group › Category": typing "pharm" offers Health › Pharmacy and Gotu › Pharmacy. */
export function CategoryPicker({ categories, kind, value, onChange, id, plain = false }: Props) {
  const items = categories
    .filter((c) => c.kind === kind)
    .map((c) => ({ id: c.id, label: c.sub_name, group: c.parent_name }));
  return <SearchPicker id={id} label="Category" items={items} value={value} onChange={onChange} none="Uncategorized" showGroup icon={plain ? undefined : "tag"} />;
}
