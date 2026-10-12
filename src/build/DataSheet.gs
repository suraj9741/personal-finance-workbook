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
