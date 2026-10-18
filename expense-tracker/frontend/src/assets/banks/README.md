# Bank logos

One SVG per bank (or a PNG when no vector is available), named by the slug in
`src/components/bank-logos.ts` (`hdfc.svg`, `sbi.svg`, `angel-one.png`, ...).
An account shows the logo when its institution or name contains one of the words listed there,
so "HDFC" and "HDFC CC" both get `hdfc.svg`. Accounts without a logo keep the type icon, and cash
accounts always show the ₹ icon.

To add a bank: drop `<slug>.svg` (or `.png`) in this folder (a square viewBox reads best) and, if the slug is
new, add its words to `ALIASES` in `bank-logos.ts`.

Sources:
- SBI, Bank of India, IndusInd, Yes Bank, HDFC, ICICI and Paytm: the `symbol.svg` files from
  [praveenpuglia/indian-banks](https://github.com/praveenpuglia/indian-banks) (vector work by
  Praveen Puglia; that repo has no licence file), with a `<title>` added.
- Fi and Zerodha: [Simple Icons](https://simpleicons.org) (CC0), in the brand's colour.
- Amazon Pay: [CityPNG](https://www.citypng.com/photo/2749/amazon-pay-logo), resized to 128px
  wide. CityPNG's terms allow personal use only, not commercial use.
- Angel One: [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:AngelOne_logo.png)
  (public domain as a simple text logo), resized to 128px wide.
- Dhan: [Logowik](https://logowik.com/dhan-logo-vector-77039.html), the round mark only, resized to
  128px wide. Logowik states no licence.
- Amazon Pay is stacked onto two lines ("amazon" over "pay") so it stays readable in the small tile.

The logos are trademarks of their banks and are used here only to label the user's own accounts.
