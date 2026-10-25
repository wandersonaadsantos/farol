// O estado chega imediatamente; somente a pintura é agrupada por dependência e visibilidade.
function criarAgendaVisual({ grupos, oculta, agendar }) {
  const sujos = new Set();
  let marcada = false;
  function pintar() {
    marcada = false;
    if (oculta()) return;
    for (const grupo of grupos) {
      if (!sujos.has(grupo.id) || (grupo.visivel && !grupo.visivel())) continue;
      sujos.delete(grupo.id);
      grupo.pintar();
    }
  }
  function pedirPintura() {
    if (marcada || oculta()) return;
    marcada = true;
    agendar(pintar);
  }
  function invalidar(campos) {
    const alterados = campos && new Set(campos);
    for (const grupo of grupos) {
      if (!alterados || grupo.campos.some(campo => alterados.has(campo))) sujos.add(grupo.id);
    }
    pedirPintura();
  }
  return { invalidar, pintar, pedirPintura, pendentes: () => [...sujos] };
}

function telaVisivel(id, sub, doc = document) {
  if (doc.hidden) return false;
  if (doc.body.dataset.tab !== id && !doc.querySelector(`#tab-${id}`)?.classList.contains('active')) return false;
  return !sub || (doc.body.dataset.radarSub || 'mim') === sub;
}

function editandoFormulario(doc = document) {
  const el = doc.activeElement;
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
function textoSelecionado(seletor, doc = document) {
  const selecao = doc.getSelection?.();
  if (!selecao || selecao.isCollapsed) return false;
  return !!doc.querySelector(seletor)?.contains(selecao.anchorNode);
}

export { criarAgendaVisual, telaVisivel, editandoFormulario, textoSelecionado };
