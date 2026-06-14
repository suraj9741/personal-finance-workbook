/****************************************************************************************
 * PERSONAL FINANCE MANAGER — single, production-grade Google Apps Script  (v3 redesign)
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
 *  1. Open your "2026 Finance" sheet ▸ Extensions ▸ Apps Script ▸ paste ▸ Save
 *  2. Reload the sheet ▸ Finance Tools ▸ Build New Workbook
 ****************************************************************************************/

/* ============================ CENTRAL CONFIGURATION ============================ */
const CONFIG = {
  YEAR: 2026,
  WORKBOOK_NAME: "2026 Finance",
  DRIVE_FOLDER_ID: "1Rgo2m0U9UclxpByY5aJqMoqiJAHWlIAl",
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

/* Seed taxonomy — written to Config ONLY when Config is empty; then fully editable there. */
const SEED = {
  EXPENSE: {
    'Debt':['Credit cards','Car EMI','Electronics EMI','EMI','Tax','GST'],
    'Education':['Tuition','Books'],
    'Entertainment':['Concerts','Movies / Shows','Games'],
    'Everyday':['Groceries','Food','Clothes','Subscriptions','Utilities','Shopping'],
    'Savings':['PPF','Friend','Share Market','H Gold'],
    'Gifts':['Gifts','Gift card','Other'],
    'Health':['Doctors','Pharmacy'],
    'Gotu':['G Food','G Bank','G Pharmacy','G Doctors','G Medical test','G Clothes','G Phone','G Utilities','G Fuel','G Cash','G Tuition'],
    'Mom':['M Insurance','M Bank','M Pharmacy','M Doctors','M Medical test','M Clothes','M Phone','M Utilities','M Bachat Gat','M Cash'],
    'Baba':['B Insurance','B Bank','B Pharmacy','B Doctors','B Shopping','B Phone','B Utilities','B Fuel','B Cash'],
    'Room':['R Rent/mortgage','R Groceries','R Maintenance','R Improvements','R Property taxes','R Internet','R Electricity','R Heat/gas','R TV'],
    'Farm':['F Pharmacy','F Pre Farming','F Post Farming','F Maintenance'],
    'Friend':['F EMI','F borrow','F lent'],
    'Home':['Rent/mortgage','H Clothes','Groceries','Maintenance','Improvements','Property taxes','Internet','Electricity','Heat/gas','TV','Paper bill','Milk bill','Food','Wedding'],
    'Insurance':['Vehicle','Health','Home','Life'],
    'Pets':['Food','Vet/medical','Toys','Supplies'],
    'Technology':['Domains & hosting','Online services','Hardware','Software'],
    'Transportation':['Fuel','Car','Fast Tag','Bike','Public transit','Trip'],
    'Travel':['Airfare','Hotels','Food'],
    'Other':['Other']
  },
  INCOME: {
    'Wages':['Paycheck','Bonus','Commission','W Other'],
    'Friend':['Refund','Rent'],
    'Savings':['PPF','Friend','Interest Income','FD'],
    'Share Market':['Dividends','S Refund','Stock sell'],
    'Gifts':['Gifts','Gift card','Other'],
    'Trip':['T Refund','Fee'],
    'Gotu':['G Bank','G Cash'],
    'Mom':['M Bank','M Cash'],
    'Baba':['B Bank','B Cash'],
    'Other':['Other']
  },
  TRANSFER: {
    'Self Transfer':['Bank to Bank','Bank to Credit','Credit to Bank','Cash to Bank','Bank to Cash','Broker to Bank','Bank to Broker','Credit to Cash']
  },
  // Payment / account master: [Pay Type, Account, Opening]. Account names MATCH Data; "HDFC"
  // is intentionally both a Bank and a Credit Card — kept apart by Pay Type.
  PAY: [
    ['Bank','HDFC',0],['Bank','SBI',0],['Bank','BOI',0],['Bank','Paytm',0],['Bank','FI',0],['Bank','Amazon Pay',0],
    ['Credit Card','HDFC CC',0],['Credit Card','Amazon Pay',0],['Credit Card','ICICI',0],['Credit Card','Indusland',0],['Credit Card','SBI',0],['Credit Card','Yes Bank',0],
    ['Share Broker','Zerodha',0],['Share Broker','Angel Broker',0],['Share Broker','Dhan',0],
    ['Cash','Cash',0]
  ]
};
/* OPTION 2 — Code-driven defaults. This is the single place to edit the built-in starter
   taxonomy. It is written to Config ONLY on the first run (when Config is empty); after that
   the Config sheet is the source of truth and is never overwritten. */
const DEFAULT_CATEGORIES = SEED;

/* OPTION 2 — Code-driven ACCOUNT defaults. Written to Config ONLY on the first run (empty
   Config). After that, Config!O:P (Pay Type | Account) is the single source of truth and is
   never overwritten. Add/remove accounts in Config, not here. */
const DEFAULT_ACCOUNTS = {
  'Bank':         ["HDFC","SBI","BOI","Paytm","FI","Amazon Pay"],
  'Credit Card':  ["HDFC CC","Amazon Pay","ICICI","Indusland","SBI","Yes Bank"],
  'Share Broker': ["Zerodha","Angel Broker","Dhan"],
  'Cash':         ["Cash"]
};
function flatAccounts_(dict){ const o=[]; Object.keys(dict).forEach(t=>dict[t].forEach(a=>o.push([t,a,0]))); return o; }

const ACCOUNT_SECTIONS = [['Bank Accounts','Bank'],['Credit Cards','Credit Card'],
                          ['Share Brokers','Share Broker'],['Cash','Cash']];

/* Single source of truth for monthly-sheet layout — no magic numbers scattered in builders.
   Columns are 1-based; move a panel by changing one number here.
   Layout (compact): A–F Expense BvA | H–M Income BvA | O–Q Transfer | S–W Accounts | Y+ Transactions */
const LAYOUT = {
  EXPENSE_COL: 1,   EXPENSE_ROWS: 154,   // A–F  (6 cols: Parent, Sub, Budget, Spent, Diff, Progress)
  INCOME_COL:  8,   INCOME_ROWS:  60,    // H–M  (6 cols: Parent, Sub, Budget, Earned, Diff, Progress)
  TRANSFER_COL: 15, TRANSFER_ROWS: 60,   // O–Q  (3 cols: Parent, Sub, Actual)
  ACCOUNTS_COL: 19, ACCOUNTS_CAP: 80,    // S–W  (account dashboard)
  TXN_COL:     25,  TXN_ROWS: 500        // Y+   (transactions: Date, Desc, Amount, Type, Cat, Account)
};

/* Derived constants */
const DROWS = CONFIG.MAX_TRANSACTION_ROWS + 1;
const CROWS = CONFIG.MAX_CATEGORY_ROWS + 1;
const CUR   = CONFIG.CURRENCY + '#,##0;[Red]-' + CONFIG.CURRENCY + '#,##0';
const PCT   = '0.0%';
let   LOGS  = [];

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
/* Year-to-date balance for a whole Pay-Type class (transfers update both sides correctly) */
function classBalance_(cls){
  return `IFERROR(SUMIFS(${R.cO},${R.cM},"${cls}")`+
    `+SUMIFS(${R.AMT},${R.TYP},"Income",${R.JPT},"${cls}")+SUMIFS(${R.AMT},${R.TYP},"Transfer",${R.MPT},"${cls}")`+
    `-SUMIFS(${R.AMT},${R.TYP},"Expense",${R.JPT},"${cls}")-SUMIFS(${R.AMT},${R.TYP},"Transfer",${R.JPT},"${cls}"),0)`;
}

/* ============================ MENU ============================ */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Finance Tools')
    .addItem('➕ Quick Add Transaction','showQuickAdd')
    .addItem('📅 Go to Current Month','gotoCurrentMonth')
    .addItem('📊 Go to Annual Dashboard','gotoAnnual').addSeparator()
    .addItem('Build New Workbook','menuBuild')
    .addItem('Resume / Finish Build','menuResumeBuild').addSeparator()
    .addItem('Repair All Months','menuRepairMonths')
    .addItem('Rebuild Dashboards','menuRebuildDash')
    .addItem('Refresh Categories','menuRefreshCats')
    .addItem('Refresh Navigation','menuRefreshNav')
    .addItem('Refresh Named Ranges','menuRefreshNames')
    .addItem('Enable Dependent Dropdowns','menuInstallTriggers').addSeparator()
    .addItem('Run Verification Tests','menuRunTests')
    .addItem('Validate Formulas','menuValidate')
    .addItem('Backup Workbook','menuBackup').addToUi();
}
function menuBuild()        { run_('Build New Workbook', buildNewWorkbook); }
function menuResumeBuild()  { run_('Resume / Finish Build', resumeBuild); }
function menuRepairMonths() { run_('Repair All Months', repairAllMonths); }
function menuRebuildDash()  { run_('Rebuild Dashboards', rebuildDashboards); }
function menuRefreshCats()  { run_('Refresh Categories', refreshCategories); }
function menuRefreshNav()   { run_('Refresh Navigation', applyNavigationToAllSheets_); }
function menuRefreshNames() { run_('Refresh Named Ranges', refreshNamedRanges); }
function menuInstallTriggers(){ run_('Enable Dependent Dropdowns', installTriggers_); }
function menuRunTests()     { run_('Run Verification Tests', runVerificationTests); }
function menuValidate()     { run_('Validate Formulas', validateWorkbook); }
function menuBackup()       { run_('Backup Workbook', backupWorkbook); }

function run_(label, fn) {
  LOGS = []; Log_('INFO','=== '+label+' started ===');
  try {
    const ss = getOrCreateSpreadsheet_(); fn(ss);
    Log_('INFO','=== '+label+' finished ==='); flushLogs_(ss);
    try { ss.toast(label+' complete.','Finance Tools',6); } catch(e){}
  } catch (err) {
    Log_('ERROR', label+' failed: '+(err && err.stack ? err.stack : err));
    try { flushLogs_(getOrCreateSpreadsheet_()); } catch(e){}
    throw err;
  }
}

/* ============================ DATA-ENTRY ASSISTANT — TRUE dependent dropdown ============================
   The Category cell has NO list until a Type is chosen. Choosing a Type sets the Category
   validation to ONLY that type's categories (catExpense / catIncome / catTransfer). No static
   union list is ever used.
   • If the script is BOUND to the sheet, the simple onEdit() fires automatically.
   • If the script is STANDALONE, run Finance Tools ▸ "Enable Dependent Dropdowns" once — it
     creates an INSTALLABLE onEdit trigger so the same logic still runs. */
