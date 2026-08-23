-- HOUSEKEEPING — run this if you used the assistant-created project.
--
-- While wiring the Supabase driver, a temporary policy named
-- "temp_driver_verification" was added to public.tickets to try to exercise the
-- driver with the anon key from a sandbox that turned out to block Supabase
-- hosts. It grants anon full read and write on the table and MUST NOT remain.
--
-- This statement is safe to run whether or not the policy exists.

drop policy if exists "temp_driver_verification" on public.tickets;

-- Verify nothing is left behind. Expect zero rows.
--   select polname from pg_policies where tablename = 'tickets';
