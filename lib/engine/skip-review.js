/* Pular a revisão quando OUTRA PESSOA já está revisando o mesmo PR (pedido do
   Wanderson, 20/08/2026). A label "<conta>:revisando" já existia como sinal pro
   time enxergar no GitHub que o review está acontecendo; aqui ela vira DECISÃO:
   se o PR já carrega a label de revisando de outra pessoa, o Farol não abre uma
   segunda sessão em cima do mesmo trabalho, comenta que está deixando com quem
   já pegou, e segue.

   Três cuidados que essa mecânica exige:

   1. FERRAMENTA NÃO É PESSOA. `acrity` nunca entra na conta (regra explícita do
      Wanderson): review de ferramenta não substitui olho humano, então ver a
      label dela não pode fazer o Farol se calar. A lista é allowlist invertida
      (denylist) porque o universo de pessoas é aberto e o de ferramentas não.

   2. O PULO É SÓ DO CAMINHO AUTOMÁTICO. Clique explícito em Revisar sempre
      revisa: se você mandou revisar sabendo que outra pessoa está lá, quem
      decide é você. Mesma régua do invariante 4 (clique nunca é sobreposto por
      política do app), só que na direção contrária.

   3. COMENTÁRIO UMA VEZ SÓ POR PR. O gate roda a cada ciclo de polling (30s a
      1h): sem âncora, um PR parado com a label de outra pessoa viraria um
      comentário por ciclo. A âncora mora em state/skip-comentado.json e é podada
      quando o PR sai do panorama, no mesmo padrão do reReviewLaunched. */
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io, { writeJsonAtomic } from '../io.js';

const SKIP_FILE = path.join(STATE_DIR, 'skip-comentado.json');
const SUFIXO = ':revisando';

// Contas que carregam label no formato de pessoa mas NÃO são pessoas. Ver o
// cuidado 1 no cabeçalho: ferramenta revisando não dispensa revisão humana.
const NAO_SAO_PESSOAS = new Set(['acrity']);

// PURA. Dos nomes de label do PR, quem MAIS está revisando agora, tirando a
// minha própria conta e as ferramentas. Devolve login em ordem estável (a ordem
// entra no texto do comentário, e comentário não pode variar por sorte do gh).
// Comparação sem caixa dos dois lados: o GitHub preserva a caixa do login na
// label, e `Thiago:revisando` é a mesma pessoa que `thiago`.
function revisandoPorOutros(labels, minhaConta) {
  const me = String(minhaConta || '').trim().toLowerCase();
  const achados = new Set();
  for (const nome of Array.isArray(labels) ? labels : []) {
    const texto = String(nome || '');
    if (!texto.toLowerCase().endsWith(SUFIXO)) continue;
    const login = texto.slice(0, -SUFIXO.length).trim();
    if (!login) continue;
    const chave = login.toLowerCase();
    if (chave === me) continue;                 // a minha própria label não me barra
    if (NAO_SAO_PESSOAS.has(chave)) continue;   // ferramenta não conta
    achados.add(login);
  }
  return [...achados].sort((a, b) => a.localeCompare(b));
}

// Gate síncrono e SEM IO, no mesmo contrato do reReviewTargets/retryTargets:
// quem decide gastar (ou poupar) sessão Claude tem que ser testável sem rede.
// Lê só o que a busca do panorama já trouxe (pr.labels), nunca chama gh.
function outrosRevisando(engine, pr) {
  return revisandoPorOutros(pr && pr.labels, engine.accountForPr(pr));
}

/* ---------- comentário do pulo ---------- */

// Texto do comentário, PURO. Escrito como pessoa (mesma régua do reviewFormatBlock):
// sem citar automação, Farol, fila ou política, sem travessão, e sem pronome de
// gênero pra quem o app não tem como saber. Diz o fato e para por aí.
function textoDoPulo(outros) {
  const nomes = (outros || []).map(u => `@${u}`);
  if (!nomes.length) return '';
  const lista = nomes.length === 1
    ? nomes[0]
    : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  const verbo = nomes.length === 1 ? 'já está revisando' : 'já estão revisando';
  return `Vi que ${lista} ${verbo} este PR, então não vou duplicar a revisão.`;
}

function loadSkipComentado(log) {
  const bruto = io.readJson(SKIP_FILE, {}, log);
  return (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) ? bruto : {};
}

function saveSkipComentado(engine) {
  try { writeJsonAtomic(SKIP_FILE, engine.skipComentado || {}); }
  catch (err) { engine.log('WARN', `salvar skip-comentado: ${err.message}`); }
}

// Comenta o pulo no PR, uma vez só (âncora por key). Best-effort: falha aqui
// nunca vira exceção pra quem chama, porque o pulo em si já aconteceu e não
// depende do comentário ter saído. A âncora só é gravada APÓS sucesso, senão um
// 503 do GitHub calaria o aviso pra sempre.
async function comentarPulo(engine, pr, outros) {
  const texto = textoDoPulo(outros);
  const acc = engine.accountForPr(pr);
  if (!texto || !pr.url || !engine.tokenFor(acc)) return false;
  try {
    const r = await io.run('gh', ['pr', 'comment', pr.url, '--body', texto], { env: engine.ghEnv(acc) });
    if (!r.ok) {
      engine.log('WARN', `comentário de pulo em ${pr.key} não saiu: ${String(r.stderr || '').trim().slice(0, 200)}`);
      return false;
    }
    engine.skipComentado[pr.key] = { at: Date.now(), quem: outros };
    saveSkipComentado(engine);
    return true;
  } catch (err) {
    engine.log('WARN', `comentário de pulo em ${pr.key} não saiu: ${err.message}`);
    return false;
  }
}

// Chamado pelo check() com os PRs que o gate pulou neste ciclo. Comenta só os
// que ainda não têm âncora e avisa na tela (o pulo nunca é silencioso: PR que
// some da fila sem explicação é exatamente o defeito que o painel de Diagnóstico
// existe pra evitar).
async function comentarPulos(engine, pulados) {
  const novos = (pulados || []).filter(p => p && p.pr && !(engine.skipComentado || {})[p.pr.key]);
  for (const { pr, outros } of novos) {
    const ok = await comentarPulo(engine, pr, outros);
    if (!ok) continue;
    engine.emit('toast', {
      kind: 'info',
      text: `${pr.key}: ${outros.map(u => `@${u}`).join(', ')} já está revisando, então deixei passar.`,
    });
  }
}

// Poda a âncora dos PRs que saíram do panorama, no mesmo compromisso do
// reReviewLaunched e do reconcileHiddenPRs: busca parcialmente falha pode custar
// UM comentário repetido, nunca um comentário perdido.
function podarSkipComentado(engine, abertos) {
  let mudou = false;
  for (const key of Object.keys(engine.skipComentado || {})) {
    if (!abertos.has(key)) { delete engine.skipComentado[key]; mudou = true; }
  }
  if (mudou) saveSkipComentado(engine);
}

const skipMod = {
  SKIP_FILE, NAO_SAO_PESSOAS, revisandoPorOutros, outrosRevisando,
  textoDoPulo, loadSkipComentado, saveSkipComentado, comentarPulo, comentarPulos, podarSkipComentado,
};
export default skipMod;
export {
  SKIP_FILE, NAO_SAO_PESSOAS, revisandoPorOutros, outrosRevisando,
  textoDoPulo, loadSkipComentado, saveSkipComentado, comentarPulo, comentarPulos, podarSkipComentado,
};
