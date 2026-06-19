# TiffinOps — Project Specification

**Client:** Apna Chulha Restaurant LLC, Dubai
**Owner contact:** Tabrez · +971 50 225 5710 · orders@apnachulha.com
**Build stack:** Next.js (App Router) · React · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres + Auth + Realtime + Storage)
**Deploy target:** Vercel (frontend) · Supabase Cloud (backend)
**Timezone:** Asia/Dubai (UTC+4). All "today" computations use Dubai time.
**Currency:** AED. Money stored as `numeric(12,2)`. Never floats.

---

## 1. Locked decisions (do not revisit during build)

| # | Decision | Value |
|---|----------|-------|
| 1 | Multi-user web app, single shared database | Yes |
| 2 | Authentication | Google OAuth only, admin approval required |
| 3 | Ledger as source of truth for balances | Yes — balances never stored, always computed |
| 4 | A la carte billing model | Credit accumulation, settle on salary day |
| 5 | Billing day | Per-customer field, defaults to company's day, falls back to 26th |
| 6 | Order meal tag at entry | Required (breakfast / lunch / dinner) — drives packing AND statements |
| 7 | WhatsApp orders | Staff manually enter (no auto-integration in v1) |
| 8 | Approvals required | Both DELETES and EDITS by Data Entry executives |
| 9 | Payment reference required | Bank, cheque, online — yes; cash, card — optional |
| 10 | Overpayment | Allowed; becomes customer credit balance |
| 11 | Payment void/delete | Owner only |
| 12 | Skip-delivery reason | Required (pick from list); optional free-text note |
| 13 | Audit captured on every order/payment/delivery | createdAt + createdBy + (updatedAt + updatedBy on edits) |
| 14 | Realtime sync across devices | Yes (Supabase Realtime) |

## 2. Roles

- **Owner** — everything. Only role that can void payments, manage users, change settings, hard-delete records.
- **Manager** — operational + financial reads, can resolve approvals, can edit anything except settings/users.
- **Data Entry** — can add customers and orders. Can request edits/deletes (goes to approval queue). Cannot see financial totals unless overridden.
- **Accounts** — record payments, view invoices/statements/ledger. Cannot change menu or operational data.
- **Viewer** — read-only dashboards and reports.

Per-user override flags on `users` table can grant extras (e.g. give a specific Data Entry user `can_record_payment = true`).

## 3. Core entities and relationships

```
users ─ (created_by) ─> customers, orders, payments, ...
companies ──< customers ──< orders ──< order_items
                       ──< customer_subscriptions ──> fixed_plans
                       ──< deliveries
                       ──< invoices ──< invoice_items
                       ──< payments
                       ──< ledger_entries  (computed balance = Σ debit − Σ credit)
                       ──< approval_requests (delete or edit)
menu_items (meal_period tag)
daily_menus / daily_menu_items (optional per-day overrides)
audit_logs (system trail)
app_settings (single row org config)
```

## 4. Ledger rules — non-negotiable

The customer ledger is the **only** place balances live. UI never reads a `balance` column; it reads `customer_balances` view which sums the ledger.

### What posts a debit (customer owes money)
- A confirmed order with `is_credit = true` (statement-cycle order). Auto-posted by trigger.
- A monthly fixed-menu invoice. Posted when invoice is issued.
- An ad-hoc adjustment by Owner ("correction: missed June 5 entry").

### What posts a credit (customer gave money or got relief)
- A recorded payment (any mode). Auto-posted by trigger.
- A goodwill discount applied to a statement.
- A refund issued.
- A write-off authorised by Owner.

### Reversals, not edits
A voided order or voided payment creates a **new** opposing ledger entry that references the original via `reversal_of`. Ledger rows are never updated or deleted. This makes the audit trail bulletproof.

### Anti-double-posting rule
Orders post to the ledger directly. Statements (a la carte cycle summary) are **descriptive** — they do NOT re-post a debit if the underlying orders are already there. This avoids the double-counting trap.

For fixed-menu customers, the monthly invoice IS the only debit (no per-meal orders exist).

For hybrid customers (fixed plan + extra orders): the fixed-monthly invoice posts a debit; each extra a la carte order posts its own debit; payments credit against the total balance.

## 5. The five screens that matter most

### A. Order Entry (data-entry executive's home screen)
1. Pick customer (or + New).
2. Pick meal period (Breakfast / Lunch / Dinner) — mandatory.
3. Tap items from the meal's menu. Each tap is a stepper, almost zero typing.
4. Choose Credit (goes on month bill) or Paid-now.
5. Save → writes `orders` + `order_items` (transaction). Trigger posts ledger debit if credit.

