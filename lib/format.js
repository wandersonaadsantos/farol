'use strict';
// Helpers de formatação/classificação puros (sem estado, sem IO). Ver docs/QUALITY.md.

// Rotulo humano do id cru que o CLI reporta no evento system/init: claude-opus-4-8
// vira "Opus 4.8". So exibicao, nunca entra em decisao.
function modelLabel(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  const fam = /opus/i.test(raw) ? 'Opus' : /sonnet/i.test(raw) ? 'Sonnet'
    : /haiku/i.test(raw) ? 'Haiku' : /fable/i.test(raw) ? 'Fable' : '';
  // versao em DUAS partes tem precedencia (4-8 = 4.8). A ordem importa: em
  // claude-haiku-4-5-20251001 a primeira forma pega 4-5 e a data nunca e lida.
  // A segunda forma cobre a geracao de major unico (claude-opus-5 = Opus 5), que
  // antes caia fora e devolvia so a familia.
  const dois = (raw.match(/(\d+)-(\d+)/) || [])[0];
  const um = dois ? '' : (raw.match(/-(\d+)(?:-|$)/) || [])[1];
  const ver = dois ? dois.replace('-', '.') : (um || '');
  return fam ? `${fam}${ver ? ' ' + ver : ''}` : raw;
}

// Branches permanentes do fluxo (gitflow + ambientes): NUNCA podem ser deletadas
// depois de um merge. Uma promocao develop->release, por exemplo, tem 'develop'
// como head; deletar a branch ali apagaria a develop. Tudo que NAO casar aqui
// (feature/*, fix/*, task-*, hotfix/*, bugfix/*...) e descartavel e pode ser
// limpo pra evitar lixo. Sem nome = trata como permanente por seguranca.
function isPermanentBranch(name) {
  const b = String(name || '').trim().toLowerCase();
  if (!b) return true;
  if (['main', 'master', 'develop', 'dev', 'trunk', 'staging', 'homolog',
    'homologacao', 'hml', 'hmg', 'prod', 'production', 'release'].includes(b)) return true;
  // familias versionadas: release/*, release_1.2, hml-*, hmg-v*, homolog*, prod*, env/*
  if (/^(release|hml|hmg|homolog|prod|production|staging|env)[\/_-]/.test(b)) return true;
  return false;
}

module.exports = { modelLabel, isPermanentBranch };
