/* ============================ 6. ANNUAL DASHBOARD ============================ */
/* Annual Dashboard theme — light, professional palette used ONLY by buildAnnual_ and
   buildAnnualCharts_. Monthly sheets keep using STYLE, so nothing else changes. */
const ANNUAL_UI = {
  NAVY:    '#1e3a5f',   // section headers / table header rows
  INK:     '#334155',   // primary text
  MUTED:   '#5f6368',   // secondary text / chart axis labels
  CARD:    '#f8fafc',   // label & card fill
  BORDER:  '#dbe3ec',   // hairline borders / chart frames
  GREEN:   '#188038',  GREEN_BG: '#e6f4ea',   // Income
  RED:     '#c5221f',  RED_BG:   '#fce8e6',   // Expense
  BLUE:    '#1a73e8',  BLUE_BG:  '#e8f0fe',   // Savings
  PURPLE:  '#7b1fa2',                          // Transfer / Net Worth
  GRAY:    '#3c4043',                          // Neutral KPIs
  AMBER:   '#f9ab00',                          // Warning accent
  PIE: ['#1a73e8','#188038','#c5221f','#f9ab00','#7b1fa2','#00796b','#e8710a','#5f6368','#129eaf','#b31412']
};

function buildAnnual_(ss) {
  const sh = prepareSheet_(ss, 'Annual Dashboard'); if (!sh) return;
  sh.setTabColor(STYLE.FLAME);
  applyPremiumTheme_(sh, true);
  const AU = ANNUAL_UI;

  /* Title banner — single navy band across the full dashboard width */
  sh.getRange('A1:K1').merge();
  sh.getRange('A1').setValue('ANNUAL DASHBOARD '+CONFIG.YEAR).setFontSize(16).setFontWeight('bold')
    .setFontColor('white').setBackground(AU.NAVY).setVerticalAlignment('middle');
  sh.setRowHeight(1, 44);
  sh.setRowHeight(2, 22);
  
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
  sh.getRange('A2').setValue('Annual Summary').setFontWeight('bold').setFontColor(AU.NAVY).setFontSize(11);
  sh.getRange('A3:A9').setFontWeight('bold').setBackground(AU.CARD).setFontColor(AU.INK).setFontSize(10);
  sh.getRange('B3:B9').setFontWeight('bold').setFontSize(10);
  sh.getRange('B3').setFontColor(AU.GREEN);      // Income → green
  sh.getRange('B4').setFontColor(AU.RED);        // Expense → red
  sh.getRange('B5:B6').setFontColor(AU.BLUE);    // Savings → blue
  sh.getRange('B7:B9').setFontColor(AU.GRAY);    // Neutral KPIs → dark gray
  styleTableBorder_(sh, 'A3:B9');
  sh.setRowHeights(3, 7, 24);

  // Zone 2: Monthly Comparison Table
  sh.getRange('D2').setValue('Monthly Comparison').setFontWeight('bold').setFontColor(AU.NAVY).setFontSize(11);
  head_(sh,'D3:H3',['Month','Income','Expense','Savings','Savings %']);
  sh.getRange('D3:H3').setBackground(AU.NAVY).setFontSize(10).setVerticalAlignment('middle');
  sh.setRowHeight(3, 26);
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
      .setGradientMinpoint(AU.RED_BG).setGradientMaxpoint(AU.GREEN_BG).setRanges([sh.getRange('H4:H15')]).build()]);

  // Zone 3: Top 10 Expense Categories
  sh.getRange('A12').setValue('Top 10 Expense Categories').setFontWeight('bold').setFontColor(AU.NAVY).setFontSize(11);
  sh.setRowHeight(12, 24);
  head_(sh,'A13:C13',['Parent','Sub','Total']);
  sh.getRange('A13:C13').setBackground(AU.NAVY).setFontSize(10).setVerticalAlignment('middle');
  sh.setRowHeight(13, 26);
  sh.getRange('A14').setFormula('=IFERROR(QUERY({Helper!P2:R},"select Col1,Col2,Col3 where Col3>0 order by Col3 desc limit 10",0),"")');
  sh.getRange('C14:C23').setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 14, 23, 1, 3, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, 'A13:C23');
  sh.setRowHeights(14, 10, 22);
  
  // Zone 4: Highest Spending Cat card
  sh.getRange('A25').setValue('Highest Spending Cat').setFontWeight('bold').setBackground(AU.CARD).setFontColor(AU.INK);
  sh.getRange('C25').setFormula('=IFERROR(INDEX(A14:A23,MATCH(MAX(C14:C23),C14:C23,0))&" / "&INDEX(B14:B23,MATCH(MAX(C14:C23),C14:C23,0)),"")').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(AU.RED);
  styleTableBorder_(sh, 'A25:C25');
  sh.setRowHeight(25, 24);

  // Zone 5: Income by Source
  sh.getRange('J2').setValue('Income by Source').setFontWeight('bold').setFontColor(AU.NAVY).setFontSize(11);
  head_(sh,'J3:K3',['Source','Total']);
  sh.getRange('J3:K3').setBackground(AU.NAVY).setFontSize(10).setVerticalAlignment('middle');
  sh.getRange('J4').setFormula('=IFERROR(QUERY({Helper!U2:V},"select Col1,Col2 where Col2>0 order by Col2 desc",0),"")');
  sh.getRange('K4:K15').setNumberFormat(CUR).setHorizontalAlignment('right');
  applyTableStripe_(sh, 4, 15, 10, 11, STYLE.SLATE_LIGHT, '#ffffff');
  styleTableBorder_(sh, 'J3:K15');
  sh.setRowHeights(4, 12, 22);
  
  sh.getRange('J18').setValue('Highest Earning Month').setFontWeight('bold').setBackground(AU.CARD).setFontColor(AU.INK);
  sh.getRange('K18').setFormula('=IFERROR(INDEX(Helper!B1:M1,MATCH(MAX(Helper!B2:M2),Helper!B2:M2,0)),"")').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(AU.GREEN);
  styleTableBorder_(sh, 'J18:K18');
  sh.setRowHeight(18, 24);

  // Financial Health Score Card (J20:K22) — composite score from savings rate, credit, emergency fund
  sh.getRange('J20:K20').merge();
  sh.getRange('J20').setValue('FINANCIAL HEALTH SCORE').setFontSize(10).setFontWeight('bold')
    .setFontColor('white').setBackground(AU.NAVY).setHorizontalAlignment('center').setVerticalAlignment('middle');
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
  sh.getRange('J21:K22').setBackground(AU.CARD);
  styleTableBorder_(sh, 'J20:K22');
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING) {
    const hsCfRules = sh.getConditionalFormatRules();
    const hsRng = [sh.getRange('J21'), sh.getRange('J22')];
    hsCfRules.push(
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$J$21>=90').setFontColor(AU.GREEN).setRanges(hsRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($J$21>=75,$J$21<90)').setFontColor('#34a853').setRanges(hsRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($J$21>=50,$J$21<75)').setFontColor(AU.AMBER).setRanges(hsRng).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$J$21<50').setFontColor(AU.RED).setRanges(hsRng).build()
    );
    sh.setConditionalFormatRules(hsCfRules);
  }
  sh.setColumnWidth(10, 140); // J — wider for Health Score card
  sh.setColumnWidth(11, 140); // K

  // Zone 6: Financial KPIs & Account Analysis
  sh.getRange('A29').setValue('Financial KPIs & Account Analysis').setFontWeight('bold').setFontColor(AU.NAVY).setFontSize(11);
  sh.setRowHeight(29, 24);
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
  sh.getRange('A30:A36').setFontWeight('bold').setBackground(AU.CARD).setFontColor(AU.INK).setFontSize(10);
  sh.getRange('B30:B36').setFontWeight('bold').setFontSize(10);
  sh.getRange('B30:B33').setFontColor(AU.GRAY);   // ratios + liquid → neutral
  sh.getRange('B34').setFontColor(AU.PURPLE);     // investments → purple
  sh.getRange('B35').setFontColor(AU.RED);        // credit card balance → red
  sh.getRange('A36:B36').setBackground(AU.GREEN_BG);              // total row: subtle highlight
  sh.getRange('B36').setFontColor(AU.GREEN).setFontSize(11);      // Net Worth stands out
  styleTableBorder_(sh, 'A30:B36');
  sh.setRowHeights(30, 7, 24);

  /* Column widths — balanced grid; I is a narrow gutter between panels */
  sh.setColumnWidth(1,170); sh.setColumnWidth(2,115); sh.setColumnWidth(3,110);
  sh.setColumnWidth(4,70);  sh.setColumnWidth(5,95);  sh.setColumnWidth(6,95);
  sh.setColumnWidth(7,95);  sh.setColumnWidth(8,80);  sh.setColumnWidth(9,24);

  if (CONFIG.ENABLE_CHARTS) buildAnnualCharts_(sh);
  sh.setFrozenRows(1);
}

