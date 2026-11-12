// Uso do plano e validade do login de cada perfil do Claude por assinatura (12/11/2026).
//
// Pedido do dono: "visualizar o consumo de cada plano sem precisar ficar indo no terminal" e
// "ter uma precisão de quando vou ter que revalidar o token".
//
// `claude -p "/usage" --output-format json` é comando do próprio CLI: não vai ao modelo (zero
// turno, zero custo, cerca de dois segundos, medido com o Claude Code 2.1.322) e devolve:
//   - `result`: texto com uma linha por janela do plano,
//       Current session: 24% used · resets Nov 12, 6am (America/Sao_Paulo)
//       Current week (all models): 80% used · resets Nov 12, 4:59am (America/Sao_Paulo)
//       Current week (Fable): 8% used · resets Nov 12, 5am (America/Sao_Paulo)
//   - `credential_expires_at`: quando o login deixa de se renovar sozinho. É a validade do
//     token de renovação, contada do login, e renovar o token de acesso não a estende.
//
// O texto é em inglês e não é contrato: linha que não casa fica de fora, e sem nenhuma janela
// a tela diz "uso não lido" em vez de mostrar número inventado. A validade vem de um campo
// próprio do JSON e sobrevive à mudança do texto. Login vencido ou ausente responde sem
// janela e sem validade.
//
// A leitura roda contra a cópia efêmera da configuração (`rodarNaCopia`, perfil-claude.js): a
// configuração do perfil não é escrita e a credencial não é copiada nem lida pelo Farol. O
// `/usage` consulta a API, então o CLI renova o token de acesso vencido na credencial da
// pasta original, como faz em qualquer sessão (medido em 12/11/2026); isso não muda a
// validade do login.
//
// Só lê o engine que foi ligado no boot (`engine.usoDoPlanoLigado`): um `new Engine()` de
// teste nunca abre o CLI por conta de um snapshot.
//
// O que NÃO muda: a cadeia continua trocando de perfil só pelo limite registrado
// (limite-plano.js). O percentual lido aqui é informação de tela e de aviso, não gate.
import { TEMPOS } from '../constants.js';
import { jsonDaSaida } from '../agy/cota.js';
import { authFromProfile, rodarNaCopia } from './perfil-claude.js';

const COMANDO = 'claude -p "/usage" --output-format json --no-session-persistence --strict-mcp-config';
const MESES = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const LINHA = /^Current (session|week \(([^)]{1,40})\)):\s*(\d{1,3})% used(?:\s*·\s*resets (.+))?$/;
const RESET = /^(?:([A-Z][a-z]{2}) (\d{1,2}), )?(\d{1,2})(?::(\d{2}))?\s?(am|pm) \(([A-Za-z0-9_+\-/]{1,64})\)$/;
const MEIO_ANO_MS = 182 * TEMPOS.DIA_MS;

// --- PURO ---------------------------------------------------------------------------------

function partesNoFuso(ms, fuso) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return p;
}

// O instante em que o relógio de parede do fuso marca a data pedida. Fuso inválido = 0.
function instanteNoFuso({ ano, mes, dia, hora, minuto }, fuso) {
  const palpite = Date.UTC(ano, mes, dia, hora, minuto);
  try {
    // duas passadas: perto da troca do horário de verão o deslocamento do palpite não é o
    // do instante certo, e a segunda passada mede no instante já corrigido
    let ms = palpite;
    for (let i = 0; i < 2; i += 1) {
      const p = partesNoFuso(ms, fuso);
      ms = palpite - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms);
    }
    return ms;
  } catch {
    return 0; // fuso que o runtime não conhece: a tela mostra o texto do CLI
  }
}

function horaDoRelogio(hora, periodo) {
  const h = Number(hora) % 12;
  return periodo === 'pm' ? h + 12 : h;
}

