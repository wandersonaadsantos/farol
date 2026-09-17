// Stub de FAROL_HEADLESS_CMD para a bancada: nenhuma sessão de IA existe. Fica viva por
// FAROL_STUB_SEGUNDOS (90 por padrão; a jornada de transferência precisa de mais tempo que
// um giro de comando) e devolve um envelope em prosa, que o Farol trata como revisão não
// concluída (nada posta).
const segundos = Number(process.env.FAROL_STUB_SEGUNDOS) || 90;
setTimeout(() => {
  process.stdout.write(JSON.stringify({ result: 'sessão simulada da bancada: nada foi revisado', is_error: false }) + '\n');
  process.exit(0);
}, segundos * 1000);
