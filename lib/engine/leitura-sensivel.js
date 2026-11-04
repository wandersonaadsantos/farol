// Detector de leitura de credencial do aparelho: só registra, nunca bloqueia.
//
// A sessão headless roda com a conta do dono e o `Read` dela alcança o home inteiro. Este
// módulo não muda o que a sessão pode fazer nem o resultado da revisão: deixa em
// medicoes-leitura.jsonl que ela abriu um arquivo de credencial, para o dono medir se isso
// acontece antes de decidir trava.
//
// A lista é ANCORADA no home de propósito, e por isso não reaproveita o CAMINHO_SENSIVEL de
// lib/review-source/contract.js: aquele julga caminho relativo do PR e casa código comum
// (`src/credentials.js`, `test/.ssh/config`). Aqui um `.ssh` dentro do escopo materializado
// ou de um clone não é a pasta do aparelho, e não pode gerar aviso.
//
// LIMITES: perfil do Claude com pasta fora do home não é coberto, porque a âncora é o home;
// só o `Read` entra (leitura por Bash não passa aqui); link simbólico só é seguido quando o
// caminho do Windows tem forma curta e precisa ser expandido.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prPathFromRead } from './pr-scope.js';
import { registrarMedicao } from './medicoes-leitura.js';

const PASTAS_DE_CREDENCIAL = new Set(['.ssh', '.aws', '.gnupg']);
const PASTA_DE_PERFIL_CLAUDE = /^\.claude(?:$|[-_.])/;
const CREDENCIAL_DO_PERFIL = '.credentials.json';
const CREDENCIAL_DO_GIT = '.git-credentials';
// Teto de caminhos distintos por sessão: sessão em laço não enche o arquivo de medições.
const TETO_DE_CAMINHOS = 50;

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

function partesDe(caminho, plataforma) {
  const lib = plataforma === 'win32' ? path.win32 : path.posix;
  const texto = dobraCaixa(plataforma) ? caminho.toLowerCase() : caminho;
  return texto.split(lib.sep).filter(Boolean);
}

// `wander~1` é a forma curta (8.3) de `wanderson`: até seis caracteres, sem espaço nem ponto.
function ehFormaCurta(curto, longo) {
  const m = /^(.{1,6})~\d+$/.exec(curto);
  return !!m && longo.replace(/[ .]/g, '').startsWith(m[1]);
}

function mesmaParte(a, b, plataforma) {
  return a === b || (plataforma === 'win32' && (ehFormaCurta(a, b) || ehFormaCurta(b, a)));
}

const mesmoInicio = (raiz, alvo, plataforma) => raiz.every((parte, i) => i < alvo.length && mesmaParte(parte, alvo[i], plataforma));

function segmentosSobOHome(alvo, home, plataforma) {
  const partes = partesDe(alvo, plataforma), raiz = partesDe(home, plataforma);
  return partes.length > raiz.length && mesmoInicio(raiz, partes, plataforma) ? partes.slice(raiz.length) : null;
}

function ehPastaDePerfil(alvo, perfis, plataforma) {
  const pasta = partesDe(alvo, plataforma).slice(0, -1);
  return (Array.isArray(perfis) ? perfis : []).some((perfil) => {
    const dir = absoluto(perfil?.dir, plataforma), raiz = dir && partesDe(dir, plataforma);
    return !!raiz && raiz.length === pasta.length && mesmoInicio(raiz, pasta, plataforma);
  });
}

function credencialDoPerfil(segmentos, alvo, perfis, plataforma) {
  if (segmentos.at(-1) !== CREDENCIAL_DO_PERFIL) return false;
  return (segmentos.length === 2 && PASTA_DE_PERFIL_CLAUDE.test(segmentos[0])) || ehPastaDePerfil(alvo, perfis, plataforma);
}

function ehCredencial(segmentos, alvo, perfis, plataforma) {
  const [primeiro, segundo] = segmentos;
  const dois = segmentos.length === 2;
  if (PASTAS_DE_CREDENCIAL.has(primeiro) || (primeiro === '.config' && segundo === 'gh')) return true;
  if (segmentos.length === 1 && primeiro === CREDENCIAL_DO_GIT) return true;
  if (dois && primeiro === '.codex' && segundo === 'auth.json') return true;
  if (dois && primeiro === '.farol' && /credentials/i.test(segundo)) return true;
  return credencialDoPerfil(segmentos, alvo, perfis, plataforma);
}

// PURA. O caminho normalizado e a identidade dele sob o home, ou null quando não é credencial.
function identificar(caminho, { home, plataforma = process.platform, perfis = [] } = {}) {
  const alvo = absoluto(caminho, plataforma), raiz = absoluto(home, plataforma);
  if (!alvo || !raiz) return null;
  const segmentos = segmentosSobOHome(alvo, raiz, plataforma);
  if (!segmentos || !ehCredencial(segmentos, alvo, perfis, plataforma)) return null;
  return { caminho: alvo, identidade: segmentos.join('/') };
}

// PURA. Devolve o caminho normalizado quando ele é credencial do aparelho, ou null.
// `perfis` é a lista claudeProfiles da config: a pasta de um perfil pode ter qualquer nome.
function caminhoSensivel(caminho, opcoes) {
  return identificar(caminho, opcoes)?.caminho || null;
}

// A parte do home a função pura resolve sem disco; `.ssh` também tem forma curta (`SSH~1`), e
// essa só o sistema expande. Arquivo inexistente segue como veio.
function expandirFormaCurta(caminho) {
  if (process.platform !== 'win32' || typeof caminho !== 'string' || !/~\d/.test(caminho)) return caminho;
  try { return fs.realpathSync.native(caminho); } catch { return caminho; }
}

// Por objeto de opções, que nasce e morre com a sessão: a mesma leitura repetida conta uma vez.
const jaVistas = new WeakMap();

function novaNaSessao(opts, identidade, dados) {
  if (!jaVistas.has(opts)) jaVistas.set(opts, { caminhos: new Set(), tetoAvisado: false });
  const sessao = jaVistas.get(opts);
  if (sessao.caminhos.has(identidade)) return false;
  if (sessao.caminhos.size < TETO_DE_CAMINHOS) {
    sessao.caminhos.add(identidade);
    return true;
  }
  if (!sessao.tetoAvisado) {
    sessao.tetoAvisado = true;
    registrarMedicao('leitura-sensivel-teto', { ...dados, teto: TETO_DE_CAMINHOS });
  }
  return false;
}

// Medição não derruba sessão: qualquer falha aqui fica sem registro e a sessão segue igual.
function avisarLeituraSensivel(engine, opts, block) {
  try {
    const achado = identificar(expandirFormaCurta(block.input?.file_path), { home: os.homedir(), perfis: engine.config?.claudeProfiles });
    if (!achado) return;
    const review = engine.activeReviews?.get(opts.id);
    if (prPathFromRead(review?.scopeRoot, achado.caminho)) return;
    const dados = { pr: review?.keys?.[0] || review?.pr?.key || null, sessao: opts.id || null };
    if (novaNaSessao(opts, achado.identidade, dados)) registrarMedicao('leitura-sensivel', { ...dados, caminho: achado.caminho });
  } catch { /* só observa */ }
}

export { caminhoSensivel, avisarLeituraSensivel, TETO_DE_CAMINHOS };
