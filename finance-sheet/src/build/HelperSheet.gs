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