function onEdit(e){ handleEdit_(e); }
function onEditInstallable(e){ handleEdit_(e); }
function handleEdit_(e){
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet(); if (sh.getName() !== 'Data') return;
    const row = e.range.getRow(), col = e.range.getColumn(); if (row < 2) return;
    const ss = e.source || SpreadsheetApp.getActiveSpreadsheet();
    const C = {DATE:1,AMT:4,TYPE:5,CAT:6,FROM:9,TO:12};
    const MAP = {Expense:'catExpense', Income:'catIncome', Transfer:'catTransfer'};

    // 1) TRUE dependent dropdown — Category list is STRICTLY the chosen Type's list
    if (col === C.TYPE) {
      const t = String((e.value!==undefined ? e.value : sh.getRange(row,col).getValue()) || '').trim();
      const catCell = sh.getRange(row, C.CAT);
      catCell.clearContent();                              // drop any stale category from the old type
      if (MAP[t]) {
        const rng = ss.getRangeByName(MAP[t]);
        if (rng) catCell.setDataValidation(
          SpreadsheetApp.newDataValidation().requireValueInRange(rng,true).setAllowInvalid(false).build());
        try { ss.toast('Category list → '+t+' categories only.','Dependent dropdown',3); } catch(_){}
      } else {
        catCell.clearDataValidations();                    // blank/other Type → no category list at all
      }
    }
    // 2) Lightweight validation warnings
    if ([C.AMT,C.TYPE,C.CAT,C.FROM,C.TO].indexOf(col) > -1) {
      const amt = sh.getRange(row,C.AMT).getValue();
      if (amt!=='' ) {
        const type = sh.getRange(row,C.TYPE).getValue();
        if (type==='')                                    ss.toast('⚠ Row '+row+': choose a Type first.','Validation',4);
        else if (sh.getRange(row,C.CAT).getValue()==='')  ss.toast('⚠ Row '+row+': pick a Category.','Validation',4);
        else if (sh.getRange(row,C.FROM).getValue()==='') ss.toast('⚠ Row '+row+': pick an Account (From).','Validation',4);
        else if (type==='Transfer' && sh.getRange(row,C.TO).getValue()==='') ss.toast('⚠ Row '+row+': Transfer needs a "To Account".','Validation',5);
      }
    }
  } catch(err){ /* never block typing */ }
}
/* Installable onEdit trigger — makes the dependent dropdown work even for a STANDALONE script. */
function installTriggers_(ss){
  ScriptApp.getProjectTriggers().forEach(t=>{ if(t.getHandlerFunction()==='onEditInstallable') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  Log_('INFO','Installable onEdit trigger created — dependent dropdowns active.');
}

/* ============================ ORCHESTRATORS ============================ */
function buildNewWorkbook(ss) {
  if (CONFIG.REBUILD_MODE === 'DELETE' && !confirmDestructive_()) { Log_('WARNING','DELETE cancelled'); return; }
  const T = {};
  time_(T,'Config',          ()=>buildConfig_(ss));
  time_(T,'Data',            ()=>buildData_(ss));
  time_(T,'Helper',          ()=>buildHelper_(ss));
  time_(T,'Accounts',        ()=>buildAccounts_(ss));
  time_(T,'Month_Template',  ()=>buildMonthTemplate_(ss));
  time_(T,'12 Months (copyTo)', ()=>createMonthlySheets_(ss));
  time_(T,'Annual',          ()=>buildAnnual_(ss));
  time_(T,'NamedRanges',     ()=>{ if (CONFIG.ENABLE_NAMED_RANGES) refreshNamedRanges(ss); });
  time_(T,'Navigation',      ()=>applyNavigationToAllSheets_(ss));  // must run AFTER all sheets exist
  try { installTriggers_(ss); } catch(e){ Log_('WARNING','Trigger install needs authorization — run Finance Tools ▸ Enable Dependent Dropdowns once. '+e); }
  orderTabs_(ss);
  writePerfReport_(ss, T);
  validateWorkbook(ss);
}
function repairAllMonths(ss){
  CONFIG.MONTHS.forEach(m=>{ const s=ss.getSheetByName(m+'_'+CONFIG.YEAR); if(s) ss.deleteSheet(s); });
  buildMonthTemplate_(ss); createMonthlySheets_(ss); orderTabs_(ss);
}
/* Resilient against the 6-min limit: builds ONLY what's missing, then finalizes.
   With copyTo this rarely times out, but re-running always continues safely. */
function resumeBuild(ss){
  if(!ss.getSheetByName('Config'))         buildConfig_(ss);
  if(!ss.getSheetByName('Data'))           buildData_(ss);
  if(!ss.getSheetByName('Helper'))         buildHelper_(ss);
  if(!ss.getSheetByName('Accounts'))       buildAccounts_(ss);
  if(!ss.getSheetByName('Month_Template')) buildMonthTemplate_(ss);
  createMonthlySheets_(ss);                                 // skips existing months, copies the rest (fast)
  if(!ss.getSheetByName('Annual Dashboard')) buildAnnual_(ss);
  if (CONFIG.ENABLE_NAMED_RANGES) refreshNamedRanges(ss);
  try { installTriggers_(ss); } catch(e){}
  orderTabs_(ss);
  const missing = CONFIG.MONTHS.filter(m=>!ss.getSheetByName(m+'_'+CONFIG.YEAR));
  Log_('INFO', (missing.length? 'Still missing: '+missing.join(', ')+' — run Resume again.' : 'All months present ✓'));
}
function rebuildDashboards(ss){
  buildHelper_(ss); buildAccounts_(ss);
  CONFIG.MONTHS.forEach(m=>{ const s=ss.getSheetByName(m+'_'+CONFIG.YEAR); if(s) ss.deleteSheet(s); });
  buildMonthTemplate_(ss); createMonthlySheets_(ss); buildAnnual_(ss);
  applyNavigationToAllSheets_(ss);
}
/* Performance timing helper + report */
function time_(T, name, fn){ const s=Date.now(); fn(); T[name]=Date.now()-s; Log_('INFO','[PERF] '+name+': '+T[name]+'ms'); }
function writePerfReport_(ss, T){
  let sh=ss.getSheetByName('Performance_Report'); if(sh) sh.clear(); else sh=ss.insertSheet('Performance_Report');
  const rows=[['Build Step','Time (ms)','Notes']]; let total=0;
  Object.keys(T).forEach(k=>{ rows.push([k, T[k], '']); total+=T[k]; });
  rows.push(['── TOTAL ──', total, total<60000 ? '✓ under 60s target' : '⚠ over 60s — raise nothing, check recalc']);
  sh.getRange(1,1,rows.length,3).setValues(rows);
  sh.getRange('A1:C1').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');
  sh.getRange(rows.length,1,1,3).setFontWeight('bold');
  sh.setColumnWidth(1,200); sh.setColumnWidth(3,300); sh.setFrozenRows(1); sh.setTabColor('#16a34a');
}
function refreshCategories(ss){ if(!ss.getSheetByName('Config')) buildConfig_(ss); applyDataValidations_(ss); refreshNamedRanges(ss); Log_('INFO','Dropdowns refreshed (categories are live from Config).'); }

/* ============================ SPREADSHEET / FOLDER MGMT ============================ */
function getOrCreateSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active && active.getName() === CONFIG.WORKBOOK_NAME) return active;
  if (CONFIG.DRIVE_FOLDER_ID) {
    const it = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID).getFilesByName(CONFIG.WORKBOOK_NAME);
    if (it.hasNext()) { Log_('INFO','Opening existing "'+CONFIG.WORKBOOK_NAME+'"'); return SpreadsheetApp.open(it.next()); }
  }
  if (active) return active;
  Log_('INFO','Creating new workbook'); const ss = SpreadsheetApp.create(CONFIG.WORKBOOK_NAME);
  if (CONFIG.DRIVE_FOLDER_ID) { const f=DriveApp.getFileById(ss.getId());
    DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID).addFile(f); DriveApp.getRootFolder().removeFile(f); }
  return ss;
}
function prepareSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) { Log_('INFO','Creating '+name); return ss.insertSheet(name); }
  switch (CONFIG.REBUILD_MODE) {
    case 'SKIP':   Log_('INFO',name+' already exists. Skipping.'); return null;
    case 'DELETE': Log_('WARNING','Deleting '+name); ss.deleteSheet(sh); return ss.insertSheet(name);
    default:       const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT','yyyyMMdd_HHmmss');
                   Log_('INFO','Backing up '+name+' → '+name+STYLE.BACKUP_TAG+stamp);
                   sh.setName(name+STYLE.BACKUP_TAG+stamp); return ss.insertSheet(name);
  }
}
function backupWorkbook(ss) {
  const f = DriveApp.getFileById(ss.getId());
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT','yyyyMMdd_HHmmss');
  const name = CONFIG.WORKBOOK_NAME+STYLE.BACKUP_TAG+stamp;
  const parent = CONFIG.DRIVE_FOLDER_ID ? DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID) : null;
  const copy = parent ? f.makeCopy(name,parent) : f.makeCopy(name);
  Log_('INFO','Full backup created: '+name+' ('+copy.getId()+')');
}

/* ============================ 1. CONFIG ============================
   Budget lives NEXT TO each category (col D for expense, col I for income) so a new
   category row automatically appears in Budget-vs-Actual with a Planned cell — true
   auto-discovery, no separate budget block to keep in sync.
   Layout:  A,B,C,D = ExpParent, ExpSub, ExpCombined(auto), Monthly Budget
            F,G,H,I = IncParent, IncSub, IncCombined(auto), Monthly Planned
            K,L,M   = TrfParent, TrfSub, TrfCombined(auto)
            O,P,Q,R = Pay Type, Account, Opening, Pay Combined(auto)
            T=Types · V/W=Settings · Y/Z/AA/AB=Filtered categories & combined union */
function buildConfig_(ss) {
  // OPTION 1 + OPTION 2: Config is the source of truth. On the FIRST run (or empty Config)
  // we seed from DEFAULT_CATEGORIES; on SUBSEQUENT runs we PRESERVE every user edit
  // (add/remove/rename categories, parents, subs, budgets, accounts) and only re-apply the
  // structural formulas/headers/theme. No user data is ever overwritten.
  let sh = ss.getSheetByName('Config');
  const preserve = sh && sh.getRange('A2').getValue()!=='' && sh.getRange('P2').getValue()!=='' && CONFIG.REBUILD_MODE!=='DELETE';
  if (preserve) {
    Log_('INFO','Config has data — preserving user categories (Config = source of truth).');
    applyConfigStructure_(sh);
    return;
  }
  sh = prepareSheet_(ss, 'Config'); if (!sh) return;
  // First run / empty → seed from DEFAULT_CATEGORIES (the code-driven defaults).
  const exp=flat_(DEFAULT_CATEGORIES.EXPENSE), inc=flat_(DEFAULT_CATEGORIES.INCOME), trf=flat_(DEFAULT_CATEGORIES.TRANSFER);
  sh.getRange(2,1,exp.length,2).setValues(exp); sh.getRange(2,4,exp.length,1).setValues(exp.map(_=>[0]));  // A,B + D budget
  sh.getRange(2,6,inc.length,2).setValues(inc); sh.getRange(2,9,inc.length,1).setValues(inc.map(_=>[0]));  // F,G + I planned
  sh.getRange(2,11,trf.length,2).setValues(trf);                                                           // K,L
  const payRows = flatAccounts_(DEFAULT_ACCOUNTS); sh.getRange(2,15,payRows.length,3).setValues(payRows); // O,P,Q from DEFAULT_ACCOUNTS
  sh.getRange('T2:T4').setValues([['Expense'],['Income'],['Transfer']]);
  sh.getRange('V2:W5').setValues([['Year',CONFIG.YEAR],['Emergency Target (months)',6],['Currency',CONFIG.CURRENCY],['Rebuild Mode',CONFIG.REBUILD_MODE]]);
  applyConfigStructure_(sh);
  Log_('INFO','Config seeded from DEFAULT_CATEGORIES (first run).');
}
/* Re-applies Config headers, auto-formula columns, formats & theme — never touches user data. */
function applyConfigStructure_(sh) {
  sh.setTabColor('#475569');
  applyPremiumTheme_(sh, false);
  head_(sh,'A1:D1',['Exp Parent','Exp Sub','Exp Combined','Monthly Budget']);
  head_(sh,'F1:I1',['Inc Parent','Inc Sub','Inc Combined','Monthly Planned']);
  head_(sh,'K1:M1',['Trf Parent','Trf Sub','Trf Combined']);
  head_(sh,'O1:R1',['Pay Type','Account','Opening '+CONFIG.YEAR,'Pay Combined']);
  head_(sh,'T1:T1',['Types']);
  head_(sh,'V1:W1',['Setting','Value']);
  head_(sh,'Y1:Y1',['Filtered Exp']); head_(sh,'Z1:Z1',['Filtered Inc']);
  head_(sh,'AA1:AA1',['Filtered Trf']); head_(sh,'AB1:AB1',['All Cats']);
  head_(sh,'AD1:AD1',['Acct Key']);   // PayType|Account — for live Opening lookup (trailing-space safe)

  // Live account key (TRIM-safe). Drives the formula-driven Account dashboards.
  sh.getRange('AD2').setFormula(`=ARRAYFORMULA(IF(P2:P${CROWS}="","",TRIM(O2:O${CROWS})&"|"&TRIM(P2:P${CROWS})))`);
  sh.getRange('C2').setFormula(`=ARRAYFORMULA(IF(A2:A${CROWS}="","",A2:A${CROWS}&"${STYLE.SEP}"&B2:B${CROWS}))`);
  sh.getRange('H2').setFormula(`=ARRAYFORMULA(IF(F2:F${CROWS}="","",F2:F${CROWS}&"${STYLE.SEP}"&G2:G${CROWS}))`);
  sh.getRange('M2').setFormula(`=ARRAYFORMULA(IF(K2:K${CROWS}="","",K2:K${CROWS}&"${STYLE.SEP}"&L2:L${CROWS}))`);
  sh.getRange('R2').setFormula(`=ARRAYFORMULA(IF(P2:P${CROWS}="","",O2:O${CROWS}&"${STYLE.SEP}"&P2:P${CROWS}))`);
  sh.getRange('Y2').setFormula(`=IFERROR(FILTER(C2:C${CROWS}, LEN(C2:C${CROWS})>0), "")`);
  sh.getRange('Z2').setFormula(`=IFERROR(FILTER(H2:H${CROWS}, LEN(H2:H${CROWS})>0), "")`);
  sh.getRange('AA2').setFormula(`=IFERROR(FILTER(M2:M${CROWS}, LEN(M2:M${CROWS})>0), "")`);
  sh.getRange('AB2').setFormula(`=IFERROR(QUERY({Y2:Y; Z2:Z; AA2:AA}, "where Col1 is not null", 0), "")`);

  sh.getRange('D2:D').setNumberFormat(CUR); sh.getRange('I2:I').setNumberFormat(CUR); sh.getRange('Q2:Q').setNumberFormat(CUR);
  sh.setRowHeight(1, 26);
  sh.setFrozenRows(1);
}

