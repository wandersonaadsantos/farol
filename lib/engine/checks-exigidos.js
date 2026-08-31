/* Dono da pergunta "este PR está estável o bastante pra valer uma sessão?".

   Módulo próprio, e não mais um bloco no skip-review.js, por dois motivos que
   apontaram pro mesmo lugar: o assunto é outro (aquele arquivo é dono de "um Farol
   por PR" e do gate de consciência, que falam de QUEM já agiu no PR; este fala do
   ESTADO da pipe), e o gate mecânico reprovou o arquivo por tamanho no instante em
   que o bloco entrou. Quando os dois eixos concordam, a linha estava no lugar errado.

   O consumidor é um só: o bloqueiaAutomatico, a boca única dos três caminhos
   automáticos de lançamento. Clique manual nunca chega aqui. */
import { TEMPOS } from '../constants.js';
import io from '../io.js';
/* ---------- gate de estabilidade: 100% dos checks OBRIGATÓRIOS verdes (31/08/2026) ----

   PEDIDO DO GUILHERME, com dois desperdícios que ele mediu em campo: o Farol começa a
   revisar, alguém clica em "Update branch", entra commit novo e a sessão inteira vira
   lixo; e o Farol aprova, a pipe quebra depois, e o ciclo de correção custa outra
   revisão. A proposta original dele era esperar "90% das pipes verdes"; o Wanderson
   simplificou para a régua que vale aqui: TODOS os obrigatórios verdes, com o botão
   Revisar continuando a atravessar sem esperar, para quem tem pressa.

   OBRIGATÓRIOS, e não todos, e isso não é detalhe: o `sonar` do engine-ai é
   cronicamente vermelho e não é exigido pela branch. Exigir tudo verde nunca revisaria
   aquele repositório, que é o oposto do que este gate existe pra fazer.

   O MESMO CHECK APARECE MAIS DE UMA VEZ, e é o caso comum, não a exceção: medido no
   biud-frontend#860, `deploy` aparece duas vezes no rollup, FAILURE de 28/08 e SUCCESS
   de 31/08, porque o job foi relançado. Contar as duas travaria o PR pra sempre por uma
   falha já corrigida, então vale a rodada MAIS RECENTE de cada nome, que é a mesma
   regra de "último estado da pessoa vence" do gate de consciência logo abaixo.

   SKIPPED e NEUTRAL contam como verde porque é assim que o próprio GitHub trata check
   obrigatório na caixa de merge; divergir disso faria o Farol esperar por algo que o
   repositório já considera satisfeito. PURA. */
const CONCLUSOES_VERDES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

// nome do check nas duas formas que o gh devolve: CheckRun tem `name`, status legado
// (a API antiga de commit status) tem `context`. O mesmo vale pro desfecho.
function nomeDoCheck(c) { return String((c && (c.name || c.context)) || '').trim(); }
function desfechoDoCheck(c) { return String((c && (c.conclusion || c.state)) || '').toUpperCase(); }

// Última rodada de cada check, por horário de início. Sem horário (status legado, dado
// truncado) vale a ordem em que o gh entregou, que é o melhor palpite disponível.
function ultimaRodadaPorNome(rollup) {
  const porNome = new Map();
  for (const c of Array.isArray(rollup) ? rollup : []) {
    const nome = nomeDoCheck(c);
    if (!nome) continue;
    const anterior = porNome.get(nome);
    const t = Date.parse((c && c.startedAt) || '') || 0;
    const tAnterior = anterior ? (Date.parse(anterior.startedAt || '') || 0) : -1;
    if (!anterior || t >= tAnterior) porNome.set(nome, c);
  }
  return porNome;
}

/* Os obrigatórios estão todos verdes? Devolve { pronto, faltando: [{nome, estado}] },
   com estado em 'rodando' | 'vermelho' | 'ausente' (nem começou, que é o caso do
   Update branch recém-clicado). FALTA DE DADO NUNCA SEGURA: sem exigência conhecida ou
   sem rollup legível, devolve pronto, porque o pior caso de deixar passar é uma
   revisão que talvez precise ser refeita, e o pior caso de segurar por falha de leitura
   é um PR que nunca é revisado e ninguém entende o silêncio. */
function checksExigidosVerdes(rollup, exigidos) {
  const lista = Array.isArray(exigidos) ? exigidos.map(String).filter(Boolean) : [];
  if (!lista.length || !Array.isArray(rollup)) return { pronto: true, faltando: [] };
  const porNome = ultimaRodadaPorNome(rollup);
  const faltando = [];
  for (const nome of lista) {
    const c = porNome.get(nome);
    if (!c) { faltando.push({ nome, estado: 'ausente' }); continue; }
    const concluido = !c.status || String(c.status).toUpperCase() === 'COMPLETED';
    if (!concluido) { faltando.push({ nome, estado: 'rodando' }); continue; }
    if (!CONCLUSOES_VERDES.has(desfechoDoCheck(c))) faltando.push({ nome, estado: 'vermelho' });
  }
  return { pronto: faltando.length === 0, faltando };
}

