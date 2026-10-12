/* ============================ NAMED RANGES ============================ */
function refreshNamedRanges(ss) {
  if (!CONFIG.ENABLE_NAMED_RANGES) return;
  const defs = {
    catAll:     `Config!$AB$2:$AB`,
    catExpense: `Config!$Y$2:$Y`,
    catIncome:  `Config!$Z$2:$Z`,
    catTransfer:`Config!$AA$2:$AA`,
    payList:    `Config!$R$2:$R`,
    dataTable:  `Data!$A$1:$R$${DROWS}`
  };
  Object.keys(defs).forEach(n=>{ try{ if(ss.getRangeByName(n)) ss.removeNamedRange(n); ss.setNamedRange(n, ss.getRange(defs[n])); }catch(e){ Log_('WARNING','Named range '+n+': '+e); } });
  Log_('INFO','Named ranges refreshed.');
}

/* ============================ VALIDATION ENGINE ============================ */
function validateWorkbook(ss) {
  const rows=[['Severity','Area','Detail']]; const add=(s,a,d)=>{rows.push([s,a,d]); Log_(s,a+': '+d);};
  const expect=['Config','Data','Helper','Accounts'].concat(CONFIG.MONTHS.map(m=>m+'_'+CONFIG.YEAR)).concat(['Annual Dashboard']);
  expect.forEach(n=>{ if(!ss.getSheetByName(n)) add('ERROR','Missing sheet',n); });
  if (CONFIG.ENABLE_NAMED_RANGES) ['catExpense','catIncome','catTransfer','payList'].forEach(n=>{ if(!ss.getRangeByName(n)) add('WARNING','Missing named range',n); });
  const cfg=ss.getSheetByName('Config');
  if(cfg){ if(cfg.getRange('A2').getValue()==='') add('ERROR','Empty config','No expense categories');
           if(cfg.getRange('P2').getValue()==='') add('ERROR','Empty config','No accounts'); }
  const tok=['#REF!','#VALUE!','#N/A','#ERROR!','#NAME?','#DIV/0!'];
  ['Annual Dashboard','Accounts'].concat(CONFIG.MONTHS.map(m=>m+'_'+CONFIG.YEAR)).forEach(n=>{
    const s=ss.getSheetByName(n); if(!s) return; const v=s.getDataRange().getDisplayValues(); let h=0;
    for(let r=0;r<v.length;r++)for(let c=0;c<v[r].length;c++) if(tok.indexOf(v[r][c])>-1){ h++; if(h<=3) add('ERROR','Formula error',n+'!'+colL_(c+1)+(r+1)+' = '+v[r][c]); }
    if(h>3) add('ERROR','Formula error',n+': '+h+' error cells'); if(h===0) add('INFO','OK',n+' clean');
  });
  let rep=ss.getSheetByName('Validation_Report'); if(rep) rep.clear(); else rep=ss.insertSheet('Validation_Report');
  rep.setTabColor('#991b1b');
  applyPremiumTheme_(rep, true);
  rep.getRange(1,1,rows.length,3).setValues(rows);
  rep.getRange('A1:C1').setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white'); rep.setFrozenRows(1);
  rep.getRange(1,5).setValue('Generated: '+new Date());
  Log_('INFO','Validation complete: '+(rows.length-1)+' findings');
}
