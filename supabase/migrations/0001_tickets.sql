-- NexaConnect AI Support Assistant — ticket log.
--
-- Run this once against a new Supabase project, either by pasting it into
-- SQL Editor → New query in the dashboard, or with:
--     supabase db push
--
-- The columns mirror the local SQLite schema exactly, so either driver can
-- back the same application with no code change.

create table if not exists public.tickets (
  id                  text primary key,
  conversation_id     text not null,
  message             text not null,
  reply               text not null,
  category            text not null,
  intent              text not null,
  sentiment           text not null,
  urgency             text not null,
  confidence          double precision not null,
  summary             text not null,
  kb_sources          jsonb not null default '[]'::jsonb,
  retrieved_chunks    jsonb not null default '[]'::jsonb,
  entities            jsonb not null default '{}'::jsonb,
  order_ref           text,
  order_found         boolean,
  order_status        text,
  order_value         double precision,
  contact_count       integer not null default 1,
  escalated           boolean not null default false,
  fired_rules         jsonb not null default '[]'::jsonb,
  route               text not null,
  sla_hours           double precision not null default 6,
  grounding_note      text,
  resolved            boolean not null default false,
  resolution_note     text,
  assigned_to         text,
  satisfaction        integer check (satisfaction is null or satisfaction between 1 and 4),
  satisfaction_reason text,
  latency_ms          integer not null default 0,

  -- A stored generated column, so the triage ordering is expressible through
  -- the REST client. It is the same ranking as the CASE expression the SQLite
  -- driver uses, kept in the database rather than duplicated in application
  -- code where the two could drift apart.
  urgency_rank        integer generated always as (
                        case urgency
                          when 'Critical' then 0
                          when 'High' then 1
                          when 'Medium' then 2
                          else 3
                        end
                      ) stored,

  -- Stable tie-break for rows written inside the same millisecond, standing in
  -- for SQLite's rowid. Without it, a seed run's ordering is arbitrary.
  seq                 bigint generated always as identity,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_tickets_created   on public.tickets (created_at desc, seq desc);
create index if not exists idx_tickets_triage    on public.tickets (resolved, urgency_rank, escalated, created_at desc);
create index if not exists idx_tickets_order_ref on public.tickets (order_ref);
create index if not exists idx_tickets_conv      on public.tickets (conversation_id);
create index if not exists idx_tickets_urgency   on public.tickets (urgency);
create index if not exists idx_tickets_category  on public.tickets (category);

-- Row level security on, with NO policies. That is deliberate: the anon and
-- publishable keys then cannot read or write this table at all. The app reaches
-- it only from the server, with the service role key, which bypasses RLS.
--
-- Do not disable this to "make it work" from the browser. If browser access is
-- ever needed, add an explicit policy for exactly what it should see.
alter table public.tickets enable row level security;

comment on table public.tickets is
  'Support tickets logged by the NexaConnect triage pipeline. Server-only access via the service role key; RLS is enabled with no policies by design.';
