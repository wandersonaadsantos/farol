// Detector de leitura de credencial do aparelho: só registra, nunca bloqueia.
//
// A sessão headless roda com a conta do dono e o `Read` dela alcança o home inteiro. Este
// módulo não muda o que a sessão pode fazer nem o resultado da revisão: deixa no log que ela
// abriu um arquivo de credencial, para o dono medir se isso acontece antes de decidir trava.
//
// A lista é ANCORADA no home de propósito, e por isso não reaproveita o CAMINHO_SENSIVEL de
// lib/review-source/contract.js: aquele julga caminho relativo do PR e casa código comum
// (`src/credentials.js`, `test/.ssh/config`). Aqui um `.ssh` dentro do escopo materializado
// ou de um clone não é a pasta do aparelho, e não pode gerar aviso.
import os from 'node:os';
import path from 'node:path';
import { prPathFromRead } from './pr-scope.js';

const PASTAS_DE_CREDENCIAL = new Set(['.ssh', '.aws', '.gnupg']);
const PASTA_DE_PERFIL_CLAUDE = /^\.claude(?:$|[-_.])/;
const CREDENCIAL_DO_PERFIL = '.credentials.json';

// Windows e macOS não diferenciam caixa no caminho padrão: `.SSH` abre a mesma pasta.
const dobraCaixa = plataforma => plataforma === 'win32' || plataforma === 'darwin';

// PURA. O caminho como o sistema abriria, ou null quando ele não é absoluto. No Windows entram
// também o prefixo `\\?\` e o `/c/...` do Git Bash, que abrem o mesmo arquivo do `C:\...`.
function absoluto(caminho, plataforma) {
  if (typeof caminho !== 'string' || !caminho || caminho.includes('\0')) return null;
  if (plataforma !== 'win32') return path.posix.isAbsolute(caminho) ? path.posix.resolve(caminho) : null;
  const semPrefixo = caminho.replace(/^\\\\\?\\/, '').replace(/^\/([a-z])(?=\/)/i, '$1:');
  return /^[a-z]:[\\/]/i.test(semPrefixo) ? path.win32.resolve(semPrefixo) : null;
}

function segmentosSobOHome(alvo, home, plataforma) {
  const lib = plataforma === 'win32' ? path.win32 : path.posix;
  const dobra = dobraCaixa(plataforma) ? s => s.toLowerCase() : s => s;
  const rel = lib.relative(dobra(home), dobra(alvo));
  if (!rel || lib.isAbsolute(rel)) return null;
  const segmentos = rel.split(lib.sep);
  return segmentos[0] === '..' ? null : segmentos;
}

function ehPastaDePerfil(alvo, perfis, plataforma) {
  const lib = plataforma === 'win32' ? path.win32 : path.posix;
  const dobra = dobraCaixa(plataforma) ? s => s.toLowerCase() : s => s;
  const pasta = dobra(lib.dirname(alvo));
  return (Array.isArray(perfis) ? perfis : []).some((perfil) => {
    const dir = absoluto(perfil?.dir, plataforma);
    return !!dir && dobra(dir) === pasta;
  });
}

function credencialDoPerfil(segmentos, alvo, perfis, plataforma) {
  if (segmentos.at(-1) !== CREDENCIAL_DO_PERFIL) return false;
  return (segmentos.length === 2 && PASTA_DE_PERFIL_CLAUDE.test(segmentos[0])) || ehPastaDePerfil(alvo, perfis, plataforma);
}

// PURA. Devolve o caminho normalizado quando ele é credencial do aparelho, ou null.
// `perfis` é a lista claudeProfiles da config: a pasta de um perfil pode ter qualquer nome.
function caminhoSensivel(caminho, { home, plataforma = process.platform, perfis = [] } = {}) {
  const alvo = absoluto(caminho, plataforma), raiz = absoluto(home, plataforma);
  if (!alvo || !raiz) return null;
  const segmentos = segmentosSobOHome(alvo, raiz, plataforma);
  if (!segmentos) return null;
  const [primeiro, segundo] = segmentos;
  const dois = segmentos.length === 2;
  if (PASTAS_DE_CREDENCIAL.has(primeiro) || (primeiro === '.config' && segundo === 'gh')) return alvo;
  if (dois && primeiro === '.codex' && segundo === 'auth.json') return alvo;
  if (dois && primeiro === '.farol' && /credentials/i.test(segundo)) return alvo;
  return credencialDoPerfil(segmentos, alvo, perfis, plataforma) ? alvo : null;
}

// Por objeto de opções, que nasce e morre com a sessão: a mesma leitura repetida avisa uma vez.
const jaAvisadas = new WeakMap();

function primeiraVez(opts, caminho) {
  const chave = dobraCaixa(process.platform) ? caminho.toLowerCase() : caminho;
  if (!jaAvisadas.has(opts)) jaAvisadas.set(opts, new Set());
  const vistas = jaAvisadas.get(opts);
  if (vistas.has(chave)) return false;
  vistas.add(chave);
  return true;
}

// Medição não derruba sessão: qualquer falha aqui fica sem aviso e a sessão segue igual.
function avisarLeituraSensivel(engine, opts, block) {
  try {
    const caminho = caminhoSensivel(block.input?.file_path, { home: os.homedir(), perfis: engine.config?.claudeProfiles });
    if (!caminho) return;
    const review = engine.activeReviews?.get(opts.id);
    if (prPathFromRead(review?.scopeRoot, caminho) || !primeiraVez(opts, caminho)) return;
    const pr = review?.keys?.[0] || review?.pr?.key || 'sem PR';
    if (typeof engine.log === 'function') engine.log('WARN', `leitura sensível (${pr}): a sessão ${opts.id || '?'} abriu ${caminho}`);
  } catch { /* só observa */ }
}

export { caminhoSensivel, avisarLeituraSensivel };
