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
    default: {
      /* BACKUP: snapshot via COPY, then rebuild the ORIGINAL sheet in place.
         NEVER rename the live sheet — Google Sheets rewrites every formula in every
         other sheet to follow a rename, which left previously-built monthly sheets
         permanently reading from the frozen "_Backup_" snapshot instead of the live
         Data/Helper/Config sheets (the "dashboards not updating" bug). */
      const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT','yyyyMMdd_HHmmss');
      Log_('INFO','Backing up '+name+' → '+name+STYLE.BACKUP_TAG+stamp);
      const bak = sh.copyTo(ss).setName(name+STYLE.BACKUP_TAG+stamp);
      try { bak.hideSheet(); } catch(e){}
      resetSheet_(sh);
      return sh;
    }
  }
}
/* Wipes a sheet back to a blank slate so a builder can treat it like a fresh insert:
   contents, formats, merges, validations, conditional formats, charts, filter, frozen panes. */
function resetSheet_(sh) {
  const full = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  full.breakApart();
  sh.clear();
  full.clearDataValidations();
  sh.clearConditionalFormatRules();
  (sh.getCharts()||[]).forEach(c => sh.removeChart(c));
  const f = sh.getFilter(); if (f) f.remove();
  if (sh.getFrozenRows()) sh.setFrozenRows(0);
  if (sh.getFrozenColumns()) sh.setFrozenColumns(0);
  sh.setHiddenGridlines(false);
  if (sh.isSheetHidden()) sh.showSheet();
}
function backupWorkbook(ss) {
  const f = DriveApp.getFileById(ss.getId());
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT','yyyyMMdd_HHmmss');
  const name = CONFIG.WORKBOOK_NAME+STYLE.BACKUP_TAG+stamp;
  const parent = CONFIG.DRIVE_FOLDER_ID ? DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID) : null;
  const copy = parent ? f.makeCopy(name,parent) : f.makeCopy(name);
  Log_('INFO','Full backup created: '+name+' ('+copy.getId()+')');
}
