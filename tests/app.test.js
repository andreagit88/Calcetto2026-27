import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  formatUpdatedAt,
  main,
  revealPage,
  showLoadingError,
  updateLastUpdatedLabel
} from "../js/app.js";

function fakeElement(attributes = []) {
  return {
    attributes: new Set(attributes),
    children: [],
    textContent: "",
    append(...children) {
      this.children.push(...children);
    },
    hasAttribute(name) {
      return this.attributes.has(name);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    replaceChildren(fragment) {
      this.children = [...fragment.children];
    }
  };
}

function fakeDocument() {
  const elements = Object.fromEntries([
    ["contenuto-dinamico", fakeElement()],
    ...["presenze", "vittorie", "assist", "gol"].map((stat) => [
      `classifica-${stat}`,
      fakeElement()
    ])
  ]);
  const updatedAt = fakeElement();

  return {
    body: fakeElement(["hidden"]),
    elements,
    updatedAt,
    createDocumentFragment: () => fakeElement(),
    createElement: () => fakeElement(),
    getElementById: (id) => elements[id],
    querySelector: (selector) => selector === ".aggiornamento" ? updatedAt : null
  };
}

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

test("l'intera pagina parte nascosta e include titolo, classifiche e regolamento", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const body = html.match(/<body hidden>([\s\S]*?)<\/body>/u);
  const dynamicContent = html.match(/<section id="contenuto-dinamico">([\s\S]*?)<\/section>/u);

  assert.ok(body);
  assert.ok(dynamicContent);
  assert.match(body[1], /<h1>Calcetto 2026\/27<\/h1>/u);
  for (const stat of ["presenze", "vittorie", "assist", "gol"]) {
    assert.match(dynamicContent[1], new RegExp(`id="classifica-${stat}"`, "u"));
  }
  assert.match(dynamicContent[1], /class="aggiornamento"/u);
  assert.match(body[1], /<h2>Regolamento<\/h2>/u);
  assert.match(html, /<script type="module" src="js\/app\.js\?v=3"><\/script>/u);
});

test("rimuove realmente hidden dall'intera pagina in una sola operazione", () => {
  const body = fakeElement(["hidden"]);
  revealPage({ body });
  assert.equal(body.hasAttribute("hidden"), false);
});

test("main carica i due JSON, renderizza le quattro classifiche e poi mostra tutta la pagina", async () => {
  const documentRoot = fakeDocument();
  const requested = [];
  const responses = {
    "data/players.json": { players: ["Andrea"] },
    "data/matches.json": { matches: [] }
  };
  const fetchJson = async (path) => {
    requested.push(path);
    return { ok: true, json: async () => responses[path] };
  };

  await main(documentRoot, fetchJson);

  assert.deepEqual(requested.sort(), ["data/matches.json", "data/players.json"]);
  for (const stat of ["presenze", "vittorie", "assist", "gol"]) {
    assert.equal(documentRoot.elements[`classifica-${stat}`].children.length, 1);
  }
  assert.equal(documentRoot.body.hasAttribute("hidden"), false);
});

test("in caso di errore mostra un messaggio e non lascia la pagina nascosta", () => {
  const body = fakeElement(["hidden"]);
  const label = { textContent: "testo precedente" };
  const documentRoot = {
    body,
    querySelector: () => label
  };

  showLoadingError(documentRoot);

  assert.equal(label.textContent, "Classifiche temporaneamente non disponibili");
  assert.equal(body.hasAttribute("hidden"), false);
});
