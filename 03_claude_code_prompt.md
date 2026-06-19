# Claude Code — Kickoff Prompt

Paste the prompt below into Claude Code after you've completed the Supabase setup in `03_setup_guide.md` (you should have a working Supabase project, your env vars filled in, and the schema migration already run).

---

You are building a production web application called **TiffinOps** for a Dubai restaurant called **Apna Chulha Restaurant LLC**. The owner is Tabrez. The complete specification is in `02_project_spec.md` and the database schema is in `01_schema.sql` — **read both files in full before you write any code.**

## Tech stack — non-negotiable

- Next.js 15+ with the App Router and TypeScript
- React Server Components for data fetching; Client Components only where interactivity is needed
- Tailwind CSS + shadcn/ui (install with `npx shadcn@latest init`, then add components as needed)
- Supabase: `@supabase/ssr` for auth in server actions/components, `@supabase/supabase-js` for Realtime in client components
- Recharts for dashboard charts
- date-fns + date-fns-tz for all date handling (timezone = `Asia/Dubai`)
- Zod for input validation on every server action
- `next/font` for fonts (no external font loads)

## Project structure

```
app/
  (auth)/login/page.tsx          Google sign-in
  (auth)/pending/page.tsx        "Access pending Admin approval"
  (app)/layout.tsx               Authenticated shell with nav
  (app)/page.tsx                 Dashboard (default landing)
  (app)/orders/new/page.tsx      Order entry
  (app)/packing/page.tsx         Packing reports
  (app)/deliveries/page.tsx      Today's deliveries
  (app)/customers/page.tsx       Customer list
  (app)/customers/[id]/page.tsx  Customer profile
  (app)/menu/page.tsx            Menu management
  (app)/payments/page.tsx        Payments + ledger
  (app)/bills/[customerId]/page.tsx  Monthly statement
  (app)/reports/page.tsx         Reports + exports
  (app)/approvals/page.tsx       Approval queue
  (app)/settings/page.tsx        App settings (Owner only)
  (app)/users/page.tsx           User management (Owner only)
  api/                           Route handlers if needed
components/
  ui/                            shadcn primitives
  app-shell/                     nav, header, user chip
  forms/                         OrderForm, PaymentForm, CustomerForm, etc
  tables/                        LedgerTable, OrderTable, etc
lib/
  supabase/server.ts             createServerClient
  supabase/client.ts             createBrowserClient
  supabase/types.ts              `supabase gen types typescript` output
  actions/                       server actions per domain (orders.ts, payments.ts, ...)
  auth.ts                        getCurrentUser, requireRole
  dates.ts                       Dubai-time helpers (today, fmtTime, etc)
  money.ts                       AED formatter, parseMoney
  audit.ts                       writeAuditLog helper
  realtime.ts                    useRealtime hook
middleware.ts                    auth gate; redirect unauthed to /login, pending to /pending
```

## Design language — match the prototype I'll provide

I have a working prototype HTML file in this folder called `tiffinops-prototype.html`. **Open it in the browser** and inspect each screen — every visual decision (colors, typography, spacing, status pills, modal patterns, the orange-cream-ember palette) is already finalised. Replicate it exactly using Tailwind + shadcn:

- Primary: saffron `#E76F2A` (CTA, active states)
- Accent: ember `#8B2E1F` (secondary)
- Surface: cream `#FBF6EE` (page bg), white (cards)
- Text: warm near-black `#221A13`, muted `#7C7063`
- Display font: Bricolage Grotesque, body: Inter
- Border radius: 10–14px on cards, 8–11px on buttons, 999px on status pills
- 48px minimum touch target on mobile

The prototype is opinionated. Don't redesign — re-implement.

## Build order — do not skip ahead

