/** Stands in for Edit on an entry someone else added: only they can change it. */
export function ViewOnly({ name }: { name: string | null }) {
  const who = name ?? "the person who added it";
  return (
    <small className="muted view-only" title={`Only ${who} can change this entry`}>
      View only
    </small>
  );
}
