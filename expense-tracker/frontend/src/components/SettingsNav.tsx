import { useEffect, useState, type ReactNode } from "react";

export interface NavSection {
  id: string;
  label: string;
}

/**
 * The section menu for Settings and Admin: a sticky list on a laptop, a row of jump links on
 * smaller screens. Plain #anchors do the work; the link for the section being read is marked.
 */
export function SettingsNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  // The current section is the last one whose top has passed the top third of the screen,
  // or the last one once the page can't scroll further (a short final section never reaches the top).
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const line = window.innerHeight / 3;
      let current = sections[0]?.id;
      for (const { id } of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) current = id;
      }
      if (atEnd && window.scrollY > 0) current = sections[sections.length - 1]?.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [sections]);

  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <ul>
        {sections.map(({ id, label }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? "true" : undefined}
              // The browser scrolls to the section; then the heading takes focus, so Tab and screen readers carry on from there.
              onClick={() => requestAnimationFrame(() => document.getElementById(`${id}-title`)?.focus({ preventScroll: true }))}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A named section: an h2 (the menu's target) over its card, with an optional line of help. */
export function SettingsSection({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="settings-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} tabIndex={-1}>
        {title}
      </h2>
      {intro && <p className="settings-intro">{intro}</p>}
      {children}
    </section>
  );
}
