// A credencial que a pessoa acabou de provar com a senha vale a partir de agora, no
// cliente vivo, e não só no disco.
//
// As regras do banco exigem senha RECENTE para trocar o admin e para limpar dados
// (`auth.token.auth_time * 1000 + 300000 > now`). O cliente guarda o ID token do login,
// que pode ter horas, e a escrita autorizada sai com o auth_time velho: o banco recusa e
// o app conta uma história errada ("outro aparelho virou admin"). Medido na bancada com
// os emuladores oficiais e as regras do commit, 16/09/2026.
//
// Cliente sem fonte de token (aparelho desconectado) não é erro aqui: quem depende da
// conexão já recusou antes de chegar neste ponto.
function adotarEntrada(rt, entrada) {
  const fonte = rt && rt.tokenSource;
  if (!fonte || typeof fonte.adotar !== 'function') return false;
  return fonte.adotar(entrada);
}

export default { adotarEntrada };
export { adotarEntrada };
