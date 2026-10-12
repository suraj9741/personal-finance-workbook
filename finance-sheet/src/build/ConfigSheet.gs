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
    appendMissingExpenseSeeds_(sh);   // additive only: default combos the user doesn't have yet
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
/* Appends default Parent/Sub combos missing from Config below the last used row of each
   section (Expense: A/B with 0 budget in D; Income: F/G with 0 planned in I). Existing rows —
   including user-added categories and edited budgets — are never touched, so Config stays
   the source of truth. */
function appendMissingExpenseSeeds_(sh){
  appendMissingSeeds_(sh, DEFAULT_CATEGORIES.EXPENSE, 1, 4, 'expense');  // A/B + D budget
  appendMissingSeeds_(sh, DEFAULT_CATEGORIES.INCOME,  6, 9, 'income');   // F/G + I planned
}
function appendMissingSeeds_(sh, dict, col, amtCol, label){
  const rows = sh.getRange(2,col,CONFIG.MAX_CATEGORY_ROWS,2).getValues();
  const existing = {}; let last = 1;                       // last = sheet row of final non-empty Parent
  rows.forEach((r,i)=>{
    const p=String(r[0]).trim(), s=String(r[1]).trim();
    if(p!==''){ last=i+2; if(s!=='') existing[p+'|'+s]=1; }
  });
  const missing = flat_(dict).filter(r=>!existing[r[0]+'|'+r[1]]);
  if(!missing.length){ Log_('INFO','Config: all default '+label+' categories already present.'); return; }
  sh.getRange(last+1,col,missing.length,2).setValues(missing);
  sh.getRange(last+1,amtCol,missing.length,1).setValues(missing.map(_=>[0]));
  Log_('INFO','Config: appended '+missing.length+' missing default '+label+' categories.');
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
