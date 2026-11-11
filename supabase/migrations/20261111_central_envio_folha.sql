-- YOETZ · Central de Envio de Folha (Departamento Pessoal -> WhatsApp)
-- Drive: Departamento Pessoal / {Competência} / {Cliente} / arquivos  (+ subpasta "Enviadas")
-- Só cria objetos novos (prefixo dp_). Não altera nenhuma tabela existente do app.

do $$ begin
  create type dp_tipo_documento as enum
    ('FOLHA','RECIBO','FGTS','INSS_DARF','GUIA','PROLABORE','FERIAS','RESCISAO','OUTROS');
exception when duplicate_object then null; end $$;
do $$ begin
  create type dp_status_documento as enum ('pronto','enviando','enviado','lido','falhou','ignorado');
exception when duplicate_object then null; end $$;
do $$ begin
  create type dp_status_envio as enum ('fila','enviado','entregue','lido','falhou');
exception when duplicate_object then null; end $$;

-- Configuração única do módulo (dono do escritório + pasta raiz no Drive)
create table if not exists public.dp_config (
  id                   int primary key default 1 check (id = 1),
  owner_id             uuid not null,
  drive_root_folder_id text not null,
  drive_root_nome      text,
  updated_at           timestamptz not null default now()
);

create or replace function public.dp_owner() returns uuid
language sql stable security definer set search_path = public as
$$ select owner_id from public.dp_config where id = 1 $$;

-- Pasta do Drive -> cliente (aprendido uma vez, vale para todos os meses)
create table if not exists public.dp_vinculos (
  pasta_norm  text primary key,
  pasta_nome  text not null,
  client_id   text not null references public.clients(id) on delete cascade,
  confirmado  boolean not null default false,   -- sugestões automáticas por nome exigem confirmação
  origem      text not null default 'manual',   -- manual | cnpj | nome | sugestao
  owner_id    uuid not null default public.dp_owner(),
  created_at  timestamptz not null default now()
);

-- Quem recebe a folha de cada cliente
create table if not exists public.dp_contatos (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null references public.clients(id) on delete cascade,
  nome          text not null,
  whatsapp      text not null check (whatsapp ~ '^55[0-9]{10,11}$'),
  papel         text default 'financeiro',
  recebe_folha  boolean not null default true,
  ativo         boolean not null default true,
  owner_id      uuid not null default public.dp_owner(),
  created_at    timestamptz not null default now()
);
create index if not exists dp_contatos_client_idx on public.dp_contatos(client_id);

create table if not exists public.dp_competencias (
  competencia        date primary key,
  drive_folder_id    text unique not null,
  drive_folder_nome  text,
  sincronizado_em    timestamptz,
  owner_id           uuid not null default public.dp_owner(),
  created_at         timestamptz not null default now()
);

