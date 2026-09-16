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
let STATE = null;
let SCOPE = 'all';
let ABA = 'radar';

const estado = () => STATE;
const escopo = () => SCOPE;
const abaAtual = () => ABA;

// Escrita: só o ui/app.js chama. Não há setter parcial de propósito, para não existirem
// dois donos do mesmo dado.
function definirEstado(novo) { STATE = novo; }
function definirEscopo(novo) { SCOPE = novo; }
function definirAba(nome) { ABA = nome; }

export { estado, escopo, abaAtual, definirEstado, definirEscopo, definirAba };
