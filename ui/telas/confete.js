/* Farol · UI: a festa de 4 segundos da análise impecável (pedido do Wanderson,
   17/09/2026). Quem decide QUANDO festejar são as puras `analiseImpecavel` e
   `festasPendentes` (ui/pure/autoanalise.js); aqui só acontece a animação.

   Sem dependência nova (invariante 1): um canvas por cima da tela, partículas em
   requestAnimationFrame, e o elemento sai do DOM no fim. Nada de som, nada de clique,
   e `pointer-events: none` para a festa nunca atrapalhar quem está usando o app.

   MOVIMENTO REDUZIDO: com `prefers-reduced-motion` ligado no sistema, não há partícula
   nenhuma. A comemoração vira um aviso discreto pelo mesmo tempo, porque quem pediu menos
   movimento pediu menos movimento, não menos informação. */

const DURACAO_MS = 4000;
const PARTICULAS = 140;
const GRAVIDADE = 0.00022;
const CORES = ['#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#8338ec', '#fb5607'];

function movimentoReduzido() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function novaParticula(largura) {
  return {
    x: Math.random() * largura,
    y: -20 - Math.random() * largura * 0.2,
    vx: (Math.random() - 0.5) * 0.18,
    vy: 0.08 + Math.random() * 0.22,
    giro: Math.random() * Math.PI,
    dGiro: (Math.random() - 0.5) * 0.02,
    lado: 6 + Math.random() * 7,
    cor: CORES[Math.floor(Math.random() * CORES.length)],
  };
}

function desenhar(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.giro);
  ctx.fillStyle = p.cor;
  ctx.fillRect(-p.lado / 2, -p.lado / 4, p.lado, p.lado / 2);
  ctx.restore();
}

function avisoDiscreto(texto, duracaoMs) {
  const aviso = document.createElement('div');
  aviso.className = 'confete-aviso';
  aviso.setAttribute('role', 'status');
  aviso.textContent = texto;
  document.body.appendChild(aviso);
  setTimeout(() => aviso.remove(), duracaoMs);
  return aviso;
}

/* Devolve o elemento criado (canvas ou aviso), ou null quando o ambiente não tem canvas.
   `duracaoMs` existe para o teste não esperar quatro segundos de verdade. */
export function festejar({ texto = 'Análise impecável: nada a ajustar.', duracaoMs = DURACAO_MS } = {}) {
  if (typeof document === 'undefined' || !document.body) return null;
  if (movimentoReduzido()) return avisoDiscreto(texto, duracaoMs);

  const canvas = document.createElement('canvas');
  canvas.className = 'confete';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return avisoDiscreto(texto, duracaoMs);
  const largura = window.innerWidth || 1200;
  const altura = window.innerHeight || 800;
  canvas.width = largura;
  canvas.height = altura;
  document.body.appendChild(canvas);
  avisoDiscreto(texto, duracaoMs);

  const particulas = Array.from({ length: PARTICULAS }, () => novaParticula(largura));
  const inicio = Date.now();
  const passo = (agora) => {
    const decorrido = (Number(agora) || Date.now()) - inicio;
    const restante = duracaoMs - decorrido;
    if (restante <= 0) { canvas.remove(); return; }
    ctx.clearRect(0, 0, largura, altura);
    // o último segundo desaparece junto com as partículas, para a festa terminar e não sumir
    ctx.globalAlpha = restante < 1000 ? Math.max(restante / 1000, 0) : 1;
    for (const p of particulas) {
      p.vy += GRAVIDADE * 16;
      p.x += p.vx * 16;
      p.y += p.vy * 16;
      p.giro += p.dGiro * 16;
      if (p.y > altura + 20) Object.assign(p, novaParticula(largura), { y: -20 });
      desenhar(ctx, p);
    }
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
  return canvas;
}

export default { festejar };
