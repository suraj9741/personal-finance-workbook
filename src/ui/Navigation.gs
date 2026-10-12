/* ============================ NAVIGATION BAR ============================
   Dynamic nav bar in Row 1 of every major sheet.

   DESIGN
   ───────────────────────────────────────────────────────────────────────
   • Row 1 = nav bar (height 32 px, frozen, gridlines hidden)
   • Background: SLATE_DARK (#0f172a) for all items; FLAME (#f97316) for
     the CURRENT sheet's item — gives an "active tab" highlight effect.
   • Each cell holds a HYPERLINK formula that jumps to the sheet by GID
     (no hardcoding — GIDs are read at run-time via getSheetId()).
   • Monthly sheets: B1 is SKIPPED so the hidden month-tag value ($B$1
     formula references throughout the template) is never disturbed.
     B1 is given dark bg + tiny white text = invisible to the user.
   • Separator cells (thin dark columns) visually divide logical groups.

   CALL SEQUENCE
   ───────────────────────────────────────────────────────────────────────
   applyNavigationToAllSheets_(ss)   ← called AFTER all sheets are built
   applyNavigationBar_(ss, sh)       ← called per sheet by the above

   MENU ENTRY
   ───────────────────────────────────────────────────────────────────────
   Finance Tools ▸ Refresh Navigation  (menuRefreshNav)                */

/* Nav item definitions — order matches left-to-right display order.
   `target` = exact sheet name; `label` = display text without emoji.    */
function navDefs_() {
  return [
    { emoji: '🏠', label: 'Home',     target: 'Annual Dashboard', group: 'home' },
    { emoji: '📊', label: 'Annual',   target: 'Annual Dashboard', group: 'home' },
    ...CONFIG.MONTHS.map(m => ({ emoji: '📅', label: m, target: m + '_' + CONFIG.YEAR, group: 'month' })),
    { emoji: '💳', label: 'Accounts', target: 'Accounts',         group: 'admin' },
    { emoji: '📝', label: 'Data',     target: 'Data',             group: 'admin' },
    { emoji: '⚙️', label: 'Config',   target: 'Config',           group: 'admin' },
  ];
}

/* Applies a COMPACT month-grid navigation to one monthly sheet — top-right of the header
   band (cols M–O, rows 2–6), ABOVE the dashboard panels. It never writes into Row 1, so the
   dashboard title/KPIs are never overwritten. Also repairs any Row-1 damage left by the old bar. */
function applyNavigationBar_(ss, sh) {
  const sheetName = sh.getName();
  const isMonthly = CONFIG.MONTHS.some(m => sheetName === m + '_' + CONFIG.YEAR);
  if (!isMonthly) return;   // dashboards only; Annual/Config/Data/Accounts use the Finance Tools menu

  // ── Repair the header that the previous Row-1 nav bar damaged (restore the template's style) ──
  const mShort = sheetName.split('_')[0];
  try {
    sh.getRange(1, 3, 1, 22).clearContent().setBackground(null);          // wipe old hyperlinks C1..X1
    sh.getRange('A1').setValue(mShort + ' ' + CONFIG.YEAR)                // title: white on dark (as designed)
      .setFontSize(13).setFontWeight('bold').setFontColor('white').setBackground(STYLE.SLATE_DARK).setVerticalAlignment('middle');
    sh.getRange('B1').setValue(sheetName).setFontColor(STYLE.SLATE_DARK).setBackground(STYLE.SLATE_DARK).setFontSize(6); // invisible tag
    sh.setRowHeight(1, 30);
  } catch(e) { Log_('WARNING', 'Header repair: ' + e); }

  // ── Compact 3-wide month grid in the header band ABOVE the transactions panel (true far-right) ──
  const NAV_C = LAYOUT.TXN_COL, NAV_R = 2;                                // above transactions, rows 2–6
  const gid = name => { const s = ss.getSheetByName(name); return s ? s.getSheetId() : -1; };
  sh.getRange(NAV_R, NAV_C, 1, 3).merge().setValue('🧭 JUMP TO MONTH')
    .setBackground(STYLE.SLATE_DARK).setFontColor('#ffffff').setFontWeight('bold').setFontSize(9)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  CONFIG.MONTHS.forEach((m, i) => {
    const r = NAV_R + 1 + Math.floor(i / 3), c = NAV_C + (i % 3);
    const tag = m + '_' + CONFIG.YEAR, g = gid(tag), active = (tag === sheetName);
    const cell = sh.getRange(r, c);
    if (g >= 0) cell.setFormula(`=HYPERLINK("#gid=${g}","${m}")`); else cell.setValue(m);
    cell.setBackground(active ? STYLE.FLAME : STYLE.SLATE_LIGHT).setFontColor(active ? '#ffffff' : STYLE.INK)
        .setFontWeight(active ? 'bold' : 'normal').setFontSize(9).setHorizontalAlignment('center');
  });
  styleTableBorder_(sh, `${colL_(NAV_C)}${NAV_R}:${colL_(NAV_C + 2)}${NAV_R + 4}`);
  Log_('INFO', 'Nav grid → ' + sheetName);
}

/* Applies the month-grid nav to every MONTHLY sheet (the ones users navigate between).
   Annual/Config/Data/Accounts intentionally have no in-sheet nav — the menu covers them. */
function applyNavigationToAllSheets_(ss) {
  let count = 0;
  CONFIG.MONTHS.forEach(m => {
    const sh = ss.getSheetByName(m + '_' + CONFIG.YEAR);
    if (sh) { applyNavigationBar_(ss, sh); count++; }
  });
  Log_('INFO', 'Navigation grid applied on ' + count + ' monthly sheets.');
}

/* ============================ NAVIGATION ============================ */
function gotoCurrentMonth(){
  const ss = SpreadsheetApp.getActive();
  const now = new Date();
  const tag = (now.getFullYear()===CONFIG.YEAR) ? CONFIG.MONTHS[now.getMonth()]+'_'+CONFIG.YEAR : CONFIG.MONTHS[0]+'_'+CONFIG.YEAR;
  const sh = ss.getSheetByName(tag); if (sh){ ss.setActiveSheet(sh); ss.toast('Jumped to '+tag,'Navigate',3); }
}
function gotoAnnual(){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Annual Dashboard'); if (sh) ss.setActiveSheet(sh);
}
