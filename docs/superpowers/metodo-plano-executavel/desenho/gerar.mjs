// Gera os artboards do desenho da sincronizacao a partir de UMA folha de estilo,
// copiada dos valores reais de ui/app.css do Farol (tema escuro, o padrao do app).
import fs from 'node:fs';

const CSS = `
body { margin: 0; background: #0b0e14; color: #e7ecf5; font: 14px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: #ffb454; } a:hover { color: #ffc676; }
* { box-sizing: border-box; }
code { font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; font-size: .92em; background: #1a2130; padding: 1px 5px; border-radius: 5px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 4px; }
.section-head h2 { font-size: 15px; font-weight: 650; margin: 0; }
.section-desc { margin: -2px 0 14px; max-width: 640px; color: #8b97ab; font-size: 13px; text-wrap: pretty; }
.sub-head { font-size: 13px; font-weight: 650; margin: 22px 0 8px; color: #e7ecf5; }
.card { background: #121722; border: 1px solid #232c3d; border-radius: 12px; padding: 14px 16px; }
.set-list { padding: 4px 18px; }
.set-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 15px 0; }
.set-row + .set-row { border-top: 1px solid rgba(35, 44, 61, .6); }
.set-title { display: block; font-size: 13.5px; font-weight: 600; }
.set-desc { display: block; margin-top: 2px; font-size: 12.5px; color: #8b97ab; text-wrap: pretty; }
.set-row.off .set-title, .set-row.off .set-desc { color: #5c687d; }
.switch { flex: none; width: 36px; height: 20px; border-radius: 99px; background: #1a2130; border: 1px solid #232c3d; position: relative; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #8b97ab; }
.switch.on { background: #ffb454; border-color: #ffb454; }
.switch.on::after { left: 18px; background: #201302; }
.switch.dis { opacity: .45; }
.callout { display: flex; align-items: flex-start; gap: 10px; padding: 11px 14px; margin: 0 0 16px; border-radius: 10px; font-size: 12.5px; max-width: 860px; text-wrap: pretty; border: 1px solid rgba(108, 168, 242, .35); background: rgba(108, 168, 242, .12); color: #8b97ab; }
.callout b { color: #e7ecf5; }
.callout svg { width: 16px; height: 16px; flex: none; margin-top: 1px; color: #6ca8f2; }
.callout.warn { border-color: rgba(255, 180, 84, .35); background: rgba(255, 180, 84, .14); }
.callout.warn svg { color: #ffb454; }
.btn { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #232c3d; border-radius: 9px; background: #121722; color: #e7ecf5; padding: 7px 13px; font: inherit; font-weight: 550; white-space: nowrap; cursor: pointer; }
.btn.sm { padding: 5px 11px; font-size: 13px; border-radius: 8px; }
.btn.primary { background: #ffb454; border-color: #ffb454; color: #201302; }
.btn.danger-ghost { background: transparent; color: #8b97ab; }
.btn.danger-solid { background: #f2707a; border-color: #f2707a; color: #fff; font-weight: 650; }
.btn.ghost { background: transparent; }
.btn svg { width: 14px; height: 14px; }
.chip { font-size: 10.5px; font-weight: 700; border-radius: 99px; padding: 2px 9px; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.chip.ok { color: #4cc38a; background: rgba(76, 195, 138, .14); }
.chip.warn { color: #ffb454; background: rgba(255, 180, 84, .14); }
.chip.bad { color: #f2707a; background: rgba(242, 112, 122, .12); }
.chip.info { color: #6ca8f2; background: rgba(108, 168, 242, .12); }
.chip.mute { color: #8b97ab; background: #1a2130; }
.chip svg { width: 11px; height: 11px; }
.sync-card { padding: 0; border-left: 3px solid #4cc38a; }
.sync-card.warn { border-left-color: #ffb454; }
.sync-card.bad { border-left-color: #f2707a; }
.sync-card.off { border-left-color: #232c3d; }
.sync-topo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid rgba(35, 44, 61, .6); }
.sync-titulo { font-size: 14px; font-weight: 650; }
.espaco { flex: 1; }
.sync-corpo { padding: 14px 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.campo { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.campo > label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #5c687d; }
.campo .input { background: #1a2130; color: #e7ecf5; border: 1px solid #232c3d; border-radius: 8px; padding: 6px 10px; font-size: 12.5px; min-height: 31px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.campo .input.vazio { color: #5c687d; }
.campo .dica { font-size: 11px; color: #5c687d; }
.conta { margin: 0 16px 14px; border: 1px solid #232c3d; border-radius: 10px; background: color-mix(in srgb, #1a2130 60%, transparent); }
.conta-topo { display: flex; align-items: center; gap: 9px; padding: 9px 13px; border-bottom: 1px solid rgba(35, 44, 61, .6); }
.conta-topo svg { width: 14px; height: 14px; flex: none; color: #4cc38a; }
.conta-topo.warn svg { color: #ffb454; }
.conta-titulo { font-size: 12.5px; font-weight: 650; }
.conta-onde { font-size: 11.5px; color: #5c687d; margin-left: auto; font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; }
.conta-corpo { padding: 12px 13px; display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: #8b97ab; }
.conta-corpo .campo { flex: 1; min-width: 190px; }
.conta-corpo .quem { color: #e7ecf5; font-weight: 600; }
.conta-nota { padding: 0 13px 11px; margin: 0; font-size: 11.5px; color: #5c687d; text-wrap: pretty; }
.rodape { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 16px 13px; }
.teste { font-size: 11.5px; color: #5c687d; }
.teste.ok { color: #4cc38a; }
.teste.ruim { color: #f2707a; }
.lista { padding: 2px 16px; }
.linha { display: grid; grid-template-columns: minmax(0, 1fr) 110px 150px; gap: 12px; align-items: center; padding: 10px 0; font-size: 12.5px; }
.linha + .linha { border-top: 1px solid rgba(35, 44, 61, .6); }
.linha.head { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #5c687d; padding-bottom: 6px; }
.nome { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; }
.nome svg { width: 15px; height: 15px; flex: none; color: #8b97ab; }
.fraco { color: #8b97ab; }
.bem-fraco { color: #5c687d; }
.coord { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 0; font-size: 12.5px; }
.coord + .coord { border-top: 1px solid rgba(35, 44, 61, .6); }
.coord .ref { color: #ffb454; font-weight: 600; text-decoration: none; }
.coord .o-que { display: block; color: #8b97ab; margin-top: 1px; }
.coord .o-que.orfao { color: #ffb454; }
.pr-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 11px; align-items: start; border-left: 3px solid #ffb454; }
.avatar { width: 28px; height: 28px; border-radius: 50%; background: #1a2130; border: 1px solid #232c3d; }
.pr-ref { font-size: 12.5px; font-weight: 600; }
.pr-ref a { text-decoration: none; }
.pr-title { font-size: 13.5px; font-weight: 600; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-sub { font-size: 12px; color: #8b97ab; margin-top: 1px; }
.pr-coord { margin-top: 4px; font-size: 11.5px; line-height: 1.35; color: #6ca8f2; }
.pr-coord.warn { color: #ffb454; }
.pr-actions { grid-column: 1 / -1; margin-top: 10px; display: flex; gap: 8px; align-items: center; }
.modal-card { background: #121722; border: 1px solid #232c3d; border-radius: 14px; box-shadow: 0 8px 24px rgba(0, 0, 0, .35); width: 470px; padding: 20px 22px; }
.modal-card.danger { border-top: 3px solid #f2707a; }
.modal-card.warn { border-top: 3px solid #ffb454; }
.modal-title { font-size: 15.5px; font-weight: 700; margin-bottom: 12px; }
.modal-body { font-size: 13.5px; }
.modal-body p { margin: 8px 0; color: #8b97ab; }
.modal-acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.seg { display: inline-flex; background: #1a2130; border: 1px solid #232c3d; border-radius: 8px; padding: 2px; gap: 2px; }
.seg-btn { border: 0; background: transparent; color: #8b97ab; font: inherit; font-size: 11.5px; padding: 4px 10px; border-radius: 6px; }
.seg-btn.active { background: #ffb454; color: #201302; font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.kpi { background: #1a2130; border: 1px solid #232c3d; border-radius: 12px; padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 2px; }
.kpi-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #5c687d; font-weight: 600; }
.kpi b { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
.kpi-sub { font-size: 11.5px; color: #8b97ab; }
.tabela-linha { display: grid; grid-template-columns: minmax(0, 1fr) 90px 100px 130px; gap: 10px; align-items: center; padding: 8px 2px; border-bottom: 1px solid rgba(35, 44, 61, .6); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.tabela-linha.head { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #5c687d; font-weight: 600; border-bottom: 1px solid #232c3d; }
.dir { text-align: right; }
.legenda { font-size: 11.5px; color: #5c687d; }
.rotulo-estado { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #5c687d; margin-bottom: 8px; }
`;

