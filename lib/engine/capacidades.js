// Estado das capacidades que existem no código e NÃO estão valendo (adendo de 16/09/2026,
// item 5). PURO: os sinais chegam por parâmetro; quem os coleta é o snapshot.
//
// POR QUE EXISTE: três capacidades desta iniciativa estão implementadas e desligadas de
// propósito (autenticação exigida no celular, teto do grupo de consumo) ou podem ser
// desligadas pelo engine mesmo com a configuração ligada (compartilhamento no celular sem
// autenticação). Sem um lugar único que responda "está valendo?", a tela mostraria o
// interruptor ligado e a pessoa acreditaria numa proteção que não está sendo aplicada. Esse
// é o pior defeito possível numa tela de segurança: mais grave que não ter a proteção.
import { exigeAutenticacao } from '../local-auth/modo.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function ligado(v) {
  return objeto(v) && v.enabled === true;
}

/**
 * O retrato das capacidades: o que foi PEDIDO (configuração) e o que está APLICADO (o que o
 * engine faz agora). Os dois separados de propósito: a diferença entre eles é exatamente o
 * que a tela precisa dizer.
 */
function estadoDasCapacidades({ modoCelular = false, ativacaoA4 = false, ativacaoTetoGrupo = false, config = {}, bloqueio = '', grupoConfigurado = false } = {}) {
  const cfg = objeto(config) ? config : {};
  const exigida = exigeAutenticacao({ modoCelular, config: cfg, ativacaoAutomatica: ativacaoA4 });
  // o bloqueio TAMBÉM é prova de pedido: a guarda do celular zera `shared` e `distribution`
  // na própria config do engine, e só marca o bloqueio quando havia algo ligado para zerar.
  // Sem esta linha, o caso real (medido numa instância isolada em modo celular) nunca
  // mostraria o cartão: a tela leria a config já zerada e concluiria que ninguém pediu.
  const pedido = ligado(cfg.shared) || ligado(cfg.distribution) || !!String(bloqueio || '');
  return {
    autenticacaoLocal: { exigida, modoCelular: modoCelular === true, ativacaoAutomatica: ativacaoA4 === true },
    compartilhamento: { pedido, aplicado: pedido && !bloqueio, bloqueio: String(bloqueio || '') },
    tetoGrupo: { configurado: grupoConfigurado === true, aplicado: ativacaoTetoGrupo === true },
  };
}

export default { estadoDasCapacidades };
export { estadoDasCapacidades };
