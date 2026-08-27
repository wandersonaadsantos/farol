// O Farol usa o Codex CLI aqui para consumir a franquia do plano ChatGPT.
// Login por API key e valido no CLI, mas nao satisfaz este contrato.
function usaPlanoChatGPT(texto) {
  return /logged in using chatgpt/i.test(String(texto || ''));
}

export default { usaPlanoChatGPT };
export { usaPlanoChatGPT };
