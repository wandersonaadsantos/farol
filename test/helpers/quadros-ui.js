// Relógio visual controlado para fixtures de integração: a asserção lê depois da pintura.
function controlarQuadros() {
  const pendentes = [];
  globalThis.requestAnimationFrame = fn => { pendentes.push(fn); return pendentes.length; };
  function pintar() { for (const fn of pendentes.splice(0)) fn(); }
  return { pintar };
}
export { controlarQuadros };
