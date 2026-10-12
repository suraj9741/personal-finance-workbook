/* Year-to-date balance for a whole Pay-Type class (transfers update both sides correctly) */
function classBalance_(cls){
  return `IFERROR(SUMIFS(${R.cO},${R.cM},"${cls}")`+
    `+SUMIFS(${R.AMT},${R.TYP},"Income",${R.JPT},"${cls}")+SUMIFS(${R.AMT},${R.TYP},"Transfer",${R.MPT},"${cls}")`+
    `-SUMIFS(${R.AMT},${R.TYP},"Expense",${R.JPT},"${cls}")-SUMIFS(${R.AMT},${R.TYP},"Transfer",${R.JPT},"${cls}"),0)`;
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
  // One gutter column after the 6-col detail table (startCol+7). The previous offset
  // (startCol+8) pushed this block INTO the Transactions panel on monthly sheets,
  // making the two sections overlap and clip each other.
  const s = startCol+7, cs = n => colL_(s+n);
  sh.getRange(top,s).setValue('TOTALS by Pay Type').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(11);
  sh.getRange(top+1,s,1,5).setValues([['Pay Type','Starting','Expense','Income','Remaining']])
    .setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white').setVerticalAlignment('middle');
  sh.setRowHeight(top+1, 24);
  sh.getRange(top+2,s).setFormula(
    `=IFERROR(QUERY({${ptRng},${cStart}${first}:${cRem}${last}},`+
    `"select Col1,sum(Col2),sum(Col3),sum(Col4),sum(Col5) where Col1 is not null group by Col1 `+
    `label sum(Col2) '',sum(Col3) '',sum(Col4) '',sum(Col5) ''",0),"")`);
  sh.getRange(`${cs(1)}${top+2}:${cs(4)}${last}`).setNumberFormat(CUR).setHorizontalAlignment('right');
  // Grand total (Net) — on the totals block's own TITLE row, inside its columns, so it
  // can never collide with the Transactions panel to the right.
  sh.getRange(top,s+2,1,2).merge();
  sh.getRange(top,s+2).setValue('NET (all accounts)').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK)
    .setFontSize(10).setHorizontalAlignment('right');
  sh.getRange(top,s+4).setFormula(`=SUM(${cRem}${first}:${cRem}${last})`).setNumberFormat(CUR).setFontWeight('bold');
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

  // Sizing — A–F detail (6 cols), G gutter, H–L totals by pay type
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 110);
  sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 110);
  sh.setColumnWidth(6, 110);
  sh.setColumnWidth(7, 24);
  for (let c = 8; c <= 12; c++) sh.setColumnWidth(c, 110);

  sh.setFrozenRows(1);
}
