// Cadastro privado por repositório, lido sem alterar o consumidor.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HOME } from '../paths.js';
import io from '../io.js';

const PROFILE_FILE = path.join(HOME, 'technical-review', 'repositories.json');

function profileFor(repo, file = PROFILE_FILE) {
  const read = io.lerJsonTeimoso(file);
  if (!read.ok) return null;
  const profile = read.data?.repositories?.[repo];
  if (!profile || !profile.declaration) return null;
  return { ...profile, fingerprint: createHash('sha256').update(io.safeStringify(profile)).digest('hex') };
}

export { PROFILE_FILE, profileFor };
