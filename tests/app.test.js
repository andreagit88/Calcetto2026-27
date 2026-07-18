import test from "node:test";
import assert from "node:assert/strict";
import { formatUpdatedAt, updateLastUpdatedLabel } from "../js/app.js";

test("formatta updatedAt in italiano nel fuso di Roma", () => {
  assert.equal(formatUpdatedAt("2026-09-15T20:05:00.000Z"), "15/09/2026 alle ore 22:05");
});

test("usa updatedAt dell'ultima partita per aggiornare la scritta", () => {
  const element = { textContent: "testo precedente" };
  updateLastUpdatedLabel([
    { updatedAt: "2026-09-14T18:00:00.000Z" },
    { updatedAt: "2026-09-15T20:05:00.000Z" }
  ], element);
  assert.equal(element.textContent, "Classifica aggiornata il 15/09/2026 alle ore 22:05");
});

test("con storico vuoto mostra che il campionato non è ancora iniziato", () => {
  const element = { textContent: "Classifica aggiornata manualmente" };
  updateLastUpdatedLabel([], element);
  assert.equal(element.textContent, "Campionato non ancora iniziato");
});