/* ============================ 2. DATA (single Amount + Type) ============================ */
function buildData_(ss) {
  const sh = prepareSheet_(ss, 'Data'); if (!sh) return;
  sh.setTabColor('#0f172a'); // deep dark slate
  applyPremiumTheme_(sh, false);
  sh.setRowHeight(1, 28);
  
  head_(sh,'A1:T1',['Date','Month','Description','Amount','Type','Category','Parent','Sub',
                    'Account / From','From Pay Type','From Account','To Account','To Pay Type','To Acct','Notes',
                    'CatKey','OutKey','InKey','MOutKey','MInKey']);
  const A=`A2:A${DROWS}`, F=`F2:F${DROWS}`, I=`I2:I${DROWS}`, L=`L2:L${DROWS}`, ar=STYLE.ARROW;
  sh.getRange('B2').setFormula(`=ARRAYFORMULA(IF(${A}="","",TEXT(${A},"mmm")&"_"&YEAR(${A})))`);
  // Parent/Sub from Category; From/To Pay Type & Account from the "PayType → Account" picks
  sh.getRange('G2').setFormula(`=ARRAYFORMULA(IFERROR(IF(${F}="","",TRIM(LEFT(${F},FIND("${ar}",${F})-1))),""))`);
  sh.getRange('H2').setFormula(`=ARRAYFORMULA(IFERROR(IF(${F}="","",TRIM(MID(${F},FIND("${ar}",${F})+1,200))),""))`);
  sh.getRange('J2').setFormula(`=ARRAYFORMULA(IFERROR(IF(${I}="","",TRIM(LEFT(${I},FIND("${ar}",${I})-1))),""))`);
  sh.getRange('K2').setFormula(`=ARRAYFORMULA(IFERROR(IF(${I}="","",TRIM(MID(${I},FIND("${ar}",${I})+1,200))),""))`);
  sh.getRange('M2').setFormula(`=ARRAYFORMULA(IFERROR(IF(${L}="","",TRIM(LEFT(${L},FIND("${ar}",${L})-1))),""))`);
  sh.getRange('N2').setFormula(`=ARRAYFORMULA(IFERROR(IF(${L}="","",TRIM(MID(${L},FIND("${ar}",${L})+1,200))),""))`);
  // Keys (TRIM-safe → tolerant of trailing spaces in Config). P=Type|Month|Category.
  sh.getRange('P2').setFormula(`=ARRAYFORMULA(IF(${A}="","",E2:E${DROWS}&"|"&B2:B${DROWS}&"|"&${F}))`);
  sh.getRange('Q2').setFormula(`=ARRAYFORMULA(IF(${A}="","",IF((E2:E${DROWS}="Expense")+(E2:E${DROWS}="Transfer"),TRIM(J2:J${DROWS})&"|"&TRIM(K2:K${DROWS}),"")))`); // OUT key  PayType|Account
  sh.getRange('R2').setFormula(`=ARRAYFORMULA(IF(${A}="","",IF(E2:E${DROWS}="Income",TRIM(J2:J${DROWS})&"|"&TRIM(K2:K${DROWS}),IF(E2:E${DROWS}="Transfer",TRIM(M2:M${DROWS})&"|"&TRIM(N2:N${DROWS}),""))))`); // IN key
  sh.getRange('S2').setFormula(`=ARRAYFORMULA(IF(Q2:Q${DROWS}="","",B2:B${DROWS}&"|"&Q2:Q${DROWS}))`); // MOutKey = Month|OUT
  sh.getRange('T2').setFormula(`=ARRAYFORMULA(IF(R2:R${DROWS}="","",B2:B${DROWS}&"|"&R2:R${DROWS}))`); // MInKey  = Month|IN

  sh.getRange(`A2:A${DROWS}`).setNumberFormat('dd-mmm-yyyy');
  sh.getRange(`D2:D${DROWS}`).setNumberFormat(CUR);
  // Auto-filled / read-only columns: light background + italic to signal non-editable
  [2,7,8,10,11,13,14,16,17,18,19,20].forEach(c => {
    sh.getRange(2, c, DROWS-1, 1)
      .setBackground(STYLE.PARENT_BG)
      .setFontStyle('italic')
      .setFontColor(STYLE.SLATE_MED);
  });
  sh.hideColumns(16,5);  // hide P,Q,R,S,T keys
  sh.setFrozenRows(1);
  applyDataValidations_(ss);
  applyRowColors_(ss);
}
function applyDataValidations_(ss) {
  const sh = ss.getSheetByName('Data'); if (!sh) return;
  const dv = (a1,rule)=>sh.getRange(a1).setDataValidation(rule);
  dv(`A2:A${DROWS}`, SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('Pick a date — Month auto-fills').build());
  dv(`E2:E${DROWS}`, SpreadsheetApp.newDataValidation().requireValueInList(['Expense','Income','Transfer'],true).setAllowInvalid(false).build());
  // Category (F): NO static list. It is set PER-ROW by the onEdit handler based on the chosen
  // Type, so Expense rows show only expense categories, etc. (true dependent dropdown).
  sh.getRange(`F2:F${DROWS}`).clearDataValidations();
  const pay = SpreadsheetApp.newDataValidation().requireValueInRange(ss.getRange(`Config!$R$2:$R`),true).setAllowInvalid(false).build();
  dv(`I2:I${DROWS}`, pay);   // Account / From
  dv(`L2:L${DROWS}`, pay);   // To Account (transfers)
}
function applyRowColors_(ss) {
  if (!CONFIG.ENABLE_CONDITIONAL_FORMATTING) return;
  const sh = ss.getSheetByName('Data'); if (!sh) return;
  const rng     = sh.getRange(`A2:O${DROWS}`);
  const typeRng = sh.getRange(`E2:E${DROWS}`);
  // Row background by transaction type
  const mkBg   = (t,c) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$E2="${t}"`).setBackground(c).setRanges([rng]).build();
  // Type column gets bold, colored text for a badge effect
  const mkFont = (t,c) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$E2="${t}"`).setFontColor(c).setBold(true).setRanges([typeRng]).build();
  sh.setConditionalFormatRules([
    mkBg('Income',  STYLE.GREEN_BG), mkBg('Expense', STYLE.RED_BG), mkBg('Transfer', STYLE.BLUE_BG),
    mkFont('Income',STYLE.GREEN),    mkFont('Expense',STYLE.RED),   mkFont('Transfer',STYLE.BLUE)
  ]);
}

/* ============================ 3. HELPER (aggregation engine) ============================ */
function buildHelper_(ss) {
  const sh = prepareSheet_(ss, 'Helper'); if (!sh) return;
  sh.setTabColor(STYLE.SLATE_MED);
  applyPremiumTheme_(sh, true);
  for (let i=0;i<12;i++) sh.getRange(1,2+i).setValue(CONFIG.MONTHS[i]+'_'+CONFIG.YEAR);
  sh.getRange('A2').setValue('Income'); sh.getRange('A3').setValue('Expense');
  sh.getRange('A4').setValue('Savings'); sh.getRange('A5').setValue('Cum.NetWorth');
  for (let i=0;i<12;i++){
    const L=sh.getRange(1,2+i).getA1Notation();
    sh.getRange(2,2+i).setFormula(`=SUMIFS(${R.AMT},${R.TYP},"Income",${R.MON},${L})`);
    sh.getRange(3,2+i).setFormula(`=SUMIFS(${R.AMT},${R.TYP},"Expense",${R.MON},${L})`);
    sh.getRange(4,2+i).setFormula(`=${sh.getRange(2,2+i).getA1Notation()}-${sh.getRange(3,2+i).getA1Notation()}`);
    sh.getRange(5,2+i).setFormula(i===0 ? `=B4` : `=${sh.getRange(5,1+i).getA1Notation()}+${sh.getRange(4,2+i).getA1Notation()}`);
  }
  sh.getRange('B2:M5').setNumberFormat(CUR);
  sh.getRange('P1').setValue('Ranked Expense Categories').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK);
  sh.getRange('P2').setFormula(`=IFERROR(QUERY(Data!A2:R${DROWS},"select G,H,sum(D) where E='Expense' group by G,H order by sum(D) desc label sum(D) 'Total'",0),"")`);
  sh.getRange('R2:R').setNumberFormat(CUR);
  sh.getRange('U1').setValue('Income by Source').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK);
  sh.getRange('U2').setFormula(`=IFERROR(QUERY(Data!A2:R${DROWS},"select G,sum(D) where E='Income' group by G order by sum(D) desc label sum(D) 'Total'",0),"")`);
  sh.getRange('V2:V').setNumberFormat(CUR);
  sh.hideSheet();
}

/* ============================ SHARED: Account Balance dashboard (100% FORMULA-DRIVEN) ============
   NOTHING is generated as static rows. The whole table is a handful of array formulas that read
   Config live. Add/remove an account in Config → every dashboard updates instantly, no rebuild.
     • Account list  = SORT(FILTER(Config O/P …))      → grouped by Pay Type, dynamic length
     • Expense/Income= SUMIF on Month|PayType|Account keys (broadcasts over the list)
     • Starting      = Jan: Opening (SUMIF Config) ; later months: previous month's Remaining
                       (same row → carry-forward; works even for accounts added mid-year)
     • TOTALS        = QUERY group-by Pay Type (rows auto-grow/shrink) + a grand Net total
   monthMode=false (Account sheet) → year-to-date; prevTag = previous month tab (''/Jan = Opening). */
