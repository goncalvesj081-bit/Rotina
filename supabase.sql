-- Rotina: sincronização entre aparelhos.
-- Cole tudo isto no Supabase (projeto Cadastro_Pontta) → SQL Editor → Run. Só precisa rodar uma vez.
-- Cria só coisas com o nome "rotina_"; não mexe em nada do Cadastro.

create table if not exists public.rotina_sync (
  code text primary key check (length(code) >= 12),
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Ninguém acessa a tabela direto: só pelas duas funções abaixo, sabendo o código.
alter table public.rotina_sync enable row level security;
revoke all on public.rotina_sync from anon, authenticated;

create or replace function public.rotina_get(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce((select data from rotina_sync where code = p_code), 'null'::jsonb);
$$;

create or replace function public.rotina_put(p_code text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(p_code) < 12 then raise exception 'codigo invalido'; end if;
  if pg_column_size(p_data) > 2000000 then raise exception 'dados grandes demais'; end if;
  insert into rotina_sync (code, data, updated_at) values (p_code, p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.rotina_get(text) from public;
revoke all on function public.rotina_put(text, jsonb) from public;
grant execute on function public.rotina_get(text) to anon, authenticated;
grant execute on function public.rotina_put(text, jsonb) to anon, authenticated;
