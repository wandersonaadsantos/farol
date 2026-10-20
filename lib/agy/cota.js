// A cota do plano de cada perfil do Antigravity CLI, lida sem gastar nada.
//
// `agy -p "/usage" --output-format json` é comando do próprio CLI (não vai ao modelo, zero
// token, cerca de um segundo) e devolve, por grupo de modelos, cada janela com a fração
// restante e a hora exata do reset em UTC (spec, seção 3):
//   command.data.groups[].buckets[] = { id, window, remaining_fraction, reset_time }
// Dois grupos independentes na conta medida: Gemini (`gemini-weekly`) e "Claude e GPT"
// (`3p-weekly`). Todos os buckets contam (relatos falam de janela de 5 horas em outros
// planos); só o `reset_time` de bucket ESGOTADO quer dizer alguma coisa, porque o de grupo
// intocado é "agora mais sete dias" e anda a cada leitura.
//
// É também a leitura barata da IDENTIDADE: o `/usage` autentica, e o log da execução diz
// `OAuth: authenticated successfully as <conta>` e, no modo de arquivo, `Using file-based
// token storage`. O log vai para um arquivo próprio (`--log-file`), lido e apagado na hora; o
// e-mail fica só na memória do processo e na tela, mascarado, nunca em log nem em erro.
//
// "Posso rodar agora?" (contrato com a cadeia, spec): grupo do modelo esgotado registra o
// limite no MESMO registro que a cadeia lê (lib/engine/limite-plano.js) até o maior reset
// dos buckets esgotados, e a cadeia passa para o próximo perfil sem abrir sessão. A leitura
// tem cache curto (TEMPOS.AGY_COTA_CACHE_MS) e nunca segura o ciclo: a cadeia agenda e segue.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TEMPOS } from '../constants.js';
import { parseJson } from '../io.js';
import { registrarLimite, liberarLimite, registroDaAssinatura } from '../engine/limite-plano.js';
import { agyEnv } from './ambiente.js';
import { pastaDoPerfil, garantirPasta, gitconfigReal, temLogin } from './home.js';
import { rodar } from './processo.js';

// --- PURO ---------------------------------------------------------------------------------

// O grupo do modelo: o `id` do bucket sem a janela (`gemini-weekly` -> `gemini`). Claude e GPT
// pela cota do Google ficam no outro grupo (`3p`).
function grupoDoModelo(modelo) {
  return /^gemini-/.test(String(modelo || '')) ? 'gemini' : '3p';
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bucketDe(b) {
  const restante = numero(b?.remaining_fraction);
  const reset = Date.parse(String(b?.reset_time || ''));
  return { id: String(b?.id || ''), janela: String(b?.window || ''), restante, reset: Number.isFinite(reset) ? reset : 0 };
}

/** Os grupos da resposta do `/usage`, só com o que o Farol usa. Forma inesperada = []. */
function resumirCota(json) {
  const grupos = json?.command?.data?.groups;
  if (!Array.isArray(grupos)) return [];
  return grupos.map((g) => {
    const buckets = (Array.isArray(g?.buckets) ? g.buckets : []).map(bucketDe).filter((b) => b.restante !== null);
    const primeiro = buckets[0]?.id || '';
    return { grupo: primeiro.split('-')[0] || '', nome: String(g?.name || ''), buckets };
  }).filter((g) => g.buckets.length);
}

function grupoNaCota(grupos, grupo) {
  return (grupos || []).find((g) => g.grupo === grupo) || null;
}

function esgotado(g) {
  return !!g && g.buckets.some((b) => b.restante <= 0);
}

// O maior reset entre os buckets esgotados: antes dele o grupo não volta.
function voltaEm(g) {
  if (!esgotado(g)) return 0;
  return Math.max(0, ...g.buckets.filter((b) => b.restante <= 0).map((b) => b.reset));
}

function restanteDoGrupo(g) {
  return g ? Math.min(...g.buckets.map((b) => b.restante)) : null;
}

// O que o log de UMA execução diz da autenticação. Sem a linha, `conta` é null (não dá para
// saber), e isso nunca vira "conta errada".
function identidadeDoLog(texto) {
  const s = String(texto || '');
  const m = s.match(/OAuth: authenticated successfully as (\S+)/);
  return { conta: m ? m[1].toLowerCase() : null, arquivo: /Using file-based token storage/.test(s) };
}

// "wa***@icloud.com": o bastante para a pessoa reconhecer a conta na tela
function mascararEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return '';
  return `${s.slice(0, Math.min(2, at))}***${s.slice(at)}`;
}