const I = {
  info: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"></circle><path d="M8 7.4v3.8M8 5.1v.6" stroke-linecap="round"></path></svg>',
  ok: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 5"></path></svg>',
  alerta: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 4.5v4.2M8 11.2v.5"></path></svg>',
  cadeado: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="7" width="9" height="6" rx="1.5"></rect><path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7"></path></svg>',
  teste: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.2"></path><path d="M13.7 2.5v3.2h-3.2"></path></svg>',
  notebook: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="3.5" width="10" height="7" rx="1"></rect><path d="M1.5 12.5h13"></path></svg>',
  celular: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5"></rect><path d="M7.3 12.2h1.4"></path></svg>',
};

const doc = (corpo, largura) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${CSS}</style>
</helmet>
<div style="width: ${largura}px; padding: 28px 30px 36px; display: flex; flex-direction: column;">
${corpo}
</div>
</x-dc>
</body>
</html>
`;

const toggles = (a, b, c) => `
<div class="card set-list">
  <div class="set-row">
    <span><span class="set-title">Sincronizar entre dispositivos</span>
    <span class="set-desc">Chave geral. Desligada, este Farol não fala com o Firebase: nenhuma conexão, nenhum envio, nenhuma consulta.</span></span>
    <span class="switch ${a ? 'on' : ''}"></span>
  </div>
  <div class="set-row ${a ? '' : 'off'}">
    <span><span class="set-title">Evitar análises simultâneas</span>
    <span class="set-desc">Antes de abrir uma revisão, autoanálise ou classificação de pushback automática, confere se outro aparelho seu já cuidou daquele PR neste commit. Se já cuidou, nenhuma sessão nasce aqui.</span></span>
    <span class="switch ${b ? 'on' : ''} ${a ? '' : 'dis'}"></span>
  </div>
  <div class="set-row ${a ? '' : 'off'}">
    <span><span class="set-title">Consolidar histórico de consumo</span>
    <span class="set-desc">Envia tokens, custo e desfecho de cada sessão, sem prompt, diff ou relatório, pra aba Consumo mostrar todos os aparelhos juntos. O histórico deste aparelho continua aqui do jeito que está.</span></span>
    <span class="switch ${c ? 'on' : ''} ${a ? '' : 'dis'}"></span>
  </div>
