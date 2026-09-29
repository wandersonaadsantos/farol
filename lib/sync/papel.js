// Papel do aparelho no conjunto, puro: este aparelho é o admin? Na v2.64.0 o admin só
// assistia; desde 28/09/2026 à noite (decisão do dono) ele revisa a própria fila como
// qualquer aparelho, e o papel só decide o que é DE TELA: a visão da frota e a decisão
// pelos outros. Sem sinal do banco, a chave local de admin decide.
function ehAdmin({ adminDev = '', deviceId = '', temChaveDeAdmin = false } = {}) {
  const eu = String(deviceId || '');
  if (!eu) return false;
  const admin = String(adminDev || '');
  if (admin) return admin === eu;
  return temChaveDeAdmin === true;
}

export default { ehAdmin };
export { ehAdmin };
