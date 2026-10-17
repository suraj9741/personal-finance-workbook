import { ApiError } from "./api";

/** Field name → message shown under that field. */
export type FieldErrors = Record<string, string>;

/** aria attributes that tie a field to its message under it. */
export function invalidProps(errors: FieldErrors, name: string, formId: string) {
  return errors[name] ? { "aria-invalid": true as const, "aria-describedby": `${formId}-${name}-error` } : {};
}

/** Put the cursor on the first field with a problem (inside a fieldset, its first control). */
export function focusFirstInvalid(root: HTMLElement | null) {
  const first = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  const target = first?.matches("fieldset") ? first.querySelector<HTMLElement>("input, select, button") : first;
  target?.focus();
}

/** A server error for one of the form's own fields goes under that field; anything else is general. */
export function splitServerError(e: Error, fields: string[]): { errors: FieldErrors; general: string } {
  if (e instanceof ApiError && e.field && fields.includes(e.field)) return { errors: { [e.field]: e.fieldMessage ?? e.message }, general: "" };
  return { errors: {}, general: e.message };
}