/** "Nov 12, 5:59am (America/Sao_Paulo)" em epoch ms; 0 quando o texto não casa. */
function resetEmMs(texto, agora = Date.now()) {
  const m = String(texto || '').trim().match(RESET);
  if (!m) return 0;
  const fuso = m[6];
  let hoje;
  try { hoje = partesNoFuso(agora, fuso); } catch { return 0; }
  const semData = !m[1];
  const mes = semData ? hoje.month - 1 : MESES.indexOf(m[1]);
  if (mes < 0) return 0;
  const alvo = { ano: hoje.year, mes, dia: semData ? hoje.day : Number(m[2]), hora: horaDoRelogio(m[3], m[5]), minuto: Number(m[4] || 0) };
  let ms = instanteNoFuso(alvo, fuso);
  if (!ms) return 0;
  // sem data, o reset é a próxima vez que o relógio marca a hora; com data, a virada do ano
  if (semData && ms < agora) ms += TEMPOS.DIA_MS;
  if (!semData && ms < agora - MEIO_ANO_MS) ms = instanteNoFuso({ ...alvo, ano: alvo.ano + 1 }, fuso);
  if (!semData && ms > agora + MEIO_ANO_MS) ms = instanteNoFuso({ ...alvo, ano: alvo.ano - 1 }, fuso);
  return ms;
}

function janelaDaLinha(linha, agora) {
  const m = String(linha || '').trim().match(LINHA);
  if (!m) return null;
  const pct = Number(m[3]);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  const sessao = m[1] === 'session';
  const escopo = String(m[2] || '').trim();
  const geral = sessao || /^all models$/i.test(escopo);
  const base = sessao ? 'sessao' : 'semana';
  const nomeBase = sessao ? 'Sessão' : 'Semana';
  let id = base;
  let nome = nomeBase;
  if (!geral) {
    id = `${base}:${escopo.toLowerCase()}`;
    nome = `${nomeBase} ${escopo}`;
  }
  return {
    id,
    nome,
    usado: pct / 100,
    reset: resetEmMs(m[4], agora),
    resetTexto: String(m[4] || '').trim(),
  };
}

/** As janelas do texto do `/usage`. Linha que não casa fica de fora; forma inesperada = []. */
function resumirUso(texto, agora = Date.now()) {
  const vistos = new Set();
  const out = [];
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const j = janelaDaLinha(linha, agora);
    if (!j || vistos.has(j.id)) continue;
    vistos.add(j.id);
    out.push(j);
  }
  return out;
}

