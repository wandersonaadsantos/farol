// Papel do aparelho no conjunto (28/09/2026, decisão do dono): o admin ASSISTE e DECIDE,
// nunca executa. Puro. Sem sinal do banco, a chave local de admin decide, e a falha é
// FECHADA: admin que perdeu a rede não volta a executar sozinho.
function ehObservador({ adminDev = '', deviceId = '', temChaveDeAdmin = false } = {}) {
  const eu = String(deviceId || '');
  if (!eu) return false;
  const admin = String(adminDev || '');
  if (admin) return admin === eu;
  return temChaveDeAdmin === true;
}

export default { ehObservador };
export { ehObservador };
