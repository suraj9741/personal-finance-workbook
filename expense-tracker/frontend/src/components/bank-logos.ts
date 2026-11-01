import { institutionLogoUrl, type Account, type Institution } from "../api";
import { useInstitutions } from "../hooks";

// Every logo in assets/banks (SVG, or PNG when no vector exists), by file name: dropping in
// sbi.svg is all it takes to add a logo.
const FILES = import.meta.glob<string>("../assets/banks/*.{svg,png}", { eager: true, query: "?url", import: "default" });
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf(".")), url]),
);

/** The banks the app has a logo for, by the name the account form's bank list shows. */
export const BUNDLED_BANKS: { name: string; file: string }[] = [
  { name: "Amazon Pay", file: "amazon-pay" },
  { name: "Angel One", file: "angel-one" },
  { name: "Bank of India", file: "boi" },
  { name: "Dhan", file: "dhan" },
  { name: "Fi", file: "fi" },
  { name: "HDFC Bank", file: "hdfc" },
  { name: "ICICI Bank", file: "icici" },
  { name: "IndusInd Bank", file: "indusind" },
  { name: "Paytm", file: "paytm" },
  { name: "State Bank of India", file: "sbi" },
  { name: "Yes Bank", file: "yes-bank" },
  { name: "Zerodha", file: "zerodha" },
  { name: "Zerodha Coin", file: "coin" },
].filter((b) => LOGOS[b.file]);

export const bundledLogo = (file: string) => LOGOS[file];

// Words in an account's institution or name that point at a logo file. Longest first, so
// "Bank of India" wins over a shorter word inside it.
const ALIASES: [string, string][] = [
  ["state bank of india", "sbi"],
  ["bank of india", "boi"],
  ["amazon pay", "amazon-pay"],
  ["angel one", "angel-one"],
  ["angelone", "angel-one"],
  ["angel", "angel-one"],
  ["yes bank", "yes-bank"],
  ["indusind", "indusind"],
  ["indusland", "indusind"],
  // Before zerodha, so "Zerodha Coin" gets the Coin logo.
  ["coin", "coin"],
  ["zerodha", "zerodha"],
  ["paytm", "paytm"],
  ["dhan", "dhan"],
  ["icici", "icici"],
  ["hdfc", "hdfc"],
  ["sbi", "sbi"],
  ["boi", "boi"],
  ["fi", "fi"],
];

type LogoAccount = Pick<Account, "name" | "institution" | "pay_type">;

/**
 * The logo for an account's bank: one someone added whose name is the account's bank (or
 * name), else a bundled one found from words in its bank, then its name ("HDFC CC" → HDFC).
 */
export function bankLogo(account: LogoAccount, added: Institution[] = []): string | undefined {
  if (account.pay_type === "cash") return undefined;
  for (const text of [account.institution, account.name]) {
    const key = (text ?? "").trim().toLowerCase();
    const own = key && added.find((i) => i.name.toLowerCase() === key);
    if (own) return institutionLogoUrl(own.id);
  }
  for (const text of [account.institution, account.name]) {
    const words = ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const hit = ALIASES.find(([alias]) => words.includes(` ${alias} `));
    if (hit && LOGOS[hit[1]]) return LOGOS[hit[1]];
  }
  return undefined;
}

/** bankLogo with the banks people added, loaded once and cached. */
export function useBankLogo(): (account: LogoAccount) => string | undefined {
  const added = useInstitutions().data ?? [];
  return (account) => bankLogo(account, added);
}
