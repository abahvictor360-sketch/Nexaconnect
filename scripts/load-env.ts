import fs from 'node:fs';
import dotenv from 'dotenv';

/** CLI scripts read .env.local first, then .env. Next.js does this itself. */
for (const file of ['.env.local', '.env']) {
  if (fs.existsSync(file)) dotenv.config({ path: file });
}
