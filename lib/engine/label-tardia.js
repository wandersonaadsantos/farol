// A label "<conta>:revisando" que espera a sessão provar vida (PURO, sem engine).
// Sem coordenação entre aparelhos, a label entrava antes do spawn, e toda sessão que
// morria nos primeiros segundos deixava um piscar público de ~20 s no PR. Agora a adição
// roda UMA vez, no primeiro conteúdo do modelo ou `esperaMs` depois da admissão, o que
// vier primeiro.
//
// Qual evento libera (21/11/2026, porte do fork em 24/11/2026): até aqui era qualquer evento
// do provedor, e o primeiro é o `init` do sistema, que o CLI emite antes de chamar a API. A
// recusa por limite do plano chega DEPOIS dele, como mensagem sintética do CLI ("<synthetic>",
// com `error`), e logo em seguida o `result` de erro: a label entrava no init e saía na morte.
// Quem chama (review.js) só aciona `aoEvento` com o conteúdo do modelo (`doModelo`, marcado
// pelos três provedores), texto ou ferramenta; a recusa costuma chegar em poucos segundos,
// antes do prazo de `esperaMs`. `cancelar` apaga o timer e impede disparo futuro; `promessa` devolve a
// adição em curso (ou vazio se nunca disparou), para o encerramento esperar antes de remover.
export function armarLabelTardia({ adicionar, esperaMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let disparada = false;
  let cancelada = false;
  let timer = null;
  let adicao = Promise.resolve('');

  const soltarTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const disparar = () => {
    if (disparada || cancelada) return;
    disparada = true;
    soltarTimer();
    // a adição é best-effort: falha vira vazio, nunca rejeição que escape do encerramento
    adicao = Promise.resolve().then(adicionar).then((l) => String(l || ''), () => '');
  };

  return {
    aoEvento: disparar,
    aoAdmitir() {
      if (disparada || cancelada || timer !== null) return;
      timer = setTimer(disparar, esperaMs);
    },
    cancelar() {
      cancelada = true;
      soltarTimer();
    },
    promessa: () => adicao,
  };
}

// O evento do feed que libera a label: só o conteúdo do modelo (texto ou ferramenta), nunca o
// init do sistema, a reconexão nem a mensagem sintética de erro do CLI.
export function liberaALabel(evento) {
  return evento?.doModelo === true;
}
