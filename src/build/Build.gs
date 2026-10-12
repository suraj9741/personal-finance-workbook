/* ============================ ORCHESTRATORS ============================ */
function buildNewWorkbook(ss) {
  if (CONFIG.REBUILD_MODE === 'DELETE' && !confirmDestructive_()) { Log_('WARNING','DELETE cancelled'); return; }
  const T = {};
  time_(T,'Config',          ()=>buildConfig_(ss));
  time_(T,'Data',            ()=>buildData_(ss));
  time_(T,'Helper',          ()=>buildHelper_(ss));
  time_(T,'Accounts',        ()=>buildAccounts_(ss));
  time_(T,'Month_Template',  ()=>buildMonthTemplate_(ss));
  // Full build: recreate month sheets from the fresh template (they hold no user data —
  // everything lives in Data/Config). SKIP mode leaves existing months untouched;
  // resumeBuild still relies on createMonthlySheets_ skipping months that already exist.
  time_(T,'12 Months (copyTo)', ()=>{
    if (CONFIG.REBUILD_MODE !== 'SKIP')
      CONFIG.MONTHS.forEach(m=>{ const s=ss.getSheetByName(m+'_'+CONFIG.YEAR); if(s) ss.deleteSheet(s); });
    createMonthlySheets_(ss);
  });
  time_(T,'Annual',          ()=>buildAnnual_(ss));
  time_(T,'NamedRanges',     ()=>{ if (CONFIG.ENABLE_NAMED_RANGES) refreshNamedRanges(ss); });
  time_(T,'Navigation',      ()=>applyNavigationToAllSheets_(ss));  // must run AFTER all sheets exist
  try { installTriggers_(ss); } catch(e){ Log_('WARNING','Trigger install needs authorization — run Finance Tools ▸ Enable Dependent Dropdowns once. '+e); }
  orderTabs_(ss);
  writePerfReport_(ss, T);
  validateWorkbook(ss);
}
function repairAllMonths(ss){
  CONFIG.MONTHS.forEach(m=>{ const s=ss.getSheetByName(m+'_'+CONFIG.YEAR); if(s) ss.deleteSheet(s); });
  buildMonthTemplate_(ss); createMonthlySheets_(ss); orderTabs_(ss);
}
/* Resilient against the 6-min limit: builds ONLY what's missing, then finalizes.
   With copyTo this rarely times out, but re-running always continues safely. */
function resumeBuild(ss){
  if(!ss.getSheetByName('Config'))         buildConfig_(ss);
  if(!ss.getSheetByName('Data'))           buildData_(ss);
  if(!ss.getSheetByName('Helper'))         buildHelper_(ss);
  if(!ss.getSheetByName('Accounts'))       buildAccounts_(ss);
  if(!ss.getSheetByName('Month_Template')) buildMonthTemplate_(ss);
  createMonthlySheets_(ss);                                 // skips existing months, copies the rest (fast)
  if(!ss.getSheetByName('Annual Dashboard')) buildAnnual_(ss);
  if (CONFIG.ENABLE_NAMED_RANGES) refreshNamedRanges(ss);
  try { installTriggers_(ss); } catch(e){}
  orderTabs_(ss);
  const missing = CONFIG.MONTHS.filter(m=>!ss.getSheetByName(m+'_'+CONFIG.YEAR));
  Log_('INFO', (missing.length? 'Still missing: '+missing.join(', ')+' — run Resume again.' : 'All months present ✓'));
}
function rebuildDashboards(ss){
  buildHelper_(ss); buildAccounts_(ss);
  CONFIG.MONTHS.forEach(m=>{ const s=ss.getSheetByName(m+'_'+CONFIG.YEAR); if(s) ss.deleteSheet(s); });
  buildMonthTemplate_(ss); createMonthlySheets_(ss); buildAnnual_(ss);
  applyNavigationToAllSheets_(ss);
}
/* Performance timing helper + report */
function time_(T, name, fn){ const s=Date.now(); fn(); T[name]=Date.now()-s; Log_('INFO','[PERF] '+name+': '+T[name]+'ms'); }
function writePerfReport_(ss, T){
  let sh=ss.getSheetByName('Performance_Report'); if(sh) sh.clear(); else sh=ss.insertSheet('Performance_Report');
  const rows=[['Build Step','Time (ms)','Notes']]; let total=0;
  Object.keys(T).forEach(k=>{ rows.push([k, T[k], '']); total+=T[k]; });
  rows.push(['── TOTAL ──', total, total<60000 ? '✓ under 60s target' : '⚠ over 60s — raise nothing, check recalc']);
  sh.getRange(1,1,rows.length,3).setValues(rows);
  sh.getRange('A1:C1').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');
  sh.getRange(rows.length,1,1,3).setFontWeight('bold');
  sh.setColumnWidth(1,200); sh.setColumnWidth(3,300); sh.setFrozenRows(1); sh.setTabColor('#16a34a');
}
function refreshCategories(ss){ buildConfig_(ss); applyDataValidations_(ss); refreshNamedRanges(ss); Log_('INFO','Dropdowns refreshed (categories are live from Config).'); }  // buildConfig_ preserves existing Config and only appends missing defaults
