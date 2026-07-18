import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRankings,
  generateMatchId,
  prepareMatch,
  validateHistory,
  validateMatchShape,
  validatePlayers
} from "../js/rankings.js";

const players = ["Matteo", "Andrea", "Max", "Valerio"];

function match(overrides = {}) {
  return {
    date: "2026-09-15",
    present: ["Andrea", "Max", "Valerio"],
    winners: ["Andrea", "Max"],
    goals: { Andrea: 2, Max: 1 },
    assists: { Valerio: 2 },
    ...overrides
  };
}

test("a parità di valore ordina alfabeticamente in ordine crescente", () => {
  const rankings = calculateRankings(players, []);
  assert.deepEqual(rankings.presenze.map((entry) => entry.name), ["Andrea", "Matteo", "Max", "Valerio"]);
});

test("rifiuta un nome sconosciuto", () => {
  assert.throws(() => validateMatchShape(match({ present: ["Andrea", "Sconosciuto"] }), players, { requireId: false }), /sconosciuto/i);
});

test("rifiuta nomi duplicati", () => {
  assert.throws(() => validatePlayers({ players: ["Andrea", " Andrea "] }), /duplicato|spazi esterni/i);
  assert.throws(() => validateMatchShape(match({ present: ["Andrea", "Andrea"] }), players, { requireId: false }), /duplicato/i);
});

test("rifiuta un vincitore non presente", () => {
  assert.throws(() => validateMatchShape(match({ winners: ["Matteo"] }), players, { requireId: false }), /non presente/i);
});

test("rifiuta un marcatore o assistman non presente", () => {
  assert.throws(() => validateMatchShape(match({ goals: { Matteo: 1 } }), players, { requireId: false }), /non compare/i);
  assert.throws(() => validateMatchShape(match({ assists: { Matteo: 1 } }), players, { requireId: false }), /non compare/i);
});

for (const [label, value] of [["negativo", -1], ["zero", 0], ["decimale", 1.5], ["non numerico", "2"]]) {
  test(`rifiuta un numero ${label}`, () => {
    assert.throws(() => validateMatchShape(match({ goals: { Andrea: value } }), players, { requireId: false }), /intero positivo/i);
  });
}

test("rifiuta ID duplicati e contenuto duplicato nello storico", async () => {
  const base = match();
  const stored = { id: await generateMatchId(base), ...base };
  await assert.rejects(validateHistory({ matches: [stored, structuredClone(stored)] }, players), /duplicato/i);
});

test("rifiuta una seconda registrazione della stessa partita", async () => {
  const base = match();
  const stored = { id: await generateMatchId(base), ...base };
  await assert.rejects(prepareMatch(base, players, [stored]), /già presente/i);
});

test("calcola tutti i risultati esclusivamente dallo storico", async () => {
  const stored = await prepareMatch(match(), players, []);
  const rankings = calculateRankings(players, [stored]);
  assert.equal(rankings.presenze.find((entry) => entry.name === "Andrea").presenze, 1);
  assert.equal(rankings.vittorie.find((entry) => entry.name === "Andrea").vittorie, 1);
  assert.equal(rankings.gol.find((entry) => entry.name === "Andrea").gol, 2);
  assert.equal(rankings.assist.find((entry) => entry.name === "Valerio").assist, 2);
});

test("accetta nello storico partite vecchie e partite con updatedAt ISO", async () => {
  const base = match();
  const oldMatch = { id: await generateMatchId(base), ...base };
  await assert.doesNotReject(validateHistory({ matches: [oldMatch] }, players));
  await assert.doesNotReject(validateHistory({
    matches: [{ ...oldMatch, updatedAt: "2026-09-15T20:05:00.000Z" }]
  }, players));
});
