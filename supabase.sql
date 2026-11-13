-- Rotina: sincronização entre aparelhos (já aplicado no projeto Cadastro_Pontta).
-- Cada tarefa é uma linha; o código de sincronização é guardado só como hash sha256.
-- A tabela é fechada; o app só acessa pelas funções rotina_push / rotina_pull.

create table if not exists public.rotina_itens (
  conta text not null,                 -- sha256 do código de sincronização
  id text not null,
  data jsonb not null,
  upd bigint not null,                 -- carimbo de alteração vindo do aparelho (ms)
  del boolean not null default false,
  server_ts timestamptz not null default clock_timestamp(),
  primary key (conta, id)
);
create index if not exists rotina_itens_conta_ts on public.rotina_itens (conta, server_ts);
alter table public.rotina_itens enable row level security;
revoke all on public.rotina_itens from anon, authenticated;

create or replace function public.rotina_conta(p_code text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
$$;

-- envia alterações; o banco só aceita se for mais nova que a que já tem
create or replace function public.rotina_push(p_code text, p_items jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_conta text;
  v_n integer := 0;
  it jsonb;
begin
  if length(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')) < 12 then raise exception 'codigo invalido'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'formato invalido'; end if;
  if jsonb_array_length(p_items) > 1000 then raise exception 'itens demais'; end if;
  v_conta := rotina_conta(p_code);
  for it in select * from jsonb_array_elements(p_items) loop
    continue when it->>'id' is null or length(it->>'id') > 64 or pg_column_size(it) > 20000;
    insert into rotina_itens as r (conta, id, data, upd, del, server_ts)
    values (v_conta, it->>'id', it, coalesce((it->>'upd')::bigint, 0), coalesce((it->>'del')::boolean, false), clock_timestamp())
    on conflict (conta, id) do update
      set data = excluded.data, upd = excluded.upd, del = excluded.del, server_ts = clock_timestamp()
      where r.upd < excluded.upd;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- devolve o que mudou desde p_since (com folga de 10s para não perder nada)
create or replace function public.rotina_pull(p_code text, p_since timestamptz)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'now', clock_timestamp(),
    'items', coalesce((
      select jsonb_agg(data order by server_ts)
      from rotina_itens
      where conta = rotina_conta(p_code)
        and length(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')) >= 12
        and server_ts > coalesce(p_since, 'epoch'::timestamptz) - interval '10 seconds'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.rotina_conta(text) from public, anon, authenticated;
revoke all on function public.rotina_push(text, jsonb) from public;
revoke all on function public.rotina_pull(text, timestamptz) from public;
grant execute on function public.rotina_push(text, jsonb) to anon, authenticated;
grant execute on function public.rotina_pull(text, timestamptz) to anon, authenticated;
