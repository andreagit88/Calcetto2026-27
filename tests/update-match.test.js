import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseMatchText, runUpdate } from "../tools/update-match.js";

const PLAYER_DATA = `${JSON.stringify({ players: ["Andrea", "Matteo", "Max", "Valerio"] }, null, 2)}\n`;
const EMPTY_HISTORY = `${JSON.stringify({ matches: [] }, null, 2)}\n`;
const VALID_MATCH = `Data: 2026-09-15

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
const COMPACT_MATCH = `Data: 2026-09-15
Presenti: Andrea, Max, Valerio
Vittoria: Andrea, Max
Gol: Andrea 2, Max 1
Assist: Valerio 2
`;
const EMPTY_MATCH_TEMPLATE = `Data:
Presenti:
Vittoria:
Gol:
Assist:
`;

async function fixture(matchText = VALID_MATCH) {
  const root = await mkdtemp(path.join(os.tmpdir(), "calcetto-test-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "players.json"), PLAYER_DATA);
  await writeFile(path.join(root, "data", "matches.json"), EMPTY_HISTORY);
  await writeFile(path.join(root, "partita.txt"), matchText);
  return root;
}

async function snapshot(root) {
  return {
    match: await readFile(path.join(root, "partita.txt"), "utf8"),
    players: await readFile(path.join(root, "data", "players.json"), "utf8"),
    history: await readFile(path.join(root, "data", "matches.json"), "utf8"),
    dataEntries: (await readdir(path.join(root, "data"))).sort()
  };
}

test("--preview non crea, modifica o elimina file", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await snapshot(root);
  const result = await runUpdate({ root, args: ["--preview"], output: () => {} });
  const after = await snapshot(root);
  assert.match(result.code, /^[a-f0-9]{64}$/u);
  assert.deepEqual(after, before);
});

test("--apply rifiuta un codice precedente se partita.txt cambia", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await runUpdate({ root, args: ["--preview"], output: () => {} });
  await writeFile(path.join(root, "partita.txt"), VALID_MATCH.replace("Andrea 2", "Andrea 3"));
  const beforeHistory = await readFile(path.join(root, "data", "matches.json"), "utf8");
  await assert.rejects(runUpdate({ root, args: ["--apply", preview.code], output: () => {} }), /sono cambiati/i);
  assert.equal(await readFile(path.join(root, "data", "matches.json"), "utf8"), beforeHistory);
  assert.deepEqual(await readdir(path.join(root, "data")), ["matches.json", "players.json"]);
});

test("un errore di validazione non modifica matches.json", async (t) => {
  const root = await fixture(VALID_MATCH.replace("Andrea 2", "Andrea 0"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await snapshot(root);
  await assert.rejects(runUpdate({ root, args: ["--preview"], output: () => {} }), /intero positivo/i);
  assert.deepEqual(await snapshot(root), before);
});

test("--apply crea un backup univoco e aggiunge atomicamente la partita", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await runUpdate({ root, args: ["--preview"], output: () => {} });
  const fixedDate = new Date("2026-09-15T22:00:00Z");
  const lines = [];
  const result = await runUpdate({ root, args: ["--apply", preview.code], output: (line) => lines.push(line), now: () => fixedDate });
  const history = JSON.parse(await readFile(path.join(root, "data", "matches.json"), "utf8"));
  assert.equal(history.matches.length, 1);
  assert.equal(history.matches[0].updatedAt, fixedDate.toISOString());
  assert.equal(result.match.updatedAt, fixedDate.toISOString());
  assert.equal(await readFile(result.backup, "utf8"), EMPTY_HISTORY);
  assert.equal(path.basename(result.backup), "matches-20260915T220000Z.json");
  assert.equal(await readFile(path.join(root, "partita.txt"), "utf8"), EMPTY_MATCH_TEMPLATE);
  assert.equal(lines.at(-1), "✓ partita.txt ripristinato e pronto per la prossima partita.");
  assert.deepEqual((await readdir(path.join(root, "data"))).sort(), ["backups", "matches.json", "players.json"]);
});

test("un errore durante il backup non modifica partita.txt o matches.json", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const preview = await runUpdate({ root, args: ["--preview"], output: () => {} });
  const before = await snapshot(root);
  await writeFile(path.join(root, "data", "backups"), "impedisce la creazione della cartella");

  await assert.rejects(
    runUpdate({ root, args: ["--apply", preview.code], output: () => {} }),
    /EEXIST|exist/i
  );

  assert.equal(await readFile(path.join(root, "partita.txt"), "utf8"), before.match);
  assert.equal(await readFile(path.join(root, "data", "matches.json"), "utf8"), before.history);
});

test("--preview non crea updatedAt", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runUpdate({ root, args: ["--preview"], output: () => {} });
  assert.equal(Object.hasOwn(result.match, "updatedAt"), false);
  assert.equal(JSON.parse(await readFile(path.join(root, "data", "matches.json"), "utf8")).matches.length, 0);
});

test("il parser rifiuta duplicati e valori non interi positivi", () => {
  assert.throws(() => parseMatchText(VALID_MATCH.replace("Max\nValerio", "Max\nMax\nValerio")), /duplicato/i);
  for (const value of ["-1", "0", "1.5", "abc"]) {
    assert.throws(() => parseMatchText(VALID_MATCH.replace("Andrea 2", `Andrea ${value}`)), /intero positivo/i);
  }
});

test("accetta il formato compatto valido con Vittoria al singolare", () => {
  assert.deepEqual(parseMatchText(COMPACT_MATCH), {
    date: "2026-09-15",
    present: ["Andrea", "Max", "Valerio"],
    winners: ["Andrea", "Max"],
    goals: { Andrea: 2, Max: 1 },
    assists: { Valerio: 2 }
  });
});

test("ignora gli spazi prima e dopo le virgole nel formato compatto", () => {
  const parsed = parseMatchText(COMPACT_MATCH
    .replace("Andrea, Max, Valerio", "Andrea ,Max ,  Valerio")
    .replace("Andrea, Max", "Andrea  ,   Max")
    .replace("Andrea 2, Max 1", "Andrea 2 ,Max 1"));
  assert.deepEqual(parsed.present, ["Andrea", "Max", "Valerio"]);
  assert.deepEqual(parsed.winners, ["Andrea", "Max"]);
  assert.deepEqual(parsed.goals, { Andrea: 2, Max: 1 });
});

test("rifiuta i duplicati nel formato compatto", () => {
  assert.throws(() => parseMatchText(COMPACT_MATCH.replace("Andrea, Max, Valerio", "Andrea, Max, Andrea")), /duplicato/i);
});

test("rifiuta un valore gol non valido nel formato compatto", () => {
  assert.throws(() => parseMatchText(COMPACT_MATCH.replace("Andrea 2", "Andrea 1.5")), /intero positivo/i);
});

test("mantiene la compatibilità con il vecchio formato multilinea", () => {
  const parsed = parseMatchText(VALID_MATCH);
  assert.deepEqual(parsed.present, ["Andrea", "Max", "Valerio"]);
  assert.deepEqual(parsed.winners, ["Andrea", "Max"]);
  assert.deepEqual(parsed.goals, { Andrea: 2, Max: 1 });
  assert.deepEqual(parsed.assists, { Valerio: 2 });
});

test("interpreta Vittoria compatta senza nomi come pareggio", () => {
  const parsed = parseMatchText(COMPACT_MATCH.replace("Vittoria: Andrea, Max", "Vittoria:"));
  assert.deepEqual(parsed.winners, []);
});

test("interpreta Gol compatto senza valori come nessun gol", () => {
  const parsed = parseMatchText(COMPACT_MATCH.replace("Gol: Andrea 2, Max 1", "Gol:"));
  assert.deepEqual(parsed.goals, {});
});

test("interpreta Assist compatto senza valori come nessun assist", () => {
  const parsed = parseMatchText(COMPACT_MATCH.replace("Assist: Valerio 2", "Assist:"));
  assert.deepEqual(parsed.assists, {});
});