/**
 * A conta que autenticou é a esperada do perfil? true, false, ou null quando não dá para
 * saber (perfil sem e-mail registrado, log sem a linha). O token que não veio da pasta (o
 * CLI voltou ao chaveiro, que é uma vaga só para a máquina inteira) também é conta errada:
 * os perfis passariam a dividir uma conta sem ninguém saber.
 */
function contaConfere(perfil, leitura) {
  if (!leitura || !leitura.conta) return null;
  if (leitura.arquivo === false) return false;
  const esperado = String(perfil?.email || '').toLowerCase();
  if (!esperado) return null;
  return leitura.conta === esperado;
}

// O objeto da saída: a linha JSON do `--output-format json` (pode haver aviso antes dela)
function jsonDaSaida(stdout) {
  const linhas = String(stdout || '').trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  for (const l of linhas.reverse()) {
    const j = parseJson(l, null);
    if (j && typeof j === 'object') return j;
  }
  return null;
}

// --- IO ------------------------------------------------------------------------------------

function cache(engine) {
  if (!(engine.agyCotas instanceof Map)) engine.agyCotas = new Map();
  return engine.agyCotas;
}

function lerLogEApagar(arquivo) {
  let texto = '';
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { /* o CLI pode não ter escrito: identidade desconhecida */ }
  try { fs.rmSync(arquivo, { force: true }); } catch { /* temporário: o sistema limpa */ }
  return texto;
}

async function lerAgora(engine, id) {
  const pasta = garantirPasta(id);
  if (!pasta) return { ok: false, erro: 'perfil sem pasta válida', grupos: [], conta: null, arquivo: null, em: Date.now() };
  // sem o arquivo do token o `/usage` pediria login e esperaria um código: nem abre
  if (!temLogin(id)) return { ok: false, erro: 'sem login', semLogin: true, grupos: [], conta: null, arquivo: null, em: Date.now() };
  const log = path.join(os.tmpdir(), `farol-agy-usage-${crypto.randomUUID()}.log`);
  const env = agyEnv(engine.ghEnv(), pasta, { gitconfigReal: gitconfigReal() });
  const r = await rodar(['-p', '/usage', '--output-format', 'json', '--log-file', log], { env, cwd: pasta, limiteMs: TEMPOS.AGY_USAGE_LIMITE_MS });
  const ident = identidadeDoLog(lerLogEApagar(log));
  const j = jsonDaSaida(r.stdout);
  const grupos = resumirCota(j);
  const semLogin = /Authentication required|authentication failed/i.test(`${r.stdout}\n${r.stderr}`);
  const ok = r.code === 0 && grupos.length > 0;
  let erro = '';
  if (!ok) erro = 'o /usage não devolveu a cota';
  if (!ok && r.tempoEsgotado) erro = 'o /usage não respondeu a tempo';
  if (!ok && semLogin) erro = 'sem login';
  return { ok, erro, semLogin, grupos, conta: ident.conta, arquivo: ident.arquivo, em: Date.now() };
}

/**
 * A cota do perfil, com cache curto. Uma leitura por perfil de cada vez: quem chega no meio
 * espera a mesma.
 * @returns {Promise<{ ok: boolean, erro: string, semLogin?: boolean, grupos: object[], conta: string|null, arquivo: boolean|null, em: number }>}
 */