### B. Packing
Filters by meal. Two views off one button:
- **Kitchen totals** — item × total quantity to prepare.
- **Packing list** — one card per customer with location, time created, executive name, order ID, items.

"Send to Packing Team" generates a WhatsApp-ready summary of that meal's orders.

### C. Deliveries (fixed-menu sweep)
Today's fixed-menu subscriptions listed. Statuses: pending → out → delivered, plus skipped (requires reason from list + optional note). Every status change captures who/when. Bulk action: "all pending → out". Send-to-driver sends the sweep on WhatsApp.

### D. Payments + Ledger
Record payment from any customer in any mode. Modal calculates live: "balance before − payment = remaining / settled / overpaid (credit)." Quick-amount chips for Half / Full / common amounts. Reference number enforced for bank/cheque/online. Saves into `payments` + auto-posts ledger credit. Ledger table shows the full history per customer.

### E. A La Carte Monthly Bill
For each customer, day-by-day meal-by-meal breakdown of the billing cycle. Built from `orders` filtered by customer + date range. Skipped days show "no order" (with reason if available from deliveries). Footer totals + WhatsApp / PDF / Record Payment actions.

## 6. Order audit & approvals workflow

### On entry (every order)
- `created_at`, `created_by` captured automatically.
- Order ID generated: `AC-A-{YYMMDD}-{seq}`.

### Executive wants to edit a non-delivered order
- Allowed directly if `created_by = self` and status is not delivered/voided (per RLS policy).
- The app records `updated_at` + `updated_by` for the audit trail.

### Executive wants to edit a delivered order, OR any order they didn't create
- App blocks direct write.
- Executive must submit an **edit approval request** with the proposed changes and a reason.
- Owner/Manager sees it in the Approvals queue.

### Executive wants to delete (= void)
- Always goes through approvals queue, even for their own orders.
- On approval: order status set to `voided`. Trigger posts a reversing ledger credit. Audit log line written.
- On rejection: order remains untouched.

### Owner/Manager
- Can edit/void anything directly. Audit log captures the before/after JSON.

### Payments
- Insert by Owner/Manager/Accounts. Once posted, void requires Owner only. No direct delete.

## 7. Realtime channels

Subscribe in the app to:
- `orders` table → live update on packing screen, dashboard KPI.
- `deliveries` table → live update on delivery screen, dashboard delivery list.
- `payments` and `ledger_entries` → live balance updates on payments screen.
- `approval_requests` → badge count on the Approvals nav button.

## 8. Number generation

Use a database sequence per prefix, atomic. App reads `nextval('orders_seq')` then formats with prefix + date. Avoids race conditions across simultaneous entries.

```sql
create sequence orders_seq;
create sequence payments_seq;
create sequence invoices_seq;
create sequence customers_seq;
```

Order number example: `AC-A-260613-00031` (prefix-date-seq).

## 9. Settings (single row table)

Editable by Owner only. Drives all prefixes, business name on PDF, currency symbol, default billing day, etc.

## 10. Non-goals for v1

- WhatsApp Business API integration (manual entry only)
- Online payment gateway
- Inventory / kitchen consumption / recipe costing
- Expense management, payroll, VAT filing, bank reconciliation
- Driver live tracking, route optimisation
- Customer-facing portal or self-order app
- Multi-branch
- Native mobile apps (PWA on mobile browser only)

## 11. Acceptance test list (run before going live)

1. Sign in with two different Google accounts, approve one as Owner, leave one as `pending` — confirm pending account is blocked.
2. Add a customer, place a breakfast order, see it on Packing → Breakfast.
3. Add a lunch order for same customer — verify both appear with correct meal tag, no cross-contamination on packing.
4. Open Payments, record AED 100 against that customer with balance AED 250 → balance shows 150 due, ledger has both debit (order) and credit (payment), `customer_balances` view returns 150.
5. Have a Data Entry user try to delete an order → confirm approval request appears in queue for Owner.
6. Owner approves → order goes voided, ledger shows reversing credit, balance recalculates.
7. On a second device, log in as Manager, change a menu price → first device sees update without refresh (realtime working).
8. Open monthly bill for a customer with 22 orders across June → all 22 appear, day-by-day, meal-by-meal, total matches sum of orders.
9. Skip a delivery with reason "Customer on leave" → reason persists, shows on the day in the bill view.
10. Generate June monthly invoices job (Owner action) → no duplicates if run twice (idempotent index protects).
