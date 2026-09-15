// O site do Jira: o que a tela recusa antes de mandar pro servidor. Extraído do ui/pure.js
// na Fase 1a da reorganização; o conteúdo não mudou.
//
// O saneador do servidor (lib/jira/sites.js) não corrige nem avisa: URL fora de forma faz o
// site INTEIRO ser descartado, e rótulo, orgs e prefixos somem enquanto a tela diz
// "Configurações salvas". As regras espelhadas aqui são as de lá, e o porquê de cada uma mora
// naquele arquivo. Prefixo é exigência da TELA, não do modelo: sem nenhum, o extractCardKeys
// aceita qualquer PALAVRA-NUMERO do título (UTF-8, SHA-256, ISO-8601), o Farol pede esse
// "card" ao Jira, toma 404 e o PR perde o auto-approve por falha inventada.

export function jiraBaseUrlProblema(valor) {
  const s = String(valor || '').trim().replace(/\/+$/, '');
  if (!s) return 'Informe a URL base do Jira.';
  let u = null;
  try { u = new URL(s); } catch { return 'URL base inválida: escreva o endereço completo, com https:// na frente.'; }
  if (u.protocol !== 'https:') return 'A URL base precisa começar com https://.';
  if (u.username || u.password) return 'A URL base não pode carregar usuário nem senha.';
  if (u.pathname !== '/' || u.search || u.hash) return 'A URL base é só o endereço do site, sem caminho, parâmetro ou âncora.';
  return '';
}

export function jiraPrefixosProblema(lista) {
  const itens = (Array.isArray(lista) ? lista : []).filter((x) => String(x || '').trim());
  if (!itens.length) return 'Informe ao menos um prefixo de projeto: sem ele o Farol procura no Jira qualquer coisa com hífen e número que apareça no título do PR.';
  return '';
}
