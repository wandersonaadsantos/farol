// O que um head novo, visto pela primeira vez num PR, destrava (02/10/2026). Duas reações
// ao mesmo fato, num lugar só: o relógio de PR quieto do round automático recomeça, e a
// saída de cena de um commit anterior deixa de valer. Folha: só recebe o engine.

// Carimba QUANDO este head foi visto pela primeira vez (debounce do round automático,
// mapa em memória de propósito: reinício zera e o debounce recomeça, lado seguro). Head
// vazio nunca carimba nem apaga: falta de dado não mexe em relógio. Saiu do
// refreshStaleStates (selfpr.js), que segue sendo quem chama.
function observarHead(engine, key, head, agora = Date.now()) {
  largarSeHeadMudou(engine, key, head);
  if (!head) return;
  const atual = (engine.headQuietoDesde || {})[key];
  if (!atual || atual.head !== head) engine.headQuietoDesde[key] = { head, at: agora };
}

// A saída de cena vale para o commit em que ela nasceu (02/10/2026). O registro sempre
// guardou o head, mas nenhuma trava o comparava: num PR em que eu pedi mudanças, outra
// pessoa entrou com a label, o autor corrigiu e me pediu revisão de novo, e o PR foi
// mergeado sem eu revisar o código final, porque a saída de cena valia para o PR
// inteiro. Commit novo libera; se a pessoa continuar revisando o commit novo, a label
// dela volta a me tirar de cena no próximo ciclo, e o "um Farol por PR" segue valendo.
// Vale também para a co-assinada: a aprovação em meu nome falava do commit anterior.
// Head vazio dos dois lados (leitura que falhou, registro antigo sem head) não libera.
function largarSeHeadMudou(engine, key, head) {
  const reg = (engine.skipComentado || {})[key];
  if (!reg || !reg.head || !head || reg.head === head) return false;
  delete engine.skipComentado[key];
  engine.saveSkipComentado();
  engine.log('INFO', `${key}: commit novo (${String(reg.head).slice(0, 7)} -> ${String(head).slice(0, 7)}) depois da saída de cena; volto a revisar sozinho.`);
  engine.emit('toast', { kind: 'info', text: `${key}: chegou commit novo depois que saí de cena, então volto a revisar este PR sozinho.` });
  return true;
}

export default { observarHead, largarSeHeadMudou };
export { observarHead, largarSeHeadMudou };
