-- =============================================================================
-- TiffinOps — Subscription changes now route through approval_requests
--
-- IMPORTANT: Postgres will not let a brand-new enum value be *used* in the
-- same transaction that adds it ("unsafe use of new value ... enum values
-- must be committed before they can be used"). The Supabase SQL Editor runs
-- everything you paste in as one transaction, so this migration is split
-- into two STEPs — run Step 1, wait for it to finish, then run Step 2 as a
-- separate query execution (a fresh "Run" click, or a new query tab).
-- =============================================================================

-- ── Step 1 — run this alone first, then click Run ───────────────────────────
-- A backdated subscription/meal-pause change is monetary (it can retroactively
-- change an already-issued invoice), so it needs its own target value on the
-- existing approval_requests table.

alter type public.approval_target add value if not exists 'subscription';

-- ── Step 2 — run this separately, after Step 1 has committed ────────────────
-- Owner policy: subscription-type requests may only be resolved by the owner —
-- narrower than the owner-or-manager convention every other request type
-- uses. (The application layer already enforces this; this RLS update makes
-- the database enforce it too, in case anything ever bypasses the service
-- role's app-level check.)

drop policy if exists "owners and managers can resolve approval_requests" on public.approval_requests;
create policy "owners and managers can resolve approval_requests"
  on public.approval_requests for update
  using (
    case
      when target_table = 'subscription' then public.has_role(array['owner']::user_role[])
      else public.has_role(array['owner','manager']::user_role[])
    end
  );
