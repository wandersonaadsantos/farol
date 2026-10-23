// Processo real para comprovar exclusão e recuperação após morte do dono.
import { acquire } from '../../lib/review-audit/lock.js';
let unlock;
process.on('message', () => { unlock?.(); process.exit(0); });
try {
  unlock = acquire(process.argv[2], 'run');
  if (process.send) process.send({ locked: true });
  else { process.stdout.write('locked'); process.exit(0); }
} catch {
  if (process.send) process.send({ locked: false });
  else process.exit(1);
}
