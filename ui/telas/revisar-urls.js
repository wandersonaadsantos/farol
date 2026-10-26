import { syncConfirmacoesDoClique } from '../pure.js';
import { estado } from './estado.js';
import { api, toast, confirmModal } from './infra.js';

/* ---------- coordenação no clique Revisar (U2) ----------

   A resposta de /api/review traz `coordenacao[]` quando o preflight segurou algum PR.
   A ESCOLHA do desfecho por motivo é pura (syncConfirmacaoDoClique, em ui/pure.js);
   aqui fica só o modal e o reenvio. O override é reenviado por PR, e só pelo PR que
   a pessoa confirmou: mandar o lote inteiro com a flag contornaria a coordenação de
   PRs que ninguém confirmou. */
// owner/repo#N a partir da URL do PR: é assim que a URL que o clique ENVIOU vira a
// chave que a resposta devolve, sem depender de o PR estar numa lista da tela.
function keyDaUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url || ''));
  return m ? `${m[1]}/${m[2]}#${m[3]}` : '';
}

// `urls` é a lista que o clique enviou, e é ela que resolve a chave. Procurar só em
// estado().queue e estado().panorama deixava a confirmação sem abrir quando o clique vinha de
// Resolvidos ou de Decisões, que é justamente onde o PR não está nas duas listas. As
// listas ficam como degrau de recuo para chamador que não passe as urls.
async function tratarCoordenacaoDoClique(resp, mode, urls = []) {
  const porKey = new Map(urls.map((u) => [keyDaUrl(u), u]).filter(([k]) => k));
  for (const c of syncConfirmacoesDoClique(resp)) {
    if (c.tipo === 'aviso') { toast('info', c.texto, 7000); continue; }
    const daLista = (estado().queue || []).concat(estado().panorama || []).find(p => p.key === c.key);
    const url = porKey.get(c.key) || (daLista && daLista.url) || '';
    if (!url) { toast('info', `${c.key}: a coordenação segurou a revisão, e o PR não está mais na tela.`, 6000); continue; }
    // uma confirmação por vez é o ponto: são modais, e empilhar dois esconderia um
    const ok = await confirmModal({ title: c.titulo, confirmLabel: c.acao, body: c.corpo });
    if (ok) revisarUrls([url], { [c.override]: true }, mode);
  }
}

/* Boca ÚNICA do clique Revisar. Todos os caminhos (fila, panorama, "revisar de novo",
   revisar tudo, terminal) passam por aqui, pela mesma razão do enqueueHeadless no
   engine: garantia que precisa valer sempre mora no estrangulamento, e não em cada
   chamador. Sem isto, o botão que alguém acrescentasse amanhã ignoraria a confirmação
   da coordenação em silêncio. */
function revisarUrls(urls, extras = {}, mode = 'auto') {
  const corpo = { urls, ...extras };
  if (mode === 'terminal') corpo.mode = 'terminal';
  return api('/api/review', corpo).then(r => {
    if (r && Array.isArray(r.coordenacao) && r.coordenacao.length) tratarCoordenacaoDoClique(r, mode, urls);
    return r;
  });
}

export { revisarUrls };