### Phase 1 — Foundation
1. Read `01_schema.sql` and `02_project_spec.md` completely.
2. Scaffold Next.js app, Tailwind, shadcn.
3. Set up `lib/supabase/*` with SSR helpers.
4. Generate types with `npx supabase gen types typescript --linked > lib/supabase/types.ts`.
5. Build `middleware.ts` enforcing auth.
6. Build login page with Google OAuth + pending-approval page.
7. Build the app shell: top bar, nav (matching the prototype's nav order), today's date pill, user chip.
8. **Stop and verify**: signing in works, an active user lands on `/`, a pending user lands on `/pending`.

### Phase 2 — Customers + Menu
9. Customer list page with search, filter chips, balance from `customer_balances` view.
10. Add-customer modal with all fields incl `billing_day` (defaulting to company's then 26).
11. Menu page with inline price editing (debounced server action), availability toggle, add-item modal.
12. **Verify**: add a customer, add a menu item, see them persist after refresh.

### Phase 3 — Orders
13. New Order screen exactly like the prototype: customer dropdown with +New, meal toggle, item grid with steppers, sticky summary, credit/paid-now toggle.
14. Server action `createOrder(input)`:
    - Validates with Zod
    - Generates order_number from sequence
    - Inserts `orders` + `order_items` in a transaction
    - Trigger handles ledger posting
    - Returns the new order ID
15. Recent-saved-today strip below the form.
16. **Verify**: save an order, see it persist; ledger debit appears for the customer.

### Phase 4 — Packing + Deliveries
17. Packing screen: tabs for meal periods, two-mode toggle (kitchen totals vs packing list), order cards with audit info (date, time, created_by).
18. "Send to Packing Team" generates a WhatsApp-friendly text and opens the share link.
19. Deliveries screen: row per fixed-menu subscription for today, status actions, skip modal with reason list + optional note. Audit captured.
20. Dashboard delivery pill becomes tap-to-cycle.
21. **Verify**: enter an order on phone, packing screen on laptop updates within 1 second (Realtime working).

### Phase 5 — Payments + Ledger
22. Payments page: KPIs, today's payments list, customers-with-balance list, customer ledger table.
23. Record Payment modal: customer dropdown showing balance, amount field, quick-amount chips (Half/Full), mode selector with conditional reference field, live preview of remaining-after-payment.
24. Server action `recordPayment(input)`:
    - Validates (reference required if mode in bank/cheque/online)
    - Generates payment_number
    - Inserts payment
    - Trigger posts ledger credit
25. **Verify**: half-payment shows remaining balance correctly in three places (toast, customer card, ledger).

### Phase 6 — Bills, Approvals, Reports
26. Monthly statement page: cycle picker, day-by-day meal breakdown from the orders table, totals, WhatsApp/PDF/Record-Payment actions. PDF via `@react-pdf/renderer`.
27. Approvals queue: list pending requests, approve/reject actions, audit log on resolution.
28. Reports page: 4 category cards (Sales / Payments / Customers / Operations) with CSV/Excel/PDF export per report. Use `papaparse` for CSV, `xlsx` for Excel.
29. **Verify**: monthly bill matches the prototype layout exactly; deletion approval flow round-trips correctly.

### Phase 7 — Polish + Deploy
30. Settings page (Owner only) for app_settings.
31. Users page (Owner only) for approving Google sign-ins and assigning roles.
32. Audit log viewer (Owner/Manager).
33. Mobile testing: every form one-handed usable, sticky save buttons, no horizontal scroll.
34. Run the 10-step acceptance test from `02_project_spec.md` section 11.
35. Deploy to Vercel. Add custom domain if Tabrez has one.

## Rules of engagement

- **Read the schema before writing any database query.** Don't invent fields.
- **Never store calculated balances.** Always compute from `ledger_entries` (use the `customer_balances` view).
- **Money is `numeric(12,2)`.** Use a decimal library or string handling — never JS floats for arithmetic.
- **Every date comparison uses Asia/Dubai.** "Today" at 02:00 UTC is yesterday in Dubai; account for it.
- **Every mutation is a server action** with Zod validation and role check (`requireRole(...)`).
- **Optimistic UI on writes** with rollback on failure; toast on success.
- **Realtime subscriptions** for: orders (packing screen), deliveries (delivery screen + dashboard pill), payments + ledger_entries (payments screen), approval_requests (nav badge).
- **Audit log** every: order create/edit/void, payment create/void, price change, role change, approval resolve, user activation.
- **Don't add features beyond the spec.** If you find a gap, stop and ask.

## Output expectations

- Production-quality TypeScript. No `any`. Strict mode on.
- Server Components by default. Client Components only when you need state, effects, or browser APIs.
- shadcn/ui components everywhere possible. Don't hand-roll a `<Button>` when one exists.
- Accessible: focus visible, ARIA labels on icon-only buttons, keyboard navigation.
- Mobile-first responsive at 360px, 768px, 1024px breakpoints.

## When you finish each phase

Stop. Print a summary of what was built. Wait for me to verify before continuing. The prototype is finalised but the codebase isn't — small UX gaps will surface during testing.

Start by reading `01_schema.sql` and `02_project_spec.md`, then confirm you understand the brief before writing code.