function buildAccountSections_(ss, sh, top, startCol, monthMode, tag, prevTag){
  const MAXA = 80;                                    // capacity (not reserved slots) — raise if you exceed 80 accounts
  const c = n => colL_(startCol+n);
  const cPT=c(0), cAcct=c(1), cStart=c(2), cExp=c(3), cInc=c(4), cRem=c(5);
  const first = top+2, last = first+MAXA-1;
  const aRng  = `${cAcct}${first}:${cAcct}${last}`;   // account names
  const ptRng = `${cPT}${first}:${cPT}${last}`;       // pay types

  if (monthMode) sh.getRange(top,startCol).setFormula('="ACCOUNT BALANCE DASHBOARD — "&$B$1');  // follows each copy
  else           sh.getRange(top,startCol).setValue('ACCOUNT BALANCE DASHBOARD — Year to Date');
  sh.getRange(top,startCol).setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(12);
  sh.getRange(top+1,startCol,1,6).setValues([['Pay Type','Account','Starting','Expense','Income','Remaining']])
    .setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');

  // 1) LIVE account list — sorted by Pay Type, then Account. Pure formula, straight from Config.
  sh.getRange(first,startCol).setFormula(
    `=IFERROR(SORT(FILTER({TRIM(Config!$O$2:$O$${CROWS}),TRIM(Config!$P$2:$P$${CROWS})},Config!$P$2:$P$${CROWS}<>""),1,TRUE,2,TRUE),"")`);

  // 2) Starting balance
  if (monthMode && prevTag) {
    sh.getRange(first,startCol+2).setFormula(`=ARRAYFORMULA(IF(${aRng}="","",'${prevTag}'!${cRem}${first}:${cRem}${last}))`);
  } else {
    sh.getRange(first,startCol+2).setFormula(`=ARRAYFORMULA(IF(${aRng}="","",IFERROR(SUMIF(${R.cAK},${ptRng}&"|"&${aRng},${R.cO}),0)))`);
  }
  // 3) Expense (out) & Income (in)
  if (monthMode) {
    sh.getRange(first,startCol+3).setFormula(`=ARRAYFORMULA(IF(${aRng}="","",IFERROR(SUMIF(${R.MOK},$B$1&"|"&${ptRng}&"|"&${aRng},${R.AMT}),0)))`);
    sh.getRange(first,startCol+4).setFormula(`=ARRAYFORMULA(IF(${aRng}="","",IFERROR(SUMIF(${R.MIK},$B$1&"|"&${ptRng}&"|"&${aRng},${R.AMT}),0)))`);
  } else {
    sh.getRange(first,startCol+3).setFormula(`=ARRAYFORMULA(IF(${aRng}="","",IFERROR(SUMIF(${R.OK},${ptRng}&"|"&${aRng},${R.AMT}),0)))`);
    sh.getRange(first,startCol+4).setFormula(`=ARRAYFORMULA(IF(${aRng}="","",IFERROR(SUMIF(${R.IK},${ptRng}&"|"&${aRng},${R.AMT}),0)))`);
  }
  // 4) Remaining
  sh.getRange(first,startCol+5).setFormula(
    `=ARRAYFORMULA(IF(${aRng}="","",${cStart}${first}:${cStart}${last}-${cExp}${first}:${cExp}${last}+${cInc}${first}:${cInc}${last}))`);

  sh.getRange(`${cStart}${first}:${cRem}${last}`).setNumberFormat(CUR);
  styleTableBorder_(sh, `${cPT}${top+1}:${cRem}${first+30}`);
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING) {
    const remRng  = sh.getRange(`${cRem}${first}:${cRem}${last}`);
    const allRng  = sh.getRange(`${cPT}${first}:${cRem}${last}`);
    // Negative Remaining: rose background + bold rose text (clearly overdrawn)
    const negRule   = SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0)
      .setFontColor(STYLE.RED).setBackground(STYLE.RED_BG).setBold(true).setRanges([remRng]).build();
    // Alternating row stripe — only on rows that have account data
    const stripeRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND(${cAcct}${first}<>"",MOD(ROW()-${first},2)=0)`)
      .setBackground(STYLE.PARENT_BG).setRanges([allRng]).build();
    const rules = sh.getConditionalFormatRules();
    rules.push(negRule, stripeRule);
    sh.setConditionalFormatRules(rules);
  }

  // 5) DYNAMIC TOTALS by Pay Type (QUERY group-by → rows appear/disappear automatically)
  const s = startCol+8, cs = n => colL_(s+n);
  sh.getRange(top,s).setValue('TOTALS by Pay Type').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(11);
  sh.getRange(top+1,s,1,5).setValues([['Pay Type','Starting','Expense','Income','Remaining']])
    .setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');
  sh.getRange(top+2,s).setFormula(
    `=IFERROR(QUERY({${ptRng},${cStart}${first}:${cRem}${last}},`+
    `"select Col1,sum(Col2),sum(Col3),sum(Col4),sum(Col5) where Col1 is not null group by Col1 `+
    `label sum(Col2) '',sum(Col3) '',sum(Col4) '',sum(Col5) ''",0),"")`);
  sh.getRange(`${cs(1)}${top+2}:${cs(4)}${last}`).setNumberFormat(CUR);
  // Grand total (Net) — sums the whole detail table; position is fixed in the header, value is dynamic
  sh.getRange(top,s+6).setValue('NET (all accounts)').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK);
  sh.getRange(top+1,s+6).setFormula(`=SUM(${cRem}${first}:${cRem}${last})`).setNumberFormat(CUR).setFontWeight('bold');
  styleTableBorder_(sh, `${cs(0)}${top+1}:${cs(4)}${first+10}`);
  return last;
}

/* Accounts grouped by Pay Type from the Config payment master */
function readAccountsByClass_(ss){
  const cfg = ss.getSheetByName('Config'); const g={}, seen={}; if(!cfg) return g;
  cfg.getRange(2,15,CONFIG.MAX_CATEGORY_ROWS,2).getValues().forEach(row=>{   // O=Pay Type, P=Account
    const t=String(row[0]).trim(), a=String(row[1]).trim();                  // TRIM → tolerant of "Bank " typos
    if(t!=='' && a!==''){ const k=t+'|'+a; if(!seen[k]){ seen[k]=1; (g[t]=g[t]||[]).push(a); } }
  });
  return g;
}

/* ============================ 4. ACCOUNT SHEET (consolidated master) ============================ */
function buildAccounts_(ss) {
  const sh = prepareSheet_(ss, 'Accounts'); if (!sh) return;
  sh.setTabColor('#0f766e');
  applyPremiumTheme_(sh, true);
  
  sh.getRange('A1').setValue('ACCOUNT MASTER — Year to Date ('+CONFIG.YEAR+')').setFontSize(14).setFontWeight('bold').setFontColor(STYLE.SLATE_DARK);
  sh.setRowHeight(1, 40);
  sh.setConditionalFormatRules([]);                       // start clean
  const endRow = buildAccountSections_(ss, sh, 3, 1, false, '', '');

  // Sizing
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 110);
  sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 110);
  
  sh.setFrozenRows(1);
}

/* ============================ 5. MONTHLY DASHBOARDS (template-driven) ============================
   buildMonthTemplate_ builds ONE sheet; createMonthlySheets_ copies it 12× via copyTo (the big
   speed win — server-side duplicate, ~3 API calls each vs ~150). Every formula is relative to
   $B$1 (month tag) and $B$2 (month-start date), so a copy only needs its A1/B1 set. The only
   per-month patch is the account "Starting" carry-forward (previous month's Remaining). */
