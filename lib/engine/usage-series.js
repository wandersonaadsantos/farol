// Agregação dos buckets e projeção das séries reconciliadas do consumo.
// Sem IO, relógio ou política de orçamento; as definições são compartilhadas com o registro.
const KIND_LABEL = {
  review: 'Revisão', self: 'Autoanálise', pushback: 'Pushback',
  tool: 'Ferramentas', chat: 'Chat', outro: 'Outro'
};

// ordem fixa das camadas do grafico empilhado: cor estavel mesmo quando um tipo
// nao teve sessao num dia (o dia entra com bucket zerado, nao some da lista).
const KIND_ORDER = ['review', 'self', 'chat', 'tool', 'pushback', 'outro'];

// nome reservado da camada/linha/coluna sintetica de reconciliacao: a fatia de um
// dia que existe no eixo autoritativo (days) mas nao tem detalhamento nos buckets
// cruzados (dias anteriores a v2.38.0, sessoes de antes de uma atualizacao no meio
// do dia, qualquer deriva futura entre escritas). Nunca colide com kind (KIND_ORDER
// e fechado), com conta (login GitHub nao comeca com _) nem com modelo (modelLabel
// nunca gera _resto).
const RESTO = '_resto';
const RESTO_LABEL = 'Sem detalhamento';

function emptyBucket() {
  return { sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
}

function addBucket(into, b) {
  into.sessions += b.sessions;
  into.inputTokens += b.inputTokens;
  into.outputTokens += b.outputTokens;
  into.cacheReadTokens += b.cacheReadTokens;
  into.cacheCreationTokens += b.cacheCreationTokens;
  into.costUsd += b.costUsd;
}

// a fatia de um dia que o eixo autoritativo (days) tem e a soma dos buckets
// detalhados nao cobre, campo a campo, clamp em zero: e a camada "_resto" da
// reconciliacao. `covered` e a soma dos buckets da dimensao naquele dia.
// Clamp: se algum bucket detalhado estiver A FRENTE de days (deriva inversa,
// ex.: crash entre as duas escritas), o resto zera e o detalhado prevalece.
function remainderBucket(dayTotal, covered) {
  const r = emptyBucket();
  if (!dayTotal) return r;
  r.sessions = Math.max(0, (dayTotal.sessions || 0) - covered.sessions);
  r.inputTokens = Math.max(0, (dayTotal.inputTokens || 0) - covered.inputTokens);
  r.outputTokens = Math.max(0, (dayTotal.outputTokens || 0) - covered.outputTokens);
  r.cacheReadTokens = Math.max(0, (dayTotal.cacheReadTokens || 0) - covered.cacheReadTokens);
  r.cacheCreationTokens = Math.max(0, (dayTotal.cacheCreationTokens || 0) - covered.cacheCreationTokens);
  // custo e float: soma e subtracao na ordem inversa deixam poeira de ponto
  // flutuante; abaixo de um decimo de centavo o resto e ruido, nao dado
  r.costUsd = Math.max(0, (dayTotal.costUsd || 0) - covered.costUsd);
  if (r.costUsd < 0.001) r.costUsd = 0;
  return r;
}

function hasAny(b) {
  return !!(b.sessions || b.inputTokens || b.outputTokens || b.cacheReadTokens || b.cacheCreationTokens || b.costUsd);
}
function cellsWithRemainder(cells, remainder) {
  return { ...cells, [RESTO]: { [RESTO]: remainder } };
}

// re-fatiar daysByKindModel (chave `${kind}|${model}|${day}`) em serie por dia,
// pra UI somar o periodo (7/30/90) que ela mesma escolheu, do mesmo jeito que ja
// faz com `series`. kind e model nunca contem "|", entao o split e seguro.
// RECONCILIADO: a fatia do dia sem detalhamento entra em cells._resto._resto,
// entao o total geral da matriz na janela SEMPRE bate com o KPI da mesma janela.
function matrixSeriesFrom(store) {
  const byDay = {};
  for (const [key, bucket] of Object.entries(store.daysByKindModel || {})) {
    const [kind, model, day] = key.split('|');
    if (!byDay[day]) byDay[day] = {};
    if (!byDay[day][kind]) byDay[day][kind] = {};
    byDay[day][kind][model] = bucket;
  }
  let hasResto = false;
  const series = Object.keys(store.days).sort().map(day => {
    const cells = byDay[day] || {};
    const covered = emptyBucket();
    for (const row of Object.values(cells)) for (const b of Object.values(row)) addBucket(covered, b);
    const resto = remainderBucket(store.days[day], covered);
    if (hasAny(resto)) {
      hasResto = true;
      return { day, cells: cellsWithRemainder(cells, resto) };
    }
    return { day, cells };
  });
  return { series, hasResto };
}

// idem, pra uma dimensao so (kind, model ou account): devolve, por dia, o bucket
// de cada nome da dimensao (zerado quando aquele nome nao teve sessao no dia).
// RECONCILIADO: quando a soma dos nomes nao cobre days[day], a diferenca vira o
// item _resto do dia (invariante: soma dos items == days[day], campo a campo).
// O chamador decide se _resto entra na lista de nomes exposta (so quando algum
// dia teve resto); os items ficam SEMPRE na ordem de `names` + _resto no fim,
// porque a UI zipa item/cor/legenda por indice.
function stackedSeriesFor(store, map, names, labelFn) {
  const days = Object.keys(store.days).sort();
  let hasResto = false;
  const series = days.map(day => {
    const items = names.map(name => ({ name, label: labelFn(name), ...(map[`${name}|${day}`] || emptyBucket()) }));
    const covered = emptyBucket();
    for (const it of items) addBucket(covered, it);
    const resto = remainderBucket(store.days[day], covered);
    if (hasAny(resto)) hasResto = true;
    items.push({ name: RESTO, label: RESTO_LABEL, ...resto });
    return { day, items };
  });
  return { series, hasResto };
}

export { KIND_LABEL, KIND_ORDER, RESTO, emptyBucket, addBucket, matrixSeriesFrom, stackedSeriesFor };
