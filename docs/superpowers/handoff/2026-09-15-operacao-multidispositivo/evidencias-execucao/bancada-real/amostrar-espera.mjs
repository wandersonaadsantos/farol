// Amostra o conjunto a cada 15 s: quem está atribuído a quem, e o que cada aparelho
// respondeu. Leitura administrativa do EMULADOR, usada só para observar (nenhuma prova de
// permissão sai daqui).
const U='nL0XoVGaMIHWWn8wtkfWsG9OKa0o', B='http://127.0.0.1:9000', NS='demo-farol-default-rtdb';
const H={ Authorization: 'Bearer owner' };
const ate = Date.now() + Number(process.argv[2] || 300) * 1000;
async function ler(no){ const r=await fetch(`${B}/users/${U}/${no}.json?ns=${NS}`,{headers:H}); return r.json(); }
while (Date.now() < ate) {
  const [assign, ack] = await Promise.all([ler('live/assign'), ler('live/ack')]);
  const linhas = [];
  for (const [item, v] of Object.entries(assign || {})) {
    const a = (ack || {})[item] || {};
    linhas.push(`${item.slice(0,8)} -> ${String(v.dev||'').slice(0,8)} ttl=${v.ttl||0} | ack ${a.estado||'-'} ${a.code||''} espera=${a.esperaAte||0} por ${String(a.dev||'').slice(0,8)}`);
  }
  console.log(new Date().toISOString(), Date.now());
  for (const l of linhas) console.log('   ', l);
  await new Promise((r) => setTimeout(r, 15000));
}
