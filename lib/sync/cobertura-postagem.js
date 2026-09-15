// Declaração de cobertura da arbitragem de postagem por conta (CT-COMPAT, "Ativação por
// versão"). PURA. Aparelho sem batimento recente não prova que não vai voltar a postar, e
// a presença de hoje não diz quais contas cada aparelho usa: por isso TODO aparelho visto
// na sincronização conta como capaz de postar por qualquer conta, e basta um numa versão
// que não participa (ou sem versão legível) para a conta ser declarada não coberta.
//
// POSTAGEM_COORDENADA_DESDE é a primeira versão publicada com a arbitragem. O valor abaixo
// é o menor possível depois da 2.59.3; o PR de release desta entrega o ajusta para o
// número efetivamente publicado (ver "Limites que continuam declarados" no plano C0b).
const POSTAGEM_COORDENADA_DESDE = '2.59.4';
const VERSAO_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function partes(v) {
  const m = VERSAO_RE.exec(String(v || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compararVersao(a, b) {
  const pa = partes(a);
  const pb = partes(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function naoParticipa(d) {
  const c = compararVersao(d && d.farolVersion, POSTAGEM_COORDENADA_DESDE);
  return c === null || c < 0;
}

function coberturaDePostagem(devices, account) {
  const lista = Object.entries(devices && typeof devices === 'object' ? devices : {});
  const antigos = lista.filter(([, d]) => naoParticipa(d)).map(([id, d]) => String((d && d.name) || '') || id);
  return { account: String(account || ''), coberta: lista.length > 0 && antigos.length === 0, naoCobertaPor: antigos };
}

export default { coberturaDePostagem, compararVersao, POSTAGEM_COORDENADA_DESDE };
export { coberturaDePostagem, compararVersao, POSTAGEM_COORDENADA_DESDE };
