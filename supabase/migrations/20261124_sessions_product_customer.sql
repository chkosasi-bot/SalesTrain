-- =====================================================================
-- SalesTrain — relasi sesi simulasi ke produk & pelanggan
-- Idempoten: aman dijalankan berulang kali di Supabase SQL Editor.
-- Semua kolom baru nullable agar sesi lama (berbasis scenarios) tetap valid.
-- =====================================================================

alter table public.sessions
  add column if not exists own_product_id uuid references public.own_products (id) on delete set null;

alter table public.sessions
  add column if not exists customer_id uuid references public.customers (id) on delete set null;

-- Fokus skenario: initial_offer | price_negotiation | bonus_terms | competitor_h2h
alter table public.sessions
  add column if not exists scenario_focus text;

-- Tingkat tantangan persona: standard | tough
alter table public.sessions
  add column if not exists challenge_mode text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_scenario_focus_check') then
    alter table public.sessions
      add constraint sessions_scenario_focus_check
      check (scenario_focus is null or scenario_focus in ('initial_offer', 'price_negotiation', 'bonus_terms', 'competitor_h2h'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_challenge_mode_check') then
    alter table public.sessions
      add constraint sessions_challenge_mode_check
      check (challenge_mode is null or challenge_mode in ('standard', 'tough'));
  end if;
end $$;

-- Indeks untuk status kelulusan per pelanggan & riwayat per produk.
create index if not exists sessions_user_customer_idx on public.sessions (user_id, customer_id, status);
create index if not exists sessions_own_product_idx on public.sessions (own_product_id);
