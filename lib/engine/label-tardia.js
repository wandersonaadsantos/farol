// A label "<conta>:revisando" que espera a sessão provar vida (PURO, sem engine).
// Sem coordenação entre aparelhos, a label entrava antes do spawn, e toda sessão que
// morria nos primeiros segundos deixava um piscar público de ~20 s no PR. Agora a adição
// roda UMA vez, no primeiro evento do provedor ou `esperaMs` depois da admissão, o que
// vier primeiro. `cancelar` apaga o timer e impede disparo futuro; `promessa` devolve a
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