/* 2×2 chart grid below the tables. Every chart gets an EXPLICIT width/height and is
   anchored to column A with pixel offsets, so spacing is exact and never depends on
   column widths — charts cannot overlap or clip each other even if the layout above
   changes. Data ranges are identical to before; only presentation options changed. */
function buildAnnualCharts_(sh){
  try {
    (sh.getCharts()||[]).forEach(c=>sh.removeChart(c));
    const AU = ANNUAL_UI;
    const W = 550, H = 316, GAP = 20;          // uniform chart size + gutter
    const ROW1 = 40, ROW2 = 56, X2 = W + GAP;  // 16 rows × 21px = 336px = H + GAP
    sh.getRange('A38').setValue('Visual Analytics').setFontWeight('bold').setFontColor(AU.NAVY).setFontSize(11);
    sh.setRowHeight(38, 26);
    sh.setRowHeights(39, 35, 21);              // uniform canvas rows keep both bands aligned
    /* Chart options are deliberately MINIMAL. The Sheets embedded-chart renderer supports
       only a subset of Google Charts options; the object-form styling added in the earlier
       redesign (backgroundColor {fill,stroke}, chartArea, legend/hAxis/vAxis objects) made
       every chart render EMPTY — frame and title only, no series. Restored to the proven
       configuration (title + colors, as in the original working version) plus explicit
       width/height, which are documented-safe and required for the fixed 2×2 grid.
       Positions/offsets never affect data bindings — ranges are attached per chart below. */
    /* Middle Left — Income vs Expense */
    sh.insertChart(sh.newChart().asColumnChart().addRange(sh.getRange('D3:F15'))
      .setOption('title', 'Income vs Expense (Monthly)')
      .setOption('colors', [AU.GREEN, AU.RED])
      .setOption('width', W).setOption('height', H)
      .setPosition(ROW1, 1, 0, 0).build());
    /* Middle Right — Savings Trend */
    sh.insertChart(sh.newChart().asLineChart().addRange(sh.getRange('D3:D15')).addRange(sh.getRange('G3:G15'))
      .setOption('title', 'Savings Trend')
      .setOption('colors', [AU.BLUE])
      .setOption('width', W).setOption('height', H)
      .setPosition(ROW1, 1, X2, 0).build());
    /* Lower Left — Category Breakdown */
    sh.insertChart(sh.newChart().asPieChart().addRange(sh.getRange('A14:A23')).addRange(sh.getRange('C14:C23'))
      .setOption('title', 'Expense Category Distribution')
      .setOption('colors', AU.PIE)
      .setOption('width', W).setOption('height', H)
      .setPosition(ROW2, 1, 0, 0).build());
    /* Lower Right — Net Worth Trend */
    sh.insertChart(sh.newChart().asLineChart().addRange(sh.getParent().getRange('Helper!A5:M5')).setTransposeRowsAndColumns(true)
      .setOption('title', 'Net Worth Trend')
      .setOption('colors', [AU.PURPLE])
      .setOption('width', W).setOption('height', H)
      .setPosition(ROW2, 1, X2, 0).build());
  } catch(e){ Log_('WARNING','Chart build skipped: '+e); }
}
