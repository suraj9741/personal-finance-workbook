/* ============================ VERIFICATION TESTS (Finance Tools ▸ Run Verification Tests) ============================
   Builds a brand-new THROWAWAY workbook, fills it with known transactions, and checks every
   dashboard number the real formulas calculate. Your real Config and Data are never read or
   written. Results go to a Test_Report tab in this workbook. The throwaway workbook is moved to
   Drive Trash when everything passes, and kept (link in the report) when something fails.

   Scenario data (Y = CONFIG.YEAR). Opening balance: Bank HDFC 10,000. Budgets: Debt → Car EMI
   1,000/month, Wages → Paycheck 60,000/month.
     10 Jan  Income    50,000  Wages → Paycheck              Bank HDFC
     15 Jan  Expense      800  Debt → Car EMI                Credit Card HDFC CC
     20 Jan  Transfer   5,000  Self Transfer → Bank to Credit  Bank HDFC → Credit Card HDFC CC
     05 Mar  Expense    1,200  Everyday → Groceries          Cash
     06 Mar  Expense     −200  Everyday → Groceries (refund) Cash
     31 Dec  Expense      100  Everyday → Food               Bank HDFC
   February has no rows on purpose (empty month). Later groups add a Quick Add row
   (14 Jun, 250) and a row dated 1 Jan of the NEXT year. */

const TEST_MONTH_ = m => m + '_' + CONFIG.YEAR;

/* Apps Script stops any run at 6 minutes. Between groups the suite checks the clock, and once
   this budget is used it saves its place and stops cleanly; Finance Tools ▸ Resume Verification
   Tests carries on from there. Results so far are always in Test_Report. Nothing runs these
   tests automatically: only the two menu items do. */
let   TEST_TIME_BUDGET_MS_ = 4.5 * 60 * 1000;
const TEST_STATE_KEY_ = 'VERIFICATION_TEST_STATE';

function runVerificationTests()    { return runTests_(null); }
function resumeVerificationTests() {
  const st = loadTestState_();
  if (!st) Log_('INFO', 'No paused test run found — starting a new one.');
  return runTests_(st);
}

function testGroups_(saved) {
  return [
    ['1. Build from scratch',                  (T, ss) => { buildNewWorkbook(ss); testStructure_(T, ss); }],
    ['2. Seed test data',                      (T, ss) => { seedTestConfig_(T, ss); writeTestRows_(ss, 2, testRows_()); SpreadsheetApp.flush(); }],
    ['3. Data sheet auto-columns',             testDataColumns_],
    ['4. Monthly KPI cards',                   testMonthlyKpis_],
    ['5. Budget vs Actual',                    testBudgetVsActual_],
    ['6. Transfers',                           testTransfers_],
    ['7. Monthly account balances',            testMonthlyAccounts_],
    ['8. Monthly transactions list',           testTransactionsPanel_],
    ['9. Accounts sheet (year to date)',       testAccountsSheet_],
    ['10. Annual Dashboard',                   testAnnual_],
    ['11. Navigation',                         testNavigation_],
    ['12. Dependent Category dropdown',        testDependentDropdown_],
    ['13. Quick Add',                          testQuickAdd_],
    ['14. Missing month → Validate → Resume',  testMissingMonthAndResume_],
    ['15. Row dated next year is ignored',     testOutOfYearRow_],
    ['16. Wrong Drive folder ID fails loudly', T => testBadFolder_(T, saved)]
  ];
}

/* st: saved place of a paused run, or null for a fresh run.
   State is saved BEFORE each group, so even if Apps Script kills the run mid-group,
   Resume knows which group was cut off. */
