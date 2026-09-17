// Aceitar política e grupo no relógio (fiação da C2, CT-ADM-POL e CT-GRUPO).
//
// ATÉ AQUI NINGUÉM CHAMAVA `aceitarPolitica` NEM `aceitarGrupo` fora dos testes: o admin
// publicava, e nenhum aparelho lia. A política efetiva da admissão lê o cache que só o
// aceite grava, então a pausa e o teto de paralelismo publicados nunca chegariam.
//
// Só lê com o consentimento local ligado e a autoridade fresca: sem um dos dois, o aceite
// recusaria de qualquer jeito, e ler seria banda gasta para nada. A ordem das recusas
// continua sendo a dos módulos de aceite, que este giro não reescreve.
import { sharedActive } from '../sync/config.js';
import politicas from './sync-politicas.js';
import grupos from './sync-grupo.js';
import publicar from './sync-publicar.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function podeAceitar(engine, cfg) {
  const rt = engine.sync;
  if (!sharedActive(cfg) || cfg.aceitarAdmin !== true) return false;
  if (!rt || !rt.client || !rt.uid || !rt.material) return false;
  return !!(rt.autoridade && rt.autoridade.fresca === true);
}

async function ler(rt, caminho) {
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/${caminho}`);
  return lido ? lido.valor : null;
}

async function cicloDoAceite(engine, cfg) {
  if (!podeAceitar(engine, cfg)) return { ok: false, code: 'sem-aceite' };
  const rt = engine.sync;
  const admin = await ler(rt, 'live/control/admin');
  if (!objeto(admin)) return { ok: false, code: 'sem-admin' };
  const autoridade = rt.autoridade;
  const saida = { ok: true, politica: null, grupos: {} };
  const no = await ler(rt, `live/devicePolicies/${rt.deviceId}`);
  if (objeto(no)) saida.politica = politicas.aceitarPolitica(engine, cfg, { no, admin, autoridade, dev: rt.deviceId });
  const todos = await ler(rt, 'live/groups');
  for (const [id, noGrupo] of Object.entries(objeto(todos) ? todos : {})) {
    saida.grupos[id] = grupos.aceitarGrupo(engine, cfg, { no: noGrupo, admin, autoridade, id });
  }
  const mudou = (saida.politica && saida.politica.ok) || Object.values(saida.grupos).some((r) => r.ok);
  if (mudou && typeof engine.pushState === 'function') engine.pushState();
  return saida;
}

export default { cicloDoAceite };
export { cicloDoAceite };
