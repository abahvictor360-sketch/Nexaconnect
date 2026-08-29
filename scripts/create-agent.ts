import './load-env';
import { createAgent } from '../lib/create-agent';

/**
 * Usage:  npm run create-agent -- agent@nexaconnect.ng 'a-long-passphrase'
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment. Run it
 * from a machine, never from the browser: the service role key bypasses row
 * level security.
 */
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npm run create-agent -- <email> '<password>'");
    process.exit(1);
  }

  const result = await createAgent({ email, password });
  console.log(
    `${result.promoted ? 'Promoted' : 'Created'} agent account ${result.email} (${result.userId}).`,
  );
  console.log('Sign in at /login, then open /agent.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