function buildMonthTemplate_(ss) {
  const sh = prepareSheet_(ss, 'Month_Template'); if (!sh) return;
  sh.setTabColor(STYLE.SLATE_DARK);
  applyPremiumTheme_(sh, true);

  // Row 1: Sheet title (A1) + hidden month tag (B1, white text = invisible, used by $B$1 formulas)
  // The navigation bar is applied separately AFTER all sheets exist (applyNavigationToAllSheets_)
  // and is rendered in a compact sidebar on the RIGHT side of row 1 (beyond all dashboard content)
  // so it NEVER interferes with A1 title or any dashboard data.
  sh.getRange('A1').setValue('MONTH '+CONFIG.YEAR)
    .setFontSize(13).setFontWeight('bold').setFontColor('white')
    .setBackground(STYLE.SLATE_DARK).setVerticalAlignment('middle');
  sh.getRange('B1').setValue(CONFIG.MONTHS[0]+'_'+CONFIG.YEAR)
    .setFontColor(STYLE.SLATE_DARK).setBackground(STYLE.SLATE_DARK).setFontSize(6); // invisible tag
  // B2 = first day of this sheet's month
  sh.getRange('B2').setFormula('=DATE(RIGHT($B$1,4),MATCH(LEFT($B$1,3),{"Jan";"Feb";"Mar";"Apr";"May";"Jun";"Jul";"Aug";"Sep";"Oct";"Nov";"Dec"},0),1)').setFontColor('#ffffff');
  sh.setRowHeight(1, 30);   // header + nav row
  sh.setRowHeight(2, 12);   // compact spacer

  const mStart = `$B$2`;                                    // month-start date
  const BUD_LAST = 154, IBUD_LAST = 60, ACC_TOP = 158;

  /* KPI cards Grid (A3:K5) — merged pairs across 6-col Expense section */
  sh.getRange('A3:B3').merge(); sh.getRange('A4:B4').merge(); sh.getRange('A5:B5').merge(); // Card 1
  sh.getRange('C3:D3').merge(); sh.getRange('C4:D4').merge(); sh.getRange('C5:D5').merge(); // Card 2
  // Card 3 (E3:E5) is single column
  sh.getRange('G3:H3').merge(); sh.getRange('G4:H4').merge(); sh.getRange('G5:H5').merge(); // Card 4
  sh.getRange('I3:J3').merge(); sh.getRange('I4:J4').merge(); sh.getRange('I5:J5').merge(); // Card 5
  // Card 6 (K3:K5) is single column
  
  sh.getRange('A3').setValue('OPENING BALANCE');
  sh.getRange('C3').setValue('MONTHLY INCOME');
  sh.getRange('E3').setValue('MONTHLY EXPENSE');
  sh.getRange('G3').setValue('NET SAVINGS');
  sh.getRange('I3').setValue('SAVINGS RATE');
  sh.getRange('K3').setValue('TOTAL BUDGET');
  
  sh.getRange('A4').setFormula(`=IFERROR(SUMIFS(${R.AMT},${R.TYP},"Income",${R.DAT},"<"&${mStart})-SUMIFS(${R.AMT},${R.TYP},"Expense",${R.DAT},"<"&${mStart})+SUM(${R.cO}),0)`);
  sh.getRange('C4').setFormula(`=IFERROR(SUMIFS(${R.AMT},${R.TYP},"Income",${R.MON},$B$1),0)`);
  sh.getRange('E4').setFormula(`=IFERROR(SUMIFS(${R.AMT},${R.TYP},"Expense",${R.MON},$B$1),0)`);
  sh.getRange('G4').setFormula('=C4-E4');
  sh.getRange('I4').setFormula('=IF(C4=0,0,G4/C4)');
  sh.getRange('K4').setFormula(`=SUM(Config!$D$2:$D$${CROWS})`);
  
  // Sparklines embedded in card layout
  sh.getRange('A5').setFormula(`=SPARKLINE(Helper!B5:M5,{"charttype","line";"color","${STYLE.SLATE_MED}";"linewidth",1.5})`);
  sh.getRange('C5').setFormula(`=SPARKLINE(Helper!B2:M2,{"charttype","line";"color","${STYLE.GREEN}";"linewidth",1.5})`);
  sh.getRange('E5').setFormula(`=SPARKLINE(Helper!B3:M3,{"charttype","line";"color","${STYLE.RED}";"linewidth",1.5})`);
  sh.getRange('G5').setFormula(`=SPARKLINE(Helper!B4:M4,{"charttype","line";"color","${STYLE.BLUE}";"linewidth",1.5})`);
  sh.getRange('I5').setFormula(`=SPARKLINE(Helper!B5:M5,{"charttype","line";"color","${STYLE.BLUE}";"linewidth",1.5})`);
  sh.getRange('K5').setValue('');
  
  sh.setRowHeight(3, 22);   // Label row — slightly taller for 10pt labels
  sh.setRowHeight(4, 36);   // Value row — larger for premium 16pt impact
  sh.setRowHeight(5, 26);   // Sparkline row
  sh.setRowHeight(6, 15);
  
  // Format Card Fonts and Alignments
  const cardsRange = sh.getRange('A3:K5');
  cardsRange.setFontFamily('Inter').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange('A3:K3').setFontSize(10).setFontWeight('bold').setFontColor(STYLE.SLATE_MED); // 10pt (was 9pt)
  sh.getRange('A4:K4').setFontSize(16).setFontWeight('bold');  // 16pt (was 14pt)
  
  sh.getRange('A4').setFontColor(STYLE.INK);
  sh.getRange('C4').setFontColor(STYLE.GREEN);
  sh.getRange('E4').setFontColor(STYLE.RED);
  sh.getRange('G4').setFontColor(STYLE.BLUE);
  sh.getRange('I4').setFontColor(STYLE.BLUE);
  sh.getRange('K4').setFontColor(STYLE.FLAME);  // Budget card — warm orange accent
  
  sh.getRange('A4:G4').setNumberFormat(CUR);
  sh.getRange('K4').setNumberFormat(CUR);
  sh.getRange('I4').setNumberFormat(PCT);
  
  // Card backgrounds — unified clean slate
  sh.getRange('A3:E5').setBackground(STYLE.SLATE_LIGHT);
  sh.getRange('G3:K5').setBackground(STYLE.SLATE_LIGHT);
  
  // Standard card borders
  styleTableBorder_(sh, 'A3:B5');
  styleTableBorder_(sh, 'C3:D5');
  styleTableBorder_(sh, 'E3:E5');
  styleTableBorder_(sh, 'G3:H5');
  styleTableBorder_(sh, 'I3:J5');
  styleTableBorder_(sh, 'K3:K5');
  // Premium colored left-border accents per card type
  try {
    sh.getRange('A3:B5').setBorder(null,true,null,null,null,null,STYLE.INK,  SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('C3:D5').setBorder(null,true,null,null,null,null,STYLE.GREEN,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('E3:E5').setBorder(null,true,null,null,null,null,STYLE.RED,  SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('G3:H5').setBorder(null,true,null,null,null,null,STYLE.BLUE, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('I3:J5').setBorder(null,true,null,null,null,null,STYLE.BLUE, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('K3:K5').setBorder(null,true,null,null,null,null,STYLE.FLAME,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  } catch(e) { Log_('WARNING','Card accent borders: '+e); }

  /* LEFT — EXPENSE Budget vs Actual  (cols A–F) */
  sh.getRange('A7').setValue('EXPENSE — Budget vs Actual').setFontWeight('bold').setFontColor(STYLE.RED).setFontSize(10);
  sh.setRowHeight(7, 22);
  head_(sh,'A8:E8',['Parent','Sub','Budget','Spent','Diff']);
  sh.getRange('F8').setValue('Bar').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white').setHorizontalAlignment('center');
  sh.setRowHeight(8, 24);
  
  const EQ=`Config!A2:A${CROWS}`, ER=`Config!B2:B${CROWS}`, ES=`Config!D2:D${CROWS}`;
  sh.getRange('A9').setFormula(`=IFERROR(FILTER(${EQ},${EQ}<>""),"")`);
  sh.getRange('B9').setFormula(`=IFERROR(FILTER(${ER},${EQ}<>""),"")`);
  sh.getRange('C9').setFormula(`=IFERROR(FILTER(${ES},${EQ}<>""),"")`);
  sh.getRange('D9').setFormula(`=ARRAYFORMULA(IF(A9:A${BUD_LAST}="","",IFERROR(SUMIF(${R.CK},"Expense|"&$B$1&"|"&A9:A${BUD_LAST}&"${STYLE.SEP}"&B9:B${BUD_LAST},${R.AMT}),0)))`);
  sh.getRange('E9').setFormula(`=ARRAYFORMULA(IF(A9:A${BUD_LAST}="","",C9:C${BUD_LAST}-D9:D${BUD_LAST}))`);
  
  sh.getRange(`C9:E${BUD_LAST}`).setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 9, BUD_LAST, 1, 5, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, `A8:E${BUD_LAST}`);
  sh.getRange(`F8:F${BUD_LAST}`).setBackground(STYLE.PARENT_BG);
  styleTableBorder_(sh, `F8:F${BUD_LAST}`);
  // Expense progress bar sparklines: auto-color green = under budget, red = over budget
  const expProgFormulas = [];
  for (let r = 9; r <= BUD_LAST; r++) {
    expProgFormulas.push([`=IF(A${r}="","",SPARKLINE(D${r},{"charttype","bar";"max",IF(C${r}=0,1,C${r});"color1",IF(D${r}>C${r},"${STYLE.RED}","${STYLE.GREEN}");"color2","#e2e8f0"}))`]);
  }
  sh.getRange(9, 6, BUD_LAST - 8, 1).setFormulas(expProgFormulas);

  /* MIDDLE — INCOME Budget vs Actual  (cols H–M; col 8–13) */
  const incStartCol = LAYOUT.INCOME_COL; // 8 = H
  const iC = colL_(incStartCol); // H
  sh.getRange(`${iC}7`).setValue('INCOME — Budget vs Actual').setFontWeight('bold').setFontColor(STYLE.GREEN).setFontSize(10);
  head_(sh,`${iC}8:${colL_(incStartCol+4)}8`,['Parent','Sub','Budget','Earned','Diff']);
  sh.getRange(`${colL_(incStartCol+5)}8`).setValue('Bar').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white').setHorizontalAlignment('center');
  const IQ=`Config!F2:F${CROWS}`, IR=`Config!G2:G${CROWS}`, IS=`Config!I2:I${CROWS}`;
  sh.getRange(`${iC}9`).setFormula(`=IFERROR(FILTER(${IQ},${IQ}<>""),("")))`);
  sh.getRange(`${colL_(incStartCol+1)}9`).setFormula(`=IFERROR(FILTER(${IR},${IQ}<>""),("")))`);
  sh.getRange(`${colL_(incStartCol+2)}9`).setFormula(`=IFERROR(FILTER(${IS},${IQ}<>""),("")))`);
  sh.getRange(`${colL_(incStartCol+3)}9`).setFormula(`=ARRAYFORMULA(IF(${iC}9:${iC}${IBUD_LAST}="","",IFERROR(SUMIF(${R.CK},"Income|"&$B$1&"|"&${iC}9:${iC}${IBUD_LAST}&"${STYLE.SEP}"&${colL_(incStartCol+1)}9:${colL_(incStartCol+1)}${IBUD_LAST},${R.AMT}),0)))`);
  sh.getRange(`${colL_(incStartCol+4)}9`).setFormula(`=ARRAYFORMULA(IF(${iC}9:${iC}${IBUD_LAST}="","",${colL_(incStartCol+2)}9:${colL_(incStartCol+2)}${IBUD_LAST}-${colL_(incStartCol+3)}9:${colL_(incStartCol+3)}${IBUD_LAST}))`);
  sh.getRange(`${colL_(incStartCol+2)}9:${colL_(incStartCol+4)}${IBUD_LAST}`).setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 9, IBUD_LAST, incStartCol, incStartCol+4, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, `${iC}8:${colL_(incStartCol+4)}${IBUD_LAST}`);
  sh.getRange(`${colL_(incStartCol+5)}8:${colL_(incStartCol+5)}${IBUD_LAST}`).setBackground(STYLE.PARENT_BG);
  styleTableBorder_(sh, `${colL_(incStartCol+5)}8:${colL_(incStartCol+5)}${IBUD_LAST}`);
  const incProgFormulas = [];
  for (let r = 9; r <= IBUD_LAST; r++) {
    const cp=colL_(incStartCol+2), ca=colL_(incStartCol+3);
    incProgFormulas.push([`=IF(${iC}${r}="","",SPARKLINE(${ca}${r},{"charttype","bar";"max",IF(${cp}${r}=0,1,${cp}${r});"color1",IF(${ca}${r}<${cp}${r},"${STYLE.RED}","${STYLE.GREEN}");"color2","#e2e8f0"}))`]);
  }
  sh.getRange(9, incStartCol+5, IBUD_LAST-8, 1).setFormulas(incProgFormulas);

  sh.setRowHeights(9, BUD_LAST-8, 20);   // compact row height

  // Diff CF (expense + income) — unchanged logic
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING) {
    const budgetCfRules = sh.getConditionalFormatRules();
    const expDiffRng = sh.getRange(`E9:E${BUD_LAST}`);
    const incDiffRng = sh.getRange(`${colL_(LAYOUT.INCOME_COL+4)}9:${colL_(LAYOUT.INCOME_COL+4)}${IBUD_LAST}`);
    budgetCfRules.push(
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(STYLE.GREEN).setBold(true).setRanges([expDiffRng]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(STYLE.RED).setRanges([expDiffRng]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0).setFontColor(STYLE.GREEN).setBold(true).setRanges([incDiffRng]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(STYLE.RED).setRanges([incDiffRng]).build()
    );
    sh.setConditionalFormatRules(budgetCfRules);
  }

  /* TRANSFER Actual Summary  (cols O–Q; col 15–17) */
  const tC = colL_(LAYOUT.TRANSFER_COL); // O
  const TBUD_LAST = 60;
  sh.getRange(`${tC}7`).setValue('TRANSFER — Summary').setFontWeight('bold').setFontColor(STYLE.BLUE).setFontSize(10);
  head_(sh,`${tC}8:${colL_(LAYOUT.TRANSFER_COL+2)}8`,['Parent','Sub','Actual']);
  const TQ=`Config!K2:K${CROWS}`, TR=`Config!L2:L${CROWS}`;
  sh.getRange(`${tC}9`).setFormula(`=IFERROR(FILTER(${TQ},${TQ}<>""),("")))`);
  sh.getRange(`${colL_(LAYOUT.TRANSFER_COL+1)}9`).setFormula(`=IFERROR(FILTER(${TR},${TQ}<>""),("")))`);
  sh.getRange(`${colL_(LAYOUT.TRANSFER_COL+2)}9`).setFormula(`=ARRAYFORMULA(IF(${tC}9:${tC}${TBUD_LAST}="","",IFERROR(SUMIF(${R.CK},"Transfer|"&$B$1&"|"&${tC}9:${tC}${TBUD_LAST}&"${STYLE.SEP}"&${colL_(LAYOUT.TRANSFER_COL+1)}9:${colL_(LAYOUT.TRANSFER_COL+1)}${TBUD_LAST},${R.AMT}),0)))`);
  sh.getRange(`${colL_(LAYOUT.TRANSFER_COL+2)}9:${colL_(LAYOUT.TRANSFER_COL+2)}${TBUD_LAST}`).setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 9, TBUD_LAST, LAYOUT.TRANSFER_COL, LAYOUT.TRANSFER_COL+2, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, `${tC}8:${colL_(LAYOUT.TRANSFER_COL+2)}${TBUD_LAST}`);

  /* ACCOUNT BALANCE DASHBOARD  (cols S–W; LAYOUT.ACCOUNTS_COL = 19) */
  buildAccountSections_(ss, sh, 7, LAYOUT.ACCOUNTS_COL, true, '', '');

  /* TRANSACTIONS  (col Y = 25; LAYOUT.TXN_COL = 25) */
  const TXN_COL = LAYOUT.TXN_COL;
  const tHdr = 8, tFirst = 9, tEnd = 508, cT0 = colL_(TXN_COL), cT5 = colL_(TXN_COL+5);
  sh.getRange(7,TXN_COL).setFormula('="TRANSACTIONS — "&$B$1').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(10);
  sh.getRange(tHdr,TXN_COL,1,6).setValues([['Date','Description','Amount','Type','Category','Account']])
    .setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white').setHorizontalAlignment('center');
  sh.setRowHeight(tHdr, 24);
  sh.getRange(tFirst,TXN_COL).setFormula(`=IFERROR(QUERY(Data!A2:O${DROWS},"select A,C,D,E,F,I where B='"&$B$1&"' order by A",0),"(no transactions yet)")`);
  sh.getRange(tFirst,TXN_COL,tEnd-tFirst+1,6).setFontFamily('Inter');
  sh.getRange(tFirst,TXN_COL,tEnd-tFirst+1,1).setNumberFormat('dd-mmm-yyyy').setHorizontalAlignment('center');
  sh.getRange(tFirst,TXN_COL+2,tEnd-tFirst+1,1).setNumberFormat(CUR).setHorizontalAlignment('right');
  sh.getRange(tFirst,TXN_COL+3,tEnd-tFirst+1,1).setHorizontalAlignment('center');
  applyTableStripe_(sh, tFirst, tEnd, TXN_COL, TXN_COL+5, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, `${cT0}${tHdr}:${cT5}${tEnd}`);
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING) {
    const typeRng = sh.getRange(`${colL_(TXN_COL+3)}${tFirst}:${colL_(TXN_COL+3)}${tEnd}`);
    const mkT=(t,c)=>SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(t).setBackground(c).setRanges([typeRng]).build();
    const rules = sh.getConditionalFormatRules();
    rules.push(mkT('Income',STYLE.GREEN_BG), mkT('Expense',STYLE.RED_BG), mkT('Transfer',STYLE.BLUE_BG));
    sh.setConditionalFormatRules(rules);
  }
  try { if (sh.getFilter()) sh.getFilter().remove(); sh.getRange(tHdr,TXN_COL,tEnd-tHdr+1,6).createFilter(); }
  catch(e){ Log_('WARNING','Transaction filter skipped: '+e); }

  /* ---- COMPACT COLUMN WIDTHS (all sections in sequence, no large gaps) ---- */
  // A–F  Expense BvA (6 cols)
  sh.setColumnWidth(1,120); sh.setColumnWidth(2,140); sh.setColumnWidth(3,80); sh.setColumnWidth(4,80); sh.setColumnWidth(5,70); sh.setColumnWidth(6,70);
  // G    spacer
  sh.setColumnWidth(7, 12);
  // H–M  Income BvA (6 cols)
  sh.setColumnWidth(8,120); sh.setColumnWidth(9,140); sh.setColumnWidth(10,80); sh.setColumnWidth(11,80); sh.setColumnWidth(12,70); sh.setColumnWidth(13,70);
  // N    spacer
  sh.setColumnWidth(14, 12);
  // O–Q  Transfer (3 cols)
  sh.setColumnWidth(15,120); sh.setColumnWidth(16,120); sh.setColumnWidth(17,90);
  // R    spacer
  sh.setColumnWidth(18, 12);
  // S–W  Accounts (5 cols)
  sh.setColumnWidth(19,160); sh.setColumnWidth(20,95); sh.setColumnWidth(21,95); sh.setColumnWidth(22,95); sh.setColumnWidth(23,95);
  // X    spacer
  sh.setColumnWidth(24, 12);
  // Y+   Transactions (6 cols)
  sh.setColumnWidth(25,95); sh.setColumnWidth(26,155); sh.setColumnWidth(27,90); sh.setColumnWidth(28,80); sh.setColumnWidth(29,135); sh.setColumnWidth(30,110);

  sh.setFrozenRows(1);
}

/* Copy the template into the 12 month sheets (copyTo = one fast server-side op each).
   Resumable: skips months that already exist. Patches Feb–Dec carry-forward Starting. */
function createMonthlySheets_(ss){
  const tpl = ss.getSheetByName('Month_Template'); if(!tpl) { Log_('ERROR','Month_Template missing'); return; }
  const accCol = LAYOUT.ACCOUNTS_COL;
  const cAcct=colL_(accCol+1), cStart=colL_(accCol+2), cRem=colL_(accCol+5);
  const first=9, last=first+LAYOUT.ACCOUNTS_CAP-1;
  CONFIG.MONTHS.forEach((m,i)=>{
    const tag = m+'_'+CONFIG.YEAR;
    if (ss.getSheetByName(tag)) return;
    const cp = tpl.copyTo(ss).setName(tag);
    cp.showSheet().setTabColor(STYLE.SLATE_DARK);
    // Restore the A1 title for each month copy (nav bar will paint over it with same bg later)
    cp.getRange('A1').setValue(m+' '+CONFIG.YEAR)
      .setFontSize(13).setFontWeight('bold').setFontColor('white')
      .setBackground(STYLE.SLATE_DARK).setVerticalAlignment('middle');
    cp.getRange('B1').setValue(tag)
      .setFontColor(STYLE.SLATE_DARK).setBackground(STYLE.SLATE_DARK).setFontSize(6);
    if (i>0){
      const prev = CONFIG.MONTHS[i-1]+'_'+CONFIG.YEAR;
      cp.getRange(`${cStart}${first}`).setFormula(
        `=ARRAYFORMULA(IF(${cAcct}${first}:${cAcct}${last}="","",'${prev}'!${cRem}${first}:${cRem}${last}))`);
    }
    Log_('INFO','Created '+tag+' (copyTo)');
  });
  tpl.hideSheet();
}

/* ============================ 6. ANNUAL DASHBOARD ============================ */
function buildAnnual_(ss) {
  const sh = prepareSheet_(ss, 'Annual Dashboard'); if (!sh) return;
  sh.setTabColor(STYLE.FLAME);
  applyPremiumTheme_(sh, true);
  
  sh.getRange('A1').setValue('ANNUAL DASHBOARD '+CONFIG.YEAR).setFontSize(18).setFontWeight('bold').setFontColor(STYLE.SLATE_DARK);
  sh.setRowHeight(1, 40);
  sh.setRowHeight(2, 15);
  
  // Zone 1: Annual KPIs
  const z1 = [
    ['Total Income',`=IFERROR(SUMIFS(${R.AMT},${R.TYP},"Income"),0)`],
    ['Total Expense',`=IFERROR(SUMIFS(${R.AMT},${R.TYP},"Expense"),0)`],
    ['Total Savings','=B3-B4'],['Savings Rate','=IF(B3=0,0,B5/B3)'],
    ['Avg Monthly Income','=IFERROR(B3/COUNTIF(Helper!B2:M2,">0"),0)'],
    ['Avg Monthly Expense','=IFERROR(B4/COUNTIF(Helper!B3:M3,">0"),0)'],
    ['Avg Monthly Savings','=IFERROR(B5/COUNTIF(Helper!B2:M2,">0"),0)']
  ];
  sh.getRange(3,1,z1.length,2).setValues(z1);
  sh.getRange('B3:B5').setNumberFormat(CUR).setHorizontalAlignment('right'); 
  sh.getRange('B6').setNumberFormat(PCT).setHorizontalAlignment('right'); 
  sh.getRange('B7:B9').setNumberFormat(CUR).setHorizontalAlignment('right');
  sh.getRange('A3:A9').setFontWeight('bold').setBackground(STYLE.SLATE_LIGHT).setFontColor(STYLE.INK);
  styleTableBorder_(sh, 'A3:B9');
  sh.setRowHeights(3, 7, 22);

  // Zone 2: Monthly Comparison Table
  sh.getRange('D2').setValue('Monthly Comparison').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(11);
  sh.setRowHeight(2, 20);
  head_(sh,'D3:H3',['Month','Income','Expense','Savings','Savings %']);
  sh.setRowHeight(3, 28);
  for (let i=0;i<12;i++){ const r=4+i,c=2+i;
    sh.getRange(r,4).setValue(CONFIG.MONTHS[i]);
    sh.getRange(r,5).setFormula(`=Helper!${colL_(c)}2`); sh.getRange(r,6).setFormula(`=Helper!${colL_(c)}3`);
    sh.getRange(r,7).setFormula(`=Helper!${colL_(c)}4`); sh.getRange(r,8).setFormula(`=IF(E${r}=0,0,G${r}/E${r})`);
    sh.setRowHeight(r, 22);
  }
  sh.getRange('E4:G15').setNumberFormat(CUR).setHorizontalAlignment('right'); 
  sh.getRange('H4:H15').setNumberFormat(PCT).setHorizontalAlignment('right');
  sh.getRange('D4:D15').setHorizontalAlignment('center');
  applyTableStripe_(sh, 4, 15, 4, 8, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, 'D3:H15');
  
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING)
    sh.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint('#f4c7c3').setGradientMaxpoint('#b7e1cd').setRanges([sh.getRange('H4:H15')]).build()]);

  // Zone 3: Top 10 Expense Categories
  sh.getRange('A12').setValue('Top 10 Expense Categories').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(11);
  sh.setRowHeight(12, 20);
  head_(sh,'A13:C13',['Parent','Sub','Total']);
  sh.setRowHeight(13, 28);
  sh.getRange('A14').setFormula('=IFERROR(QUERY({Helper!P2:R},"select Col1,Col2,Col3 where Col3>0 order by Col3 desc limit 10",0),"")');
  sh.getRange('C14:C23').setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 14, 23, 1, 3, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, 'A13:C23');
  sh.setRowHeights(14, 10, 22);
  
  // Zone 4: Highest Spending Cat card
  sh.getRange('A25').setValue('Highest Spending Cat').setFontWeight('bold').setBackground(STYLE.SLATE_LIGHT).setFontColor(STYLE.INK);
  sh.getRange('C25').setFormula('=IFERROR(INDEX(A14:A23,MATCH(MAX(C14:C23),C14:C23,0))&" / "&INDEX(B14:B23,MATCH(MAX(C14:C23),C14:C23,0)),"")').setFontWeight('bold').setHorizontalAlignment('right');
  styleTableBorder_(sh, 'A25:C25');
  sh.setRowHeight(25, 24);

  // Zone 5: Income by Source
  sh.getRange('J2').setValue('Income by Source').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(11);
  sh.setRowHeight(2, 20);
  head_(sh,'J3:K3',['Source','Total']);
  sh.setRowHeight(3, 28);
  sh.getRange('J4').setFormula('=IFERROR(QUERY({Helper!U2:V},"select Col1,Col2 where Col2>0 order by Col2 desc",0),"")');
  sh.getRange('K4:K15').setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 4, 15, 10, 11, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, 'J3:K15');
  sh.setRowHeights(4, 12, 22);
  
  sh.getRange('J18').setValue('Highest Earning Month').setFontWeight('bold').setBackground(STYLE.SLATE_LIGHT).setFontColor(STYLE.INK);
  sh.getRange('K18').setFormula('=IFERROR(INDEX(Helper!B1:M1,MATCH(MAX(Helper!B2:M2),Helper!B2:M2,0)),"")').setFontWeight('bold').setHorizontalAlignment('right');
  styleTableBorder_(sh, 'J18:K18');
  sh.setRowHeight(18, 24);

  // Financial Health Score Card (J20:K22) — composite score from savings rate, credit, emergency fund
  sh.getRange('J20:K20').merge();
  sh.getRange('J20').setValue('FINANCIAL HEALTH SCORE').setFontSize(10).setFontWeight('bold')
    .setFontColor('white').setBackground(STYLE.SLATE_DARK).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(20, 26);
  sh.getRange('J21:K21').merge();
  sh.getRange('J21')
    .setFormula(`=ROUND(MIN(100,MAX(0,(IFERROR(B5/MAX(B3,1),0)*40)+IF(B35<=0,30,IF(B35<ABS(B33),15,0))+MIN(IFERROR(B33/MAX(1,B4/12),0),1)*30)))`)
    .setFontSize(28).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat('0');
  sh.setRowHeight(21, 52);
  sh.getRange('J22:K22').merge();
  sh.getRange('J22')
    .setFormula('=IF(J21>=90,"⬤ Excellent",IF(J21>=75,"⬤ Good",IF(J21>=50,"⬤ Fair","⬤ Critical")))')
    .setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(22, 32);
  sh.getRange('J21:K22').setBackground(STYLE.SLATE_LIGHT);
  styleTableBorder_(sh, 'J20:K22');
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING) {
    const hsCfRules = sh.getConditionalFormatRules();
    const hsRng = [sh.getRange('J21'), sh.getRange('J22')];
    hsCfRules.push(
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$J$21>=90').setFontColor(STYLE.GREEN).setRanges(hsRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($J$21>=75,$J$21<90)').setFontColor('#14b8a6').setRanges(hsRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($J$21>=50,$J$21<75)').setFontColor(STYLE.FLAME).setRanges(hsRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$J$21<50').setFontColor(STYLE.RED).setRanges(hsRng).build()
    );
    sh.setConditionalFormatRules(hsCfRules);
  }
  sh.setColumnWidth(10, 140); // J — wider for Health Score card
  sh.setColumnWidth(11, 140); // K

  // Zone 6: Financial KPIs & Account Analysis
  sh.getRange('A29').setValue('Financial KPIs & Account Analysis').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(11);
  sh.setRowHeight(29, 20);
  const kpi=[
    ['Expense-to-Income','=IFERROR(B4/B3,0)'],
    ['Savings-to-Income','=IFERROR(B5/B3,0)'],
    ['Avg Daily Spending',`=IFERROR(B4/MAX(1,TODAY()-DATE(${CONFIG.YEAR},1,1)+1),0)`],
    ['Liquid (Bank + Cash)',`=${classBalance_('Bank')}+${classBalance_('Cash')}`],
    ['Investment (Brokers)',`=${classBalance_('Share Broker')}`],
    ['Credit Card Balance',`=${classBalance_('Credit Card')}`],
    ['Net Worth','=B33+B34+B35']
  ];
  sh.getRange(30,1,kpi.length,2).setValues(kpi);
  sh.getRange('B30:B31').setNumberFormat(PCT).setHorizontalAlignment('right');
  sh.getRange('B32').setNumberFormat(CUR).setHorizontalAlignment('right'); 
  sh.getRange('B33:B36').setNumberFormat(CUR).setHorizontalAlignment('right');
  sh.getRange('A30:A36').setFontWeight('bold').setBackground(STYLE.SLATE_LIGHT).setFontColor(STYLE.INK);
  styleTableBorder_(sh, 'A30:B36');
  sh.setRowHeights(30, 7, 22);

  if (CONFIG.ENABLE_CHARTS) buildAnnualCharts_(sh);
  sh.setFrozenRows(1);
}

