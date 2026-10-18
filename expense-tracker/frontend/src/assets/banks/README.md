# Bank logos

One SVG per bank, named by the slug in `src/components/bank-logos.ts` (`hdfc.svg`, `sbi.svg`, ...).
An account shows the logo when its institution or name contains one of the words listed there,
so "HDFC" and "HDFC CC" both get `hdfc.svg`. Accounts without a logo keep the type icon.

To add a bank: drop `<slug>.svg` in this folder (a square viewBox reads best) and, if the slug is
new, add its words to `ALIASES` in `bank-logos.ts`.

Sources:
- SBI, Bank of India, IndusInd, Yes Bank, HDFC, ICICI and Paytm: the `symbol.svg` files from
  [praveenpuglia/indian-banks](https://github.com/praveenpuglia/indian-banks) (vector work by
  Praveen Puglia; that repo has no licence file), with a `<title>` added.
- Fi and Zerodha: [Simple Icons](https://simpleicons.org) (CC0), in the brand's colour.

The logos are trademarks of their banks and are used here only to label the user's own accounts.
