-- Memória permanente do assistente de voz (Simão): fatos e preferências que o
-- usuário pede para lembrar. Cada usuário só enxerga e altera a própria memória.
create table if not exists public.assistant_memory (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists assistant_memory_user_idx on public.assistant_memory (user_id, created_at desc);
alter table public.assistant_memory enable row level security;
create policy assistant_memory_select on public.assistant_memory for select to authenticated using ((select auth.uid()) = user_id);
create policy assistant_memory_insert on public.assistant_memory for insert to authenticated with check ((select auth.uid()) = user_id);
create policy assistant_memory_update on public.assistant_memory for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy assistant_memory_delete on public.assistant_memory for delete to authenticated using ((select auth.uid()) = user_id);

-- Visitantes sem login não precisam enxergar a tabela.
revoke all on table public.assistant_memory from anon;
