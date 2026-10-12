/****************************************************************************************
 * PERSONAL FINANCE MANAGER — production-grade Google Apps Script  (v3 redesign)
 * ======================================================================================
 * WHAT CHANGED IN v3 (design corrections)
 *  • Data uses ONE "Amount" column + "Type" (Expense / Income / Transfer) — no more
 *    redundant Expense/Income columns.
 *  • Transfers are first-class & two-sided: a Transfer row has a FROM account and a TO
 *    account, so balances on BOTH sides update and transfers NEVER inflate Income/Expense
 *    or Net Savings (no double counting).
 *  • Config has three category blocks: Expense, Income, Transfer — each Parent/Sub, fully
 *    configurable. Add a row → dropdowns, Budget-vs-Actual and dashboards update (no code).
 *  • The Account sheet now uses the SAME 4-section logic/structure as the monthly Account
 *    Balance Dashboard (shared builder) — a consolidated year-to-date master view.
 *  • Dependent Category dropdown via onEdit (needs a BOUND script: Extensions ▸ Apps Script).
 *
 * QUICK START
 *  1. From the repo root: clasp push   (see README — uploads every file under src/)
 *  2. Reload the sheet ▸ Finance Tools ▸ Build New Workbook
 *
 * FILES (all share ONE global scope — no imports; every function/const is visible everywhere)
 *  config/  Config.gs (settings you edit, layout, derived ranges) · Defaults.gs (seed lists)
 *  core/    logging/utils, spreadsheet & folder mgmt, styling, named ranges & validation
 *  build/   one file per sheet builder + Build.gs orchestrators
 *  ui/      menu, onEdit triggers, navigation, Quick-Add sidebar
 *  tests/   runVerificationTests
 *  Rule: top-level code (outside functions) may only reference names from config/Config.gs
 *  or its own file. Keep anything that needs another file inside a function.
 ****************************************************************************************/

/* ============================ CENTRAL CONFIGURATION ============================ */
const CONFIG = {
  YEAR: 2027,
  WORKBOOK_NAME: "2027 Finance",
  DRIVE_FOLDER_ID: "1245tVfCnmVPpoHCEdc9lDIJUzMRYhKUg",
  REBUILD_MODE: "BACKUP",                 // DELETE | BACKUP | SKIP
  MONTHS: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
  TRANSACTION_START_ROW: 240,
  CURRENCY: "₹",
  ENABLE_CHARTS: true,
  ENABLE_CONDITIONAL_FORMATTING: true,
  ENABLE_NAMED_RANGES: true,
  MAX_CATEGORY_ROWS: 1000,
  MAX_TRANSACTION_ROWS: 10000   // bounded range for all SUMIF/QUERY. 10k ≈ years of data and keeps
                                // recalc fast. Raise toward 50000 only when you truly need it
                                // (heavier recalc). Re-run Build/Rebuild after changing.
};

const STYLE = {
  SLATE_DARK: '#0f172a',   // Header backgrounds
  SLATE_MED: '#64748b',    // Labels
  SLATE_LIGHT: '#f8fafc',  // Zebra/Card background
  PARENT_BG: '#f1f5f9',    // Parent row / light alternate stripe
  BORDER: '#cbd5e1',       // Soft border
  INK: '#1e293b',          // Font color/Primary
  FLAME: '#f97316',        // Orange accent (Budget, Nav Active)
  GREEN: '#0d9488',        // Teal Emerald — Income (premium, calm)
  GREEN_BG: '#f0fdfa',     // Soft mint tint — Income rows
  RED: '#e11d48',          // Rose Red — Expense (distinct, urgent)
  RED_BG: '#fff1f2',       // Soft rose tint — Expense rows
  BLUE: '#4f46e5',         // Royal Indigo — Transfer (premium)
  BLUE_BG: '#eef2ff',      // Soft indigo tint — Transfer rows
  BACKUP_TAG: '_Backup_',
  SEP: ' → ',
  ARROW: '→'
};

/* Single source of truth for monthly-sheet layout — no magic numbers scattered in builders.
   Columns are 1-based; move a panel by changing one number here.
   Layout (compact): A–F Expense BvA | H–M Income BvA | O–Q Transfer | S–X Account detail | Z–AD Totals | AF+ Transactions */
const LAYOUT = {
  EXPENSE_COL: 1,   EXPENSE_ROWS: 154,   // A–F  (6 cols: Parent, Sub, Budget, Spent, Diff, Progress)
  INCOME_COL:  8,   INCOME_ROWS:  60,    // H–M  (6 cols: Parent, Sub, Budget, Earned, Diff, Progress)
  TRANSFER_COL: 15, TRANSFER_ROWS: 60,   // O–Q  (3 cols: Parent, Sub, Actual)
  ACCOUNTS_COL: 19, ACCOUNTS_CAP: 80,    // S–X detail (6 cols) + Z–AD totals by pay type
  TXN_COL:     32,  TXN_ROWS: 500        // AF+  (transactions: Date, Desc, Amount, Type, Cat, Account)
};

/* Derived constants — top-level code; keep it in THIS file so load order never matters */
const DROWS = CONFIG.MAX_TRANSACTION_ROWS + 1;
const CROWS = CONFIG.MAX_CATEGORY_ROWS + 1;
const CUR   = CONFIG.CURRENCY + '#,##0;[Red]-' + CONFIG.CURRENCY + '#,##0';
const PCT   = '0.0%';

/* Bounded Data ranges (single source of truth for every formula) */
const R = {
  AMT:`Data!$D$2:$D$${DROWS}`, TYP:`Data!$E$2:$E$${DROWS}`, MON:`Data!$B$2:$B$${DROWS}`,
  DAT:`Data!$A$2:$A$${DROWS}`, CK:`Data!$P$2:$P$${DROWS}`, OK:`Data!$Q$2:$Q$${DROWS}`,
  IK:`Data!$R$2:$R$${DROWS}`, JPT:`Data!$J$2:$J$${DROWS}`, MPT:`Data!$M$2:$M$${DROWS}`,
  MOK:`Data!$S$2:$S$${DROWS}`,  // Month|PayType|Account  (money OUT, per month)
  MIK:`Data!$T$2:$T$${DROWS}`,  // Month|PayType|Account  (money IN, per month)
  cO:`Config!$Q$2:$Q$${CROWS}`, cN:`Config!$P$2:$P$${CROWS}`, cM:`Config!$O$2:$O$${CROWS}`, // Opening, Account, PayType
  cAK:`Config!$AD$2:$AD$${CROWS}` // PayType|Account key (for live Opening lookup)
};