</div>`;

const cabecalho = `
<div class="section-head"><h2>Sincronização entre dispositivos</h2></div>
<p class="section-desc">Opcional. Evita que dois aparelhos seus revisem o mesmo PR e mostra o consumo de todos juntos. Cada aparelho continua com o próprio histórico e funciona sem internet.</p>`;

const campos = (vazio) => `
<div class="sync-corpo">
  <div class="campo"><label>Chave web do projeto</label><div class="input ${vazio ? 'vazio' : ''}">${vazio ? 'AIza...' : 'AIzaSyB•••••••••••••1q8'}</div><span class="dica">em Configurações do projeto, no Firebase</span></div>
  <div class="campo"><label>URL do banco</label><div class="input ${vazio ? 'vazio' : ''}">${vazio ? 'https://projeto-default-rtdb.firebaseio.com' : 'https://farol-pessoal-default-rtdb.firebaseio.com'}</div><span class="dica">Realtime Database</span></div>
  <div class="campo"><label>Nome deste aparelho</label><div class="input">Notebook Windows</div><span class="dica">é como os outros aparelhos o chamam</span></div>
</div>`;

const contaConectada = `
<div class="conta">
  <div class="conta-topo">${I.cadeado}<span class="conta-titulo">Login no Firebase</span><span class="conta-onde">sync-credentials.json</span></div>
  <div class="conta-corpo">
    <span>Conectado como <span class="quem">voce@exemplo.com</span>. A senha não fica guardada; só o acesso renovável, fora do <code>config.json</code>.</span>
    <span class="espaco"></span>
    <button class="btn sm danger-ghost">Sair deste aparelho</button>
  </div>
