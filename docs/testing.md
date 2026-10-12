# Testing guide

There are two kinds of tests:

| | Node tests | In-sheet tests |
| --- | --- | --- |
| Where they run | Your computer, and GitHub on every push | Google Apps Script, in your Google account |
| What they check | What the script writes: sheets, headers, formulas, dropdowns, triggers, error handling | What Google Sheets calculates: every dashboard number, from a known set of transactions |
| Speed | About 2 seconds | Several minutes |
| Touches your data | Never (nothing real is involved) | No. They build a separate throwaway workbook. Only a `Test_Report` tab is added to your finance workbook |

Run the Node tests whenever you change code. Run the in-sheet tests after you push new code to
Apps Script, or whenever you want proof the real workbook calculates correctly.

---

## 1. In-sheet tests (Google Apps Script)

### Step 1: put the latest code into Apps Script

Pick one:

- **GitHub:** repo ▸ **Actions** ▸ **Push to Apps Script** ▸ **Run workflow** ▸ branch `main` ▸
  **Run workflow**. Wait for the green tick.
- **Your Mac:** in the repo folder, `git pull` then `clasp push`.

Then open the script ([script.google.com](https://script.google.com) ▸ **google finance sheet**)
and reload the browser tab so the editor shows the new code.

### Step 2: make sure your finance workbook exists

The report is written into your finance workbook (`CONFIG.WORKBOOK_NAME`, currently
**2027 Finance**, in the Drive folder `CONFIG.DRIVE_FOLDER_ID`). If you have not built it yet, do
that first: open the file **`ui/Menu`**, choose **`menuBuild`** in the function dropdown, click
**Run**. If the build stops on the 6-minute limit, run **`menuResumeBuild`** until the log says
`All months present ✓`.

> If the workbook does not exist when you run the tests, the script creates an empty one with
> that name, the same way the build does.

### Step 3: start the tests

Your script is standalone (not attached to a sheet), so the **Finance Tools** menu does not
appear in Sheets. You run the menu's functions from the editor instead:

1. In the left file list, open **`ui/Menu`**.
2. In the toolbar's function dropdown (next to **Run** / **Debug**), choose **`menuRunTests`**.
3. Click **Run**.
4. If Google asks for permission (first run, or after new permissions were added): **Review permissions** ▸ choose your account ▸
   **Advanced** ▸ **Go to google finance sheet (unsafe)** ▸ **Allow**. "Unsafe" only means
   Google has not reviewed your personal script. Then click **Run** again.

| Function to choose (file `ui/Menu`) | Same as menu item | What it does |
| --- | --- | --- |
| `menuRunTests` | Finance Tools ▸ Run Verification Tests | Starts a fresh test run |
| `menuResumeTests` | Finance Tools ▸ Resume Verification Tests | Continues a paused or cut-off run |
| `menuBuild` | Finance Tools ▸ Build New Workbook | Builds your real workbook |
| `menuResumeBuild` | Finance Tools ▸ Resume / Finish Build | Finishes a build that hit the time limit |

(`runVerificationTests` and `resumeVerificationTests` in **`tests/Tests`** do the same as the
first two, without writing to the `_Logs` tab.)

### Step 4: watch the Execution log

The **Execution log** panel opens under the code. Two lines tell you where everything is:

```
[INFO] Throwaway test workbook: https://docs.google.com/spreadsheets/d/…
…
[INFO] Results: Test_Report tab in "2027 Finance" https://docs.google.com/spreadsheets/d/…
```

The run ends with **Execution completed**. If instead you see **Exceeded maximum execution
time**, Google cut the run off at 6 minutes. Nothing is lost: run **`menuResumeTests`**.

### Step 5: read `Test_Report`

Open the **Results** link (your finance workbook) and go to the **`Test_Report`** tab. It is
**not** in the throwaway workbook.

**Row 1 is the summary.** It is one of these:

| Row 1 starts with | Meaning | What to do |
| --- | --- | --- |
| `142 passed · 0 failed · …  · test workbook moved to Trash` | Everything passed | Nothing. The throwaway workbook is already in the Trash |
| `140 passed · 2 failed · … · test workbook kept for inspection: <link>` | Finished, some checks failed | Read the red rows. The link opens the throwaway workbook so you can see the numbers |
| `PAUSED (time limit) after 9 of 16 groups — …` | The suite stopped itself before the 6-minute limit | Run `menuResumeTests`. Repeat until row 1 shows the final counts |
| `IN PROGRESS after 9 of 16 groups — …` | Either it is still running, or Google cut it off | If the editor says the run finished or failed, run `menuResumeTests` |

(The numbers above are examples.)

**Row 2 is the header, and each row after it is one check:**

| Column | Meaning |
| --- | --- |
| **Group** | Which scenario, e.g. `4. Monthly KPI cards`. There are 16 groups |
| **Check** | What was checked, e.g. `Jan income` |
| **Expected** | The value the check should see |
| **Actual** | The value the workbook actually shows. For a crash, the error message |
| **Result** | `PASS`, or `FAIL` in red |

Two special check names:

- **`(group stopped early)`**: the group crashed. **Actual** holds the error. Later groups still ran.
- **`(stopped by the 6-minute limit)`**: Google cut the run off inside this group. Resume does not
  re-run it, because the group changes the test workbook and a half-done second try would give
  misleading results. Start a fresh run (`menuRunTests`) if you need that group's results.

### Step 6: the two failures to expect

These are bugs in the workbook formulas, not in the tests. They are not fixed yet.

| Group | Failing check | Why |
| --- | --- | --- |
| `15. Row dated next year is ignored` | `Annual expense unchanged`, `HDFC remaining unchanged`, `Net worth unchanged` | The Annual Dashboard, Accounts and net-worth formulas add up every row in Data with no year filter, so a 1 Jan 2028 row is counted in 2027. Month sheets are fine (`Jan unchanged`, `Dec unchanged` pass) |
| `14. Missing month → Validate → Resume` | `May HDFC starting still carries forward from Apr` (probably) | When a month sheet is deleted and recreated, the next month's opening balance points at the deleted sheet and shows `#REF!` |

Any **other** failure is new. Copy its rows (all five columns) into the project chat.

### Cleaning up

- **All passed:** the throwaway workbook (named `2027 Finance — TEST <date>_<time>`, in My Drive)
  is already in the Trash.
- **Something failed:** it is kept so you can inspect it. Delete it when you are done.
- **A paused run you don't want to finish:** run `menuRunTests` again. It trashes the paused
  run's workbook and starts over.
- You can delete the `Test_Report` tab any time; the next run recreates it.

---

## 2. Node tests (your computer)

### One-time setup

You need **Node.js 20 or newer**. Check with:

```
node -v
```

If it prints `v20…` or higher you're set. Otherwise install it from
[nodejs.org](https://nodejs.org) (LTS) or with `brew install node`.

There are no packages to install: the tests only use what ships with Node.

### Run them

From the repo folder:

```
npm test
```

### Read the output

Each test prints one line, then a summary:

```
ok 1 - Build New Workbook creates every sheet in the right order
ok 2 - Config is seeded from the defaults
…
# tests 49
# pass 49
# fail 0
```

`# fail 0` means everything passed. A failure looks like this:

```
not ok 17 - default accounts: unique per pay type, matching the seed list
  location: '/…/tests/node/config.test.js:43:1'
  error: |-
    Expected values to be strictly deep-equal: …
  expected: …
  actual: …
```

The `location` line is the test file and line number; `expected` and `actual` show what differed.

The test files, in `tests/node/`:

| File | Covers |
| --- | --- |
| `helpers.test.js` | Small helper functions (column letters, quoting, account lists, navigation) |
| `config.test.js` | `CONFIG` sanity: no overlapping layout blocks, clean default categories and accounts |
| `build.test.js` | Full build: sheet order, Data headers/formulas/dropdowns, month sheets, named ranges, rebuild modes, Resume, triggers |
| `triggers.test.js` | The dependent Category dropdown and incomplete-row warnings |
| `quickadd.test.js` | Quick Add: first empty row, formula columns untouched, transfers, bad input |
| `spreadsheet.test.js` | Opening the workbook, wrong folder ID, sheet backup modes |
| `verification-suite.test.js` | The in-sheet suite's own plumbing: cleanup, pause/resume, standalone script, no automatic runs |
| `gas-mock.js`, `load.js` | Not tests: a stand-in for Google Sheets, and the loader that runs the `.gs` files in Node |

The stand-in stores values and formulas but cannot calculate formulas. That is why the
calculated numbers are only checked by the in-sheet tests.

---

## 3. Tests on GitHub

Every push and every pull request runs `npm test` automatically (workflow **Tests**,
`.github/workflows/tests.yml`). It does not need any secret, and it never touches Apps Script.

- **On a pull request:** the checks box at the bottom shows **Tests / node-tests**. A green tick
  means all Node tests passed.
- **On any commit:** the green tick or red cross next to the commit message.
- **Details:** repo ▸ **Actions** ▸ **Tests** ▸ pick a run ▸ **node-tests** ▸ expand **Run npm test**.
  The output is the same as on your computer.

The in-sheet tests never run on GitHub: they need your Google account.