function validadeDoJson(j) {
  const ms = Date.parse(String(j?.credential_expires_at || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function erroDaLeitura(r, j, janelas, venceEm) {
  if (janelas.length) return '';
  // prazo estourado: o `runShell` mata o processo, e aí não há código de saída
  if (!j && r && !r.ok && (r.code === null || r.code === undefined)) return 'o Claude Code não respondeu a tempo';
  if (!j) return 'o Claude Code não devolveu o uso';
  if (!venceEm) return 'sem login válido nesta pasta';
  return 'o Claude Code mudou o formato do uso';
}

/** O que a saída do CLI vira: janelas, validade do login e o motivo quando não há janela. */
function leituraDaSaida(r, agora = Date.now()) {
  const j = jsonDaSaida(r?.stdout);
  const janelas = j ? resumirUso(j.result, agora) : [];
  const venceEm = validadeDoJson(j);
  return { ok: janelas.length > 0, respondeu: !!j, erro: erroDaLeitura(r, j, janelas, venceEm), semLogin: !!j && !janelas.length && !venceEm, janelas, venceEm, em: agora };
}

// Só assinatura do Claude lida por pasta (o login da máquina é pasta vazia). Chave de API,
// OpenRouter, Codex e Antigravity não têm `/usage` do Claude para ler.
function pastaDoUso(perfil, config) {
  const auth = authFromProfile(perfil, config);
  return auth?.kind === 'dir' ? { dir: auth.dir || '' } : null;
}

const FAIXAS = Object.freeze({ VENCIDO: 'vencido', ULTIMO_DIA: 'ultimo-dia', PERTO: 'perto' });

function faixaDoVencimento(venceEm, agora) {
  if (!venceEm) return '';
  const falta = venceEm - agora;
  if (falta <= 0) return FAIXAS.VENCIDO;
  if (falta <= TEMPOS.CLAUDE_VENCE_ULTIMO_DIA_MS) return FAIXAS.ULTIMO_DIA;
  return falta <= TEMPOS.CLAUDE_VENCE_AVISO_MS ? FAIXAS.PERTO : '';
}

function quando(ms) {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * O aviso de login que vence, ou null. A chave muda com a faixa e com a validade (na hora
 * cheia, para uma diferença de segundos entre leituras não avisar de novo): cada faixa avisa
 * uma vez, e login renovado (validade nova) volta a poder avisar.
 * @returns {{ chave: string, texto: string, faixa: string } | null}
 */
function avisoDeVencimento(perfil, venceEm, agora = Date.now()) {
  const faixa = faixaDoVencimento(venceEm, agora);
  if (!faixa) return null;
  const nome = String(perfil?.label || perfil?.id || 'perfil');
  const como = 'Renove pela sessão de login do perfil, em Sistema, Plano e chaves.';
  const texto = faixa === FAIXAS.VENCIDO
    ? `O login do Claude no perfil ${nome} venceu em ${quando(venceEm)}. ${como}`
    : `O login do Claude no perfil ${nome} vence em ${quando(venceEm)}. ${como}`;
  return { chave: `${perfil?.id || ''}:${Math.floor(venceEm / TEMPOS.HORA_MS)}:${faixa}`, texto, faixa };
}

// --- IO ------------------------------------------------------------------------------------

function cache(engine) {
  if (!(engine.usosDoPlano instanceof Map)) engine.usosDoPlano = new Map();
  return engine.usosDoPlano;
}

async function lerAgora(alvo, rodar) {
  const r = await rodar(alvo.dir, COMANDO, { timeout: TEMPOS.CLAUDE_USO_LIMITE_MS });
  return leituraDaSaida(r, Date.now());
}

const ERRO_DE_LEITURA = 'não foi possível ler o uso agora';

// A mensagem da exceção pode trazer caminho da máquina: ela vai ao log, uma vez por mensagem
// e por perfil, e a tela recebe um texto fixo.
function falhaDaLeitura(engine, perfil, err) {
  const msg = String(err?.message || err);
  if (!(engine.falhasDoUsoDoPlano instanceof Map)) engine.falhasDoUsoDoPlano = new Map();
  if (engine.falhasDoUsoDoPlano.get(perfil.id) !== msg) {
    engine.falhasDoUsoDoPlano.set(perfil.id, msg);
    engine.log?.('WARN', `uso do plano do perfil ${perfil.label || perfil.id}: ${msg}`);
  }
  return { ok: false, respondeu: false, erro: ERRO_DE_LEITURA, semLogin: false, janelas: [], venceEm: 0, em: Date.now() };
}

/**
 * A leitura nova com o que a anterior ainda vale. PURA.
 *  - O CLI não respondeu (prazo, processo que não abriu): a última leitura boa continua na
 *    tela por até uma hora, marcada como desatualizada. Uma falha de passagem não apaga as
 *    barras nem a validade, que não muda entre leituras.
 *  - Login vencido responde sem validade: a que já se conhecia, e que já passou, continua
 *    dizendo quando foi. Validade ainda no futuro não é herdada (pode ter sido um logout).
 */
function comAnterior(leitura, anterior) {
  const lidaEm = anterior?.lidaEm || anterior?.em || 0;
  if (!leitura.respondeu && anterior?.ok && leitura.em - lidaEm < TEMPOS.HORA_MS) {
    return { ...anterior, em: leitura.em, lidaEm, desatualizado: true, erro: leitura.erro };
  }
  if (leitura.semLogin && anterior?.venceEm && anterior.venceEm <= leitura.em) return { ...leitura, venceEm: anterior.venceEm };
  return leitura;
}

/**
 * O uso do perfil, com cache curto. Uma leitura de cada vez na máquina inteira: cada uma abre
 * o CLI, e sete perfis de uma vez seriam sete processos.
 * @returns {Promise<{ ok: boolean, erro: string, janelas: object[], venceEm: number, em: number } | null>}
 */
function lerUso(engine, perfil, { forcar = false, agora = Date.now(), rodar = rodarNaCopia } = {}) {
  const alvo = pastaDoUso(perfil, engine?.config);
  if (!alvo) return Promise.resolve(null);
  const c = cache(engine);
  const atual = c.get(perfil.id);
  if (atual?.lendo) return atual.lendo;
  if (!forcar && atual?.leitura && agora - atual.leitura.em < TEMPOS.CLAUDE_USO_CACHE_MS) return Promise.resolve(atual.leitura);
  const fila = engine.filaDoUsoDoPlano || Promise.resolve();
  const lendo = fila.then(() => lerAgora(alvo, rodar))
    .catch((err) => falhaDaLeitura(engine, perfil, err))
    .then((nova) => {
      const leitura = comAnterior(nova, atual?.leitura);
      c.set(perfil.id, { leitura });
      return leitura;
    });
  engine.filaDoUsoDoPlano = lendo;
  c.set(perfil.id, { ...atual, lendo });
  return lendo;
}

function avisar(engine, perfil, leitura, agora = Date.now()) {
  const aviso = avisoDeVencimento(perfil, leitura?.venceEm, agora);
  if (!aviso) return;
  if (!(engine.vencimentosAvisados instanceof Set)) engine.vencimentosAvisados = new Set();
  if (engine.vencimentosAvisados.has(aviso.chave)) return;
  engine.vencimentosAvisados.add(aviso.chave);
  // três dias antes é informação; no último dia e depois de vencer, é erro a resolver
  engine.emit?.('toast', { kind: aviso.faixa === FAIXAS.PERTO ? 'info' : 'error', text: aviso.texto });
}

// Login refeito no terminal: a leitura guardada dessa pasta deixa de valer, e o próximo
// snapshot lê de novo em vez de mostrar por cinco minutos a validade antiga.
function esquecerPasta(engine, dir) {
  if (!(engine?.usosDoPlano instanceof Map)) return;
  for (const p of engine.config?.claudeProfiles || []) {
    const alvo = pastaDoUso(p, engine.config);
    if (alvo && alvo.dir === (dir || '')) engine.usosDoPlano.delete(p.id);
  }
}

// A tela pergunta sem esperar: uso velho agenda a leitura, e a resposta chega no próximo
// snapshot. Só lê o engine ligado no boot (`usoDoPlanoLigado`, server.js): o de teste, que
// também monta snapshot, nunca abre o CLI.
function agendarLeitura(engine, perfil, agora = Date.now(), rodar = rodarNaCopia) {
  if (!engine || engine.usoDoPlanoLigado !== true || !pastaDoUso(perfil, engine.config)) return;
  const atual = cache(engine).get(perfil.id);
  if (atual?.lendo || (atual?.leitura && agora - atual.leitura.em < TEMPOS.CLAUDE_USO_CACHE_MS)) return;
  lerUso(engine, perfil, { agora, rodar }).then((leitura) => {
    if (!leitura) return;
    avisar(engine, perfil, leitura);
    engine.pushState?.();
  }).catch(() => { /* a próxima pergunta da tela agenda de novo */ });
}

// O que a tela recebe de um perfil: as janelas com a fração usada e a hora do reset, e a
// validade do login. Nunca caminho de pasta, conta ou credencial.
function usoParaTela(engine, perfil, agora = Date.now()) {
  if (!pastaDoUso(perfil, engine?.config)) return null;
  const l = engine?.usosDoPlano instanceof Map ? engine.usosDoPlano.get(perfil.id)?.leitura : null;
  if (!l) return { lido: false };
  return {
    lido: true, ok: !!l.ok, erro: l.erro || '', em: l.em, venceEm: l.venceEm || 0, faixaDoLogin: faixaDoVencimento(l.venceEm, agora),
    desatualizado: l.desatualizado === true, lidaEm: l.lidaEm || l.em,
    janelas: (l.janelas || []).map((j) => ({ id: j.id, nome: j.nome, usado: j.usado, reset: j.reset, resetTexto: j.resetTexto })),
  };
}

export default { resetEmMs, resumirUso, leituraDaSaida, pastaDoUso, faixaDoVencimento, avisoDeVencimento, comAnterior, lerUso, avisar, agendarLeitura, esquecerPasta, usoParaTela };
export { resetEmMs, resumirUso, leituraDaSaida, pastaDoUso, faixaDoVencimento, avisoDeVencimento, comAnterior, lerUso, avisar, agendarLeitura, esquecerPasta, usoParaTela, COMANDO, ERRO_DE_LEITURA };
