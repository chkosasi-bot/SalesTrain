-- =====================================================================
-- SalesTrain — perbaikan "Database error creating new user"
-- Jalankan di Supabase Dashboard → SQL Editor.
--
-- Gejala: auth.admin.createUser / signInWithOtp untuk user BARU selalu gagal
-- (HTTP 500 "Database error creating/saving new user"). Penyebab paling umum:
-- trigger pada auth.users (mis. handle_new_user) yang error, misalnya karena
-- tidak memakai schema "public." / search_path, atau mengisi kolom yang tidak ada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- LANGKAH 1 — DIAGNOSA: lihat trigger buatan pengguna pada auth.users
-- beserta isi fungsinya. Jalankan ini dulu dan periksa hasilnya.
-- ---------------------------------------------------------------------
select
  t.tgname                         as trigger_name,
  p.oid::regprocedure              as function_name,
  pg_get_triggerdef(t.oid)         as trigger_def,
  pg_get_functiondef(p.oid)        as function_def
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal;

-- Detail error persisnya juga bisa dilihat di Dashboard → Logs → Postgres / Auth.

-- ---------------------------------------------------------------------
-- LANGKAH 2 — PERBAIKAN: fungsi sinkronisasi profil yang aman.
-- - security definer + search_path kosong + nama tabel lengkap (public.profiles)
-- - on conflict do nothing (aplikasi juga meng-upsert profil sendiri)
-- - error apa pun TIDAK membatalkan pendaftaran user (hanya warning di log)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, telegram_chat_id, telegram_username)
  values (
    new.id,
    case when new.email ilike '%@telegram.salestrain.local' then null else new.email end,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'telegram_chat_id', ''),
    nullif(new.raw_user_meta_data ->> 'telegram_username', '')
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user gagal untuk %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- LANGKAH 3 — Pasang ulang trigger.
-- PENTING: bila LANGKAH 1 menampilkan trigger dengan NAMA LAIN yang rusak,
-- hapus juga trigger tersebut, contoh:
--   drop trigger if exists <nama_trigger_rusak> on auth.users;
-- ---------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- (Opsional) Indeks untuk pencarian token & profil Telegram.
-- ---------------------------------------------------------------------
create unique index if not exists telegram_magic_links_token_key on public.telegram_magic_links (token);
create index if not exists telegram_magic_links_chat_created_idx on public.telegram_magic_links (telegram_chat_id, created_at desc);
create index if not exists profiles_telegram_chat_id_idx on public.profiles (telegram_chat_id);