function buildAnnualCharts_(sh){
  try {
    (sh.getCharts()||[]).forEach(c=>sh.removeChart(c));
    sh.insertChart(sh.newChart().asColumnChart().addRange(sh.getRange('D3:F15'))
      .setOption('title','Income vs Expense (Monthly)').setOption('colors',[STYLE.SLATE_DARK,STYLE.FLAME]).setPosition(40,1,0,0).build());
    sh.insertChart(sh.newChart().asLineChart().addRange(sh.getRange('D3:D15')).addRange(sh.getRange('G3:G15'))
      .setOption('title','Savings Trend').setOption('colors',[STYLE.BLUE]).setPosition(40,6,0,0).build());
    sh.insertChart(sh.newChart().asPieChart().addRange(sh.getRange('A14:A23')).addRange(sh.getRange('C14:C23'))
      .setOption('title','Expense Category Distribution').setPosition(58,1,0,0).build());
    sh.insertChart(sh.newChart().asLineChart().addRange(sh.getParent().getRange('Helper!A5:M5'))
      .setTransposeRowsAndColumns(true).setOption('title','Net Worth Trend').setOption('colors',[STYLE.FLAME]).setPosition(58,6,0,0).build());
  } catch(e){ Log_('WARNING','Chart build skipped: '+e); }
}