function runTests_(st) {
  const started = Date.now();
  const host = SpreadsheetApp.getActiveSpreadsheet();
  const saved = { name: CONFIG.WORKBOOK_NAME, folder: CONFIG.DRIVE_FOLDER_ID };
  const groups = testGroups_(saved);
  let tmp = null, T, next = 0, paused = false;
  Log_('INFO', '=== ' + (st ? 'Resuming' : 'Running') + ' Verification Tests (throwaway workbook) ===');
  TEST_MODE_ = true;
  try {
    if (st) {
      tmp = SpreadsheetApp.openById(st.tmpId);
      T = newTestKit_(readTestReportRows_(host));
      next = st.next;
      if (st.running === next) {            // the last run was killed inside this group
        if (next === 0) {
          T.group(groups[0][0], () => {
            resumeBuild(tmp); applyNavigationToAllSheets_(tmp);
            T.ok('Build needed a second run (6-minute limit)', true, 'finished on resume');
            testStructure_(T, tmp);
          });
        } else {
          T.group(groups[next][0], () => T.ok('(stopped by the 6-minute limit)', false, 'not re-run: it changes the test workbook'));
        }
        next++;
      }
    } else {
      discardPausedTestRun_();
      T = newTestKit_([]);
      const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT', 'yyyyMMdd_HHmmss');
      tmp = SpreadsheetApp.create(CONFIG.WORKBOOK_NAME + ' — TEST ' + stamp);
    }
    for (let i = next, first = true; i < groups.length; i++, first = false) {
      if (!first && Date.now() - started > TEST_TIME_BUDGET_MS_) { paused = true; break; }
      next = i;
      saveTestState_({ tmpId: tmp.getId(), next: i, running: i });
      writeTestReport_(host, T, tmp, 'running', i, groups.length);
      T.group(groups[i][0], () => groups[i][1](T, tmp));
      next = i + 1;
    }
  } catch (e) {
    T = T || newTestKit_([]);
    T.ok('Test run', false, 'Stopped: ' + (e && e.message || e));
  } finally {
    TEST_MODE_ = false;
    CONFIG.WORKBOOK_NAME = saved.name;
    CONFIG.DRIVE_FOLDER_ID = saved.folder;
  }

  const failed = T.failed();
  if (paused) {
    saveTestState_({ tmpId: tmp.getId(), next: next });
    writeTestReport_(host, T, tmp, 'paused', next, groups.length);
    Log_('INFO', `Verification paused after ${next} of ${groups.length} groups — run Resume Verification Tests.`);
    try { host.toast(`Paused after ${next} of ${groups.length} groups (time limit). Run Finance Tools ▸ Resume Verification Tests.`, 'Verification Tests', 10); } catch (e) {}
    return { total: T.rows.length, failed: failed, paused: true, next: next };
  }
  clearTestState_();
  if (tmp && failed === 0) { try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e) { Log_('WARNING', 'Could not trash test workbook: ' + e); } }
  writeTestReport_(host, T, failed ? tmp : null, 'done', groups.length, groups.length);
  Log_(failed ? 'ERROR' : 'INFO', `Verification: ${T.rows.length - failed} passed, ${failed} failed`);
  try { host.toast(failed ? `${failed} check(s) FAILED — see Test_Report` : `All ${T.rows.length} checks passed`, 'Verification Tests', 8); } catch (e) {}
  return { total: T.rows.length, failed: failed, paused: false };
}

