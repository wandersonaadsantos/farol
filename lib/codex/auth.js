// O Farol usa o Codex CLI aqui para consumir a franquia do plano ChatGPT.
// Login por API key e valido no CLI, mas nao satisfaz este contrato.
function usaPlanoChatGPT(texto) {
  return /logged in using chatgpt/i.test(String(texto || ''));
}

// O que o doctor mostra do `codex login status`: se o login e pelo plano ChatGPT (o
// contrato acima) e a primeira linha do que o CLI respondeu. Morava copiado no server.js,
// com a regex do plano escrita de novo ao lado desta funcao: duas respostas para "o login
// e pelo ChatGPT?", e a primeira correcao consertaria so uma delas.
function leituraDoLogin(r) {
  const res = r || {};
  const texto = `${res.stdout || ''}\n${res.stderr || ''}`;
  let detalhe = '';
  if (res.stdout || res.stderr) detalhe = texto.trim().split(/\r?\n/)[0];
  else if (!res.ok) detalhe = 'codex login status falhou' + (res.code ? ` (código ${res.code})` : '');
  return { chatGPT: !!res.ok && usaPlanoChatGPT(texto), detalhe };
}

export default { usaPlanoChatGPT, leituraDoLogin };
export { usaPlanoChatGPT, leituraDoLogin };
