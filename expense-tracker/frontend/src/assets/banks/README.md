# Bank logos

One SVG per bank, named by the slug in `src/components/bank-logos.ts` (`hdfc.svg`, `sbi.svg`, ...).
An account shows the logo when its institution or name contains one of the words listed there,
so "HDFC" and "HDFC CC" both get `hdfc.svg`. Accounts without a logo keep the type icon.

To add a bank: drop `<slug>.svg` in this folder (a square viewBox reads best) and, if the slug is
new, add its words to `ALIASES` in `bank-logos.ts`.

Sources: HDFC, ICICI, Paytm, Fi and Zerodha are from [Simple Icons](https://simpleicons.org)
(CC0), in each brand's colour. The logos are trademarks of their banks and are used here only to
label the user's own accounts.