function lerCota(engine, id, { forcar = false, agora = Date.now() } = {}) {
  const c = cache(engine);
  const atual = c.get(id);
  if (atual?.lendo) return atual.lendo;
  if (!forcar && atual?.leitura && agora - atual.leitura.em < TEMPOS.AGY_COTA_CACHE_MS) return Promise.resolve(atual.leitura);
  const lendo = lerAgora(engine, id).catch((err) => ({ ok: false, erro: String(err?.message || err), grupos: [], conta: null, arquivo: null, em: Date.now() }))
    .then((leitura) => { c.set(id, { leitura }); return leitura; });
  c.set(id, { ...atual, lendo });
  return lendo;
}

/**
 * Aplica a leitura ao registro da cadeia: grupo do modelo esgotado fica "no limite até" o
 * maior reset dos buckets esgotados. Grupo com cota livre libera só o limite ESTIMADO (o que
 * a sessão registrou sem hora): o reset citado continua até passar.
 */
function aplicarLeitura(engine, auth, leitura, agora = Date.now()) {
  const g = leitura?.ok ? grupoNaCota(leitura.grupos, auth.grupo || 'gemini') : null;
  if (!g) return { esgotado: false, ate: 0 };
  if (esgotado(g)) {
    const ate = voltaEm(g);
    // reset que já passou e o grupo segue zerado: o CLI ainda não virou a janela; uma hora
    const efetivo = ate > agora ? ate : agora + TEMPOS.LIMITE_PLANO_SEM_HORA_MS;
    registrarLimite(engine, '', efetivo, agora, { auth, estimado: !(ate > agora) });
    return { esgotado: true, ate: efetivo, grupo: g.grupo };
  }
  const reg = registroDaAssinatura(engine, auth, agora);
  if (reg?.estimado) liberarLimite(engine, '', auth);
  return { esgotado: false, ate: 0 };
}

// A cadeia pergunta sem esperar: cota velha agenda uma leitura e a resposta vale para a
// próxima pergunta. Erro de leitura não muda nada (a sessão confere de novo antes de rodar).
function agendarLeitura(engine, perfil, auth, agora = Date.now()) {
  if (!engine || typeof engine.ghEnv !== 'function' || !pastaDoPerfil(perfil?.id)) return;
  const atual = cache(engine).get(perfil.id);
  if (atual?.lendo || (atual?.leitura && agora - atual.leitura.em < TEMPOS.AGY_COTA_CACHE_MS)) return;
  lerCota(engine, perfil.id, { agora }).then((l) => aplicarLeitura(engine, auth, l)).catch(() => { /* a sessão confere de novo */ });
}

// O que a tela recebe de um perfil: grupos com a fração e a hora do reset, a conta mascarada
// e se ela confere. Nunca o e-mail inteiro, nunca caminho.
function cotaParaTela(engine, perfil) {
  const l = cache(engine).get(perfil?.id)?.leitura;
  if (!l) return null;
  return {
    ok: !!l.ok, erro: l.erro || '', em: l.em,
    conta: mascararEmail(l.conta), contaConfere: contaConfere(perfil, l),
    grupos: (l.grupos || []).map((g) => ({ grupo: g.grupo, nome: g.nome, restante: restanteDoGrupo(g), reset: voltaEm(g) || Math.max(0, ...g.buckets.map((b) => b.reset)), esgotado: esgotado(g) })),
  };
}

export default {
  grupoDoModelo, resumirCota, grupoNaCota, esgotado, voltaEm, restanteDoGrupo, identidadeDoLog, mascararEmail, contaConfere, jsonDaSaida,
  lerCota, aplicarLeitura, agendarLeitura, cotaParaTela,
};
export {
  grupoDoModelo, resumirCota, grupoNaCota, esgotado, voltaEm, restanteDoGrupo, identidadeDoLog, mascararEmail, contaConfere, jsonDaSaida,
  lerCota, aplicarLeitura, agendarLeitura, cotaParaTela,
};
