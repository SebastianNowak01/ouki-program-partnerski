import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import Database from 'better-sqlite3'
import { parse, serialize } from 'cookie'
import { z } from 'zod'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)
const COOKIE_NAME = 'partner_ref'
const COMMISSION_RATE = 0.1

const dataDir = path.resolve(process.cwd(), 'server', 'data')
fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'affiliate.sqlite'))
db.pragma('journal_mode = WAL')

const products = [
  { id: 'iphone-16', name: 'iPhone 16 Pro', price: 5999 },
  { id: 'galaxy-s25', name: 'Samsung Galaxy S25', price: 4899 },
  { id: 'pixel-10', name: 'Google Pixel 10', price: 4199 },
  { id: 'xiaomi-15', name: 'Xiaomi 15 Ultra', price: 3799 },
]

const initDb = db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ref_code TEXT NOT NULL UNIQUE,
      bank_account TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      ref_code TEXT NOT NULL,
      clicked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_agent TEXT,
      ip TEXT,
      FOREIGN KEY (partner_id) REFERENCES partners(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      customer_email TEXT NOT NULL,
      partner_id INTEGER,
      partner_ref TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (partner_id) REFERENCES partners(id)
    );

    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL UNIQUE,
      amount REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('accrued', 'requested', 'paid')) DEFAULT 'accrued',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT,
      payout_id INTEGER,
      FOREIGN KEY (partner_id) REFERENCES partners(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('requested', 'paid')) DEFAULT 'requested',
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      transfer_reference TEXT,
      FOREIGN KEY (partner_id) REFERENCES partners(id)
    );

    CREATE TABLE IF NOT EXISTS bank_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payout_id INTEGER NOT NULL,
      partner_id INTEGER NOT NULL,
      account_number TEXT NOT NULL,
      amount REAL NOT NULL,
      transfer_reference TEXT NOT NULL,
      executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payout_id) REFERENCES payouts(id),
      FOREIGN KEY (partner_id) REFERENCES partners(id)
    );
  `)
})

initDb()

app.use(express.json())

const createPartnerSchema = z.object({
  name: z.string().min(2).max(80),
  bankAccount: z.string().min(8).max(34),
})

const clickSchema = z.object({
  refCode: z.string().min(3).max(40),
})

const orderSchema = z.object({
  productId: z.string().min(2),
  customerEmail: z.string().email(),
})

const roundMoney = (value) => Math.round(value * 100) / 100

const generateRefCode = () => `P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

const findPartnerByRef = db.prepare('SELECT * FROM partners WHERE ref_code = ?')

app.get('/api/products', (_req, res) => {
  res.json({ products })
})

app.get('/api/partners', (_req, res) => {
  const rows = db
    .prepare('SELECT id, name, ref_code AS refCode, bank_account AS bankAccount, created_at AS createdAt FROM partners ORDER BY id DESC')
    .all()
  res.json({ partners: rows })
})

app.post('/api/partners', (req, res) => {
  const parsed = createPartnerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Niepoprawne dane partnera.' })
    return
  }

  let refCode = generateRefCode()
  while (findPartnerByRef.get(refCode)) {
    refCode = generateRefCode()
  }

  const insert = db.prepare('INSERT INTO partners (name, ref_code, bank_account) VALUES (?, ?, ?)')
  const result = insert.run(parsed.data.name, refCode, parsed.data.bankAccount)

  const partner = db
    .prepare('SELECT id, name, ref_code AS refCode, bank_account AS bankAccount, created_at AS createdAt FROM partners WHERE id = ?')
    .get(result.lastInsertRowid)

  res.status(201).json({ partner })
})

app.post('/api/track-click', (req, res) => {
  const parsed = clickSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Brak poprawnego kodu polecenia.' })
    return
  }

  const partner = findPartnerByRef.get(parsed.data.refCode)
  if (!partner) {
    res.status(404).json({ message: 'Partner o podanym kodzie nie istnieje.' })
    return
  }

  db.prepare('INSERT INTO affiliate_clicks (partner_id, ref_code, user_agent, ip) VALUES (?, ?, ?, ?)').run(
    partner.id,
    parsed.data.refCode,
    req.headers['user-agent'] ?? null,
    req.ip,
  )

  res.setHeader(
    'Set-Cookie',
    serialize(COOKIE_NAME, parsed.data.refCode, {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    }),
  )

  res.json({ message: 'Polecenie zapisane.', refCode: parsed.data.refCode })
})

app.post('/api/orders', (req, res) => {
  const parsed = orderSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Niepoprawne dane zamowienia.' })
    return
  }

  const product = products.find((item) => item.id === parsed.data.productId)
  if (!product) {
    res.status(404).json({ message: 'Nie znaleziono produktu.' })
    return
  }

  const rawCookie = req.headers.cookie ?? ''
  const cookies = parse(rawCookie)
  const refFromCookie = cookies[COOKIE_NAME]
  const partner = refFromCookie ? findPartnerByRef.get(refFromCookie) : null

  const insertOrder = db.prepare(
    'INSERT INTO orders (product_id, product_name, total_amount, customer_email, partner_id, partner_ref) VALUES (?, ?, ?, ?, ?, ?)',
  )

  const orderResult = insertOrder.run(
    product.id,
    product.name,
    product.price,
    parsed.data.customerEmail,
    partner?.id ?? null,
    partner?.ref_code ?? null,
  )

  const commissionAmount = partner ? roundMoney(product.price * COMMISSION_RATE) : 0
  if (partner && commissionAmount > 0) {
    db.prepare('INSERT INTO commissions (partner_id, order_id, amount) VALUES (?, ?, ?)').run(
      partner.id,
      orderResult.lastInsertRowid,
      commissionAmount,
    )
  }

  res.status(201).json({
    orderId: orderResult.lastInsertRowid,
    productName: product.name,
    totalAmount: product.price,
    partnerRef: partner?.ref_code ?? null,
    commissionAmount,
  })
})

