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

  /* KPI cards Grid (A3:L5) — every card spans TWO columns so labels/values never clip */
  sh.getRange('A3:B3').merge(); sh.getRange('A4:B4').merge(); sh.getRange('A5:B5').merge(); // Card 1
  sh.getRange('C3:D3').merge(); sh.getRange('C4:D4').merge(); sh.getRange('C5:D5').merge(); // Card 2
  sh.getRange('E3:F3').merge(); sh.getRange('E4:F4').merge(); sh.getRange('E5:F5').merge(); // Card 3
  sh.getRange('G3:H3').merge(); sh.getRange('G4:H4').merge(); sh.getRange('G5:H5').merge(); // Card 4
  sh.getRange('I3:J3').merge(); sh.getRange('I4:J4').merge(); sh.getRange('I5:J5').merge(); // Card 5
  sh.getRange('K3:L3').merge(); sh.getRange('K4:L4').merge(); sh.getRange('K5:L5').merge(); // Card 6
  
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
  
  sh.setRowHeight(3, 30);   // Label row — tall enough for wrapped 2-line labels
  sh.setRowHeight(4, 36);   // Value row — larger for premium 16pt impact
  sh.setRowHeight(5, 26);   // Sparkline row
  sh.setRowHeight(6, 15);

  // Format Card Fonts and Alignments
  const cardsRange = sh.getRange('A3:L5');
  cardsRange.setFontFamily('Inter').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange('A3:L3').setFontSize(10).setFontWeight('bold').setFontColor(STYLE.SLATE_MED).setWrap(true);
  sh.getRange('A4:L4').setFontSize(16).setFontWeight('bold');  // 16pt (was 14pt)
  
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
  sh.getRange('A3:F5').setBackground(STYLE.SLATE_LIGHT);
  sh.getRange('G3:L5').setBackground(STYLE.SLATE_LIGHT);

  // Standard card borders
  styleTableBorder_(sh, 'A3:B5');
  styleTableBorder_(sh, 'C3:D5');
  styleTableBorder_(sh, 'E3:F5');
  styleTableBorder_(sh, 'G3:H5');
  styleTableBorder_(sh, 'I3:J5');
  styleTableBorder_(sh, 'K3:L5');
  // Premium colored left-border accents per card type
  try {
    sh.getRange('A3:B5').setBorder(null,true,null,null,null,null,STYLE.INK,  SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('C3:D5').setBorder(null,true,null,null,null,null,STYLE.GREEN,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('E3:F5').setBorder(null,true,null,null,null,null,STYLE.RED,  SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('G3:H5').setBorder(null,true,null,null,null,null,STYLE.BLUE, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('I3:J5').setBorder(null,true,null,null,null,null,STYLE.BLUE, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange('K3:L5').setBorder(null,true,null,null,null,null,STYLE.FLAME,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  } catch(e) { Log_('WARNING','Card accent borders: '+e); }

  /* LEFT — EXPENSE Budget vs Actual  (cols A–F) */
  sh.getRange('A7').setValue('EXPENSE — Budget vs Actual').setFontWeight('bold').setFontColor(STYLE.RED).setFontSize(11);
  sh.setRowHeight(7, 26);
  head_(sh,'A8:E8',['Parent','Sub','Budget','Spent','Diff']);
  sh.getRange('F8').setValue('Bar').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white').setHorizontalAlignment('center');
  sh.setRowHeight(8, 24);
  
  const EQ=`Config!A2:A${CROWS}`, ER=`Config!B2:B${CROWS}`, ES=`Config!D2:D${CROWS}`;
  sh.getRange('A9').setFormula(`=IFERROR(FILTER(${EQ},${EQ}<>""),"")`);
  sh.getRange('B9').setFormula(`=IFERROR(FILTER(${ER},${EQ}<>""),"")`);
  sh.getRange('C9').setFormula(`=IFERROR(FILTER(${ES},${EQ}<>""),"")`);
  sh.getRange('D9').setFormula(`=ARRAYFORMULA(IF(A9:A${BUD_LAST}="","",IFERROR(SUMIF(${R.CK},"Expense|"&$B$1&"|"&A9:A${BUD_LAST}&"${STYLE.SEP}"&B9:B${BUD_LAST},${R.AMT}),0)))`);
  // Diff = Budget − Spent: positive = still left to spend, negative = over budget.
  sh.getRange('E9').setFormula(`=ARRAYFORMULA(IF(A9:A${BUD_LAST}="","",IFERROR(C9:C${BUD_LAST}-D9:D${BUD_LAST},0)))`);
  // Totals for the whole table, on the title row (row 7) so they stay visible above the list.
  sh.getRange('C7').setFormula(`=SUM(C9:C${BUD_LAST})`);
  sh.getRange('D7').setFormula(`=SUM(D9:D${BUD_LAST})`);
  sh.getRange('E7').setFormula('=C7-D7');
  sh.getRange('C7:E7').setNumberFormat(CUR).setHorizontalAlignment('right').setFontWeight('bold').setBackground(STYLE.RED_BG)
    .setNote('Month total: Budget · Spent · Diff');
  
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
  sh.getRange(`${iC}7`).setValue('INCOME — Budget vs Actual').setFontWeight('bold').setFontColor(STYLE.GREEN).setFontSize(11);
  head_(sh,`${iC}8:${colL_(incStartCol+4)}8`,['Parent','Sub','Budget','Earned','Diff']);
  sh.getRange(`${colL_(incStartCol+5)}8`).setValue('Bar').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white').setHorizontalAlignment('center');
  const IQ=`Config!F2:F${CROWS}`, IR=`Config!G2:G${CROWS}`, IS=`Config!I2:I${CROWS}`;
  sh.getRange(`${iC}9`).setFormula(`=IFERROR(FILTER(${IQ},${IQ}<>""),"")`);
  sh.getRange(`${colL_(incStartCol+1)}9`).setFormula(`=IFERROR(FILTER(${IR},${IQ}<>""),"")`);
  sh.getRange(`${colL_(incStartCol+2)}9`).setFormula(`=IFERROR(FILTER(${IS},${IQ}<>""),"")`);
  sh.getRange(`${colL_(incStartCol+3)}9`).setFormula(`=ARRAYFORMULA(IF(${iC}9:${iC}${IBUD_LAST}="","",IFERROR(SUMIF(${R.CK},"Income|"&$B$1&"|"&${iC}9:${iC}${IBUD_LAST}&"${STYLE.SEP}"&${colL_(incStartCol+1)}9:${colL_(incStartCol+1)}${IBUD_LAST},${R.AMT}),0)))`);
  // Diff = Earned − Budget: positive = earned more than planned, negative = short.
  // (Same direction as Expense: positive is good, so the green/red colouring means the same thing.)
  const iB=colL_(incStartCol+2), iE=colL_(incStartCol+3), iD=colL_(incStartCol+4);
  sh.getRange(`${iD}9`).setFormula(`=ARRAYFORMULA(IF(${iC}9:${iC}${IBUD_LAST}="","",IFERROR(${iE}9:${iE}${IBUD_LAST}-${iB}9:${iB}${IBUD_LAST},0)))`);
  sh.getRange(`${iB}7`).setFormula(`=SUM(${iB}9:${iB}${IBUD_LAST})`);
  sh.getRange(`${iE}7`).setFormula(`=SUM(${iE}9:${iE}${IBUD_LAST})`);
  sh.getRange(`${iD}7`).setFormula(`=${iE}7-${iB}7`);
  sh.getRange(`${iB}7:${iD}7`).setNumberFormat(CUR).setHorizontalAlignment('right').setFontWeight('bold').setBackground(STYLE.GREEN_BG)
    .setNote('Month total: Budget · Earned · Diff');
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

  // Diff colours (expense + income, rows and totals): positive green, negative red
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING) {
    const budgetCfRules = sh.getConditionalFormatRules();
    const dc = colL_(LAYOUT.INCOME_COL+4);
    const expDiffRng = [sh.getRange(`E9:E${BUD_LAST}`), sh.getRange('E7')];
    const incDiffRng = [sh.getRange(`${dc}9:${dc}${IBUD_LAST}`), sh.getRange(`${dc}7`)];
    budgetCfRules.push(
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(STYLE.GREEN).setBold(true).setRanges(expDiffRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(STYLE.RED).setRanges(expDiffRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0).setFontColor(STYLE.GREEN).setBold(true).setRanges(incDiffRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(STYLE.RED).setRanges(incDiffRng).build()
    );
    sh.setConditionalFormatRules(budgetCfRules);
  }

  /* TRANSFER Actual Summary  (cols O–Q; col 15–17) */
  const tC = colL_(LAYOUT.TRANSFER_COL); // O
  const TBUD_LAST = 60;
  sh.getRange(`${tC}7`).setValue('TRANSFER — Actual Summary').setFontWeight('bold').setFontColor(STYLE.BLUE).setFontSize(11);
  head_(sh,`${tC}8:${colL_(LAYOUT.TRANSFER_COL+2)}8`,['Parent','Sub','Actual']);
  const TQ=`Config!K2:K${CROWS}`, TR=`Config!L2:L${CROWS}`;
  sh.getRange(`${tC}9`).setFormula(`=IFERROR(FILTER(${TQ},${TQ}<>""),"")`);
  sh.getRange(`${colL_(LAYOUT.TRANSFER_COL+1)}9`).setFormula(`=IFERROR(FILTER(${TR},${TQ}<>""),"")`);
  sh.getRange(`${colL_(LAYOUT.TRANSFER_COL+2)}9`).setFormula(`=ARRAYFORMULA(IF(${tC}9:${tC}${TBUD_LAST}="","",IFERROR(SUMIF(${R.CK},"Transfer|"&$B$1&"|"&${tC}9:${tC}${TBUD_LAST}&"${STYLE.SEP}"&${colL_(LAYOUT.TRANSFER_COL+1)}9:${colL_(LAYOUT.TRANSFER_COL+1)}${TBUD_LAST},${R.AMT}),0)))`);
  sh.getRange(`${colL_(LAYOUT.TRANSFER_COL+2)}9:${colL_(LAYOUT.TRANSFER_COL+2)}${TBUD_LAST}`).setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 9, TBUD_LAST, LAYOUT.TRANSFER_COL, LAYOUT.TRANSFER_COL+2, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, `${tC}8:${colL_(LAYOUT.TRANSFER_COL+2)}${TBUD_LAST}`);

  /* ACCOUNT BALANCE DASHBOARD  (detail S–X, totals Z–AD; LAYOUT.ACCOUNTS_COL = 19) */
  buildAccountSections_(ss, sh, 7, LAYOUT.ACCOUNTS_COL, true, '', '');

  /* TRANSACTIONS  (col AF = 32; LAYOUT.TXN_COL) */
  const TXN_COL = LAYOUT.TXN_COL;
  const tHdr = 8, tFirst = 9, tEnd = 508, cT0 = colL_(TXN_COL), cT5 = colL_(TXN_COL+5);
  sh.getRange(7,TXN_COL).setFormula('="TRANSACTIONS — "&$B$1').setFontWeight('bold').setFontColor(STYLE.SLATE_DARK).setFontSize(12);
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

  /* ---- COMPACT COLUMN WIDTHS (all sections in sequence, comfortable gutters) ---- */
  // A–F  Expense BvA (6 cols)
  sh.setColumnWidth(1,120); sh.setColumnWidth(2,140); sh.setColumnWidth(3,85); sh.setColumnWidth(4,85); sh.setColumnWidth(5,75); sh.setColumnWidth(6,70);
  // G    spacer (also left half of the NET SAVINGS card)
  sh.setColumnWidth(7, 24);
  // H–M  Income BvA (6 cols)
  sh.setColumnWidth(8,120); sh.setColumnWidth(9,140); sh.setColumnWidth(10,85); sh.setColumnWidth(11,85); sh.setColumnWidth(12,75); sh.setColumnWidth(13,70);
  // N    spacer
  sh.setColumnWidth(14, 24);
  // O–Q  Transfer (3 cols)
  sh.setColumnWidth(15,120); sh.setColumnWidth(16,130); sh.setColumnWidth(17,95);
  // R    spacer
  sh.setColumnWidth(18, 24);
  // S–X  Account detail (6 cols: Pay Type, Account, Starting, Expense, Income, Remaining)
  sh.setColumnWidth(19,110); sh.setColumnWidth(20,140); sh.setColumnWidth(21,95); sh.setColumnWidth(22,95); sh.setColumnWidth(23,95); sh.setColumnWidth(24,95);
  // Y    spacer
  sh.setColumnWidth(25, 24);
  // Z–AD TOTALS by Pay Type (5 cols)
  sh.setColumnWidth(26,110); sh.setColumnWidth(27,95); sh.setColumnWidth(28,95); sh.setColumnWidth(29,95); sh.setColumnWidth(30,95);
  // AE   spacer
  sh.setColumnWidth(31, 24);
  // AF+  Transactions (6 cols) — Category/Account wide enough for "Parent → Sub" strings
  sh.setColumnWidth(32,95); sh.setColumnWidth(33,155); sh.setColumnWidth(34,90); sh.setColumnWidth(35,80); sh.setColumnWidth(36,150); sh.setColumnWidth(37,130);
  // All table header rows: centered vertically so bold headers never look cut off
  sh.getRange('A8:AK8').setVerticalAlignment('middle');

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