/* ---------- paused-run bookkeeping (PropertiesService) ---------- */
function loadTestState_() {
  const raw = PropertiesService.getUserProperties().getProperty(TEST_STATE_KEY_);
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function saveTestState_(st) { PropertiesService.getUserProperties().setProperty(TEST_STATE_KEY_, JSON.stringify(st)); }
function clearTestState_()  { PropertiesService.getUserProperties().deleteProperty(TEST_STATE_KEY_); }
/* Starting over: trash the half-tested workbook a paused run left behind. */
function discardPausedTestRun_() {
  const st = loadTestState_();
  if (st && st.tmpId) { try { DriveApp.getFileById(st.tmpId).setTrashed(true); } catch (e) {} }
  clearTestState_();
}
/* Results of earlier runs live in Test_Report, so a resumed run reads them back from there. */
function readTestReportRows_(host) {
  const rep = host.getSheetByName('Test_Report');
  if (!rep || rep.getLastRow() < 3) return [];
  return rep.getRange(3, 1, rep.getLastRow() - 2, 5).getValues().filter(r => r[1] !== '');
}

/* ---------- tiny assertion kit ---------- */
function newTestKit_(earlier) {
  const rows = (earlier || []).slice(); let group = '';
  const show = v => (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd') : v;
  const add = (name, exp, act, ok) => { rows.push([group, name, show(exp), show(act), ok ? 'PASS' : 'FAIL']); return ok; };
  return {
    rows: rows,
    group(name, fn) { group = name; try { fn(); } catch (e) { add('(group stopped early)', 'no error', String(e && e.message || e), false); } },
    eq(name, expected, actual, tol) {
      const num = typeof expected === 'number' && typeof actual === 'number';
      return add(name, expected, actual, num ? Math.abs(expected - actual) <= (tol === undefined ? 0.005 : tol) : String(show(expected)) === String(show(actual)));
    },
    ok(name, cond, detail) { return add(name, 'true', detail === undefined ? String(!!cond) : detail, !!cond); },
    failed() { return rows.filter(r => r[4] === 'FAIL').length; }
  };
}

/* ---------- test data ---------- */
function testRows_() {
  const Y = CONFIG.YEAR, d = (m, day) => new Date(Y, m, day);
  //        Date        Description        Amount  Type        Category                           From                     To
  return [
    [d(0, 10),  'Salary',          50000, 'Income',   'Wages → Paycheck',               'Bank → HDFC',          ''],
    [d(0, 15),  'Car EMI',           800, 'Expense',  'Debt → Car EMI',                 'Credit Card → HDFC CC', ''],
    [d(0, 20),  'Pay card bill',    5000, 'Transfer', 'Self Transfer → Bank to Credit', 'Bank → HDFC',          'Credit Card → HDFC CC'],
    [d(2, 5),   'Groceries',        1200, 'Expense',  'Everyday → Groceries',           'Cash → Cash',          ''],
    [d(2, 6),   'Grocery refund',   -200, 'Expense',  'Everyday → Groceries',           'Cash → Cash',          ''],
    [d(11, 31), 'Dinner',            100, 'Expense',  'Everyday → Food',                'Bank → HDFC',          '']
  ];
}
/* Writes only the input columns (A,C,D,E,F,I,L) so the auto-fill formulas in B,G,H,J,K,M,N stay intact. */
function writeTestRows_(ss, startRow, rows) {
  const sh = ss.getSheetByName('Data');
  const cols = [[1, 0], [3, 1], [4, 2], [5, 3], [6, 4], [9, 5], [12, 6]];
  cols.forEach(([col, i]) => sh.getRange(startRow, col, rows.length, 1).setValues(rows.map(r => [r[i]])));
}
function seedTestConfig_(T, ss) {
  const cfg = ss.getSheetByName('Config');
  const setBy = (keyCol, a, b, valCol, v) => {
    const vals = cfg.getRange(2, keyCol, CONFIG.MAX_CATEGORY_ROWS, 2).getValues();
    const i = vals.findIndex(r => String(r[0]).trim() === a && String(r[1]).trim() === b);
    T.ok(`Config has ${a} / ${b}`, i > -1);
    if (i > -1) cfg.getRange(i + 2, valCol).setValue(v);
  };
  setBy(15, 'Bank', 'HDFC', 17, 10000);          // O/P → Q opening
  setBy(1, 'Debt', 'Car EMI', 4, 1000);          // A/B → D budget
  setBy(6, 'Wages', 'Paycheck', 9, 60000);       // F/G → I planned
}

/* ---------- reading helpers ---------- */
function cell_(ss, sheet, a1) { return ss.getSheetByName(sheet).getRange(a1).getValue(); }
function findRow_(sh, r, c, nr, nc, pred) {
  const vals = sh.getRange(r, c, nr, nc).getValues();
  return vals.find(pred) || null;
}
function monthAccount_(ss, month, payType, acct) {   // [PayType, Account, Starting, Expense, Income, Remaining]
  return findRow_(ss.getSheetByName(TEST_MONTH_(month)), 9, LAYOUT.ACCOUNTS_COL, LAYOUT.ACCOUNTS_CAP, 6,
    r => r[0] === payType && r[1] === acct);
}
function ytdAccount_(ss, payType, acct) {
  return findRow_(ss.getSheetByName('Accounts'), 5, 1, 80, 6, r => r[0] === payType && r[1] === acct);
}

/* ---------- scenario groups ---------- */
function testStructure_(T, ss) {
  const expected = ['Config', 'Data'].concat(CONFIG.MONTHS.map(TEST_MONTH_)).concat(['Accounts', 'Annual Dashboard']);
  expected.forEach(n => T.ok('Sheet exists: ' + n, !!ss.getSheetByName(n)));
  T.eq('Tab order starts Config, Data, Jan', ['Config', 'Data', TEST_MONTH_('Jan')].join(','),
    ss.getSheets().slice(0, 3).map(s => s.getName()).join(','));
  ['Helper', 'Month_Template'].forEach(n => T.ok(n + ' is hidden', ss.getSheetByName(n) && ss.getSheetByName(n).isSheetHidden()));
  ['catExpense', 'catIncome', 'catTransfer', 'payList'].forEach(n => T.ok('Named range ' + n, !!ss.getRangeByName(n)));
  const cfg = ss.getSheetByName('Config');
  T.eq('Seeded expense categories', flat_(DEFAULT_CATEGORIES.EXPENSE).length,
    cfg.getRange(2, 1, CONFIG.MAX_CATEGORY_ROWS, 1).getValues().filter(r => r[0] !== '').length);
  T.eq('Seeded accounts', flatAccounts_(DEFAULT_ACCOUNTS).length,
    cfg.getRange(2, 16, CONFIG.MAX_CATEGORY_ROWS, 1).getValues().filter(r => r[0] !== '').length);
  T.eq('Config year setting', CONFIG.YEAR, cfg.getRange('W2').getValue());
  T.eq('Jan title', 'Jan ' + CONFIG.YEAR, cell_(ss, TEST_MONTH_('Jan'), 'A1'));
  T.eq('Dec month tag', TEST_MONTH_('Dec'), cell_(ss, TEST_MONTH_('Dec'), 'B1'));
  T.eq('Mar month start date', new Date(CONFIG.YEAR, 2, 1), cell_(ss, TEST_MONTH_('Mar'), 'B2'));
  const rep = ss.getSheetByName('Validation_Report');
  const errs = rep ? rep.getDataRange().getValues().filter(r => r[0] === 'ERROR') : [['no report']];
  T.eq('Validate Formulas: no errors on an empty workbook', 0, errs.length);
  T.eq('Every month empty → Jan income', 0, cell_(ss, TEST_MONTH_('Jan'), 'C4'));
}

function testDataColumns_(T, ss) {
  const d = ss.getSheetByName('Data');
  T.eq('Month auto-fill (row 2)', TEST_MONTH_('Jan'), d.getRange('B2').getValue());
  T.eq('Month auto-fill (Dec row)', TEST_MONTH_('Dec'), d.getRange('B7').getValue());
  T.eq('Parent from Category', 'Wages', d.getRange('G2').getValue());
  T.eq('Sub from Category', 'Paycheck', d.getRange('H2').getValue());
  T.eq('From Pay Type', 'Bank', d.getRange('J2').getValue());
  T.eq('From Account', 'HDFC', d.getRange('K2').getValue());
  T.eq('Transfer To Pay Type', 'Credit Card', d.getRange('M4').getValue());
  T.eq('Transfer To Account', 'HDFC CC', d.getRange('N4').getValue());
  T.eq('Blank row stays blank', '', d.getRange('B8').getValue());
}

function testMonthlyKpis_(T, ss) {
  const k = (m, a1) => cell_(ss, TEST_MONTH_(m), a1);
  T.eq('Jan opening = Config opening', 10000, k('Jan', 'A4'));
  T.eq('Jan income', 50000, k('Jan', 'C4'));
  T.eq('Jan expense (transfer not counted)', 800, k('Jan', 'E4'));
  T.eq('Jan net savings', 49200, k('Jan', 'G4'));
  T.eq('Jan savings rate', 0.984, k('Jan', 'I4'), 0.0005);
  T.eq('Total budget card', 1000, k('Jan', 'K4'));
  T.eq('Feb (empty) opening carries Jan result', 59200, k('Feb', 'A4'));
  T.eq('Feb (empty) income', 0, k('Feb', 'C4'));
  T.eq('Feb (empty) expense', 0, k('Feb', 'E4'));
  T.eq('Feb (empty) savings rate is 0, not an error', 0, k('Feb', 'I4'));
  T.eq('Mar expense nets the refund', 1000, k('Mar', 'E4'));
  T.eq('Mar net savings negative', -1000, k('Mar', 'G4'));
  T.eq('Apr opening', 58200, k('Apr', 'A4'));
  T.eq('Dec (31st) expense counted in Dec', 100, k('Dec', 'E4'));
  T.eq('Dec opening', 58200, k('Dec', 'A4'));
}

function testBudgetVsActual_(T, ss) {
  const exp = (m, p, s) => findRow_(ss.getSheetByName(TEST_MONTH_(m)), 9, 1, 146, 5, r => r[0] === p && r[1] === s);
  const inc = (m, p, s) => findRow_(ss.getSheetByName(TEST_MONTH_(m)), 9, LAYOUT.INCOME_COL, 52, 5, r => r[0] === p && r[1] === s);
  const car = exp('Jan', 'Debt', 'Car EMI') || [];
  T.eq('Car EMI budget', 1000, car[2]); T.eq('Car EMI spent', 800, car[3]); T.eq('Car EMI under budget by', 200, car[4]);
  const gro = exp('Mar', 'Everyday', 'Groceries') || [];
  T.eq('Groceries spent (refund netted)', 1000, gro[3]); T.eq('Groceries over budget (negative diff)', -1000, gro[4]);
  T.eq('Car EMI spent in Feb', 0, (exp('Feb', 'Debt', 'Car EMI') || [])[3]);
  const pay = inc('Jan', 'Wages', 'Paycheck') || [];
  T.eq('Paycheck planned', 60000, pay[2]); T.eq('Paycheck earned', 50000, pay[3]); T.eq('Paycheck short by', 10000, pay[4]);
}

function testTransfers_(T, ss) {
  const row = m => findRow_(ss.getSheetByName(TEST_MONTH_(m)), 9, LAYOUT.TRANSFER_COL, 52, 3,
    r => r[0] === 'Self Transfer' && r[1] === 'Bank to Credit') || [];
  T.eq('Jan Bank → Credit transfer', 5000, row('Jan')[2]);
  T.eq('Feb Bank → Credit transfer', 0, row('Feb')[2]);
  T.eq('Annual income ignores transfers', 50000, cell_(ss, 'Annual Dashboard', 'B3'));
}

function testMonthlyAccounts_(T, ss) {
  const jan = monthAccount_(ss, 'Jan', 'Bank', 'HDFC') || [];
  T.eq('Jan HDFC starting = opening', 10000, jan[2]); T.eq('Jan HDFC out (transfer)', 5000, jan[3]);
  T.eq('Jan HDFC in (salary)', 50000, jan[4]); T.eq('Jan HDFC remaining', 55000, jan[5]);
  const cc = monthAccount_(ss, 'Jan', 'Credit Card', 'HDFC CC') || [];
  T.eq('Jan HDFC CC out (EMI)', 800, cc[3]); T.eq('Jan HDFC CC in (bill paid)', 5000, cc[4]); T.eq('Jan HDFC CC remaining', 4200, cc[5]);
  T.eq('Feb HDFC starting carries Jan remaining', 55000, (monthAccount_(ss, 'Feb', 'Bank', 'HDFC') || [])[2]);
  const cash = monthAccount_(ss, 'Mar', 'Cash', 'Cash') || [];
  T.eq('Mar Cash out (with refund)', 1000, cash[3]); T.eq('Mar Cash remaining negative', -1000, cash[5]);
  const sbiCard = monthAccount_(ss, 'Jan', 'Credit Card', 'SBI') || [];
  T.eq('Same account name, other pay type stays 0', 0, sbiCard[5]);
  T.eq('Dec HDFC remaining', 54900, (monthAccount_(ss, 'Dec', 'Bank', 'HDFC') || [])[5]);
  const netCol = LAYOUT.ACCOUNTS_COL + 7 + 4;
  T.eq('Jan NET (all accounts)', 59200, ss.getSheetByName(TEST_MONTH_('Jan')).getRange(7, netCol).getValue());
  T.eq('Dec NET (all accounts)', 58100, ss.getSheetByName(TEST_MONTH_('Dec')).getRange(7, netCol).getValue());
}

function testTransactionsPanel_(T, ss) {
  const jan = ss.getSheetByName(TEST_MONTH_('Jan')).getRange(9, LAYOUT.TXN_COL, 4, 6).getValues();
  T.eq('Jan lists 3 transactions', 3, jan.filter(r => r[0] !== '').length);
  T.eq('Jan first row (sorted by date)', 'Salary', jan[0][1]);
  T.eq('Jan last row', 'Pay card bill', jan[2][1]);
  T.eq('Feb shows the empty message', '(no transactions yet)', cell_(ss, TEST_MONTH_('Feb'), colL_(LAYOUT.TXN_COL) + '9'));
}

function testAccountsSheet_(T, ss) {
  const h = ytdAccount_(ss, 'Bank', 'HDFC') || [];
  T.eq('HDFC starting', 10000, h[2]); T.eq('HDFC out', 5100, h[3]); T.eq('HDFC in', 50000, h[4]); T.eq('HDFC remaining', 54900, h[5]);
  T.eq('HDFC CC remaining', 4200, (ytdAccount_(ss, 'Credit Card', 'HDFC CC') || [])[5]);
  T.eq('Cash remaining', -1000, (ytdAccount_(ss, 'Cash', 'Cash') || [])[5]);
  T.eq('Unused account', 0, (ytdAccount_(ss, 'Share Broker', 'Zerodha') || [])[5]);
  T.eq('NET (all accounts)', 58100, cell_(ss, 'Accounts', 'L3'));
  const tot = ss.getSheetByName('Accounts').getRange(5, 8, 6, 5).getValues();
  const t = n => (tot.find(r => r[0] === n) || [])[4];
  T.eq('Totals: Bank', 54900, t('Bank')); T.eq('Totals: Credit Card', 4200, t('Credit Card')); T.eq('Totals: Cash', -1000, t('Cash'));
}

function testAnnual_(T, ss) {
  const a = a1 => cell_(ss, 'Annual Dashboard', a1);
  T.eq('Total income', 50000, a('B3')); T.eq('Total expense', 1900, a('B4')); T.eq('Total savings', 48100, a('B5'));
  T.eq('Savings rate', 0.962, a('B6'), 0.0005);
  T.eq('Avg monthly income (months with income)', 50000, a('B7'));
  T.eq('Avg monthly expense (months with expense)', 1900 / 3, a('B8'), 0.01);
  T.eq('Monthly table: Jan income', 50000, a('E4')); T.eq('Monthly table: Mar expense', 1000, a('F6'));
  const months = ss.getSheetByName('Annual Dashboard').getRange('F4:F15').getValues().reduce((s, r) => s + (Number(r[0]) || 0), 0);
  T.eq('Sum of monthly expenses = annual expense', a('B4'), months);
  T.eq('Top category', 'Groceries', a('B14')); T.eq('Top category total', 1000, a('C14'));
  T.eq('Second category', 'Car EMI', a('B15'));
  T.eq('Highest spending card', 'Everyday / Groceries', a('C25'));
  T.eq('Income by source', 'Wages', a('J4')); T.eq('Income by source total', 50000, a('K4'));
  T.eq('Highest earning month', TEST_MONTH_('Jan'), a('K18'));
  T.eq('Expense-to-income', 0.038, a('B30'), 0.0005);
  T.eq('Liquid (Bank + Cash)', 53900, a('B33')); T.eq('Investments', 0, a('B34')); T.eq('Credit card balance', 4200, a('B35'));
  T.eq('Net worth', 58100, a('B36'));
  T.eq('Net worth = opening + savings', 10000 + a('B5'), a('B36'));
  T.eq('Health score', 83, a('J21')); T.eq('Health label', '⬤ Good', a('J22'));
  T.eq('Cumulative net worth (Helper, Dec)', 48100, cell_(ss, 'Helper', 'M5'));
}

function testNavigation_(T, ss) {
  const jan = ss.getSheetByName(TEST_MONTH_('Jan')), feb = ss.getSheetByName(TEST_MONTH_('Feb'));
  T.ok('Jan nav links to Feb', String(jan.getRange(3, LAYOUT.TXN_COL + 1).getFormula()).indexOf('#gid=' + feb.getSheetId()) > -1,
    jan.getRange(3, LAYOUT.TXN_COL + 1).getFormula());
  T.eq('Current month highlighted', STYLE.FLAME, jan.getRange(3, LAYOUT.TXN_COL).getBackground());
  T.eq('Other months not highlighted', STYLE.SLATE_LIGHT, feb.getRange(3, LAYOUT.TXN_COL).getBackground());
}

function testDependentDropdown_(T, ss) {
  const d = ss.getSheetByName('Data'), row = 40;
  const edit = v => { d.getRange(row, 5).setValue(v); handleEdit_({ range: d.getRange(row, 5), value: v, source: ss }); };
  const listOf = () => { const dv = d.getRange(row, 6).getDataValidation(); return dv ? dv.getCriteriaValues()[0].getA1Notation() : 'none'; };
  edit('Expense');
  T.eq('Expense → expense categories', ss.getRangeByName('catExpense').getA1Notation(), listOf());
  d.getRange(row, 6).setValue('Debt → Car EMI');
  edit('Income');
  T.eq('Changing Type clears the old category', '', d.getRange(row, 6).getValue());
  T.eq('Income → income categories', ss.getRangeByName('catIncome').getA1Notation(), listOf());
  edit('Transfer');
  T.eq('Transfer → transfer categories', ss.getRangeByName('catTransfer').getA1Notation(), listOf());
  edit('');
  T.eq('Blank Type → no list', 'none', listOf());
  handleEdit_({ range: ss.getSheetByName('Config').getRange(row, 5), value: 'Expense', source: ss });
  T.ok('Edits on other sheets are ignored', true);
  d.getRange(row, 1, 1, 15).clearContent();
}

function testQuickAdd_(T, ss) {
  const f = getFormData_(ss);
  T.ok('Form lists expense categories', f.Expense.indexOf('Everyday → Food') > -1);
  T.ok('Form lists income categories', f.Income.indexOf('Wages → Paycheck') > -1);
  T.ok('Form lists accounts', f.accounts.indexOf('Bank → HDFC') > -1);
  const msg = addQuickTransaction({ date: CONFIG.YEAR + '-06-14', desc: 'Quick add test', amount: '250', type: 'Expense',
    category: 'Everyday → Food', account: 'Bank → HDFC' }, ss);
  T.eq('Quick Add appends after the last row', 'Saved row 8: Expense ' + CONFIG.CURRENCY + '250', msg);
  SpreadsheetApp.flush();
  T.eq('Quick Add row month', TEST_MONTH_('Jun'), ss.getSheetByName('Data').getRange('B8').getValue());
  T.eq('Jun expense shows it', 250, cell_(ss, TEST_MONTH_('Jun'), 'E4'));
  T.eq('Annual expense includes it', 2150, cell_(ss, 'Annual Dashboard', 'B4'));
  T.eq('HDFC remaining drops by 250', 54650, (ytdAccount_(ss, 'Bank', 'HDFC') || [])[5]);
}

function testMissingMonthAndResume_(T, ss) {
  const janId = ss.getSheetByName(TEST_MONTH_('Jan')).getSheetId();
  ss.deleteSheet(ss.getSheetByName(TEST_MONTH_('Apr')));
  validateWorkbook(ss);
  const errs = ss.getSheetByName('Validation_Report').getDataRange().getValues().filter(r => r[0] === 'ERROR');
  T.ok('Validate reports the missing month', errs.some(r => r[1] === 'Missing sheet' && r[2] === TEST_MONTH_('Apr')),
    errs.map(r => r[1] + ': ' + r[2]).join('; ') || 'no errors');
  const rowsBefore = ss.getSheetByName('Data').getRange('A2:A').getValues().filter(r => r[0] !== '').length;
  resumeBuild(ss);
  SpreadsheetApp.flush();
  T.ok('Resume recreates the month', !!ss.getSheetByName(TEST_MONTH_('Apr')));
  T.eq('Resume leaves other months alone', janId, ss.getSheetByName(TEST_MONTH_('Jan')).getSheetId());
  T.eq('Resume keeps Data rows', rowsBefore, ss.getSheetByName('Data').getRange('A2:A').getValues().filter(r => r[0] !== '').length);
  T.eq('Resume keeps Config budgets', 1000, (findRow_(ss.getSheetByName('Config'), 2, 1, 200, 4, r => r[0] === 'Debt' && r[1] === 'Car EMI') || [])[3]);
  T.eq('Recreated Apr opening', 58200, cell_(ss, TEST_MONTH_('Apr'), 'A4'));
  T.eq('May HDFC starting still carries forward from Apr', 55000, (monthAccount_(ss, 'May', 'Bank', 'HDFC') || [])[2]);
}

function testOutOfYearRow_(T, ss) {
  const before = {
    annual: cell_(ss, 'Annual Dashboard', 'B4'), jan: cell_(ss, TEST_MONTH_('Jan'), 'E4'),
    dec: cell_(ss, TEST_MONTH_('Dec'), 'E4'), hdfc: (ytdAccount_(ss, 'Bank', 'HDFC') || [])[5], net: cell_(ss, 'Annual Dashboard', 'B36')
  };
  writeTestRows_(ss, 9, [[new Date(CONFIG.YEAR + 1, 0, 1), 'Next-year row', 999, 'Expense', 'Everyday → Food', 'Bank → HDFC', '']]);
  SpreadsheetApp.flush();
  T.eq('Jan unchanged', before.jan, cell_(ss, TEST_MONTH_('Jan'), 'E4'));
  T.eq('Dec unchanged', before.dec, cell_(ss, TEST_MONTH_('Dec'), 'E4'));
  T.eq('Annual expense unchanged', before.annual, cell_(ss, 'Annual Dashboard', 'B4'));
  T.eq('HDFC remaining unchanged', before.hdfc, (ytdAccount_(ss, 'Bank', 'HDFC') || [])[5]);
  T.eq('Net worth unchanged', before.net, cell_(ss, 'Annual Dashboard', 'B36'));
}

function testBadFolder_(T, saved) {
  let threw = false, msg = '';
  CONFIG.WORKBOOK_NAME = '__no_such_workbook__';
  CONFIG.DRIVE_FOLDER_ID = 'not-a-real-folder-id';
  try { getOrCreateSpreadsheet_(); } catch (e) { threw = true; msg = String(e && e.message || e); }
  finally { CONFIG.WORKBOOK_NAME = saved.name; CONFIG.DRIVE_FOLDER_ID = saved.folder; }
  T.ok('Stops with an error instead of creating a workbook elsewhere', threw, msg || 'no error');
}

/* ---------- report ---------- */
/* status: 'running' (written before each group, so a killed run still leaves its results),
   'paused' (time budget used; Resume continues) or 'done'. */
function writeTestReport_(host, T, keptWorkbook, status, groupsDone, groupsTotal) {
  let rep = host.getSheetByName('Test_Report');
  if (rep) rep.clear(); else rep = host.insertSheet('Test_Report');
  rep.setTabColor('#1e3a8a');
  const failed = T.failed();
  const head = [['Group', 'Check', 'Expected', 'Actual', 'Result']];
  const counts = `${T.rows.length - failed} passed · ${failed} failed · ${new Date()}`;
  const summary = status === 'done'
    ? counts + (keptWorkbook ? ` · test workbook kept for inspection: ${keptWorkbook.getUrl()}` : ' · test workbook moved to Trash')
    : `${status === 'paused' ? 'PAUSED (time limit)' : 'IN PROGRESS'} after ${groupsDone} of ${groupsTotal} groups — ` +
      `if this run has stopped, use Finance Tools ▸ Resume Verification Tests · ${counts} so far · test workbook: ${keptWorkbook.getUrl()}`;
  rep.getRange(1, 1).setValue(summary).setFontWeight('bold');
  rep.getRange(2, 1, 1, 5).setValues(head).setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');
  if (T.rows.length) rep.getRange(3, 1, T.rows.length, 5).setValues(T.rows);
  if (CONFIG.ENABLE_CONDITIONAL_FORMATTING && T.rows.length) {
    const res = rep.getRange(3, 5, T.rows.length, 1);
    rep.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('FAIL').setBackground(STYLE.RED_BG).setFontColor(STYLE.RED).setRanges([res]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PASS').setFontColor(STYLE.GREEN).setRanges([res]).build()
    ]);
  }
  rep.setFrozenRows(2);
  rep.setColumnWidth(1, 230); rep.setColumnWidth(2, 300); rep.setColumnWidth(3, 140); rep.setColumnWidth(4, 140); rep.setColumnWidth(5, 70);
}
