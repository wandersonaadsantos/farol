// Monta os quadros do B2 (arquivos .dc.html do Claude Design) a partir de fragmentos em
// quadros/. Cada fragmento é o corpo de um quadro; o montador injeta o CSS comum, o topo do
// app e a navegação do Sistema, para os quadros não divergirem entre si.
//   @@TOPO:<aba>@@      topo com a aba ativa (radar, time, consumo, sistema)
//   @@NAV:<secao>@@     barra lateral do Sistema com a seção ativa
// Uso: node montar.mjs <pasta de saída>
import fs from 'node:fs';
import path from 'node:path';

const AQUI = import.meta.dirname;
const SAIDA = path.resolve(process.argv[2] || path.join(AQUI, 'saida'));
const css = fs.readFileSync(path.join(AQUI, 'comum.css'), 'utf8');

const LOGO = '<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#ffb454" d="M10.7 5.2 2 2.6v5.4l8.7-1.1z" opacity=".5"/><path fill="#ffb454" d="M13.3 5.2 22 2.6v5.4l-8.7-1.1z"/><path fill="#e7ecf5" d="M12 1.9l1.6 2h-3.2l1.6-2z"/><rect fill="#e7ecf5" x="10.5" y="3.9" width="3" height="2.6"/><rect fill="#ffb454" x="11.1" y="4.4" width="1.8" height="1.7"/><rect fill="#e7ecf5" x="9.8" y="6.5" width="4.4" height="1.1" rx=".55"/><path fill="#e7ecf5" d="M10.7 7.6h2.6L15.2 20H8.8l1.9-12.4z"/><rect fill="#0b0e14" x="10.2" y="11" width="3.7" height="1.1"/><rect fill="#0b0e14" x="9.7" y="14.6" width="4.7" height="1.1"/><rect fill="#e7ecf5" x="8" y="20" width="8" height="1.7" rx=".85"/></svg>';

const ABAS = [['radar', 'Radar'], ['time', 'Time'], ['consumo', 'Consumo'], ['sistema', 'Sistema']];

function topo(ativa) {
  const abas = ABAS.map(([id, nome]) => `<span class="nav-item${id === ativa ? ' active' : ''}">${nome}</span>`).join('');
  return `<header class="topbar"><div class="topbar-main">
  <div class="brand">${LOGO}<span class="brand-name">Farol</span><span class="ver">v2.60.0</span><span class="pill ok">monitorando</span></div>
  <nav class="tabs">${abas}</nav>
  <div class="top-actions"><span class="btn sm ghost">Verificar agora</span></div>
</div></header>`;
}

// ícones de traço, 24px, um estilo só
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SECOES = [
  ['overview', 'Visão geral', I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')],
  ['accounts', 'Contas', I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>')],
  ['automation', 'Automação', I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>')],
  ['connections', 'Conexões', I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')],
  ['jira', 'Jira', I('<path d="M12 3l9 9-9 9-9-9z"/><path d="M12 8l4 4-4 4-4-4z"/>')],
  ['sync', 'Sincronização', I('<path d="M20 12a8 8 0 0 1-14 5M4 12a8 8 0 0 1 14-5"/><path d="M18 3v4h-4M6 21v-4h4"/>')],
  ['devices', 'Aparelhos', I('<rect x="3" y="4" width="13" height="10" rx="1.5"/><path d="M7 18h5"/><rect x="17" y="8" width="5" height="12" rx="1.2"/>')],
  ['groups', 'Grupos de consumo', I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')],
  ['plans', 'Plano e chaves', I('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>')],
  ['reviewers', 'Reviewers', I('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 3-5 6-5s6 1.5 6 5"/><path d="M16 5.5a3 3 0 0 1 0 5.5M18 15c2 .6 3 2 3 5"/>')],
  ['prefs', 'Preferências', I('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')],
  ['news', 'Novidades', I('<path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/>')],
  ['diag', 'Diagnóstico', I('<path d="M3 12h4l2-6 4 12 2-6h6"/>')],
  ['about', 'Sobre', I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')],
];

function nav(ativa) {
  const itens = SECOES.map(([id, nome, icone]) => `<span class="sys-nav-item${id === ativa ? ' active' : ''}">${icone}${nome}</span>`).join('');
  return `<aside class="sys-sidebar"><div class="sys-search">Buscar configuração…</div><nav class="sys-nav">${itens}</nav><div class="sys-foot">Farol v2.60.0<br>dados de exemplo</div></aside>`;
}

function quadro(corpo) {
  const html = corpo
    .replace(/@@TOPO:([a-z]+)@@/g, (_, aba) => topo(aba))
    .replace(/@@NAV:([a-z]+)@@/g, (_, s) => nav(s));
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
${css}
  </style>
</helmet>
${html}
</x-dc>
</body>
</html>
`;
}

fs.mkdirSync(SAIDA, { recursive: true });
const pasta = path.join(AQUI, 'quadros');
const gerados = [];
for (const nome of fs.readdirSync(pasta).filter((f) => f.endsWith('.html')).sort()) {
  const alvo = path.join(SAIDA, nome.replace(/\.html$/, '.dc.html'));
  fs.writeFileSync(alvo, quadro(fs.readFileSync(path.join(pasta, nome), 'utf8')));
  gerados.push(path.basename(alvo));
}
fs.copyFileSync(path.join(AQUI, 'canvas.json'), path.join(SAIDA, 'canvas.json'));
console.log(`${gerados.length} quadros em ${SAIDA}: ${gerados.join(', ')}`);
