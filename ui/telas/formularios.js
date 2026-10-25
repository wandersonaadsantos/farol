// Mantém rascunhos de campos com identidade estável, inclusive ao editar outro campo.
function criarPreservacaoDeFormulario() {
  let projetados = new Map();
  const campos = raiz => [...raiz.querySelectorAll('input[id], textarea[id], select[id]')];
  const valor = el => ({ tag: el.tagName, type: el.type, value: el.value, checked: el.checked });
  const igual = (a, b) => a && b && a.tag === b.tag && a.type === b.type && a.value === b.value && a.checked === b.checked;
  return (raiz, pintar) => {
    const rascunhos = new Map();
    const arquivos = new Map();
    for (const el of campos(raiz)) {
      // FileList pertence ao controle nativo. value não pode restaurar um arquivo escolhido.
      if (el.type === 'file') { if (el.files?.length) arquivos.set(el.id, el); continue; }
      const anterior = projetados.get(el.id);
      if (anterior && !igual(anterior, valor(el))) rascunhos.set(el.id, valor(el));
    }
    pintar();
    const novos = new Map();
    for (const el of campos(raiz)) {
      if (el.type === 'file') {
        const original = arquivos.get(el.id);
        if (original && original !== el) el.replaceWith(original);
        continue;
      }
      const atual = valor(el), rascunho = rascunhos.get(el.id);
      novos.set(el.id, atual);
      if (!rascunho || rascunho.tag !== atual.tag || rascunho.type !== atual.type) continue;
      el.value = rascunho.value;
      el.checked = rascunho.checked;
    }
    projetados = novos;
  };
}
export { criarPreservacaoDeFormulario };
