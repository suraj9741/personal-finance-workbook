/* Seed taxonomy — written to Config ONLY when Config is empty; then fully editable there. */
const SEED = {
  EXPENSE: {
    'Debt':['Credit cards','Car EMI','Electronics EMI','EMI','Tax','GST'],
    'Education':['Tuition','Books'],
    'Entertainment':['Concerts','Movies / Shows','Games'],
    'Everyday':['Groceries','Food','Clothes','Subscriptions','Utilities','Shopping'],
    'Savings':['PPF','Friend','Share Market','H Gold'],
    'Gifts':['Gifts','Gift card','Other'],
    'Health':['Doctors','Pharmacy'],
    'Gotu':['Food','Bank','Pharmacy','Doctors','Medical test','Clothes','Phone','Utilities','Fuel','Cash','Tuition'],
    'Mom':['Insurance','Bank','Pharmacy','Doctors','Medical test','Clothes','Phone','Utilities','Bachat Gat','Cash'],
    'Baba':['Insurance','Bank','Pharmacy','Doctors','Shopping','Phone','Utilities','Fuel','Cash'],
    'Room':['Rent/mortgage','Groceries','Maintenance','Improvements','Property taxes','Internet','Electricity','Heat/gas','TV'],
    'Farm':['Pharmacy','Pre Farming','Post Farming','Maintenance'],
    'Friend':['EMI','borrow','lent'],
    'Home':['Rent/mortgage','Clothes','Groceries','Maintenance','Improvements','Property taxes','Internet','Electricity','Heat/gas','TV','Paper bill','Milk bill','Home Food','Wedding'],
    'Insurance':['Vehicle','Health','Home','Life'],
    'Pets':['Food','Vet/medical','Toys','Supplies'],
    'Technology':['Domains & hosting','Online services','Hardware','Software'],
    'Transportation':['Fuel','Car','Fast Tag','Bike','Public transit','Trip'],
    'Travel':['Airfare','Hotels','Travel Food'],
    'Pratiksha':['Food','Bank','Pharmacy','Doctors','Medical test','Clothes','Phone','Utilities','Fuel','Cash','Tuition'],
    'Other':['Other']
  },
  INCOME: {
    'Wages':['Paycheck','Bonus','Commission','W Other'],
    'Friend':['Refund','Rent'],
    'Savings':['PPF','Friend','Interest Income','FD'],
    'Share Market':['Dividends','S Refund','Stock sell'],
    'Gifts':['Gifts','Gift card','Other'],
    'Trip':['Refund','Fee'],
    'Gotu':['Bank','Cash'],
    'Mom':['Bank','Cash'],
    'Baba':['Bank','Cash'],
    'Pratiksha':['Bank','Cash'],
    'Other':['Other']
  },
  TRANSFER: {
    'Self Transfer':['Bank to Bank','Bank to Credit','Credit to Bank','Cash to Bank','Bank to Cash','Broker to Bank','Bank to Broker','Credit to Cash']
  },
  // Payment / account master: [Pay Type, Account, Opening]. Account names MATCH Data; "HDFC"
  // is intentionally both a Bank and a Credit Card — kept apart by Pay Type.
  PAY: [
    ['Bank','HDFC',0],['Bank','SBI',0],['Bank','BOI',0],['Bank','Paytm',0],['Bank','FI',0],['Bank','Amazon Pay',0],
    ['Credit Card','HDFC CC',0],['Credit Card','Amazon Pay',0],['Credit Card','ICICI',0],['Credit Card','Indusland',0],['Credit Card','SBI',0],['Credit Card','Yes Bank',0],
    ['Share Broker','Zerodha',0],['Share Broker','Angel Broker',0],['Share Broker','Dhan',0],
    ['Cash','Cash',0]
  ]
};
/* OPTION 2 — Code-driven defaults. This is the single place to edit the built-in starter
   taxonomy. It is written to Config ONLY on the first run (when Config is empty); after that
   the Config sheet is the source of truth and is never overwritten. */
const DEFAULT_CATEGORIES = SEED;

/* OPTION 2 — Code-driven ACCOUNT defaults. Written to Config ONLY on the first run (empty
   Config). After that, Config!O:P (Pay Type | Account) is the single source of truth and is
   never overwritten. Add/remove accounts in Config, not here. */
const DEFAULT_ACCOUNTS = {
  'Bank':         ["HDFC","SBI","BOI","Paytm","FI","Amazon Pay"],
  'Credit Card':  ["HDFC CC","Amazon Pay","ICICI","Indusland","SBI","Yes Bank"],
  'Share Broker': ["Zerodha","Angel Broker","Dhan"],
  'Cash':         ["Cash"]
};
function flatAccounts_(dict){ const o=[]; Object.keys(dict).forEach(t=>dict[t].forEach(a=>o.push([t,a,0]))); return o; }

const ACCOUNT_SECTIONS = [['Bank Accounts','Bank'],['Credit Cards','Credit Card'],
                          ['Share Brokers','Share Broker'],['Cash','Cash']];
