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
    .addItem('Resume Verification Tests','menuResumeTests')
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
function menuResumeTests()  { run_('Resume Verification Tests', resumeVerificationTests); }
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