</div>`;

const contaLogin = (rotulo, extra = '') => `
<div class="conta">
  <div class="conta-topo warn">${I.cadeado}<span class="conta-titulo">Login no Firebase</span><span class="conta-onde">o mesmo usuário em todos os aparelhos</span></div>
  <div class="conta-corpo">
    <span class="campo"><label>E-mail</label><span class="input vazio">voce@exemplo.com</span></span>
    <span class="campo"><label>Senha</label><span class="input vazio">••••••••</span></span>
    <button class="btn sm primary">${rotulo}</button>
  </div>
  ${extra}
  <p class="conta-nota">Crie o usuário uma vez no console do Firebase (Authentication, provedor e-mail e senha) e entre com ele em cada aparelho. A senha é usada só agora e não é gravada.</p>
</div>`;

// ---------- Main: conectada, dois aparelhos, coordenação em curso ----------
const main = doc(`
${cabecalho}
${toggles(true, true, true)}
<div class="sub-head">Conexão</div>
<div class="card sync-card">
  <div class="sync-topo">
    <span class="sync-titulo">Firebase pessoal</span>
    <span class="espaco"></span>
    <span class="chip ok">${I.ok}conectado</span>
  </div>
  ${campos(false)}
  ${contaConectada}
  <div class="rodape">
    <button class="btn sm">${I.teste}Testar conexão</button>
    <span class="teste ok">respondeu agora, 2 aparelhos neste banco</span>
    <span class="espaco"></span>
    <button class="btn sm danger-ghost">Apagar dados sincronizados</button>
  </div>
</div>
<div class="sub-head">Aparelhos</div>
<div class="card lista">
  <div class="linha head"><span>aparelho</span><span>sistema</span><span>visto por último</span></div>
  <div class="linha"><span class="nome">${I.notebook}Notebook Windows <span class="chip mute">este</span></span><span class="fraco">Windows</span><span class="fraco">agora</span></div>
  <div class="linha"><span class="nome">${I.celular}Celular</span><span class="fraco">Linux (Termux)</span><span class="fraco">há 4 min</span></div>
</div>
<div class="sub-head">Coordenação agora</div>
<div class="card lista">
  <div class="coord"><span><a class="ref" href="#">acme/web#912</a><span class="o-que">sendo revisado no Celular desde 14:32; este aparelho espera</span></span><span class="chip info">em outro aparelho</span></div>
  <div class="coord"><span><a class="ref" href="#">acme/api#108</a><span class="o-que">revisado no Notebook neste commit, aguardando sua decisão lá</span></span><span class="chip mute">pendente lá</span></div>
  <div class="coord"><span><a class="ref" href="#">acme/core#317</a><span class="o-que orfao">pendente no Celular, sem atividade há 9 dias; o resultado só existe lá</span></span><button class="btn sm">Refazer neste aparelho</button></div>
