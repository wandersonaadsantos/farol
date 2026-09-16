// O estado que a tela inteira lê: o último snapshot do SSE, o escopo de conta e a aba atual.
//
// POR QUE EXISTE: 109 das 169 funções do ui/app.js liam variável de módulo (STATE em 68,
// SCOPE em 19). Com as telas em módulos, cada uma precisaria importar o bootstrap de volta
// só para ler STATE, que é o ciclo que a Fase 1b existe para evitar. Aqui a leitura é de mão
// única.
//
// Duas coisas diferentes chamam de escrita, e só uma delas é regra nova. Trocar a
// REFERÊNCIA (o snapshot inteiro) é só do ui/app.js, sempre por definirEstado: é o
// contrato que este módulo garante. Mutar o CONTEÚDO de um campo (por exemplo
// estado().accounts = lista, estado().config.people = pessoas) já acontecia no
// ui/app.js antes desta tarefa e continua acontecendo: é herança preservada, não
// licença nova. Módulo de tela lê por estado() e não muta nada dentro do que lê.
//
// Cada setter abaixo tem os donos que REALMENTE o chamam hoje (nem todos são só o
// ui/app.js, e essa lista é o que evita a próxima extração quebrar por engano):
//   definirEstado    -> só ui/app.js (o handler do evento 'state' do SSE).
//   definirEscopo    -> ui/app.js (boot, a partir do localStorage, e o clique na barra
//                        de contas), telas/contas.js (rebuildAccounts saneia escopo
//                        órfão quando a conta some) e telas/sistema-contas.js (silenciar
//                        ou remover a conta que é o escopo atual solta ela pra 'all').
//   definirAba       -> só ui/app.js (switchTab).
//   definirPlataforma -> só ui/app.js (aplicaPlataforma, reconciliando com o SO real
//                        que o snapshot do engine manda).
let STATE = null;
let SCOPE = 'all';
let ABA = 'radar';
// Palpite do primeiro paint (antes do primeiro estado chegar pelo SSE); o ui/app.js
// reconcilia com app.platform assim que o snapshot chega, por definirPlataforma. Mora
// aqui, e não no bootstrap, pela mesma razão de STATE/SCOPE/ABA: mais de uma tela
// (por exemplo o editor de perfis Claude) precisa perguntar "é Windows?", e um módulo
// de tela não pode importar o bootstrap de volta só pra fazer essa pergunta.
// O guarda `typeof navigator` é só pra este módulo não explodir se algum dia for
// importado fora de um contexto de navegador (o node --test sempre passa pelo
// dom-stub, que define navigator antes deste import rodar); SEM navigator, o palpite
// cai silenciosamente em 'win32' (o lado do `: 'win32'` do ternário), nunca em 'darwin'.
let PLATAFORMA = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'darwin' : 'win32';

const estado = () => STATE;
const escopo = () => SCOPE;
const abaAtual = () => ABA;
const ehMac = () => PLATAFORMA === 'darwin';
const ehWin = () => PLATAFORMA === 'win32';
// Responde "esta página está rodando dentro do shell Electron do Farol?". Ao
// contrário de PLATAFORMA, não tem reconciliação com o engine: o Electron do PRÓPRIO
// processo desta página não muda em runtime, então o userAgent já é fonte definitiva
// aqui, nunca palpite. Mora nesta camada, e não em cada módulo que precisa saber, pela
// mesma razão de PLATAFORMA/ehMac/ehWin: um módulo de tela não pode importar o
// bootstrap de volta só pra fazer esta pergunta.
const ehElectron = () => typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

function definirEstado(novo) { STATE = novo; }
function definirEscopo(novo) { SCOPE = novo; }
function definirAba(nome) { ABA = nome; }
function definirPlataforma(p) { if (p) PLATAFORMA = p; }

// Leituras derivadas do estado (não o snapshot cru, um predicado sobre ele). As duas
// abas opcionais moram juntas aqui pela mesma razão do módulo inteiro: cada tela que
// precisar perguntar "essa flag está ligada?" lê daqui, em vez de reimplementar a
// mesma leitura de config ou importar a tela alheia só por causa do predicado.
function teamHighlightsEnabled() { return estado()?.config?.teamHighlights === true; }
function deliveriesEnabled() { return estado()?.config?.deliveriesEnabled === true; }

// mapa de pessoas (perfil de review: papel e domínios) do config atual. Lido pelo
// Radar (papelPicker de cada card) e pelo Time; junto das outras leituras derivadas
// desta lista pela mesma razão: mais de uma tela precisa e nenhuma pode importar a
// outra só por causa disto.
function peopleOf() { return (estado()?.config && estado().config.people) || {}; }

export {
  estado, escopo, abaAtual, definirEstado, definirEscopo, definirAba,
  teamHighlightsEnabled, deliveriesEnabled, peopleOf,
  ehMac, ehWin, ehElectron, definirPlataforma,
};
