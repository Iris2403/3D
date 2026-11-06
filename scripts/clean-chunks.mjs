// Removes previously built lazy chunks (kuki-*.js) so stale hashed files never ship.
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const dir = new URL('../theme/assets/', import.meta.url).pathname;
for (const f of readdirSync(dir)) if (/^kuki-.+\.js$/.test(f)) unlinkSync(join(dir, f));