</div>
`, 900);

// ---------- Estados da conexão ----------
const estado = (rotulo, classe, chip, corpo) => `
<div style="display: flex; flex-direction: column;">
  <div class="rotulo-estado">${rotulo}</div>
  <div class="card sync-card ${classe}">
    <div class="sync-topo"><span class="sync-titulo">Firebase pessoal</span><span class="espaco"></span>${chip}</div>
    ${corpo}
  </div>
</div>`;

const estados = doc(`
<div class="section-head"><h2>Estados da conexão</h2></div>
<p class="section-desc">O mesmo cartão de Conexão em cada estado. A barra da esquerda e o selo dizem o estado, como no cartão de site do Jira.</p>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 22px;">
${estado('desligada', 'off', '<span class="chip mute">desligada</span>', '<div class="conta-corpo" style="padding: 14px 16px;"><span>Nada é enviado nem consultado. Ligue a chave geral acima para configurar.</span></div>')}
${estado('ligada, sem login', 'warn', `<span class="chip warn">${I.alerta}falta o login</span>`, contaLogin('Entrar'))}
${estado('entrando', 'warn', '<span class="chip info">entrando</span>', contaLogin('Entrando...'))}
${estado('conectada, só este aparelho', '', `<span class="chip ok">${I.ok}conectado</span>`, `${contaConectada}<div class="rodape"><span class="teste">este é o único aparelho neste banco por enquanto</span></div>`)}
${estado('conexão degradada', 'warn', `<span class="chip warn">${I.alerta}coordenação indisponível</span>`, `<div class="callout warn" style="margin: 14px 16px;">${I.alerta}<span><b>O Firebase não respondeu no último ciclo.</b> A revisão automática espera a conexão voltar, sem gastar sessão. Clique manual continua podendo executar, com confirmação.</span></div>`)}
${estado('login expirado', 'bad', `<span class="chip bad">${I.alerta}login expirado</span>`, contaLogin('Entrar de novo', '<p class="conta-nota" style="color: #f2707a; padding-top: 0;">O Firebase recusou o acesso guardado. Enquanto isso a automação espera.</p>'))}
${estado('dados remotos apagados', '', `<span class="chip ok">${I.ok}conectado</span>`, '<div class="conta-corpo" style="padding: 14px 16px;"><span>Os dados sincronizados foram apagados do Firebase. O histórico deste aparelho continua intacto; o consumo consolidado recomeça do zero no próximo envio.</span></div>')}
${estado('migração do histórico em andamento', '', `<span class="chip ok">${I.ok}conectado</span>`, '<div class="rodape" style="padding-top: 13px;"><span class="teste">enviando o histórico de consumo: 350 de 671 sessões, 0 recusadas</span><span class="espaco"></span><button class="btn sm">Pausar envio</button></div>')}
</div>
`, 900);

// ---------- Fila: cards com anotação de coordenação ----------
const card = (ref, titulo, nota, classeNota = '') => `
<div class="card pr-card">
  <span class="avatar"></span>
  <div>
    <div class="pr-ref"><a href="#">${ref}</a></div>
    <div class="pr-title">${titulo}</div>
    <div class="pr-sub">@autora · atualizado há 18 min</div>
    <div class="pr-coord ${classeNota}">${nota}</div>
  </div>
  <div class="pr-actions"><button class="btn sm primary">Revisar</button></div>
