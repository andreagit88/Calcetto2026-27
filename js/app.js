import {
  calculateRankings,
  validateHistory,
  validatePlayers
} from "./rankings.js";

const sections = ["presenze", "vittorie", "assist", "gol"];

export function formatUpdatedAt(updatedAt) {
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(updatedAt));

  const value = (type) =>
    parts.find((part) => part.type === type).value;

  return `${value("day")}/${value("month")}/${value("year")} alle ore ${value("hour")}:${value("minute")}`;
}

export function updateLastUpdatedLabel(matches, element) {
  if (!element) return;

  const latest = matches.at(-1);

  if (!latest?.updatedAt) {
    element.textContent = "Campionato non ancora iniziato";
    return;
  }

  element.textContent =
    `Classifica aggiornata il ${formatUpdatedAt(latest.updatedAt)}`;
}

function renderRanking(documentRoot, stat, entries) {
  const list = documentRoot.getElementById(`classifica-${stat}`);
  const fragment = documentRoot.createDocumentFragment();

  entries.forEach((entry, index) => {
    const item = documentRoot.createElement("li");
    const position = documentRoot.createElement("span");
    const name = documentRoot.createElement("span");
    const value = documentRoot.createElement("span");

    position.className = "numero";
    name.className = "nome";
    value.className = stat;

    position.textContent = String(index + 1);
    name.textContent = entry.name;
    value.textContent = String(entry[stat]);

    item.append(position, name, value);
    fragment.append(item);
  });

  list.replaceChildren(fragment);
}

async function loadJson(path, fetchJson) {
  const response = await fetchJson(path, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Impossibile caricare ${path}: HTTP ${response.status}.`
    );
  }

  return response.json();
}

export async function main(documentRoot, fetchJson) {
  const [playersData, historyData] = await Promise.all([
    loadJson("data/players.json", fetchJson),
    loadJson("data/matches.json", fetchJson)
  ]);

  const players = validatePlayers(playersData);
  const matches = await validateHistory(historyData, players);

  updateLastUpdatedLabel(
    matches,
    documentRoot.querySelector(".aggiornamento")
  );

  const rankings = calculateRankings(players, matches);

  for (const stat of sections) {
    renderRanking(documentRoot, stat, rankings[stat]);
  }

  revealDynamicContent(documentRoot);
}

export function revealDynamicContent(documentRoot) {
  const content = documentRoot.getElementById("contenuto-dinamico");
  if (content) content.removeAttribute("hidden");
}

export function showLoadingError(documentRoot) {
  const label = documentRoot.querySelector(".aggiornamento");
  if (label) {
    label.textContent = "Classifiche temporaneamente non disponibili";
  }
  revealDynamicContent(documentRoot);
}

if (typeof document !== "undefined") {
  main(document, fetch).catch((error) => {
    console.error("Classifiche non disponibili:", error);
    showLoadingError(document);
  });
}
