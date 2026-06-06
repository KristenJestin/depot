/**
 * Prototype-focused seed (PRD 0025 / T1).
 *
 * Lays down two realistic prototypes on the first PRD it can attach to so the
 * web prototypes workspace has something to chew on locally.
 *
 * Usage: bun run seed:prototype
 * Defaults to .depot-dev/depot.db. Set DEPOT_DB_PATH to override.
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import path from "node:path";
import { existsSync } from "node:fs";
import * as schema from "#/db/schema";
import { generateId } from "#/shared/utils";

const dbPath = process.env["DEPOT_DB_PATH"] ?? process.env["DB_PATH"] ?? ".depot-dev/depot.db";
const absDbPath = path.resolve(dbPath);

if (!existsSync(absDbPath)) {
  console.error(`No database at ${absDbPath}.`);
  console.error("Run `bun run seed:rich` first to bootstrap a realistic dataset.");
  process.exit(1);
}

const client = new Database(absDbPath);
client.exec("PRAGMA foreign_keys = ON;");
const db = drizzle({ client, relations: schema.relations, casing: "snake_case" });

console.log(`[seed-prototype] DB: ${absDbPath}`);

// ── Pick a target PRD revision ───────────────────────────────────────────────
//
// Prefer an `in_progress` revision (most realistic place for an agent to be
// iterating on a prototype). Fall back to `draft` or `ready`. Bail out
// loudly if the DB has no PRDs at all.

const pickRevision = () => {
  const inProgress = client
    .query<{ id: string; prdId: string; title: string; status: string }, []>(
      "SELECT id, prd_id as prdId, title, status FROM prd_revisions WHERE status = 'in_progress' ORDER BY created_at DESC LIMIT 1",
    )
    .get();
  if (inProgress) return inProgress;
  const fallback = client
    .query<{ id: string; prdId: string; title: string; status: string }, []>(
      "SELECT id, prd_id as prdId, title, status FROM prd_revisions WHERE status IN ('draft', 'ready') ORDER BY created_at DESC LIMIT 1",
    )
    .get();
  return fallback;
};

const target = pickRevision();
if (!target) {
  console.error("No PRD revisions found in this DB.");
  console.error("Run `bun run seed:rich` first to bootstrap a dataset.");
  process.exit(1);
}

console.log(
  `[seed-prototype] target PRD revision: ${target.id} (${target.status}) — "${target.title}"`,
);

// ── Time helpers ─────────────────────────────────────────────────────────────

const NOW = Date.now();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

// ── HTML templates ───────────────────────────────────────────────────────────
//
// Self-contained: no CDN, no external CSS. Inline <style> with a sober digital
// banking palette (zinc neutrals + a violet/blue accent). Each variant is
// visually distinct so the renderer's "compare variants" mode is meaningful.

const baseStyles = (accent: string) => `
  :root {
    --bg: #fafafa;
    --surface: #ffffff;
    --border: #e4e4e7;
    --text: #18181b;
    --muted: #71717a;
    --subtle: #f4f4f5;
    --accent: ${accent};
    --accent-soft: ${accent}1a;
    --positive: #16a34a;
    --negative: #dc2626;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    line-height: 1.5;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .breadcrumb {
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    font-size: 13px;
    color: var(--muted);
  }
  .breadcrumb strong { color: var(--text); font-weight: 600; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .kpi-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr); }
  .kpi-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi-value { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .kpi-delta { font-size: 12px; margin-top: 4px; }
  .kpi-delta.up { color: var(--positive); }
  .kpi-delta.down { color: var(--negative); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  .btn {
    display: inline-block;
    padding: 8px 16px;
    background: var(--accent);
    color: white;
    border-radius: 6px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    font-size: 13px;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
  }
  .nav-link { color: var(--accent); font-weight: 600; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600; }
`;

const breadcrumb = (page: string) => `
  <div class="breadcrumb">
    <strong>Acme Banking</strong> &rsaquo; ${page}
  </div>
`;

// Overview, sidebar layout, iter-1 — the original mockup.
const htmlOverviewV1Sidebar = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Overview — Acme Banking</title>
  <style>${baseStyles("#6d28d9")}
    .shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 24px 16px; }
    .sidebar h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 24px 0 8px; }
    .sidebar a { display: block; padding: 8px 12px; border-radius: 6px; color: var(--text); margin-bottom: 2px; }
    .sidebar a.active { background: var(--accent-soft); color: var(--accent); }
    .sidebar a:hover { background: var(--subtle); text-decoration: none; }
    .main { padding: 24px; display: grid; gap: 16px; }
    .logo { font-weight: 800; font-size: 18px; color: var(--accent); }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">Acme</div>
      <h3>Banking</h3>
      <a href="#" class="active">Overview</a>
      <a href="#" data-depot-page="transactions">Transactions</a>
      <a href="#">Cards</a>
      <a href="#">Transfers</a>
      <h3>Account</h3>
      <a href="#">Settings</a>
      <a href="#">Logout</a>
    </aside>
    <main class="main">
      ${breadcrumb("Overview")}
      <div class="kpi-grid">
        <div class="card"><div class="kpi-label">Balance</div><div class="kpi-value">€12,438.20</div><div class="kpi-delta up">+€312 vs last month</div></div>
        <div class="card"><div class="kpi-label">Pending</div><div class="kpi-value">€1,204.50</div><div class="kpi-delta">3 transactions</div></div>
        <div class="card"><div class="kpi-label">Spend (MTD)</div><div class="kpi-value">€2,847.00</div><div class="kpi-delta down">+12% vs avg</div></div>
        <div class="card"><div class="kpi-label">Savings</div><div class="kpi-value">€48,200.00</div><div class="kpi-delta up">+€800 this month</div></div>
      </div>
      <div class="card">
        <h2 style="margin-top:0;font-size:16px;">Recent activity</h2>
        <table>
          <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th style="text-align:right;">Amount</th></tr></thead>
          <tbody>
            <tr><td>Jun 02</td><td>Uber</td><td>Transport</td><td style="text-align:right;">−€18.40</td></tr>
            <tr><td>Jun 01</td><td>Salary — Acme Corp</td><td>Income</td><td style="text-align:right;color:var(--positive);">+€3,200.00</td></tr>
            <tr><td>May 31</td><td>Carrefour</td><td>Groceries</td><td style="text-align:right;">−€67.20</td></tr>
            <tr><td>May 30</td><td>Netflix</td><td>Entertainment</td><td style="text-align:right;">−€13.99</td></tr>
          </tbody>
        </table>
        <p style="margin-top:12px;"><a href="#" data-depot-page="transactions" class="nav-link">See all transactions &rarr;</a></p>
      </div>
    </main>
  </div>
</body>
</html>`;

// Overview, top-nav layout, iter-1 — alt mockup the user rejected.
const htmlOverviewV1TopNav = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Overview — Acme Banking</title>
  <style>${baseStyles("#6d28d9")}
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 32px; }
    .logo { font-weight: 800; font-size: 18px; color: var(--accent); }
    nav { display: flex; gap: 4px; }
    nav a { padding: 8px 12px; border-radius: 6px; color: var(--text); }
    nav a.active { background: var(--accent-soft); color: var(--accent); }
    nav a:hover { background: var(--subtle); text-decoration: none; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
  </style>
</head>
<body>
  <header>
    <div class="logo">Acme Banking</div>
    <nav>
      <a href="#" class="active">Overview</a>
      <a href="#" data-depot-page="transactions">Transactions</a>
      <a href="#">Cards</a>
      <a href="#">Transfers</a>
      <a href="#">Settings</a>
    </nav>
    <div style="margin-left:auto;color:var(--muted);font-size:13px;">jane@acme.co</div>
  </header>
  ${breadcrumb("Overview")}
  <div class="container">
    <div class="kpi-grid">
      <div class="card"><div class="kpi-label">Balance</div><div class="kpi-value">€12,438.20</div><div class="kpi-delta up">+€312 this month</div></div>
      <div class="card"><div class="kpi-label">Pending</div><div class="kpi-value">€1,204.50</div><div class="kpi-delta">3 transactions</div></div>
      <div class="card"><div class="kpi-label">Spend (MTD)</div><div class="kpi-value">€2,847.00</div><div class="kpi-delta down">+12% vs avg</div></div>
      <div class="card"><div class="kpi-label">Savings</div><div class="kpi-value">€48,200.00</div><div class="kpi-delta up">+€800</div></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0;font-size:16px;">Recent activity</h2>
      <table>
        <thead><tr><th>Date</th><th>Merchant</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>
          <tr><td>Jun 02</td><td>Uber</td><td style="text-align:right;">−€18.40</td></tr>
          <tr><td>Jun 01</td><td>Salary — Acme Corp</td><td style="text-align:right;color:var(--positive);">+€3,200.00</td></tr>
          <tr><td>May 31</td><td>Carrefour</td><td style="text-align:right;">−€67.20</td></tr>
        </tbody>
      </table>
      <p style="margin-top:12px;"><a href="#" data-depot-page="transactions" class="nav-link">See all transactions &rarr;</a></p>
    </div>
  </div>
</body>
</html>`;

// Overview, sidebar layout, iter-2 — refined after feedback.
const htmlOverviewV2Sidebar = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Overview — Acme Banking</title>
  <style>${baseStyles("#6d28d9")}
    .shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 24px 16px; display: flex; flex-direction: column; }
    .sidebar h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 20px 0 6px; }
    .sidebar a { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; color: var(--text); margin-bottom: 2px; }
    .sidebar a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .sidebar a:hover { background: var(--subtle); text-decoration: none; }
    .sidebar .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
    .sidebar a.active .dot { background: var(--accent); }
    .user-card { margin-top: auto; padding: 12px; background: var(--subtle); border-radius: 6px; font-size: 12px; }
    .user-card .name { font-weight: 600; color: var(--text); }
    .main { padding: 32px; display: grid; gap: 20px; }
    .logo { font-weight: 800; font-size: 18px; color: var(--accent); margin-bottom: 12px; }
    .page-title { font-size: 24px; font-weight: 700; margin: 0; }
    .page-sub { color: var(--muted); margin: 4px 0 0; }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">Acme</div>
      <h3>Banking</h3>
      <a href="#" class="active"><span class="dot"></span>Overview</a>
      <a href="#" data-depot-page="transactions"><span class="dot"></span>Transactions</a>
      <a href="#"><span class="dot"></span>Cards</a>
      <a href="#"><span class="dot"></span>Transfers</a>
      <h3>Account</h3>
      <a href="#"><span class="dot"></span>Settings</a>
      <a href="#"><span class="dot"></span>Logout</a>
      <div class="user-card"><div class="name">Jane Doe</div><div style="color:var(--muted);">jane@acme.co</div></div>
    </aside>
    <main class="main">
      ${breadcrumb("Overview")}
      <div>
        <h1 class="page-title">Good morning, Jane <span class="pill">Premium</span></h1>
        <p class="page-sub">Here is what happened across your accounts in the last 30 days.</p>
      </div>
      <div class="kpi-grid">
        <div class="card"><div class="kpi-label">Available balance</div><div class="kpi-value">€12,438.20</div><div class="kpi-delta up">+€312.10 vs last month</div></div>
        <div class="card"><div class="kpi-label">Pending</div><div class="kpi-value">€1,204.50</div><div class="kpi-delta">3 transactions awaiting clearance</div></div>
        <div class="card"><div class="kpi-label">Spend (MTD)</div><div class="kpi-value">€2,847.00</div><div class="kpi-delta down">+12% vs 6-month average</div></div>
        <div class="card"><div class="kpi-label">Savings goal</div><div class="kpi-value">€48,200.00</div><div class="kpi-delta up">96% of €50k target</div></div>
      </div>
      <div class="card">
        <h2 style="margin-top:0;font-size:16px;">Recent activity</h2>
        <table>
          <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th style="text-align:right;">Amount</th></tr></thead>
          <tbody>
            <tr><td>Jun 02</td><td>Uber</td><td>Transport</td><td style="text-align:right;">−€18.40</td></tr>
            <tr><td>Jun 01</td><td>Salary — Acme Corp</td><td>Income</td><td style="text-align:right;color:var(--positive);">+€3,200.00</td></tr>
            <tr><td>May 31</td><td>Carrefour</td><td>Groceries</td><td style="text-align:right;">−€67.20</td></tr>
            <tr><td>May 30</td><td>Netflix</td><td>Entertainment</td><td style="text-align:right;">−€13.99</td></tr>
            <tr><td>May 29</td><td>Spotify</td><td>Entertainment</td><td style="text-align:right;">−€9.99</td></tr>
          </tbody>
        </table>
        <p style="margin-top:14px;"><a href="#" data-depot-page="transactions" class="nav-link">See all transactions &rarr;</a></p>
      </div>
    </main>
  </div>
</body>
</html>`;

// Overview, compact layout, iter-2 — the "denser" alternative on iter-2.
const htmlOverviewV2Compact = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Overview — Acme Banking</title>
  <style>${baseStyles("#6d28d9")}
    .shell { display: grid; grid-template-columns: 200px 1fr; min-height: 100vh; }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 16px 12px; }
    .sidebar a { display: block; padding: 6px 10px; border-radius: 4px; color: var(--text); margin-bottom: 1px; font-size: 13px; }
    .sidebar a.active { background: var(--accent); color: white; }
    .sidebar a:hover:not(.active) { background: var(--subtle); text-decoration: none; }
    .main { padding: 16px 20px; display: grid; gap: 12px; }
    .logo { font-weight: 800; font-size: 15px; color: var(--accent); margin-bottom: 8px; }
    .kpi-grid { grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .card { padding: 12px; }
    .kpi-value { font-size: 18px; margin-top: 2px; }
    .compact-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .compact-row:last-child { border-bottom: none; }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">Acme</div>
      <a href="#" class="active">Overview</a>
      <a href="#" data-depot-page="transactions">Transactions</a>
      <a href="#">Cards</a>
      <a href="#">Transfers</a>
      <a href="#">Settings</a>
    </aside>
    <main class="main">
      ${breadcrumb("Overview")}
      <div class="kpi-grid">
        <div class="card"><div class="kpi-label">Balance</div><div class="kpi-value">€12,438</div></div>
        <div class="card"><div class="kpi-label">Pending</div><div class="kpi-value">€1,204</div></div>
        <div class="card"><div class="kpi-label">Spend</div><div class="kpi-value">€2,847</div></div>
        <div class="card"><div class="kpi-label">Savings</div><div class="kpi-value">€48,200</div></div>
      </div>
      <div class="card">
        <strong style="font-size:13px;">Activity</strong>
        <div style="margin-top:8px;">
          <div class="compact-row"><span>Jun 02 · Uber</span><span>−€18.40</span></div>
          <div class="compact-row"><span>Jun 01 · Salary</span><span style="color:var(--positive);">+€3,200.00</span></div>
          <div class="compact-row"><span>May 31 · Carrefour</span><span>−€67.20</span></div>
          <div class="compact-row"><span>May 30 · Netflix</span><span>−€13.99</span></div>
          <div class="compact-row"><span>May 29 · Spotify</span><span>−€9.99</span></div>
        </div>
        <p style="margin-top:10px;font-size:13px;"><a href="#" data-depot-page="transactions" class="nav-link">All transactions &rarr;</a></p>
      </div>
    </main>
  </div>
</body>
</html>`;

const htmlTransactionsV1 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Transactions — Acme Banking</title>
  <style>${baseStyles("#6d28d9")}
    .shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 24px 16px; }
    .sidebar h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 20px 0 6px; }
    .sidebar a { display: block; padding: 8px 12px; border-radius: 6px; color: var(--text); margin-bottom: 2px; }
    .sidebar a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .sidebar a:hover { background: var(--subtle); text-decoration: none; }
    .main { padding: 32px; display: grid; gap: 16px; }
    .logo { font-weight: 800; font-size: 18px; color: var(--accent); margin-bottom: 12px; }
    .filters { display: flex; gap: 8px; align-items: center; }
    .filters input, .filters select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--surface); }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">Acme</div>
      <h3>Banking</h3>
      <a href="#" data-depot-page="overview">Overview</a>
      <a href="#" class="active">Transactions</a>
      <a href="#">Cards</a>
      <a href="#">Transfers</a>
    </aside>
    <main class="main">
      ${breadcrumb("Transactions")}
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h1 style="margin:0;font-size:22px;">Transactions</h1>
        <button class="btn">Export CSV</button>
      </div>
      <div class="filters card">
        <input type="text" placeholder="Search merchant..." style="flex:1;" />
        <select><option>All categories</option><option>Groceries</option><option>Transport</option></select>
        <select><option>Last 30 days</option><option>Last 90 days</option></select>
        <button class="btn btn-ghost">Apply</button>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th style="text-align:right;">Amount</th></tr></thead>
          <tbody>
            <tr><td>Jun 02</td><td>Uber</td><td>Transport</td><td>Checking</td><td style="text-align:right;">−€18.40</td></tr>
            <tr><td>Jun 01</td><td>Salary — Acme Corp</td><td>Income</td><td>Checking</td><td style="text-align:right;color:var(--positive);">+€3,200.00</td></tr>
            <tr><td>May 31</td><td>Carrefour</td><td>Groceries</td><td>Checking</td><td style="text-align:right;">−€67.20</td></tr>
            <tr><td>May 30</td><td>Netflix</td><td>Entertainment</td><td>Checking</td><td style="text-align:right;">−€13.99</td></tr>
            <tr><td>May 29</td><td>Spotify</td><td>Entertainment</td><td>Checking</td><td style="text-align:right;">−€9.99</td></tr>
            <tr><td>May 28</td><td>SNCF</td><td>Transport</td><td>Checking</td><td style="text-align:right;">−€142.00</td></tr>
            <tr><td>May 27</td><td>Amazon</td><td>Shopping</td><td>Credit</td><td style="text-align:right;">−€39.95</td></tr>
            <tr><td>May 26</td><td>Cafe Oz</td><td>Restaurants</td><td>Checking</td><td style="text-align:right;">−€24.50</td></tr>
          </tbody>
        </table>
      </div>
      <p style="color:var(--muted);font-size:13px;"><a href="#" data-depot-page="overview" class="nav-link">&larr; Back to overview</a></p>
    </main>
  </div>
</body>
</html>`;

const htmlSignup = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sign up — Acme Banking</title>
  <style>${baseStyles("#2563eb")}
    .shell { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; }
    .hero { background: linear-gradient(135deg, #1e3a8a, #2563eb); color: white; padding: 48px; display: flex; flex-direction: column; justify-content: space-between; }
    .hero h1 { font-size: 36px; margin: 0; font-weight: 800; letter-spacing: -0.02em; }
    .hero p { font-size: 16px; opacity: 0.85; max-width: 360px; }
    .hero .feature { font-size: 14px; opacity: 0.85; margin-bottom: 12px; }
    .hero .feature::before { content: "✓"; margin-right: 8px; }
    .form-side { padding: 48px; display: flex; flex-direction: column; justify-content: center; }
    .form-side h2 { margin: 0 0 4px; font-size: 22px; }
    .form-side p.sub { margin: 0 0 24px; color: var(--muted); font-size: 14px; }
    form { display: grid; gap: 12px; max-width: 380px; }
    label { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    input {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      background: var(--surface);
    }
    .field { display: grid; gap: 4px; }
    .legal { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .btn { width: 100%; padding: 12px; font-size: 14px; }
    .login-prompt { margin-top: 16px; font-size: 13px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div>
        <div style="font-weight:800;font-size:20px;">Acme Banking</div>
      </div>
      <div>
        <h1>Banking that respects you.</h1>
        <p>Open an account in 4 minutes — no paperwork, no waiting room, no fees on the first year.</p>
        <div style="margin-top:24px;">
          <div class="feature">€0 monthly fee, first year</div>
          <div class="feature">PSD2-compliant from day one</div>
          <div class="feature">Free transfers across the EU</div>
        </div>
      </div>
      <div style="font-size:12px;opacity:0.7;">© Acme Banking · BIN 437200 · Regulated by ACPR</div>
    </div>
    <div class="form-side">
      ${breadcrumb("Sign up")}
      <div style="margin-top:24px;">
        <h2>Create your account</h2>
        <p class="sub">You will need a valid ID and 4 minutes.</p>
        <form>
          <div class="field"><label>Email</label><input type="email" placeholder="jane@acme.co" required /></div>
          <div class="field"><label>Password</label><input type="password" placeholder="At least 12 characters" required /></div>
          <div class="field"><label>Date of birth</label><input type="date" required /></div>
          <div class="field"><label>Phone number</label><input type="tel" placeholder="+33 6 12 34 56 78" required /></div>
          <p class="legal">By continuing, you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.</p>
          <button type="submit" class="btn">Continue to identity check</button>
        </form>
        <p class="login-prompt">Already a customer? <a href="#" data-depot-page="overview">Sign in instead &rarr;</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;

// ── Insertion helpers ────────────────────────────────────────────────────────

const findPrototypeBySlug = (prdRevisionId: string, slug: string) => {
  const row = client
    .query<{ id: string }, [string, string]>(
      "SELECT id FROM prd_prototypes WHERE prd_revision_id = ? AND slug = ?",
    )
    .get(prdRevisionId, slug);
  return row?.id ?? null;
};

const insertPrototype = (prdRevisionId: string, slug: string, description: string) => {
  const id = generateId();
  db.insert(schema.prdPrototypes)
    .values({
      id,
      prdRevisionId,
      slug,
      description,
      createdAt: new Date(NOW - 3 * DAY),
    })
    .run();
  return id;
};

const insertPage = (
  prototypeId: string,
  slug: string,
  title: string,
  position: number,
  createdAtMs: number,
) => {
  const id = generateId();
  db.insert(schema.prdPrototypePages)
    .values({
      id,
      prototypeId,
      slug,
      title,
      position,
      createdAt: new Date(createdAtMs),
    })
    .run();
  return id;
};

const insertVersion = (
  pageId: string,
  label: string,
  summary: string | null,
  createdAtMs: number,
  archivedAtMs: number | null = null,
) => {
  const id = generateId();
  db.insert(schema.prdPrototypePageVersions)
    .values({
      id,
      pageId,
      label,
      summary,
      createdAt: new Date(createdAtMs),
      archivedAt: archivedAtMs === null ? null : new Date(archivedAtMs),
    })
    .run();
  return id;
};

const insertVariant = (
  pageVersionId: string,
  label: string,
  title: string,
  htmlContent: string,
  isMain: boolean,
  position: number,
  createdAtMs: number,
) => {
  const id = generateId();
  db.insert(schema.prdPrototypeVariants)
    .values({
      id,
      pageVersionId,
      label,
      title,
      htmlContent,
      isMain,
      position,
      createdAt: new Date(createdAtMs),
    })
    .run();
  return id;
};

type FeedbackInput = {
  variantId: string;
  text: string;
  selectorCss?: string | null;
  status?: "open" | "ignored";
  resolutionNote?: string | null;
  resolutionViaVariantId?: string | null;
  resolvedAtMs?: number | null;
  ignoredReason?: string | null;
  ignoredAtMs?: number | null;
  createdAtMs: number;
};

const insertFeedback = (input: FeedbackInput) => {
  const id = generateId();
  db.insert(schema.prdPrototypeFeedback)
    .values({
      id,
      variantId: input.variantId,
      text: input.text,
      selectorCss: input.selectorCss ?? null,
      status: input.status ?? "open",
      resolutionNote: input.resolutionNote ?? null,
      resolutionViaVariantId: input.resolutionViaVariantId ?? null,
      resolvedAt:
        input.resolvedAtMs === undefined || input.resolvedAtMs === null
          ? null
          : new Date(input.resolvedAtMs),
      ignoredReason: input.ignoredReason ?? null,
      ignoredAt:
        input.ignoredAtMs === undefined || input.ignoredAtMs === null
          ? null
          : new Date(input.ignoredAtMs),
      createdAt: new Date(input.createdAtMs),
    })
    .run();
  return id;
};

const insertRound = (
  prototypeId: string,
  label: string,
  summary: string | null,
  position: number,
  createdAtMs: number,
) => {
  const id = generateId();
  db.insert(schema.prdPrototypeRounds)
    .values({
      id,
      prototypeId,
      label,
      summary,
      position,
      createdAt: new Date(createdAtMs),
    })
    .run();
  return id;
};

const insertRoundPage = (
  roundId: string,
  pageId: string,
  pageVersionId: string,
  position: number,
  createdAtMs: number,
) => {
  const id = generateId();
  db.insert(schema.prdPrototypeRoundPages)
    .values({
      id,
      roundId,
      pageId,
      pageVersionId,
      position,
      createdAt: new Date(createdAtMs),
    })
    .run();
  return id;
};

const created: string[] = [];
const skipped: string[] = [];

// ── Prototype A: dashboard-redesign ──────────────────────────────────────────

const slugA = "dashboard-redesign";
let prototypeAId = findPrototypeBySlug(target.id, slugA);
if (prototypeAId) {
  skipped.push(slugA);
  console.log(`[seed-prototype] skip: prototype "${slugA}" already exists (${prototypeAId})`);
} else {
  prototypeAId = insertPrototype(
    target.id,
    slugA,
    "Multi-page redesign of the post-login dashboard — overview + transactions.",
  );
  created.push(slugA);

  const pageOverviewId = insertPage(prototypeAId, "overview", "Overview", 0, NOW - 3 * DAY);
  const verOverviewV1Id = insertVersion(
    pageOverviewId,
    "iter-1",
    "First mockup, sidebar layout",
    NOW - 3 * DAY,
    NOW - 1 * DAY,
  );
  const variantOverviewV1SidebarId = insertVariant(
    verOverviewV1Id,
    "with-sidebar",
    "Sidebar layout",
    htmlOverviewV1Sidebar,
    true,
    0,
    NOW - 3 * DAY,
  );
  const variantOverviewV1TopNavId = insertVariant(
    verOverviewV1Id,
    "top-nav",
    "Top navigation layout",
    htmlOverviewV1TopNav,
    false,
    1,
    NOW - 3 * DAY + 2 * HOUR,
  );

  const verOverviewV2Id = insertVersion(
    pageOverviewId,
    "iter-2",
    "After 2 rounds of feedback",
    NOW - 1 * DAY,
  );
  const variantOverviewV2SidebarId = insertVariant(
    verOverviewV2Id,
    "with-sidebar",
    "Sidebar layout — refined",
    htmlOverviewV2Sidebar,
    true,
    0,
    NOW - 1 * DAY,
  );
  insertVariant(
    verOverviewV2Id,
    "compact",
    "Compact dense layout",
    htmlOverviewV2Compact,
    false,
    1,
    NOW - 1 * DAY + 1 * HOUR,
  );

  const pageTransactionsId = insertPage(
    prototypeAId,
    "transactions",
    "Transactions",
    1,
    NOW - 2 * DAY,
  );
  const verTransactionsV1Id = insertVersion(pageTransactionsId, "iter-1", null, NOW - 2 * DAY);
  insertVariant(
    verTransactionsV1Id,
    "default",
    "Default layout",
    htmlTransactionsV1,
    true,
    0,
    NOW - 2 * DAY,
  );

  // Open actionable feedbacks on overview/v2/with-sidebar.
  insertFeedback({
    variantId: variantOverviewV2SidebarId,
    text: "The 'Premium' pill next to the greeting feels promotional — can we move it next to the avatar in the user card instead?",
    selectorCss: ".page-title .pill",
    createdAtMs: NOW - 6 * HOUR,
  });
  insertFeedback({
    variantId: variantOverviewV2SidebarId,
    text: "Spend KPI says '+12% vs 6-month average' in red — that reads as alarming. Either drop the colour or pick a softer copy.",
    createdAtMs: NOW - 4 * HOUR,
  });
  insertFeedback({
    variantId: variantOverviewV2SidebarId,
    text: "Add a 'last updated at' timestamp under the KPIs so the user knows the data is fresh.",
    createdAtMs: NOW - 2 * HOUR,
  });

  // Resolved derived (open on a non-latest version of overview).
  insertFeedback({
    variantId: variantOverviewV1SidebarId,
    text: "Sidebar feels cramped at 220px — increase it to ~240 and add spacing between sections.",
    selectorCss: ".sidebar",
    resolutionNote:
      "Widened sidebar to 240px, added section dots and a user card at the bottom in v2.",
    resolutionViaVariantId: variantOverviewV2SidebarId,
    resolvedAtMs: NOW - 1 * DAY - 2 * HOUR,
    createdAtMs: NOW - 2 * DAY - 6 * HOUR,
  });
  insertFeedback({
    variantId: variantOverviewV1SidebarId,
    text: "Need a friendlier greeting at the top — something like 'Good morning, Jane' — not just a KPI grid.",
    resolutionNote: "Added greeting + premium pill + descriptive subtitle in v2.",
    resolutionViaVariantId: variantOverviewV2SidebarId,
    resolvedAtMs: NOW - 1 * DAY - 1 * HOUR,
    createdAtMs: NOW - 2 * DAY - 4 * HOUR,
  });

  // Ignored on overview/v1/top-nav.
  insertFeedback({
    variantId: variantOverviewV1TopNavId,
    text: "Top-nav layout would work better if we made the search bar global at the top right.",
    status: "ignored",
    ignoredReason:
      "We picked the sidebar layout as the canonical direction — the top-nav variant is being dropped.",
    ignoredAtMs: NOW - 1 * DAY - 4 * HOUR,
    createdAtMs: NOW - 2 * DAY - 2 * HOUR,
  });

  // Two whole-design rounds (PRD 0029). Round v1 pinned both pages (overview at
  // its iter-1 version, transactions at iter-1); round v2 iterated the overview
  // (pinning its iter-2 version) and DROPPED the transactions page. The
  // overview iter-2 variant still hard-codes a `data-depot-page="transactions"`
  // link (frozen HTML), so under the current round (v2) the web greys that link
  // out and shows the "removed from this round" notice on click — the
  // dropped-link demo. (Round labels stay v1/v2; the page versions they pin are
  // iter-1/iter-2 — versions are no longer surfaced to the human.)
  const roundAV1Id = insertRound(
    prototypeAId,
    "v1",
    "First whole-design round — overview + transactions.",
    0,
    NOW - 3 * DAY,
  );
  insertRoundPage(roundAV1Id, pageOverviewId, verOverviewV1Id, 0, NOW - 3 * DAY);
  insertRoundPage(roundAV1Id, pageTransactionsId, verTransactionsV1Id, 1, NOW - 2 * DAY);

  const roundAV2Id = insertRound(
    prototypeAId,
    "v2",
    "Second round — refined overview, transactions dropped from the design.",
    1,
    NOW - 1 * DAY,
  );
  insertRoundPage(roundAV2Id, pageOverviewId, verOverviewV2Id, 0, NOW - 1 * DAY);
  // transactions is intentionally absent from round v2's manifest = dropped.

  console.log(`[seed-prototype] created prototype A: ${prototypeAId}`);
}

// ── Prototype B: signup-flow ─────────────────────────────────────────────────

const slugB = "signup-flow";
let prototypeBId = findPrototypeBySlug(target.id, slugB);
if (prototypeBId) {
  skipped.push(slugB);
  console.log(`[seed-prototype] skip: prototype "${slugB}" already exists (${prototypeBId})`);
} else {
  prototypeBId = insertPrototype(
    target.id,
    slugB,
    "Account creation flow — single-page baseline before adding KYC steps.",
  );
  created.push(slugB);

  const pageSignupId = insertPage(prototypeBId, "signup", "Sign up", 0, NOW - 3 * DAY);
  const verSignupV1Id = insertVersion(pageSignupId, "iter-1", null, NOW - 3 * DAY);
  insertVariant(verSignupV1Id, "default", "Default layout", htmlSignup, true, 0, NOW - 3 * DAY);

  const roundBV1Id = insertRound(
    prototypeBId,
    "v1",
    "Single-page baseline round.",
    0,
    NOW - 3 * DAY,
  );
  insertRoundPage(roundBV1Id, pageSignupId, verSignupV1Id, 0, NOW - 3 * DAY);

  console.log(`[seed-prototype] created prototype B: ${prototypeBId}`);
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log("");
console.log("Summary:");
console.log(`  created: ${created.length === 0 ? "(none)" : created.join(", ")}`);
console.log(`  skipped: ${skipped.length === 0 ? "(none)" : skipped.join(", ")}`);
console.log("");
console.log("Open in the web UI:");
console.log(`  ✓ Prototype A: dashboard-redesign (rounds v1 + v2; v2 dropped 'transactions')`);
console.log(`    URL: http://localhost:4242/prds/${target.prdId}/prototype/dashboard-redesign`);
console.log(`    Demo: toggle nav-highlight, then click the 'transactions' link in overview`);
console.log(`          → it is greyed (dropped from current round v2) + shows the notice.`);
console.log(`  ✓ Prototype B: signup-flow`);
console.log(`    URL: http://localhost:4242/prds/${target.prdId}/prototype/signup-flow`);

client.close();