</div>`;

const fila = doc(`
<div class="section-head"><h2>Sua fila</h2></div>
<p class="section-desc">Quando a coordenação segura um PR, o card continua na fila e diz por quê, em azul (espera) e não em vermelho (falha). O botão Revisar segue valendo.</p>
<div style="display: flex; flex-direction: column; gap: 10px;">
${card('acme/web#912', 'Corrige o arredondamento do total no checkout', 'Em revisão no Celular desde 14:32. A revisão automática espera por aqui.')}
${card('acme/api#131', 'Adiciona índice na consulta de pedidos por cliente', 'Coordenação entre dispositivos indisponível agora. A revisão automática espera a conexão voltar.', 'warn')}
${card('acme/core#322', 'Refatora o cálculo de frete por região', 'Teto de 3 rodadas automáticas de hoje atingido entre seus aparelhos. Volta amanhã; o Revisar vale agora.', 'warn')}
</div>
`, 640);

// ---------- Confirmações do clique manual ----------
const confirmacoes = doc(`
<div class="section-head"><h2>Confirmações do clique manual</h2></div>
<p class="section-desc">Só aparecem quando a coordenação diria "não" a um clique seu. Lease de outro aparelho não tem confirmação: o Farol nunca toma uma análise em andamento.</p>
<div style="display: flex; gap: 22px; align-items: flex-start;">
  <div class="modal-card warn">
    <div class="modal-title">Revisar sem coordenação?</div>
    <div class="modal-body">
      <p>O Firebase não respondeu, então este aparelho não consegue saber se outro já está revisando <code>acme/api#131</code>.</p>
      <p>Se estiver, as duas sessões gastam tokens pelo mesmo PR. O dedup de postagem continua impedindo review duplicado no GitHub.</p>
    </div>
    <div class="modal-acoes"><button class="btn sm ghost">Cancelar</button><button class="btn sm primary">Revisar mesmo assim</button></div>
  </div>
  <div class="modal-card warn">
    <div class="modal-title">Revisar de novo este commit?</div>
    <div class="modal-body">
      <p><code>acme/core#317</code> já foi revisado no <b>Celular</b> neste commit, em 01/09 às 10:14. O resultado só existe lá, e o aparelho está sem atividade há 9 dias.</p>
      <p>Refazer aqui abre uma sessão nova e consome tokens. Se o Celular voltar, ele confere antes de postar e não publica por cima.</p>
    </div>
    <div class="modal-acoes"><button class="btn sm ghost">Cancelar</button><button class="btn sm primary">Refazer neste aparelho</button></div>
  </div>
</div>
<div style="display: flex; gap: 22px; align-items: flex-start; margin-top: 22px;">
  <div class="modal-card danger">
    <div class="modal-title">Apagar dados sincronizados?</div>
    <div class="modal-body">
      <p>Apaga do seu Firebase os aparelhos, as coordenações e o consumo enviado por <b>todos</b> os aparelhos.</p>
      <p>Nenhum arquivo local é tocado: o histórico de cada aparelho continua nele. A sincronização continua ligada e recomeça do zero.</p>
    </div>
    <div class="modal-acoes"><button class="btn sm ghost">Cancelar</button><button class="btn sm danger-solid">Apagar do Firebase</button></div>
  </div>
</div>
`, 1040);

// ---------- Consumo: todos os aparelhos ----------
const consumo = doc(`
<div class="section-head"><h2>Consumo</h2>
  <div style="display: flex; gap: 8px; align-items: center;">
    <div class="seg"><button class="seg-btn">Este aparelho</button><button class="seg-btn active">Todos os aparelhos</button></div>
    <div class="seg"><button class="seg-btn">Hoje</button><button class="seg-btn">7 dias</button><button class="seg-btn active">30 dias</button></div>
  </div>
</div>
<p class="section-desc">Enviado há 3 min, nada pendente. O custo estimado de sessões que caíram no meio continua marcado como estimado.</p>
<div class="kpis">
  <div class="kpi"><span class="kpi-label">custo, todos os aparelhos</span><b>US$ 2.611,40</b><span class="kpi-sub">US$ 2.545,07 aqui e US$ 66,33 no Celular</span></div>
  <div class="kpi"><span class="kpi-label">sessões</span><b>689</b><span class="kpi-sub">671 aqui, 18 no Celular</span></div>
  <div class="kpi"><span class="kpi-label">medido x estimado</span><b>98%</b><span class="kpi-sub">US$ 52,10 estimado</span></div>
