-- Adds customer identity and image-attachment metadata to the ticket log.
-- Safe to run on an existing database: every statement is idempotent.

alter table public.tickets add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.tickets add column if not exists customer_email text;
alter table public.tickets add column if not exists has_attachment boolean not null default false;
alter table public.tickets add column if not exists attachment_note text;

create index if not exists idx_tickets_user on public.tickets (user_id);

comment on column public.tickets.user_id is
  'The signed-in customer who raised the case, or null for a guest.';
comment on column public.tickets.attachment_note is
  'What the assistant read from an attached image. The image itself is not stored.';

-- Row level security stays enabled with no policies, so the anon and
-- publishable keys still cannot touch this table. The application reads and
-- writes it from the server with the service role key, and enforces "a
-- customer sees only their own cases" in the API layer, where the session is
-- known.
--
-- If you would rather push that rule into the database as well, this is the
-- policy to add — it is commented out because the app does not rely on it, and
-- an unused policy that looks load-bearing is worse than none:
--
--   create policy "customers read their own cases" on public.tickets
--     for select to authenticated using (user_id = auth.uid());

-- Granting an account agent access:
--
--   update auth.users
--      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"agent"}'::jsonb
--    where email = 'agent@example.com';
--
-- app_metadata is chosen deliberately: it is writable only by the service role,
-- whereas user_metadata can be edited by the user themselves and must never
-- carry a permission.
