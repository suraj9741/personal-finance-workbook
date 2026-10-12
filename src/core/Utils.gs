/* In-memory log buffer for the current run (flushed to the _Logs sheet by flushLogs_) */
let   LOGS  = [];

/* ============================ LOGGING + UTILITIES ============================ */
function Log_(level,msg){ LOGS.push([new Date(),level,msg]); Logger.log('['+level+'] '+msg); }
function flushLogs_(ss){ if(!LOGS.length) return; let sh=ss.getSheetByName('_Logs');
  if(!sh){
    sh=ss.insertSheet('_Logs');
    sh.setTabColor('#5b21b6');
    applyPremiumTheme_(sh, true);
    sh.getRange(1,1,1,3).setValues([['Time','Level','Message']]).setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white');
    sh.setFrozenRows(1);
  }
  sh.getRange(sh.getLastRow()+1,1,LOGS.length,3).setValues(LOGS);
  if(sh.getLastRow()>2000) sh.deleteRows(2,sh.getLastRow()-2000); LOGS=[]; }
/* Flattens {Parent:[Subs]} to [[Parent,Sub],...], de-duplicating Parent|Sub combos while
   preserving first-seen order (guards against accidental duplicates in the seed lists). */
function flat_(d){ const o=[], seen={}; Object.keys(d).forEach(p=>d[p].forEach(c=>{ const k=p+'|'+c; if(!seen[k]){ seen[k]=1; o.push([p,c]); } })); return o; }
function setRows_(sh,r,c,a){ if(a.length) sh.getRange(r,c,a.length,a[0].length).setValues(a); }
function head_(sh,a1,vals){ const r=sh.getRange(a1); if(vals&&vals.length&&r.getNumRows()===1&&r.getNumColumns()===vals.length) r.setValues([vals]); r.setFontWeight('bold').setBackground(STYLE.SLATE_DARK).setFontColor('white'); }
function colL_(c){ let s=''; while(c>0){ const m=(c-1)%26; s=String.fromCharCode(65+m)+s; c=(c-m-1)/26; } return s; }
function qs_(s){ return String(s).replace(/"/g,'""'); }
function confirmDestructive_(){ try{ const ui=SpreadsheetApp.getUi();
  return ui.alert('DELETE mode','REBUILD_MODE=DELETE permanently removes sheets (incl. Data/Config) with NO backup. Continue?',ui.ButtonSet.YES_NO)===ui.Button.YES;
}catch(e){ return true; } }
function orderTabs_(ss){
  const order=['Config','Data'].concat(CONFIG.MONTHS.map(m=>m+'_'+CONFIG.YEAR)).concat(['Accounts','Annual Dashboard','Validation_Report','Helper','_Logs']);
  let pos=1; order.forEach(n=>{ const s=ss.getSheetByName(n); if(s){ ss.setActiveSheet(s); ss.moveActiveSheet(pos++); } });
}