</div>
<div class="card">
  <div class="tabela-linha head"><span>aparelho</span><span class="dir">sessões</span><span class="dir">custo</span><span class="dir">última sessão</span></div>
  <div class="tabela-linha"><span class="nome">${I.notebook}Notebook Windows <span class="chip mute">este</span></span><span class="dir">671</span><span class="dir">US$ 2.545,07</span><span class="dir fraco">agora</span></div>
  <div class="tabela-linha" style="border-bottom: 0;"><span class="nome">${I.celular}Celular</span><span class="dir">18</span><span class="dir">US$ 66,33</span><span class="dir fraco">há 2 h</span></div>
  <p class="legenda" style="margin: 10px 2px 0;">Números de exemplo. Com "Este aparelho" a aba volta a ser exatamente a de hoje.</p>
</div>
`, 900);

// ---------- Mobile: a mesma seção no navegador estreito (Termux) ----------
const mobile = doc(`
${cabecalho}
${toggles(true, true, false)}
<div class="sub-head">Conexão</div>
<div class="card sync-card">
  <div class="sync-topo"><span class="sync-titulo">Firebase pessoal</span><span class="espaco"></span><span class="chip ok">${I.ok}conectado</span></div>
  <div class="sync-corpo" style="grid-template-columns: 1fr;">
    <div class="campo"><label>Nome deste aparelho</label><div class="input">Celular</div></div>
  </div>
  ${contaConectada}
  <div class="rodape"><button class="btn sm">${I.teste}Testar conexão</button><span class="teste ok">2 aparelhos</span></div>
</div>
<div class="sub-head">Aparelhos</div>
<div class="card lista">
  <div class="coord"><span class="nome">${I.celular}Celular <span class="chip mute">este</span></span><span class="fraco">agora</span></div>
  <div class="coord"><span class="nome">${I.notebook}Notebook Windows</span><span class="fraco">há 4 min</span></div>
</div>
`, 390);

const saida = { 'Main.dc.html': main, 'Estados.dc.html': estados, 'Fila.dc.html': fila, 'Confirmacoes.dc.html': confirmacoes, 'Consumo.dc.html': consumo, 'Mobile.dc.html': mobile };
for (const [nome, html] of Object.entries(saida)) fs.writeFileSync(nome, html);

const canvas = {
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: 900, h: 1320, title: 'Sistema > Sincronização (conectada)' },
    { file: 'Mobile.dc.html', x: 980, y: 0, w: 390, h: 1420, title: 'Mesma seção no celular (Termux)' },
    { file: 'Estados.dc.html', x: 0, y: 1440, w: 900, h: 1260, title: 'Estados da conexão' },
    { file: 'Fila.dc.html', x: 980, y: 1500, w: 640, h: 640, title: 'Card da fila com coordenação' },
    { file: 'Confirmacoes.dc.html', x: 0, y: 2820, w: 1040, h: 840, title: 'Confirmações do clique manual' },
    { file: 'Consumo.dc.html', x: 1120, y: 2820, w: 900, h: 560, title: 'Consumo de todos os aparelhos' },
  ],
  annotations: [
    { id: 'premissas', x: 1460, y: 0, w: 320, text: 'Tema escuro, que é o padrão do Farol. Valores copiados de ui/app.css: nenhuma cor nova.\nNúmeros, e-mail e nomes de PR são de exemplo.\nA coordenação usa azul (espera) e âmbar (atenção), nunca o vermelho do estacionamento, porque segurar não é falhar.' },
  ],
  launch: { view: 'canvas' },
};
fs.writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log('ok', Object.keys(saida).length, 'artboards');
