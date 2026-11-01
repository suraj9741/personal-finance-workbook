import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ChangeEvent } from "react";
import { ApiError, institutionLogoUrl, post, type Institution } from "../api";
import { useInstitutions } from "../hooks";
import { BUNDLED_BANKS, bundledLogo } from "./bank-logos";
import { SearchPicker, type PickerItem } from "./SearchPicker";

const ADD = "__add__";
const MAX_LOGO_KB = 200;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * The bank (or card issuer, or broker) field: pick one from the list so its logo shows, or add
 * one that isn't there yet with its logo. Added banks are shared by everyone using the app.
 */
export function BankPicker({ label, value, onChange }: { label: string; value: string; onChange: (name: string) => void }) {
  const added = useInstitutions().data ?? [];
  const [adding, setAdding] = useState(false);
  const known = [
    ...BUNDLED_BANKS.map((b) => ({ name: b.name, logo: bundledLogo(b.file) })),
    ...added.map((i) => ({ name: i.name, logo: institutionLogoUrl(i.id) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const items: PickerItem[] = known.map((b) => ({ id: b.name, label: b.name, group: "Banks and brokers", logo: b.logo, icon: "bank" }));
  // A bank typed in before this list existed stays selectable as it was written.
  const current = value.trim();
  if (current && !known.some((b) => b.name.toLowerCase() === current.toLowerCase())) {
    items.unshift({ id: current, label: current, group: "Banks and brokers", icon: "bank", hint: "no logo" });
  }
  items.push({ id: ADD, label: "Add a bank with its logo", group: "Not in the list?", icon: "plus" });
  const selected = items.find((i) => i.id !== ADD && i.label.toLowerCase() === current.toLowerCase());

  return (
    <div className="bank-picker">
      <SearchPicker
        label={label}
        none="None"
        icon="bank"
        items={items}
        value={selected?.id ?? null}
        onChange={(id) => {
          if (id === ADD) setAdding(true);
          else onChange(id ?? "");
        }}
      />
      {adding && (
        <AddBank
          onAdded={(bank) => {
            onChange(bank.name);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function AddBank({ onAdded, onCancel }: { onAdded: (bank: Institution) => void; onCancel: () => void }) {
  const client = useQueryClient();
  const id = useId();
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => post<Institution>("/institutions", { name: name.trim(), logo }),
    onSuccess: async (bank) => {
      await client.invalidateQueries({ queryKey: ["institutions"] });
      onAdded(bank);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't add the bank. Try again."),
  });

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError("");
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setError("Use a PNG, JPEG or WebP image.");
    if (file.size > MAX_LOGO_KB * 1024) return setError(`The logo must be ${MAX_LOGO_KB} KB or smaller.`);
    setLogo(await readAsDataUrl(file));
  }

  return (
    <div className="add-bank" role="group" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`} className="add-bank-title">
        Add a bank
      </p>
      <div className="add-bank-row">
        <label className="logo-drop">
          {logo ? <img src={logo} alt="Logo preview" /> : <span className="muted small">Logo</span>}
          <input type="file" accept={LOGO_TYPES.join(",")} className="sr-only" aria-label="Logo image" onChange={pick} />
        </label>
        <label className="add-bank-name">
          Name
          <input maxLength={60} value={name} placeholder="e.g. Kotak Mahindra Bank" onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <p className="hint">A square PNG, JPEG or WebP up to {MAX_LOGO_KB} KB. Everyone using the app can then pick this bank.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="tinted small" disabled={!name.trim() || !logo || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Adding…" : "Add bank"}
        </button>
        <button type="button" className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
