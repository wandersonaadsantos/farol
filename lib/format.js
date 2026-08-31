// Helpers de formatação/classificação puros (sem estado, sem IO). Ver docs/QUALITY.md.

// Rotulo humano do id cru que o CLI reporta no evento system/init: claude-opus-4-8
// vira "Opus 4.8". So exibicao, nunca entra em decisao.
function modelLabel(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (/^auto$/i.test(raw)) return 'Auto (custo-benefício)';
  const fam = /opus/i.test(raw) ? 'Opus' : /sonnet/i.test(raw) ? 'Sonnet'
    : /haiku/i.test(raw) ? 'Haiku' : /fable/i.test(raw) ? 'Fable' : '';
  // versao em DUAS partes tem precedencia (4-8 = 4.8), com minor de ate 2 digitos
  // e fronteira (?=-|$): assim a data de snapshot (8 digitos) nunca e lida como
  // minor. Em claude-haiku-4-5-20251001 pega 4-5; em claude-sonnet-4-20250514 a
  // primeira forma NAO casa e a segunda pega so o major (Sonnet 4).
  const dois = (raw.match(/(\d+)-(\d{1,2})(?=-|$)/) || [])[0];
  const um = dois ? '' : (raw.match(/-(\d+)(?:-|$)/) || [])[1];
  const ver = dois ? dois.replace('-', '.') : (um || '');
  return fam ? `${fam}${ver ? ' ' + ver : ''}` : raw;
}

// Branches permanentes do fluxo (gitflow + ambientes): NUNCA podem ser deletadas
// depois de um merge. Uma promocao develop->release, por exemplo, tem 'develop'
// como head; deletar a branch ali apagaria a develop. Tudo que NAO casar aqui
// (feature/*, fix/*, task-*, hotfix/*, bugfix/*...) e descartavel e pode ser
// limpo pra evitar lixo. Sem nome = trata como permanente por seguranca.
function isPermanentBranch(name) {
  const b = String(name || '').trim().toLowerCase();
  if (!b) return true;
  if (['main', 'master', 'develop', 'dev', 'trunk', 'staging', 'homolog',
    'homologacao', 'hml', 'hmg', 'prod', 'production', 'release'].includes(b)) return true;
  // familias versionadas: release/*, release_1.2, hml-*, hmg-v*, homolog*, prod*, env/*
  if (/^(release|hml|hmg|homolog|prod|production|staging|env)[\/_-]/.test(b)) return true;
  return false;
}

// Carimbo do farol.log em horário de Brasília com o fuso EXPLÍCITO na linha
// (pedido do Wanderson em 16/08/2026: o log em UTC cru deslocava a linha do
// tempo em 3h contra os carimbos do checkpoint, que sempre foram Brasília, e
// isso enganava o diagnóstico). O offset sai do próprio IANA America/Sao_Paulo,
// nunca de literal: se o Brasil voltar a ter horário de verão, a linha acompanha.
function logStamp(d = new Date()) {
  const ts = d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo', hour12: false });
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', timeZoneName: 'longOffset' })
    .formatToParts(d).find(p => p.type === 'timeZoneName');
  // ICU usa U+2212 como sinal em alguns ambientes; o log é ASCII. "GMT" puro = UTC.
  const off = String((tz && tz.value) || 'GMT').replace('GMT', '').replace('−', '-') || '+00:00';
  return `${ts} ${off}`;
}

/* Texto de um motivo. Desde a v2.48.0 `reasons`/`attention` viajam como
   `{ text, kind }`, e quem interpolar o objeto cru numa string escreve
   "[object Object]" na cara do usuário. Já aconteceu DUAS vezes: no card de
   "Precisa de você" (corrigido na v2.48.3) e nas três notificações do sistema
   (v2.51.1, achado pelo Wanderson em 20/08/2026, e o CHANGELOG da v2.48.3
   afirmava que a notificação tinha sido corrigida sem ter sido).

   Entrada antiga (string pura, de um decisions.json anterior à v2.48.0) passa
   direto, que é a leitura conservadora de sempre.

   NOTA: `ui/pure.js` tem a própria cópia de propósito. Ele é servido ao
   NAVEGADOR como módulo ES e não pode importar de `lib/`, que o servidor não
   expõe. As duas são triviais e estão travadas em teste dos dois lados. */
function reasonText(r) {
  return (r && typeof r === 'object') ? (r.text || '') : (r || '');
}

/* "O PR andou depois desta revisão", dito uma vez só. Os DOIS pontos de postagem
   (o automático em review.js e o clique em decision.js) recusam pelo mesmo motivo e
   por isso falam a mesma frase; os shas curtos das duas pontas estão aí pra você
   conferir no GitHub sem abrir o app. Sinal `->` em ASCII, igual ao resto do log. */
function staleHeadText(lido, agora) {
  const curto = (sha) => String(sha || '').slice(0, 7) || '?';
  return `o autor empurrou commit novo durante a revisão (${curto(lido)} -> ${curto(agora)})`;
}

/* "A sessão não devolveu JSON", dito de um jeito que dá pra diagnosticar depois.

   Os DOIS parsers (revisão em session.js, autoanálise em selfpr.js) chegam aqui pelo
   mesmo caminho: o stream resolveu bem e o texto final não tem um objeto sequer. Por
   trás disso há duas causas OPOSTAS, e a mensagem antiga não as separava: o resultado
   veio VAZIO (o `?? ''` do parseEnvelope absorve `result` ausente) ou a sessão
   respondeu PROSA em vez do envelope. A primeira é falha de transporte, a segunda é
   contrato quebrado, e quem lê o farol.log precisa saber qual das duas foi.

   Vai só o TAMANHO, nunca um trecho do texto: o final de sessão pode conter qualquer
   coisa que ela leu no repositório, e log é para sempre (ver [[nunca-vazar-segredo]]).
   O prefixo é preservado ao pé da letra porque a taxonomia de falha casa por texto. */
function semJsonText(texto) {
  const n = String(texto || '').length;
  return n === 0
    ? 'a sessão não devolveu JSON (o resultado veio vazio)'
    : `a sessão não devolveu JSON (${n} caracteres de texto, nenhum objeto)`;
}

export default { modelLabel, isPermanentBranch, logStamp, reasonText, staleHeadText, semJsonText };
export { modelLabel, isPermanentBranch, logStamp, reasonText, staleHeadText, semJsonText };
