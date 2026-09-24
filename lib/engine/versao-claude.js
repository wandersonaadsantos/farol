// O Claude Code atrasado deixa o Farol rodando num modelo legado, em silencio (24/09/2026).
//
// O Farol pede o modelo por APELIDO (`opus`, `sonnet`, `haiku`) e quem decide para onde o
// apelido aponta e o CLI, versao a versao: a 2.1.280 fez do Opus 5.5 "o Opus padrao". Este
// aparelho estava na 2.1.268 desde 10/09, entao o `opus` seguia no Opus 5, que a pagina
// oficial de modelos ja lista como legado: 1001 sessoes rodaram nele, com o doctor todo
// verde. E fixar o ID novo na config nao era saida: a 2.1.268 responde
// `unrecognized_model` para `claude-opus-5-5` (medido), entao a fixacao teria derrubado
// todas as sessoes. A alavanca e manter o CLI atual, e este modulo diz quando ele nao esta.
//
// A regra conta desde QUANDO voce esta atras, e nao quantas versoes: o CLI sai com versao
// nova quase todo dia, e um aviso por patch viveria aceso. Atrasado e quando a primeira
// versao publicada depois da sua ja saiu ha mais de `CLAUDE_CLI_TOLERANCIA_MS`.
//
// Falta de dado nunca vira alarme: CLI ausente e assunto do check de presenca, registro
// fora do ar mantem a ultima leitura boa, e versao nova sem data conhecida nao acusa.
import io from '../io.js';
import { TEMPOS } from '../constants.js';

const REGISTRO = 'https://registry.npmjs.org/@anthropic-ai/claude-code';
const SEMVER = /(\d+)\.(\d+)\.(\d+)/;

// "2.1.268 (Claude Code)" -> [2, 1, 268]; pre-lancamento (2.2.0-beta.1) nao conta como
// versao publicada para quem usa o canal normal
function partes(texto) {
  const s = String(texto || '').trim();
  if (!s || /-/.test(s.split(/\s/)[0])) return null;
  const m = SEMVER.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function comparar(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// PURA. Devolve null quando nao da para comparar (sem versao instalada legivel, ou sem a
// mais recente): o check some da tela em vez de mostrar um verde que ninguem conferiu.
function avaliarVersao({ instalada, maisRecente, datas = {}, agora = Date.now(), tolerancia = TEMPOS.CLAUDE_CLI_TOLERANCIA_MS }) {
  const minha = partes(instalada);
  const ultima = partes(maisRecente);
  if (!minha || !ultima) return null;
  const base = { instalada: minha.join('.'), maisRecente: ultima.join('.') };
  if (comparar(minha, ultima) >= 0) return { ...base, atualizada: true, atrasadaDesde: 0, atrasada: false };
  // a PRIMEIRA versao publicada depois da minha: e dela que conta o atraso
  const seguinte = Object.keys(datas)
    .map((v) => ({ v, p: partes(v) }))
    .filter((x) => x.p && comparar(x.p, minha) > 0)
    .sort((a, b) => comparar(a.p, b.p))[0];
  const desde = seguinte ? Date.parse(datas[seguinte.v]) : NaN;
  if (!Number.isFinite(desde)) return { ...base, atualizada: false, atrasadaDesde: 0, atrasada: false };
  return { ...base, atualizada: false, atrasadaDesde: desde, atrasada: agora - desde > tolerancia };
}

async function lerVersaoInstalada() {
  const r = await io.runShell('claude --version');
  return r.ok ? r.stdout.trim().split('\n')[0] : '';
}

// O documento do pacote traz a versao mais recente (dist-tags) e a data de cada versao
// (time). Pesa ~1,5 MB e e lido no maximo uma vez por intervalo. null em qualquer falha.
async function lerRegistro() {
  try {
    const r = await fetch(REGISTRO, { signal: AbortSignal.timeout(TEMPOS.CLAUDE_CLI_REGISTRO_TIMEOUT_MS) });
    if (!r.ok) return null;
    const doc = await r.json();
    const maisRecente = doc && doc['dist-tags'] && doc['dist-tags'].latest;
    return maisRecente ? { maisRecente, datas: doc.time || {} } : null;
  } catch {
    return null; // rede, timeout ou corpo invalido: sem dado, sem aviso
  }
}

// Relida a cada `CLAUDE_CLI_VERSAO_MS`, e nao so no boot como o doctor: sem isso, um
// `claude update` continuaria aparecendo como atrasado ate alguem reiniciar o Farol.
async function atualizarVersaoClaude(engine, deps = {}) {
  const agora = deps.agora != null ? deps.agora : Date.now();
  if (engine.versaoClaudeLidaEm && agora - engine.versaoClaudeLidaEm < TEMPOS.CLAUDE_CLI_VERSAO_MS) return engine.claudeVersao;
  engine.versaoClaudeLidaEm = agora;
  try {
    const [instalada, registro] = await Promise.all([
      (deps.lerVersao || lerVersaoInstalada)(),
      (deps.lerRegistro || lerRegistro)(),
    ]);
    if (!registro) return engine.claudeVersao; // registro fora do ar: a ultima leitura boa vale
    const v = avaliarVersao({ instalada, maisRecente: registro.maisRecente, datas: registro.datas, agora });
    if (v) { engine.claudeVersao = v; engine.pushState(); }
  } catch {
    // leitura que falha nunca derruba o ciclo; tenta de novo no proximo intervalo
  }
  return engine.claudeVersao;
}

export default { avaliarVersao, atualizarVersaoClaude };
export { avaliarVersao, atualizarVersaoClaude };
