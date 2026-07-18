import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runUpdate } from "./update-match.js";

export async function runAggiorna({
  root,
  write = console.log,
  ask,
  now = () => new Date()
}) {
  const preview = await runUpdate({ root, args: ["--preview"], output: write });
  let answer;
  do {
    answer = (await ask("Procedere con l'aggiornamento? (S/N) ")).trim();
    if (!/^[sSnN]$/u.test(answer)) write("Risposta non valida. Inserire S oppure N.");
  } while (!/^[sSnN]$/u.test(answer));

  if (/^[nN]$/u.test(answer)) {
    write("Aggiornamento annullato");
    return { status: "cancelled", preview };
  }

  const applied = await runUpdate({
    root,
    args: ["--apply", preview.code],
    output: write,
    now
  });
  write("");
  write("✔ Partita registrata con successo.");
  write("");
  write(`ID partita: ${applied.match.id}`);
  write(`Backup creato: ${applied.backup}`);
  write("");
  write("Classifiche e data di aggiornamento aggiornate.");
  write("");
  write("Passaggi successivi:");
  write("1. Apri GitHub Desktop.");
  write("2. Controlla i file modificati.");
  write("3. Crea il commit.");
  write("4. Premi Push origin.");
  return { status: "applied", preview, applied };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const root = path.resolve(path.dirname(currentFile), "..");
  const terminal = createInterface({ input, output });
  runAggiorna({
    root,
    ask: (question) => terminal.question(question)
  }).catch((error) => {
    console.error(`Errore: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => terminal.close());
}