/* Quais checks a BRANCH DE DESTINO exige, pelo mesmo endpoint que o fetchRuleBlocked
   já usa (`repos/{repo}/rules/branches/{base}`). Ele responde pra quem tem leitura, sem
   exigir admin, e foi conferido em campo: biud-frontend@development exige
   lint/typecheck/test/build/audit/gitleaks, e engine-ai@development exige
   lint/quality-gate/coverage/golden-set/integration-tests/acrity-review.

   Cache por repo@base porque a exigência muda por mudança de ruleset, que é rara, e
   sem ele isto seria uma chamada gh por PR por ciclo. null = não deu pra saber, e quem
   chama trata isso como "não segura". */
async function checksExigidosDoRepo(engine, repo, base) {
  if (!repo || !base) return null;
  if (!(engine.checksExigidosCache instanceof Map)) engine.checksExigidosCache = new Map();
  const chave = `${repo}@${base}`;
  const c = engine.checksExigidosCache.get(chave);
  if (c && (Date.now() - c.at) < TEMPOS.CHECKS_EXIGIDOS_TTL_MS) return c.lista;
  const acc = engine.accountForOwner(String(repo).split('/')[0]);
  if (!engine.tokenFor(acc)) return null;
  const jq = '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[]?.context]';
  const r = await io.run('gh', ['api', `repos/${repo}/rules/branches/${base}`, '--jq', jq], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  const lista = io.parseJson(r.stdout, null);
  if (!Array.isArray(lista)) return null;
  engine.checksExigidosCache.set(chave, { lista, at: Date.now() });
  return lista;
}

/* O PR está estável o bastante pra valer uma sessão? Uma chamada gh pro PR (base +
   rollup no mesmo `--json`) e, no máximo, uma pra exigência do repo, que fica em cache.
   Mesma ordem de custo do gate de consciência, e só na boca do lançamento automático.

   Devolve { bloqueado, faltando }. Falta de dado (sem token, gh fora, rollup ilegível,
   repo sem exigência) NUNCA bloqueia: o pior caso de deixar passar é uma revisão que
   talvez precise ser refeita, e o pior caso de segurar por falha de leitura é um PR
   que nunca é revisado, com ninguém entendendo o silêncio. */
async function bloqueadoPorChecks(engine, pr) {
  const livre = { bloqueado: false, faltando: [] };
  const acc = engine.accountForPr(pr);
  if (!pr || !pr.url || !engine.tokenFor(acc)) return livre;
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'baseRefName,statusCheckRollup'], { env: engine.ghEnv(acc) });
  if (!r.ok) return livre;
  const j = io.parseJson(r.stdout, null);
  if (!j) return livre;
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const exigidos = await checksExigidosDoRepo(engine, repo, j.baseRefName);
  if (!Array.isArray(exigidos) || !exigidos.length) return livre;
  const v = checksExigidosVerdes(j.statusCheckRollup, exigidos);
  return { bloqueado: !v.pronto, faltando: v.faltando };
}

// Texto do aviso. PURA, mesma régua de redação do resto: português, sem travessão.
const ESTADO_TEXTO = { rodando: 'ainda rodando', vermelho: 'vermelho', ausente: 'ainda não começou' };
function textoDosChecks(key, faltando) {
  const itens = (faltando || []).slice(0, 3)
    .map(f => `${f.nome} (${ESTADO_TEXTO[f.estado] || f.estado})`);
  if (!itens.length) return '';
  const resto = (faltando || []).length - itens.length;
  const lista = itens.join(', ') + (resto > 0 ? ` e mais ${resto}` : '');
  return `${key}: esperando os checks obrigatórios ficarem verdes (${lista}). O botão Revisar continua valendo se você não quiser esperar.`;
}

/* Aviso ÚNICO por PR e por ESTADO dos checks: o mesmo PR volta à boca do lançamento a
   cada ciclo, e repetir a frase toda vez seria ruído. Quando o que falta MUDA (a pipe
   andou), o aviso novo é informação, não repetição, e por isso a chave carrega a lista.
   As chaves velhas do mesmo PR saem na entrada, como no aviso do gate de consciência. */
function avisaBloqueioChecks(engine, pr, faltando) {
  if (!(engine.checksAvisado instanceof Set)) engine.checksAvisado = new Set();
  const chave = `${pr.key}@${(faltando || []).map(f => `${f.nome}:${f.estado}`).join(',')}`;
  if (engine.checksAvisado.has(chave)) return;
  for (const k of [...engine.checksAvisado]) {
    if (k.slice(0, k.indexOf('@')) === pr.key) engine.checksAvisado.delete(k);
  }
  engine.checksAvisado.add(chave);
  const texto = textoDosChecks(pr.key, faltando);
  if (texto) engine.emit('toast', { kind: 'info', text: texto });
}

const checksMod = {
  checksExigidosVerdes, checksExigidosDoRepo, bloqueadoPorChecks, textoDosChecks, avisaBloqueioChecks,
};
export default checksMod;
export {
  checksExigidosVerdes, checksExigidosDoRepo, bloqueadoPorChecks, textoDosChecks, avisaBloqueioChecks,
};