create table if not exists public.dp_documentos (
  id                   uuid primary key default gen_random_uuid(),
  competencia          date not null references public.dp_competencias(competencia) on delete cascade,
  client_id            text references public.clients(id) on delete set null,
  pasta_cliente_nome   text not null,
  pasta_cliente_norm   text not null,
  em_enviadas          boolean not null default false,
  drive_file_id        text unique not null,
  nome_arquivo         text not null,
  mime_type            text,
  tamanho_bytes        bigint,
  md5                  text,
  drive_modified_at    timestamptz,
  tipo                 dp_tipo_documento not null default 'OUTROS',
  tipo_manual          boolean not null default false,
  status               dp_status_documento not null default 'pronto',
  enviado_manual       boolean not null default false,
  alterado_apos_envio  boolean not null default false,
  rodada_em            timestamptz,
  ultimo_envio_em      timestamptz,
  owner_id             uuid not null default public.dp_owner(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists dp_documentos_comp_idx  on public.dp_documentos(competencia, client_id);
create index if not exists dp_documentos_pasta_idx on public.dp_documentos(pasta_cliente_norm);

-- Registro de envios (substitui o caderno)
create table if not exists public.dp_envios (
  id              uuid primary key default gen_random_uuid(),
  documento_id    uuid not null references public.dp_documentos(id) on delete cascade,
  contato_id      uuid references public.dp_contatos(id) on delete set null,
  canal           text not null default 'whatsapp' check (canal in ('whatsapp','manual')),
  whatsapp        text,
  wa_message_id   text unique,
  status          dp_status_envio not null default 'fila',
  erro            text,
  enviado_em      timestamptz,
  entregue_em     timestamptz,
  lido_em         timestamptz,
  usuario_id      uuid default auth.uid(),
  owner_id        uuid not null default public.dp_owner(),
  created_at      timestamptz not null default now()
);
create index if not exists dp_envios_doc_idx on public.dp_envios(documento_id);

create table if not exists public.dp_respostas (
  id            uuid primary key default gen_random_uuid(),
  contato_id    uuid references public.dp_contatos(id) on delete set null,
  whatsapp      text not null,
  nome_perfil   text,
  texto         text,
  wa_message_id text unique,
  recebido_em   timestamptz not null default now(),
  owner_id      uuid not null default public.dp_owner()
);

-- Status do documento = melhor status dos envios da rodada atual
create or replace function public.dp_atualiza_status_documento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rodada timestamptz; v_status dp_status_documento;
begin
  select rodada_em into v_rodada from dp_documentos where id = new.documento_id;
  select case
           when count(*) = 0                              then null
           when bool_or(status = 'lido')                  then 'lido'
           when bool_or(status in ('enviado','entregue')) then 'enviado'
           when bool_and(status = 'falhou')               then 'falhou'
           else 'enviando'
         end::dp_status_documento
    into v_status
    from dp_envios
   where documento_id = new.documento_id and (v_rodada is null or created_at >= v_rodada);
  if v_status is not null then
    update dp_documentos
       set status = v_status,
           enviado_manual = (new.canal = 'manual' and v_status = 'enviado'),
           ultimo_envio_em = coalesce(new.enviado_em, ultimo_envio_em),
           updated_at = now()
     where id = new.documento_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_dp_envios_status on public.dp_envios;
create trigger trg_dp_envios_status after insert or update of status on public.dp_envios
  for each row execute function public.dp_atualiza_status_documento();

-- Ao vincular (ou trocar) a pasta, os documentos dela passam a apontar para o cliente
create or replace function public.dp_aplica_vinculo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update dp_documentos set client_id = new.client_id, updated_at = now()
   where pasta_cliente_norm = new.pasta_norm and client_id is distinct from new.client_id;
  return new;
end $$;
drop trigger if exists trg_dp_vinculos_aplica on public.dp_vinculos;
create trigger trg_dp_vinculos_aplica after insert or update of client_id on public.dp_vinculos
  for each row execute function public.dp_aplica_vinculo();

create or replace function public.dp_remove_vinculo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update dp_documentos set client_id = null, updated_at = now() where pasta_cliente_norm = old.pasta_norm;
  return old;
end $$;
drop trigger if exists trg_dp_vinculos_remove on public.dp_vinculos;
create trigger trg_dp_vinculos_remove after delete on public.dp_vinculos
  for each row execute function public.dp_remove_vinculo();

revoke execute on function public.dp_atualiza_status_documento() from public, anon, authenticated;
revoke execute on function public.dp_aplica_vinculo() from public, anon, authenticated;
revoke execute on function public.dp_remove_vinculo() from public, anon, authenticated;
revoke execute on function public.dp_owner() from public, anon;
grant execute on function public.dp_owner() to authenticated, service_role;

-- RLS: somente a equipe do escritório (mesma regra yoetz_team_ids() do restante do app)
alter table public.dp_config       enable row level security;
alter table public.dp_vinculos     enable row level security;
alter table public.dp_contatos     enable row level security;
alter table public.dp_competencias enable row level security;
alter table public.dp_documentos   enable row level security;
alter table public.dp_envios       enable row level security;
alter table public.dp_respostas    enable row level security;

drop policy if exists dp_config_team_read on public.dp_config;
create policy dp_config_team_read on public.dp_config for select to authenticated
  using (owner_id in (select public.yoetz_team_ids()));

do $$
declare t text;
begin
  foreach t in array array['dp_vinculos','dp_contatos','dp_competencias','dp_documentos','dp_envios','dp_respostas'] loop
    execute format('drop policy if exists %I on public.%I', t||'_team', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (owner_id in (select public.yoetz_team_ids()))
                      with check (owner_id in (select public.yoetz_team_ids()))', t||'_team', t);
  end loop;
end $$;