/* ============================ NAMED RANGES ============================ */
function refreshNamedRanges(ss) {
  if (!CONFIG.ENABLE_NAMED_RANGES) return;
  const defs = {
    catAll:     `Config!$AB$2:$AB`,
    catExpense: `Config!$Y$2:$Y`,
    catIncome:  `Config!$Z$2:$Z`,
    catTransfer:`Config!$AA$2:$AA`,
    payList:    `Config!$R$2:$R`,
    dataTable:  `Data!$A$1:$R$${DROWS}`
  };
  Object.keys(defs).forEach(n=>{ try{ if(ss.getRangeByName(n)) ss.removeNamedRange(n); ss.setNamedRange(n, ss.getRange(defs[n])); }catch(e){ Log_('WARNING','Named range '+n+': '+e); } });
  Log_('INFO','Named ranges refreshed.');
}

/* ============================ VALIDATION ENGINE ============================ */
function validateWorkbook(ss) {
  const rows=[['Severity','Area','Detail']]; const add=(s,a,d)=>{rows.push([s,a,d]); Log_(s,a+': '+d);};
  const expect=['Config','Data','Helper','Accounts'].concat(CONFIG.MONTHS.map(m=>m+'_'+CONFIG.YEAR)).concat(['Annual Dashboard']);
  expect.forEach(n=>{ if(!ss.getSheetByName(n)) add('ERROR','Missing sheet',n); });
  if (CONFIG.ENABLE_NAMED_RANGES) ['catExpense','catIncome','catTransfer','payList'].forEach(n=>{ if(!ss.getRangeByName(n)) add('WARNING','Missing named range',n); });
  const cfg=ss.getSheetByName('Config');
  if(cfg){ if(cfg.getRange('A2').getValue()==='') add('ERROR','Empty config','No expense categories');
           if(cfg.getRange('P2').getValue()==='') add('ERROR','Empty config','No accounts'); }
  const tok=['#REF!','#VALUE!','#N/A','#ERROR!','#NAME?','#DIV/0!'];
  ['Annual Dashboard','Accounts'].concat(CONFIG.MONTHS.map(m=>m+'_'+CONFIG.YEAR)).forEach(n=>{
    const s=ss.getSheetByName(n); if(!s) return; const v=s.getDataRange().getDisplayValues(); let h=0;
    for(let r=0;r<v.length;r++)for(let c=0;c<v[r].length;c++) if(tok.indexOf(v[r][c])>-1){ h++; if(h<=3) add('ERROR','Formula error',n+'!'+colL_(c+1)+(r+1)+' = '+v[r][c]); }
    if(h>3) add('ERROR','Formula error',n+': '+h+' error cells'); if(h===0) add('INFO','OK',n+' clean');
  });
  let rep=ss.getSheetByName('Validation_Report'); if(rep) rep.clear(); else rep=ss.insertSheet('Validation_Report');
  rep.setTabColor('#991b1b');
  applyPremiumTheme_(rep, true);
  rep.getRange(1,1,rows.length,3).setValues(rows);
  rep.getRange('A1:C1').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white'); rep.setFrozenRows(1);
  rep.getRange(1,5).setValue('Generated: '+new Date());
  Log_('INFO','Validation complete: '+(rows.length-1)+' findings');
}

/* ============================ LOGGING + UTILITIES ============================ */
function Log_(level,msg){ LOGS.push([new Date(),level,msg]); Logger.log('['+level+'] '+msg); }
function flushLogs_(ss){ if(!LOGS.length) return; let sh=ss.getSheetByName('_Logs');
  if(!sh){
    sh=ss.insertSheet('_Logs');
    sh.setTabColor('#5b21b6');
    applyPremiumTheme_(sh, true);
    sh.getRange(1,1,1,3).setValues([['Time','Level','Message']]).setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');
    sh.setFrozenRows(1);
  }
  sh.getRange(sh.getLastRow()+1,1,LOGS.length,3).setValues(LOGS);
  if(sh.getLastRow()>2000) sh.deleteRows(2,sh.getLastRow()-2000); LOGS=[]; }
