// Com CREDENCIAL DE USUÁRIO (nunca owner): um comando carimbado com a geração ANTERIOR
// não entra, e o mesmo comando com a geração vigente entra. Prova de regra, não de app.
const AUTH='http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=chave-do-emulador';
const B='http://127.0.0.1:9000'; const NS='demo-farol-default-rtdb';
const s=await (await fetch(AUTH,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'bancada@demo.local',password:'senha-da-bancada',returnSecureToken:true})})).json();
const u=s.localId, t=s.idToken;
const enc=`e1.g1.${'A'.repeat(16)}.${'B'.repeat(40)}.${'C'.repeat(22)}`;
const sig='x'.repeat(86);
async function tentar(cmdId, generation) {
  const no={ v:1, generation, alvo:'15292345-70d8-4c92-b1e0-26332c3fea7c', ttl: Date.now()+600000, enc, sig };
  const r=await fetch(`${B}/users/${u}/live/commands/${cmdId}.json?auth=${t}&ns=${NS}`,{method:'PUT',body:JSON.stringify(no)});
  console.log(`geracao ${generation}:`, r.status, (await r.text()).slice(0,120));
}
await tentar('ffffffffffffffffffffffffffffff01', 1);
await tentar('ffffffffffffffffffffffffffffff02', 2);
const limpar = await fetch(`${B}/users/${u}/live/commands/ffffffffffffffffffffffffffffff02.json?auth=${t}&ns=${NS}`,{method:'DELETE'});
console.log('limpeza do comando de prova:', limpar.status);
