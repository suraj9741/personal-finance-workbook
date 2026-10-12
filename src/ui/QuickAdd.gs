/* ============================ QUICK-ADD SIDEBAR (HtmlService) ============================
   A real data-entry form: Type → dependent Category → Account → Amount → Save (appends to Data).
   Removes dropdown hunting and guarantees valid rows. Single-file (HTML built in code). */
function showQuickAdd(){
  const data = getFormData_(SpreadsheetApp.getActive());
  const html = HtmlService.createHtmlOutput(quickAddHtml_(data)).setTitle('➕ Quick Add Transaction');
  SpreadsheetApp.getUi().showSidebar(html);
}
function getFormData_(ss){
  const cfg = ss.getSheetByName('Config'); if(!cfg) return {Expense:[],Income:[],Transfer:[],accounts:[]};
  const col = c => cfg.getRange(2,c,CONFIG.MAX_CATEGORY_ROWS,1).getValues().map(r=>String(r[0]).trim()).filter(String);
  return { Expense: col(25), Income: col(26), Transfer: col(27), accounts: col(18) };  // Y, Z, AA, R
}
function addQuickTransaction(p, ssOpt){   // ssOpt: only the test suite passes a workbook
  const ss = ssOpt || SpreadsheetApp.getActive(), sh = ss.getSheetByName('Data'); if(!sh) throw new Error('Data sheet missing');
  // Next free entry row = first blank in column A (Date)
  const colA = sh.getRange(2,1,CONFIG.MAX_TRANSACTION_ROWS,1).getValues();
  let n = 0; while(n < colA.length && colA[n][0] !== '') n++;
  const row = n + 2;
  const d = p.date ? new Date(p.date+'T00:00:00') : new Date();
  sh.getRange(row,1).setValue(d);                 // A Date
  sh.getRange(row,3).setValue(p.desc||'');         // C Description
  sh.getRange(row,4).setValue(Number(p.amount)||0);// D Amount
  sh.getRange(row,5).setValue(p.type);             // E Type
  sh.getRange(row,6).setValue(p.category);         // F Category
  sh.getRange(row,9).setValue(p.account);          // I Account / From
  if(p.type==='Transfer' && p.toAccount) sh.getRange(row,12).setValue(p.toAccount); // L To Account
  return 'Saved row '+row+': '+p.type+' '+CONFIG.CURRENCY+(Number(p.amount)||0);
}
function quickAddHtml_(data){
  const J = JSON.stringify(data).replace(/</g,'\\u003c');
  return `<!DOCTYPE html><html><head><base target="_top">
  <style>
    body{font-family:'Inter',Arial,sans-serif;margin:0;padding:14px;background:#0f172a;color:#e2e8f0}
    h2{font-size:15px;margin:0 0 12px;color:#fff}
    label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;margin:10px 0 4px}
    input,select{width:100%;box-sizing:border-box;padding:9px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#fff;font-size:14px}
    .seg{display:flex;gap:6px;margin-bottom:4px}
    .seg button{flex:1;padding:9px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#cbd5e1;cursor:pointer;font-weight:600}
    .seg button.on{color:#fff}
    .exp.on{background:#ef4444;border-color:#ef4444}.inc.on{background:#10b981;border-color:#10b981}.trf.on{background:#3b82f6;border-color:#3b82f6}
    #save{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:#f97316;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
    #msg{margin-top:10px;font-size:12px;min-height:16px;color:#86efac}
    .to{display:none}
  </style></head><body>
  <h2>➕ Quick Add Transaction</h2>
  <div class="seg">
    <button type="button" class="exp on" onclick="setType('Expense')">Expense</button>
    <button type="button" class="inc" onclick="setType('Income')">Income</button>
    <button type="button" class="trf" onclick="setType('Transfer')">Transfer</button>
  </div>
  <label>Date</label><input type="date" id="date">
  <label>Category</label><select id="category"></select>
  <label id="acctLabel">Account</label><select id="account"></select>
  <div class="to" id="toWrap"><label>To Account</label><select id="toAccount"></select></div>
  <label>Amount</label><input type="number" id="amount" inputmode="decimal" placeholder="0">
  <label>Description</label><input type="text" id="desc" placeholder="optional">
  <button id="save" onclick="save()">Save Transaction</button>
  <div id="msg"></div>
  <script>
    var DATA=${J}, type='Expense';
    document.getElementById('date').valueAsDate=new Date();
    function fill(sel,arr){var s=document.getElementById(sel);s.innerHTML='';arr.forEach(function(v){var o=document.createElement('option');o.value=v;o.text=v;s.add(o);});}
    function setType(t){type=t;
      ['exp','inc','trf'].forEach(function(c){document.querySelector('.'+c).classList.remove('on');});
      document.querySelector('.'+(t==='Expense'?'exp':t==='Income'?'inc':'trf')).classList.add('on');
      fill('category', DATA[t]||[]);
      document.getElementById('toWrap').style.display = (t==='Transfer')?'block':'none';
      document.getElementById('acctLabel').textContent = (t==='Transfer')?'From Account':'Account';
    }
    fill('account',DATA.accounts);fill('toAccount',DATA.accounts);setType('Expense');
    function save(){
      var p={date:document.getElementById('date').value,type:type,
        category:document.getElementById('category').value,account:document.getElementById('account').value,
        toAccount:document.getElementById('toAccount').value,amount:document.getElementById('amount').value,
        desc:document.getElementById('desc').value};
      if(!p.amount){document.getElementById('msg').textContent='⚠ Enter an amount.';return;}
      document.getElementById('save').textContent='Saving…';
      google.script.run.withSuccessHandler(function(r){
        document.getElementById('msg').textContent='✓ '+r;
        document.getElementById('amount').value='';document.getElementById('desc').value='';
        document.getElementById('save').textContent='Save Transaction';
      }).withFailureHandler(function(e){document.getElementById('msg').style.color='#fca5a5';document.getElementById('msg').textContent='✕ '+e.message;document.getElementById('save').textContent='Save Transaction';})
      .addQuickTransaction(p);
    }
  </script></body></html>`;
}
