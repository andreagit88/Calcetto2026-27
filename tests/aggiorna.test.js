import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAggiorna } from "../tools/aggiorna.js";

const PLAYERS = `${JSON.stringify({ players: ["Andrea", "Matteo", "Max", "Valerio"] }, null, 2)}\n`;
const HISTORY = `${JSON.stringify({ matches: [] }, null, 2)}\n`;
const MATCH = `Data: 2026-09-15

Presenti:
Andrea
Max
Valerio

Vincitori:
Andrea
Max

Gol:
Andrea 2
Max 1

Assist:
Valerio 2
`;
const SUCCESS_MESSAGE = "✔ Partita registrata con successo.";

async function fixture(match = MATCH) {
  const root = await mkdtemp(path.join(os.tmpdir(), "calcetto-aggiorna-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "players.json"), PLAYERS);
  await writeFile(path.join(root, "data", "matches.json"), HISTORY);
  await writeFile(path.join(root, "partita.txt"), match);
  return root;
}

async function snapshot(root) {
  return {
    match: await readFile(path.join(root, "partita.txt"), "utf8"),
    players: await readFile(path.join(root, "data", "players.json"), "utf8"),
    history: await readFile(path.join(root, "data", "matches.json"), "utf8"),
    entries: (await readdir(path.join(root, "data"))).sort()
  };
}

test("risposta S applica la partita e mostra anteprima e successo", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lines = [];
  const result = await runAggiorna({ root, ask: async () => "S", write: (line) => lines.push(line) });
  assert.equal(result.status, "applied");
  assert.equal(JSON.parse(await readFile(path.join(root, "data", "matches.json"), "utf8")).matches.length, 1);
  assert(lines.some((line) => line.startsWith("Partita interpretata:")));
  assert(lines.includes("Variazioni:"));
  assert(lines.includes("Classifica Presenze:"));
  assert(lines.includes(SUCCESS_MESSAGE));
  assert(lines.includes(`ID partita: ${result.applied.match.id}`));
  assert(lines.includes(`Backup creato: ${result.applied.backup}`));
  assert(lines.includes("Classifiche e data di aggiornamento aggiornate."));
  assert.deepEqual(lines.slice(-5), [
    "Passaggi successivi:",
    "1. Apri GitHub Desktop.",
    "2. Controlla i file modificati.",
    "3. Crea il commit.",
    "4. Premi Push origin."
  ]);
});

test("risposta N annulla senza modificare file", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await snapshot(root);
  const lines = [];
  const result = await runAggiorna({ root, ask: async () => "n", write: (line) => lines.push(line) });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(await snapshot(root), before);
  assert(lines.includes("Aggiornamento annullato"));
  assert.equal(lines.includes(SUCCESS_MESSAGE), false);
});

test("risposta non valida viene richiesta nuovamente e poi S applica", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const answers = ["forse", "s"];
  let questions = 0;
  const lines = [];
  await runAggiorna({
    root,
    ask: async () => { questions += 1; return answers.shift(); },
    write: (line) => lines.push(line)
  });
  assert.equal(questions, 2);
  assert(lines.includes("Risposta non valida. Inserire S oppure N."));
  assert.equal(JSON.parse(await readFile(path.join(root, "data", "matches.json"), "utf8")).matches.length, 1);
});

test("errore di validazione non modifica alcun file", async (t) => {
  const root = await fixture(MATCH.replace("Andrea 2", "Andrea 0"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await snapshot(root);
  const lines = [];
  let asked = false;
  await assert.rejects(runAggiorna({ root, ask: async () => { asked = true; return "S"; }, write: (line) => lines.push(line) }), /intero positivo/i);
  assert.equal(asked, false);
  assert.deepEqual(await snapshot(root), before);
  assert.equal(lines.includes(SUCCESS_MESSAGE), false);
});

test("partita.txt cambiato dopo anteprima blocca applicazione", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lines = [];
  await assert.rejects(runAggiorna({
    root,
    ask: async () => {
      await writeFile(path.join(root, "partita.txt"), MATCH.replace("Andrea 2", "Andrea 3"));
      return "S";
    },
    write: (line) => lines.push(line)
  }), /sono cambiati/i);
  assert.equal((JSON.parse(await readFile(path.join(root, "data", "matches.json"), "utf8"))).matches.length, 0);
  assert.deepEqual((await readdir(path.join(root, "data"))).sort(), ["matches.json", "players.json"]);
  assert.equal(lines.includes(SUCCESS_MESSAGE), false);
});

test("applicazione crea backup e updatedAt corretti", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixed = new Date("2026-09-15T22:00:00Z");
  const result = await runAggiorna({ root, ask: async () => "S", write: () => {}, now: () => fixed });
  const stored = JSON.parse(await readFile(path.join(root, "data", "matches.json"), "utf8")).matches[0];
  assert.equal(stored.updatedAt, fixed.toISOString());
  assert.equal(await readFile(result.applied.backup, "utf8"), HISTORY);
  assert.equal(path.basename(result.applied.backup), "matches-20260915T220000Z.json");
});
