/* ============================ PREMIUM STYLING HELPERS ============================ */
function applyPremiumTheme_(sh, hideGridlines) {
  try {
    sh.getRange(1, 1, Math.min(sh.getMaxRows(), 120), Math.min(sh.getMaxColumns(), 60)).setFontFamily("Inter"); // 120 rows ≈ dashboard area (was 1000 → 8× fewer cells)
    sh.setHiddenGridlines(hideGridlines);
  } catch(e) { Log_('WARNING', 'Could not apply premium theme: ' + e); }
}

function styleTableBorder_(sh, rangeA1) {
  try {
    const rng = sh.getRange(rangeA1);
    rng.setBorder(true, true, true, true, true, true, STYLE.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  } catch(e) { Log_('WARNING', 'Could not style table borders: ' + e); }
}

function applyTableStripe_(sh, startRow, endRow, startCol, endCol, evenColor, oddColor) {
  try {
    if (endRow < startRow) return;
    const numRows = endRow - startRow + 1;
    const numCols = endCol - startCol + 1;
    const range = sh.getRange(startRow, startCol, numRows, numCols);
    const backgrounds = [];
    for (let r = startRow; r <= endRow; r++) {
      const color = (r % 2 === 0) ? evenColor : oddColor;
      backgrounds.push(Array(numCols).fill(color));
    }
    range.setBackgrounds(backgrounds);
  } catch(e) { Log_('WARNING', 'Could not apply stripe backgrounds: ' + e); }
}
