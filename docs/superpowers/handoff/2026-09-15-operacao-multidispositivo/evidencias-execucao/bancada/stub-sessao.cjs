// Stub de FAROL_HEADLESS_CMD para a bancada: nenhuma sessão de IA existe. Fica 90 s "viva"
// e devolve um envelope em prosa, que o Farol trata como revisão não concluída (nada posta).
setTimeout(() => {
  process.stdout.write(JSON.stringify({ result: 'sessão simulada da bancada: nada foi revisado', is_error: false }) + '\n');
  process.exit(0);
}, 90000);