app.get('/api/partner/:refCode/dashboard', (req, res) => {
  const partner = findPartnerByRef.get(req.params.refCode)
  if (!partner) {
    res.status(404).json({ message: 'Nie znaleziono partnera.' })
    return
  }

  const totals = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'accrued' THEN amount END), 0) AS availableForPayout,
        COALESCE(SUM(CASE WHEN status = 'requested' THEN amount END), 0) AS pendingTransfer,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paidOut,
        COALESCE(SUM(amount), 0) AS lifetime
      FROM commissions
      WHERE partner_id = ?
      `,
    )
    .get(partner.id)

  const commissions = db
    .prepare(
      `
      SELECT
        c.id,
        c.amount,
        c.status,
        c.created_at AS createdAt,
        c.paid_at AS paidAt,
        o.id AS orderId,
        o.product_name AS productName,
        o.total_amount AS orderValue,
        o.created_at AS orderCreatedAt
      FROM commissions c
      INNER JOIN orders o ON o.id = c.order_id
      WHERE c.partner_id = ?
      ORDER BY c.id DESC
      `,
    )
    .all(partner.id)

  const payouts = db
    .prepare(
      `
      SELECT
        p.id,
        p.amount,
        p.status,
        p.requested_at AS requestedAt,
        p.completed_at AS completedAt,
        p.transfer_reference AS transferReference,
        t.executed_at AS transferExecutedAt
      FROM payouts p
      LEFT JOIN bank_transfers t ON t.payout_id = p.id
      WHERE p.partner_id = ?
      ORDER BY p.id DESC
      `,
    )
    .all(partner.id)

  res.json({
    partner: {
      id: partner.id,
      name: partner.name,
      refCode: partner.ref_code,
      bankAccount: partner.bank_account,
      createdAt: partner.created_at,
    },
    totals,
    commissions,
    payouts,
    canRequestPayout: Number(totals.availableForPayout) > 0,
    hasRequestedPayout: payouts.some((payout) => payout.status === 'requested'),
  })
})

app.post('/api/partner/:refCode/payout-request', (req, res) => {
  const partner = findPartnerByRef.get(req.params.refCode)
  if (!partner) {
    res.status(404).json({ message: 'Nie znaleziono partnera.' })
    return
  }

  const available = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM commissions WHERE partner_id = ? AND status = 'accrued'")
    .get(partner.id)

  if (Number(available.amount) <= 0) {
    res.status(400).json({ message: 'Brak prowizji gotowych do wyplaty.' })
    return
  }

  const transaction = db.transaction(() => {
    const payoutResult = db
      .prepare('INSERT INTO payouts (partner_id, amount, status) VALUES (?, ?, ?)')
      .run(partner.id, roundMoney(Number(available.amount)), 'requested')

    db.prepare("UPDATE commissions SET status = 'requested', payout_id = ? WHERE partner_id = ? AND status = 'accrued'").run(
      payoutResult.lastInsertRowid,
      partner.id,
    )

    return payoutResult.lastInsertRowid
  })

  const payoutId = transaction()

  const payout = db
    .prepare('SELECT id, amount, status, requested_at AS requestedAt FROM payouts WHERE id = ?')
    .get(payoutId)

  res.status(201).json({ message: 'Zadanie wyplaty zostalo zapisane.', payout })
})

app.post('/api/payouts/:payoutId/mock-transfer', (req, res) => {
  const payout = db
    .prepare('SELECT p.*, pa.bank_account FROM payouts p INNER JOIN partners pa ON pa.id = p.partner_id WHERE p.id = ?')
    .get(req.params.payoutId)

  if (!payout) {
    res.status(404).json({ message: 'Nie znaleziono wyplaty.' })
    return
  }

  if (payout.status !== 'requested') {
    res.status(400).json({ message: 'Mock przelew mozna wykonac tylko dla statusu requested.' })
    return
  }

  const transferReference = `TRX-${Date.now()}`

  const transaction = db.transaction(() => {
    db.prepare(
      'INSERT INTO bank_transfers (payout_id, partner_id, account_number, amount, transfer_reference) VALUES (?, ?, ?, ?, ?)',
    ).run(payout.id, payout.partner_id, payout.bank_account, payout.amount, transferReference)

    db.prepare('UPDATE payouts SET status = ?, completed_at = CURRENT_TIMESTAMP, transfer_reference = ? WHERE id = ?').run(
      'paid',
      transferReference,
      payout.id,
    )

    db.prepare("UPDATE commissions SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE payout_id = ?").run(payout.id)
  })

  transaction()

  res.json({ message: 'Mock przelew wykonany.', transferReference })
})

app.listen(PORT, () => {
  console.log(`Affiliate backend listening on http://localhost:${PORT}`)
})


