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
    ['14-Jun-'+CONFIG.YEAR, '', 'Test Expense', 100, 'Expense', 'Debt → Car EMI', '', '', 'Credit Card → HDFC CC', '', '', '', '', '', 'Test Case 1'],
    ['14-Jun-'+CONFIG.YEAR, '', 'Test Income', 300, 'Income', 'Wages → Paycheck', '', '', 'Bank → HDFC', '', '', '', '', '', 'Test Case 2'],
    ['14-Jun-'+CONFIG.YEAR, '', 'Test Transfer', 5000, 'Transfer', 'Self Transfer → Bank to Credit', '', '', 'Bank → HDFC', '', '', 'Credit Card → HDFC CC', '', '', 'Test Case 3']
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
  
  // 3. Verify Month Dashboard (Jun_<YEAR>)
  const monthSheet = ss.getSheetByName('Jun_'+CONFIG.YEAR);
  if (!monthSheet) {
    Log_('ERROR', 'Month sheet Jun_'+CONFIG.YEAR+' not found!');
    return;
  }
  
  const opening = monthSheet.getRange('A4').getValue();
  const income = monthSheet.getRange('C4').getValue();
  const expense = monthSheet.getRange('E4').getValue();
  const savings = monthSheet.getRange('G4').getValue();
  
  Log_('INFO', `Month Dashboard Jun_${CONFIG.YEAR}: Opening=${opening}, Income=${income}, Expense=${expense}, Net Savings=${savings}`);
  
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
