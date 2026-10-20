// Agendamento da revisão quando ela precisa voltar à fila sem perder a identidade do PR.
import { classify } from '../log-taxonomy.js';
import { aposFalhaDeLogin } from './cadeia-perfis.js';
import retomadaMod from './retomada-duravel.js';

// Sem confirmação do head no GitHub, aguarda um ciclo saudável sem gastar tentativa.
// A referência durável continua pendente até o dado necessário ser confirmado.
function aguardarConfirmacaoDeHead(engine, pr, msg) {
  const guardado = engine.retryAfterNet.get(pr.key);
  engine.retryAfterNet.set(pr.key, { tries: (guardado && guardado.tries) || 0, pr, notBefore: null });
  engine.log('WARN', `revisao ${pr.key} (retomada aguardando confirmação do head): ${msg}`);
}

function tentarFallbackLogin(engine, pr, conta, err) {
  if (classify(err.message || '').id !== 'oauth-expirado') return false;
  const proximo = aposFalhaDeLogin(engine, conta, err.perfilDaSessao);
  if (!proximo) return false;
  // Uma sessão de outro perfil/provedor não pode reutilizar o SID anterior.
  retomadaMod.consumirRetomada(engine, pr.key);
  const novoPr = { ...pr, retomarSid: '', resumeSid: '' };
  engine.retryAfterNet.set(pr.key, { tries: 0, pr: novoPr, notBefore: null });
  engine.log('WARN', `revisao ${pr.key}: login expirado; próximo perfil: ${proximo.label}`);
  engine.emit('toast', { kind: 'info', text: `Login expirado no perfil usado. Retomo ${pr.key} no perfil "${proximo.label}" no próximo ciclo; renove o login do perfil anterior em Plano e chaves.` });
  return true;
}

export { aguardarConfirmacaoDeHead, tentarFallbackLogin };
