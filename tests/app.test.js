import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  formatUpdatedAt,
  revealDynamicContent,
  showLoadingError,
  updateLastUpdatedLabel
} from "../js/app.js";

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

test("il contenuto dinamico parte nascosto e include tutte le classifiche", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const dynamicContent = html.match(/<section id="contenuto-dinamico" hidden>([\s\S]*?)<\/section>/u);

  assert.ok(dynamicContent);
  for (const stat of ["presenze", "vittorie", "assist", "gol"]) {
    assert.match(dynamicContent[1], new RegExp(`id="classifica-${stat}"`, "u"));
  }
  assert.match(dynamicContent[1], /class="aggiornamento"/u);
  assert.ok(html.indexOf("<h2>Regolamento</h2>") > dynamicContent.index + dynamicContent[0].length);
});

test("rende visibile tutto il contenuto dinamico in una sola operazione", () => {
  const content = { hidden: true };
  revealDynamicContent({ getElementById: () => content });
  assert.equal(content.hidden, false);
});

test("in caso di errore mostra un messaggio e non lascia la sezione nascosta", () => {
  const content = { hidden: true };
  const label = { textContent: "testo precedente" };
  const documentRoot = {
    getElementById: () => content,
    querySelector: () => label
  };

  showLoadingError(documentRoot);

  assert.equal(label.textContent, "Classifiche temporaneamente non disponibili");
  assert.equal(content.hidden, false);
});