function flat_(d){ const o=[]; Object.keys(d).forEach(p=>d[p].forEach(c=>o.push([p,c]))); return o; }
function setRows_(sh,r,c,a){ if(a.length) sh.getRange(r,c,a.length,a[0].length).setValues(a); }
function head_(sh,a1,vals){ const r=sh.getRange(a1); if(vals&&vals.length&&r.getNumRows()===1&&r.getNumColumns()===vals.length) r.setValues([vals]); r.setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white'); }
function colL_(c){ let s=''; while(c>0){ const m=(c-1)%26; s=String.fromCharCode(65+m)+s; c=(c-m-1)/26; } return s; }
function qs_(s){ return String(s).replace(/"/g,'""'); }
function confirmDestructive_(){ try{ const ui=SpreadsheetApp.getUi();
  return ui.alert('DELETE mode','REBUILD_MODE=DELETE permanently removes sheets (incl. Data/Config) with NO backup. Continue?',ui.ButtonSet.YES_NO)===ui.Button.YES;
}catch(e){ return true; } }
function orderTabs_(ss){
  const order=['Config','Data'].concat(CONFIG.MONTHS.map(m=>m+'_'+CONFIG.YEAR)).concat(['Accounts','Annual Dashboard','Validation_Report','Helper','_Logs']);
  let pos=1; order.forEach(n=>{ const s=ss.getSheetByName(n); if(s){ ss.setActiveSheet(s); ss.moveActiveSheet(pos++); } });
}

/* ============================ NAVIGATION BAR ============================
   Dynamic nav bar in Row 1 of every major sheet.

   DESIGN
   ───────────────────────────────────────────────────────────────────────
   • Row 1 = nav bar (height 32 px, frozen, gridlines hidden)
   • Background: SLATE_DARK (#0f172a) for all items; FLAME (#f97316) for
     the CURRENT sheet's item — gives an "active tab" highlight effect.
   • Each cell holds a HYPERLINK formula that jumps to the sheet by GID
     (no hardcoding — GIDs are read at run-time via getSheetId()).
   • Monthly sheets: B1 is SKIPPED so the hidden month-tag value ($B$1
     formula references throughout the template) is never disturbed.
     B1 is given dark bg + tiny white text = invisible to the user.
   • Separator cells (thin dark columns) visually divide logical groups.

   CALL SEQUENCE
   ───────────────────────────────────────────────────────────────────────
   applyNavigationToAllSheets_(ss)   ← called AFTER all sheets are built
   applyNavigationBar_(ss, sh)       ← called per sheet by the above

   MENU ENTRY
   ───────────────────────────────────────────────────────────────────────
   Finance Tools ▸ Refresh Navigation  (menuRefreshNav)                */

/* Nav item definitions — order matches left-to-right display order.
   `target` = exact sheet name; `label` = display text without emoji.    */
function navDefs_() {
  return [
    { emoji: '🏠', label: 'Home',     target: 'Annual Dashboard', group: 'home' },
    { emoji: '📊', label: 'Annual',   target: 'Annual Dashboard', group: 'home' },
    ...CONFIG.MONTHS.map(m => ({ emoji: '📅', label: m, target: m + '_' + CONFIG.YEAR, group: 'month' })),
    { emoji: '💳', label: 'Accounts', target: 'Accounts',         group: 'admin' },
    { emoji: '📝', label: 'Data',     target: 'Data',             group: 'admin' },
    { emoji: '⚙️', label: 'Config',   target: 'Config',           group: 'admin' },
  ];
}

/* Applies a COMPACT month-grid navigation to one monthly sheet — top-right of the header
   band (cols M–O, rows 2–6), ABOVE the dashboard panels. It never writes into Row 1, so the
   dashboard title/KPIs are never overwritten. Also repairs any Row-1 damage left by the old bar. */
function applyNavigationBar_(ss, sh) {
  const sheetName = sh.getName();
  const isMonthly = CONFIG.MONTHS.some(m => sheetName === m + '_' + CONFIG.YEAR);
  if (!isMonthly) return;   // dashboards only; Annual/Config/Data/Accounts use the Finance Tools menu

  // ── Repair the header that the previous Row-1 nav bar damaged (restore the template's style) ──
  const mShort = sheetName.split('_')[0];
  try {
    sh.getRange(1, 3, 1, 22).clearContent().setBackground(null);          // wipe old hyperlinks C1..X1
    sh.getRange('A1').setValue(mShort + ' ' + CONFIG.YEAR)                // title: white on dark (as designed)
      .setFontSize(13).setFontWeight('bold').setFontColor('white').setBackground(STYLE.SLATE_DARK).setVerticalAlignment('middle');
    sh.getRange('B1').setValue(sheetName).setFontColor(STYLE.SLATE_DARK).setBackground(STYLE.SLATE_DARK).setFontSize(6); // invisible tag
    sh.setRowHeight(1, 30);
  } catch(e) { Log_('WARNING', 'Header repair: ' + e); }

  // ── Compact 3-wide month grid in the header band ABOVE the transactions panel (true far-right) ──
  const NAV_C = LAYOUT.TXN_COL, NAV_R = 2;                                // above transactions, rows 2–6
  const gid = name => { const s = ss.getSheetByName(name); return s ? s.getSheetId() : -1; };
  sh.getRange(NAV_R, NAV_C, 1, 3).merge().setValue('🧭 JUMP TO MONTH')
    .setBackground(STYLE.SLATE_DARK).setFontColor('#ffffff').setFontWeight('bold').setFontSize(9)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  CONFIG.MONTHS.forEach((m, i) => {
    const r = NAV_R + 1 + Math.floor(i / 3), c = NAV_C + (i % 3);
    const tag = m + '_' + CONFIG.YEAR, g = gid(tag), active = (tag === sheetName);
    const cell = sh.getRange(r, c);
    if (g >= 0) cell.setFormula(`=HYPERLINK("#gid=${g}","${m}")`); else cell.setValue(m);
    cell.setBackground(active ? STYLE.FLAME : STYLE.SLATE_LIGHT).setFontColor(active ? '#ffffff' : STYLE.INK)
        .setFontWeight(active ? 'bold' : 'normal').setFontSize(9).setHorizontalAlignment('center');
  });
  styleTableBorder_(sh, `${colL_(NAV_C)}${NAV_R}:${colL_(NAV_C + 2)}${NAV_R + 4}`);
  Log_('INFO', 'Nav grid → ' + sheetName);
}

/* Applies the month-grid nav to every MONTHLY sheet (the ones users navigate between).
   Annual/Config/Data/Accounts intentionally have no in-sheet nav — the menu covers them. */
function applyNavigationToAllSheets_(ss) {
  let count = 0;
  CONFIG.MONTHS.forEach(m => {
    const sh = ss.getSheetByName(m + '_' + CONFIG.YEAR);
    if (sh) { applyNavigationBar_(ss, sh); count++; }
  });
  Log_('INFO', 'Navigation grid applied on ' + count + ' monthly sheets.');
}

/* ============================ PREMIUM STYLING HELPERS ============================ */
function applyPremiumTheme_(sh, hideGridlines) {
  try {
    sh.getRange(1, 1, Math.min(sh.getMaxRows(), 120), Math.min(sh.getMaxColumns(), 60)).setFontFamily("Inter"); // 120 rows ≈ dashboard area (was 1000 → 8× fewer cells)
    sh.setHiddenGridlines(hideGridlines);
  } catch(e) { Log_('WARNING', 'Could not apply premium theme: ' + e); }
}

function styleTableBorder_(sh, rangeA1) {
  try {
    const rng = sh.getRange(rangeA1);
    rng.setBorder(true, true, true, true, true, true, STYLE.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  } catch(e) { Log_('WARNING', 'Could not style table borders: ' + e); }
}

function applyTableStripe_(sh, startRow, endRow, startCol, endCol, evenColor, oddColor) {
  try {
    if (endRow < startRow) return;
    const numRows = endRow - startRow + 1;
    const numCols = endCol - startCol + 1;
    const range = sh.getRange(startRow, startCol, numRows, numCols);
    const backgrounds = [];
    for (let r = startRow; r <= endRow; r++) {
      const color = (r % 2 === 0) ? evenColor : oddColor;
      backgrounds.push(Array(numCols).fill(color));
    }
    range.setBackgrounds(backgrounds);
  } catch(e) { Log_('WARNING', 'Could not apply stripe backgrounds: ' + e); }
}

/* ============================ PROGRAMMATIC VERIFICATION TEST HARNESS ============================ */
function runVerificationTests() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Log_('INFO', '=== Running Verification Tests ===');
  
  // 1. Rebuild Workbook first to get a clean state
  buildNewWorkbook(ss);
  
  const dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) {
    Log_('ERROR', 'Data sheet not found for testing!');
    return;
  }
  
  // 2. Insert test data
  const testRows = [
    ['14-Jun-2026', '', 'Test Expense', 100, 'Expense', 'Debt → Car EMI', '', '', 'Credit Card → HDFC CC', '', '', '', '', '', 'Test Case 1'],
    ['14-Jun-2026', '', 'Test Income', 300, 'Income', 'Wages → Paycheck', '', '', 'Bank → HDFC', '', '', '', '', '', 'Test Case 2'],
    ['14-Jun-2026', '', 'Test Transfer', 5000, 'Transfer', 'Self Transfer → Bank to Credit', '', '', 'Bank → HDFC', '', '', 'Credit Card → HDFC CC', '', '', 'Test Case 3']
  ];
  
  dataSheet.getRange(2, 1, testRows.length, 1).setValues(testRows.map(r => [r[0]]));
  dataSheet.getRange(2, 3, testRows.length, 1).setValues(testRows.map(r => [r[2]]));
  dataSheet.getRange(2, 4, testRows.length, 1).setValues(testRows.map(r => [r[3]]));
  dataSheet.getRange(2, 5, testRows.length, 1).setValues(testRows.map(r => [r[4]]));
  dataSheet.getRange(2, 6, testRows.length, 1).setValues(testRows.map(r => [r[5]]));
  dataSheet.getRange(2, 9, testRows.length, 1).setValues(testRows.map(r => [r[8]]));
  dataSheet.getRange(2, 12, testRows.length, 1).setValues(testRows.map(r => [r[11]]));
  dataSheet.getRange(2, 15, testRows.length, 1).setValues(testRows.map(r => [r[14]]));
  
  SpreadsheetApp.flush();
  Utilities.sleep(1000); // Wait for formulas to calculate
  
  // 3. Verify Month Dashboard (Jun_2026)
  const monthSheet = ss.getSheetByName('Jun_2026');
  if (!monthSheet) {
    Log_('ERROR', 'Month sheet Jun_2026 not found!');
    return;
  }
  
  const opening = monthSheet.getRange('A4').getValue();
  const income = monthSheet.getRange('C4').getValue();
  const expense = monthSheet.getRange('E4').getValue();
  const savings = monthSheet.getRange('G4').getValue();
  
  Log_('INFO', `Month Dashboard Jun_2026: Opening=${opening}, Income=${income}, Expense=${expense}, Net Savings=${savings}`);
  
  // Verify Accounts Master sheet values
  const accountsSheet = ss.getSheetByName('Accounts');
  if (!accountsSheet) {
    Log_('ERROR', 'Accounts sheet not found!');
    return;
  }
  
  const accValues = accountsSheet.getDataRange().getValues();
  let hdfcBal = 0, hdfcccBal = 0;
  accValues.forEach(row => {
    if (row[0] === 'HDFC') {
      hdfcBal = row[4];
    }
    if (row[0] === 'HDFC CC') {
      hdfcccBal = row[4];
    }
  });
  
  Log_('INFO', `Accounts Master: HDFC (Bank) Balance = ${hdfcBal}, HDFC CC (Credit Card) Balance = ${hdfcccBal}`);
  
  // 4. Verify Annual Dashboard
  const annualSheet = ss.getSheetByName('Annual Dashboard');
  const annIncome = annualSheet.getRange('B3').getValue();
  const annExpense = annualSheet.getRange('B4').getValue();
  const annSavings = annualSheet.getRange('B5').getValue();
  const annNetWorth = annualSheet.getRange('B36').getValue();
  
  Log_('INFO', `Annual Dashboard: Income=${annIncome}, Expense=${annExpense}, Savings=${annSavings}, Net Worth=${annNetWorth}`);
  
  // Assertions
  const passIncome = (annIncome === 300);
  const passExpense = (annExpense === 100);
  const passSavings = (annSavings === 200);
  const passHdfc = (hdfcBal === -4700); // 0 + 300 - 5000 = -4700
  const passHdfccc = (hdfcccBal === 4900); // 0 - 100 + 5000 = 4900
  const passNetWorth = (annNetWorth === 200); // HDFC (-4700) + HDFC CC (4900) = 200
  
  Log_('INFO', `TEST RESULTS:
  - Income matches 300: ${passIncome ? 'PASS' : 'FAIL'}
  - Expense matches 100: ${passExpense ? 'PASS' : 'FAIL'}
  - Savings matches 200: ${passSavings ? 'PASS' : 'FAIL'}
  - HDFC Bank Balance matches -4700: ${passHdfc ? 'PASS' : 'FAIL'}
  - HDFC CC Balance matches 4900: ${passHdfccc ? 'PASS' : 'FAIL'}
  - Net Worth matches 200: ${passNetWorth ? 'PASS' : 'FAIL'}`);
  
  // Create Test_Report sheet
  let rep = ss.getSheetByName('Test_Report');
  if (rep) rep.clear(); else rep = ss.insertSheet('Test_Report');
  rep.setTabColor('#1e3a8a');
  applyPremiumTheme_(rep, true);
  
  const reportData = [
    ['Test Case', 'Expected Value', 'Actual Value', 'Result'],
    ['Total Income', 300, annIncome, passIncome ? 'PASS' : 'FAIL'],
    ['Total Expense', 100, annExpense, passExpense ? 'PASS' : 'FAIL'],
    ['Net Savings', 200, annSavings, passSavings ? 'PASS' : 'FAIL'],
    ['HDFC Bank Balance', -4700, hdfcBal, passHdfc ? 'PASS' : 'FAIL'],
    ['HDFC CC Balance', 4900, hdfcccBal, passHdfccc ? 'PASS' : 'FAIL'],
    ['Net Worth', 200, annNetWorth, passNetWorth ? 'PASS' : 'FAIL']
  ];
  
  rep.getRange(1, 1, reportData.length, 4).setValues(reportData);
  rep.getRange('A1:D1').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');
  styleTableBorder_(rep, `A1:D${reportData.length}`);
  
  rep.getRange(2, 2, reportData.length - 1, 2).setNumberFormat(CUR);
  rep.setColumnWidth(1, 180);
  rep.setColumnWidth(2, 120);
  rep.setColumnWidth(3, 120);
  rep.setColumnWidth(4, 100);
  
  ss.toast('Verification Tests Complete! View Test_Report tab.', 'Testing', 6);
}

/* ============================ NAVIGATION ============================ */
function gotoCurrentMonth(){
  const ss = SpreadsheetApp.getActive();
  const now = new Date();
  const tag = (now.getFullYear()===CONFIG.YEAR) ? CONFIG.MONTHS[now.getMonth()]+'_'+CONFIG.YEAR : CONFIG.MONTHS[0]+'_'+CONFIG.YEAR;
  const sh = ss.getSheetByName(tag); if (sh){ ss.setActiveSheet(sh); ss.toast('Jumped to '+tag,'Navigate',3); }
}
function gotoAnnual(){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Annual Dashboard'); if (sh) ss.setActiveSheet(sh);
}

/* ============================ QUICK-ADD SIDEBAR (HtmlService) ============================
   A real data-entry form: Type → dependent Category → Account → Amount → Save (appends to Data).
   Removes dropdown hunting and guarantees valid rows. Single-file (HTML built in code). */
function showQuickAdd(){
  const data = getFormData_(SpreadsheetApp.getActive());
  const html = HtmlService.createHtmlOutput(quickAddHtml_(data)).setTitle('➕ Quick Add Transaction');
  SpreadsheetApp.getUi().showSidebar(html);
}
function getFormData_(ss){
  const cfg = ss.getSheetByName('Config'); if(!cfg) return {Expense:[],Income:[],Transfer:[],accounts:[]};
  const col = c => cfg.getRange(2,c,CONFIG.MAX_CATEGORY_ROWS,1).getValues().map(r=>String(r[0]).trim()).filter(String);
  return { Expense: col(25), Income: col(26), Transfer: col(27), accounts: col(18) };  // Y, Z, AA, R
}
function addQuickTransaction(p){
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('Data'); if(!sh) throw new Error('Data sheet missing');
  // Next free entry row = first blank in column A (Date)
  const colA = sh.getRange(2,1,CONFIG.MAX_TRANSACTION_ROWS,1).getValues();
  let n = 0; while(n < colA.length && colA[n][0] !== '') n++;
  const row = n + 2;
  const d = p.date ? new Date(p.date+'T00:00:00') : new Date();
  sh.getRange(row,1).setValue(d);                 // A Date
  sh.getRange(row,3).setValue(p.desc||'');         // C Description
  sh.getRange(row,4).setValue(Number(p.amount)||0);// D Amount
  sh.getRange(row,5).setValue(p.type);             // E Type
  sh.getRange(row,6).setValue(p.category);         // F Category
  sh.getRange(row,9).setValue(p.account);          // I Account / From
  if(p.type==='Transfer' && p.toAccount) sh.getRange(row,12).setValue(p.toAccount); // L To Account
  return 'Saved row '+row+': '+p.type+' '+CONFIG.CURRENCY+(Number(p.amount)||0);
}
function quickAddHtml_(data){
  const J = JSON.stringify(data).replace(/</g,'\\u003c');
  return `<!DOCTYPE html><html><head><base target="_top">
  <style>
    body{font-family:'Inter',Arial,sans-serif;margin:0;padding:14px;background:#0f172a;color:#e2e8f0}
    h2{font-size:15px;margin:0 0 12px;color:#fff}
    label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;margin:10px 0 4px}
    input,select{width:100%;box-sizing:border-box;padding:9px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#fff;font-size:14px}
    .seg{display:flex;gap:6px;margin-bottom:4px}
    .seg button{flex:1;padding:9px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#cbd5e1;cursor:pointer;font-weight:600}
    .seg button.on{color:#fff}
    .exp.on{background:#ef4444;border-color:#ef4444}.inc.on{background:#10b981;border-color:#10b981}.trf.on{background:#3b82f6;border-color:#3b82f6}
    #save{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:#f97316;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
    #msg{margin-top:10px;font-size:12px;min-height:16px;color:#86efac}
    .to{display:none}
  </style></head><body>
  <h2>➕ Quick Add Transaction</h2>
  <div class="seg">
    <button type="button" class="exp on" onclick="setType('Expense')">Expense</button>
    <button type="button" class="inc" onclick="setType('Income')">Income</button>
    <button type="button" class="trf" onclick="setType('Transfer')">Transfer</button>
  </div>
  <label>Date</label><input type="date" id="date">
  <label>Category</label><select id="category"></select>
  <label id="acctLabel">Account</label><select id="account"></select>
  <div class="to" id="toWrap"><label>To Account</label><select id="toAccount"></select></div>
  <label>Amount</label><input type="number" id="amount" inputmode="decimal" placeholder="0">
  <label>Description</label><input type="text" id="desc" placeholder="optional">
  <button id="save" onclick="save()">Save Transaction</button>
  <div id="msg"></div>
  <script>
    var DATA=${J}, type='Expense';
    document.getElementById('date').valueAsDate=new Date();
    function fill(sel,arr){var s=document.getElementById(sel);s.innerHTML='';arr.forEach(function(v){var o=document.createElement('option');o.value=v;o.text=v;s.add(o);});}
    function setType(t){type=t;
      ['exp','inc','trf'].forEach(function(c){document.querySelector('.'+c).classList.remove('on');});
      document.querySelector('.'+(t==='Expense'?'exp':t==='Income'?'inc':'trf')).classList.add('on');
      fill('category', DATA[t]||[]);
      document.getElementById('toWrap').style.display = (t==='Transfer')?'block':'none';
      document.getElementById('acctLabel').textContent = (t==='Transfer')?'From Account':'Account';
    }
    fill('account',DATA.accounts);fill('toAccount',DATA.accounts);setType('Expense');
    function save(){
      var p={date:document.getElementById('date').value,type:type,
        category:document.getElementById('category').value,account:document.getElementById('account').value,
        toAccount:document.getElementById('toAccount').value,amount:document.getElementById('amount').value,
        desc:document.getElementById('desc').value};
      if(!p.amount){document.getElementById('msg').textContent='⚠ Enter an amount.';return;}
      document.getElementById('save').textContent='Saving…';
      google.script.run.withSuccessHandler(function(r){
        document.getElementById('msg').textContent='✓ '+r;
        document.getElementById('amount').value='';document.getElementById('desc').value='';
        document.getElementById('save').textContent='Save Transaction';
      }).withFailureHandler(function(e){document.getElementById('msg').style.color='#fca5a5';document.getElementById('msg').textContent='✕ '+e.message;document.getElementById('save').textContent='Save Transaction';})
      .addQuickTransaction(p);
    }
  </script></body></html>`;
}
