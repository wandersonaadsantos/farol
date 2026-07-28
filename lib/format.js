'use strict';
// Helpers de formatação/classificação puros (sem estado, sem IO). Ver docs/QUALITY.md.

function modelLabel(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  const fam = /opus/i.test(raw) ? 'Opus' : /sonnet/i.test(raw) ? 'Sonnet' : /haiku/i.test(raw) ? 'Haiku' : '';
  const ver = (raw.match(/(\d+)-(\d+)/) || [])[0];
  return fam ? `${fam}${ver ? ' ' + ver.replace('-', '.') : ''}` : raw;
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
