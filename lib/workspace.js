// Leitura dos artefatos do workspace do Claude (highlights, dossiês por autor, log).
// Puro: lê arquivos de state e devolve estrutura, sem tocar no engine. Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR, LOG_FILE } from './paths.js';

// destaques (kudos) registrados em highlights.md, do mais novo pro mais antigo.
function parseHighlights() {
  let text = '';
  try { text = fs.readFileSync(path.join(STATE_DIR, 'highlights.md'), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^-\s+(.*)$/);
    if (!m) continue;
    const parts = m[1].split('·').map(s => s.trim());
    const entry = { date: null, author: null, ref: null, url: null, text: m[1] };
    if (parts.length >= 3) {
      entry.date = parts[0];
      entry.author = (parts[1] || '').replace(/^@/, '');
      const rest = parts.slice(2).join(' · ');
      const link = rest.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (link) { entry.ref = link[1]; entry.url = link[2]; }
      const sep = rest.indexOf('—');
      entry.text = sep >= 0 ? rest.slice(sep + 1).trim() : rest.replace(/\[([^\]]+)\]\(([^)]+)\)\s*/, '').trim();
    }
    out.push(entry);
  }
  return out.reverse();
}

// dossiês por autor (state/authors/<login>.md): histórico de reviews que fiz.
function parseTeam() {
  const dir = path.join(STATE_DIR, 'authors');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return []; }
  const team = [];
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const login = f.replace(/\.md$/, '');
    const title = text.match(/^#\s+(.+)$/m);
    const nameM = title ? title[1].match(/\(([^)]+)\)/) : null;
    const entries = [];
    const blocks = text.split(/^##\s+/m).slice(1);
    for (const b of blocks) {
      const lines = b.split(/\r?\n/);
      const head = lines[0].split('·').map(s => s.trim());
      entries.push({
        date: head[0] || '',
        ref: head[1] || '',
        verdict: head[2] || '',
        bullets: lines.slice(1).filter(l => l.trim().startsWith('-')).map(l => l.replace(/^\s*-\s*/, ''))
      });
    }
    team.push({ login, name: nameM ? nameM[1] : login, entries });
  }
  team.sort((a, b) => (b.entries[0] && b.entries[0].date || '').localeCompare(a.entries[0] && a.entries[0].date || ''));
  return team;
}

// últimas N linhas do log de falhas (fonte do diagnóstico).
function tailLog(lines = 300) {
  let text = '';
  try { text = fs.readFileSync(LOG_FILE, 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).slice(-lines);
}

export default { parseHighlights, parseTeam, tailLog };
export { parseHighlights, parseTeam, tailLog };
