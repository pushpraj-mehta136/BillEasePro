const express = require('express');
const fs = require('fs');
const path = require('path');
const pdf = require('html-pdf');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

const TENANTS_FILE = path.join(__dirname, 'data', 'tenants.json');
const BILLS_FILE = path.join(__dirname, 'data', 'bills.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Ensure data files exist
if (!fs.existsSync(TENANTS_FILE)) fs.writeFileSync(TENANTS_FILE, '[]');
if (!fs.existsSync(BILLS_FILE)) fs.writeFileSync(BILLS_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) {
  const defaultUser = [{
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10)
  }];
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUser, null, 2));
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'billespro_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: null
  }
}));

// Auth middleware
function ensureAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.redirect('/login');
}

// === LOGIN ROUTES ===
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html')); // Login page renamed to index.html
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = JSON.parse(fs.readFileSync(USERS_FILE));
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.send('Invalid credentials. <a href="/login">Try again</a>.');
  }
  req.session.authenticated = true;
  req.session.username = username;
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// === HTML VIEWS ===
app.get('/', ensureAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/tenants', ensureAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'tenants.html')));
app.get('/bills', ensureAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'bills.html')));

// === TENANTS API ===
app.get('/api/tenants', ensureAuth, (req, res) => {
  const tenants = JSON.parse(fs.readFileSync(TENANTS_FILE));
  res.json(tenants);
});

app.post('/api/tenants', ensureAuth, (req, res) => {
  const tenants = JSON.parse(fs.readFileSync(TENANTS_FILE));
  tenants.push(req.body);
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2));
  res.sendStatus(200);
});

app.put('/api/tenants/:id', ensureAuth, (req, res) => {
  const tenants = JSON.parse(fs.readFileSync(TENANTS_FILE));
  tenants[req.params.id] = req.body;
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2));
  res.sendStatus(200);
});

app.delete('/api/tenants/:id', ensureAuth, (req, res) => {
  const tenants = JSON.parse(fs.readFileSync(TENANTS_FILE));
  tenants.splice(req.params.id, 1);
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2));
  res.sendStatus(200);
});

// === BILLS API ===
app.get('/api/bills', ensureAuth, (req, res) => {
  const bills = JSON.parse(fs.readFileSync(BILLS_FILE));
  res.json(bills);
});

app.post('/api/bills', ensureAuth, (req, res) => {
  const bills = JSON.parse(fs.readFileSync(BILLS_FILE));
  const bill = { ...req.body, date: new Date().toLocaleString(), id: bills.length };
  bills.push(bill);
  fs.writeFileSync(BILLS_FILE, JSON.stringify(bills, null, 2));
  res.sendStatus(200);
});

app.delete('/api/bills/:id', ensureAuth, (req, res) => {
  const bills = JSON.parse(fs.readFileSync(BILLS_FILE));
  bills.splice(req.params.id, 1);
  fs.writeFileSync(BILLS_FILE, JSON.stringify(bills, null, 2));
  res.sendStatus(200);
});

// === PDF Generation ===
app.get('/api/bills/pdf/:id', ensureAuth, (req, res) => {
  const bills = JSON.parse(fs.readFileSync(BILLS_FILE));
  const bill = bills[req.params.id];
  if (!bill) return res.status(404).send('Not found');

  const now = new Date().toLocaleString();
  const html = `
    <html><head><style>
      body { font-family: 'Segoe UI'; padding: 40px; color: #333; }
      h1 { color: #2d2e83; margin: 0; }
      h3 { color: #555; margin-top: 5px; margin-bottom: 30px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
      .footer { margin-top: 40px; font-size: 13px; color: #777; text-align: center; border-top: 1px dashed #aaa; padding-top: 10px; }
    </style></head><body>
      <div style="text-align:center;">
        <h1>BillEasePro - Rent Invoice</h1>
        <h3>Generated on ${now}</h3>
      </div>
      <table>
        <tr><th>Tenant Name</th><td>${bill.tenantName}</td></tr>
        <tr><th>Tenant Mobile</th><td>${bill.mobile}</td></tr>
        <tr><th>Rent for Month</th><td>${bill.monthYear}</td></tr>
        <tr><th>Owner</th><td>${bill.owner} (${bill.ownerMobile})</td></tr>
        <tr><th>Paid Through</th><td>${bill.through}</td></tr>
        <tr><th>Payment Mode</th><td>${bill.paymentMode}${bill.paymentMode === 'UPI' && bill.utr ? ` (UTR Number: ${bill.utr})` : ''}</td></tr>
        <tr><th>Amount Paid</th><td>₹${bill.amount}</td></tr>
        <tr><th>Billing Date</th><td>${bill.date}</td></tr>
      </table>
      <div class="footer">Generated using <strong>BillEasePro</strong> — Smart Room Rent Billing System</div>
    </body></html>
  `;

  const fname = `${bill.tenantName.replace(/\s+/g, '_')}_${bill.date.split(',')[0].replace(/\//g, '-')}.pdf`;

  pdf.create(html).toStream((err, stream) => {
    if (err) return res.status(500).send('PDF error');
    res.setHeader('Content-disposition', `attachment; filename=${fname}`);
    res.setHeader('Content-type', 'application/pdf');
    stream.pipe(res);
  });
});

// === Server Start ===
app.listen(PORT, () => console.log(`✅ BillEasePro running at http://localhost:${PORT}`));
