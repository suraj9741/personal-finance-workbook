import type { Account } from "../api";

// Every SVG in assets/banks, by file name: dropping in sbi.svg is all it takes to add a logo.
const FILES = import.meta.glob<string>("../assets/banks/*.svg", { eager: true, query: "?url", import: "default" });
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".svg".length), url]),
);

// Words in an account's institution or name that point at a logo file. Longest first, so
// "Bank of India" wins over a shorter word inside it.
const ALIASES: [string, string][] = [
  ["state bank of india", "sbi"],
  ["bank of india", "boi"],
  ["amazon pay", "amazon-pay"],
  ["yes bank", "yes-bank"],
  ["indusind", "indusind"],
  ["indusland", "indusind"],
  ["zerodha", "zerodha"],
  ["paytm", "paytm"],
  ["icici", "icici"],
  ["hdfc", "hdfc"],
  ["sbi", "sbi"],
  ["boi", "boi"],
  ["fi", "fi"],
];

/** The logo for an account's bank, found from its institution, then its name ("HDFC CC" → HDFC). */
export function bankLogo(account: Pick<Account, "name" | "institution" | "pay_type">): string | undefined {
  if (account.pay_type === "cash") return undefined;
  for (const text of [account.institution, account.name]) {
    const words = ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const hit = ALIASES.find(([alias]) => words.includes(` ${alias} `));
    if (hit && LOGOS[hit[1]]) return LOGOS[hit[1]];
  }
  return undefined;
}
