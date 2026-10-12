/* ============================ DATA-ENTRY ASSISTANT — TRUE dependent dropdown ============================
   The Category cell has NO list until a Type is chosen. Choosing a Type sets the Category
   validation to ONLY that type's categories (catExpense / catIncome / catTransfer). No static
   union list is ever used.
   • If the script is BOUND to the sheet, the simple onEdit() fires automatically.
   • If the script is STANDALONE, run Finance Tools ▸ "Enable Dependent Dropdowns" once — it
     creates an INSTALLABLE onEdit trigger so the same logic still runs. */
function onEdit(e){ handleEdit_(e); }
function onEditInstallable(e){ handleEdit_(e); }
function handleEdit_(e){
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet(); if (sh.getName() !== 'Data') return;
    const row = e.range.getRow(), col = e.range.getColumn(); if (row < 2) return;
    const ss = e.source || SpreadsheetApp.getActiveSpreadsheet();
    const C = {DATE:1,AMT:4,TYPE:5,CAT:6,FROM:9,TO:12};
    const MAP = {Expense:'catExpense', Income:'catIncome', Transfer:'catTransfer'};

    // 1) TRUE dependent dropdown — Category list is STRICTLY the chosen Type's list
    if (col === C.TYPE) {
      const t = String((e.value!==undefined ? e.value : sh.getRange(row,col).getValue()) || '').trim();
      const catCell = sh.getRange(row, C.CAT);
      catCell.clearContent();                              // drop any stale category from the old type
      if (MAP[t]) {
        const rng = ss.getRangeByName(MAP[t]);
        if (rng) catCell.setDataValidation(
          SpreadsheetApp.newDataValidation().requireValueInRange(rng,true).setAllowInvalid(false).build());
        try { ss.toast('Category list → '+t+' categories only.','Dependent dropdown',3); } catch(_){}
      } else {
        catCell.clearDataValidations();                    // blank/other Type → no category list at all
      }
    }
    // 2) Lightweight validation warnings
    if ([C.AMT,C.TYPE,C.CAT,C.FROM,C.TO].indexOf(col) > -1) {
      const amt = sh.getRange(row,C.AMT).getValue();
      if (amt!=='' ) {
        const type = sh.getRange(row,C.TYPE).getValue();
        if (type==='')                                    ss.toast('⚠ Row '+row+': choose a Type first.','Validation',4);
        else if (sh.getRange(row,C.CAT).getValue()==='')  ss.toast('⚠ Row '+row+': pick a Category.','Validation',4);
        else if (sh.getRange(row,C.FROM).getValue()==='') ss.toast('⚠ Row '+row+': pick an Account (From).','Validation',4);
        else if (type==='Transfer' && sh.getRange(row,C.TO).getValue()==='') ss.toast('⚠ Row '+row+': Transfer needs a "To Account".','Validation',5);
      }
    }
  } catch(err){ /* never block typing */ }
}
/* Installable onEdit trigger — makes the dependent dropdown work even for a STANDALONE script. */
function installTriggers_(ss){
  ScriptApp.getProjectTriggers().forEach(t=>{ if(t.getHandlerFunction()==='onEditInstallable') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  Log_('INFO','Installable onEdit trigger created — dependent dropdowns active.');
}
