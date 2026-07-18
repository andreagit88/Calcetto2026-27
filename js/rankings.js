const PLAYER_KEYS = ["players"];
const HISTORY_KEYS = ["matches"];
const MATCH_KEYS = ["id", "date", "present", "winners", "goals", "assists"];
const UPDATED_MATCH_KEYS = [...MATCH_KEYS, "updatedAt"];
const INPUT_MATCH_KEYS = ["date", "present", "winners", "goals", "assists"];
const STAT_KEYS = ["presenze", "vittorie", "assist", "gol"];

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function assert(condition, message) {
  if (!condition) throw new ValidationError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  assert(isPlainObject(value), `${label} deve essere un oggetto.`);
  const actual = Object.keys(value).sort(compareCodePoints);
  const wanted = [...expected].sort(compareCodePoints);
  assert(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} deve contenere soltanto: ${expected.join(", ")}.`);
}

export function normalizeName(name) {
  return name.trim().replace(/\s+/gu, " ").normalize("NFKC").toLocaleLowerCase("und");
}

export function compareCodePoints(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function compareNames(left, right) {
  const normalized = compareCodePoints(normalizeName(left), normalizeName(right));
  return normalized || compareCodePoints(left.normalize("NFKC"), right.normalize("NFKC"));
}

export function validatePlayers(data) {
  assertExactKeys(data, PLAYER_KEYS, "players.json");
  assert(Array.isArray(data.players) && data.players.length > 0,
    "players deve essere un array non vuoto.");
  const normalized = new Set();
  for (const name of data.players) {
    assert(typeof name === "string" && name === name.trim() && name.length > 0,
      "Ogni giocatore deve essere una stringa non vuota senza spazi esterni.");
    const key = normalizeName(name);
    assert(!normalized.has(key), `Giocatore duplicato: ${name}.`);
    normalized.add(key);
  }
  return [...data.players];
}

function officialNameMap(players) {
  return new Map(players.map((name) => [normalizeName(name), name]));
}

function validateNameArray(value, label, names) {
  assert(Array.isArray(value), `${label} deve essere un array.`);
  const seen = new Set();
  for (const name of value) {
    assert(typeof name === "string" && name === name.trim() && name.length > 0,
      `${label}: nome non valido.`);
    const key = normalizeName(name);
    assert(names.has(key) && names.get(key) === name, `${label}: nome sconosciuto o non canonico: ${name}.`);
    assert(!seen.has(key), `${label}: nome duplicato: ${name}.`);
    seen.add(key);
  }
  return seen;
}

function validateStats(value, label, names, present) {
  assert(isPlainObject(value), `${label} deve essere un oggetto.`);
  const seen = new Set();
  for (const [name, amount] of Object.entries(value)) {
    const key = normalizeName(name);
    assert(names.has(key) && names.get(key) === name, `${label}: nome sconosciuto o non canonico: ${name}.`);
    assert(!seen.has(key), `${label}: nome duplicato: ${name}.`);
    assert(present.has(key), `${label}: ${name} non compare tra i presenti.`);
    assert(typeof amount === "number" && Number.isInteger(amount) && amount > 0,
      `${label}: il valore di ${name} deve essere un intero positivo.`);
    seen.add(key);
  }
}

function validateDate(date) {
  assert(typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date),
    "La data deve avere formato YYYY-MM-DD.");
  const parsed = new Date(`${date}T00:00:00Z`);
  assert(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date,
    `Data non valida: ${date}.`);
}

export function validateMatchShape(match, players, { requireId = true } = {}) {
  if (requireId && Object.hasOwn(match, "updatedAt")) {
    assertExactKeys(match, UPDATED_MATCH_KEYS, "Partita");
    assert(typeof match.updatedAt === "string" && !Number.isNaN(Date.parse(match.updatedAt)),
      "updatedAt deve essere una data ISO valida.");
  } else {
    assertExactKeys(match, requireId ? MATCH_KEYS : INPUT_MATCH_KEYS, "Partita");
  }
  const names = officialNameMap(players);
  validateDate(match.date);
  const present = validateNameArray(match.present, "Presenti", names);
  assert(present.size > 0, "La partita deve avere almeno un presente.");
  const winners = validateNameArray(match.winners, "Vincitori", names);
  for (const winner of winners) {
    assert(present.has(winner), `Vincitore non presente: ${names.get(winner)}.`);
  }
  validateStats(match.goals, "Gol", names, present);
  validateStats(match.assists, "Assist", names, present);
  if (requireId) assert(typeof match.id === "string" && match.id.length > 0, "ID partita non valido.");
  return match;
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => compareNames(a, b)));
}

export function canonicalMatch(match) {
  return JSON.stringify({
    date: match.date,
    present: [...match.present].sort(compareNames),
    winners: [...match.winners].sort(compareNames),
    goals: sortObject(match.goals),
    assists: sortObject(match.assists)
  });
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const cryptoApi = globalThis.crypto ?? (await import("node:crypto")).webcrypto;
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function generateMatchId(match) {
  return `${match.date}-${(await sha256Hex(canonicalMatch(match))).slice(0, 12)}`;
}

export async function validateHistory(data, players) {
  assertExactKeys(data, HISTORY_KEYS, "matches.json");
  assert(Array.isArray(data.matches), "matches deve essere un array.");
  const ids = new Set();
  const contents = new Set();
  for (let index = 0; index < data.matches.length; index += 1) {
    const match = data.matches[index];
    validateMatchShape(match, players);
    const expectedId = await generateMatchId(match);
    assert(match.id === expectedId, `Partita ${index + 1}: ID non deterministico (atteso ${expectedId}).`);
    assert(!ids.has(match.id), `ID partita duplicato: ${match.id}.`);
    const content = canonicalMatch(match);
    assert(!contents.has(content), `Partita duplicata: ${match.id}.`);
    ids.add(match.id);
    contents.add(content);
  }
  return data.matches.map((match) => structuredClone(match));
}

export async function prepareMatch(match, players, history) {
  validateMatchShape(match, players, { requireId: false });
  const prepared = { id: await generateMatchId(match), ...structuredClone(match) };
  const content = canonicalMatch(prepared);
  assert(!history.some((existing) => existing.id === prepared.id), `ID partita già presente: ${prepared.id}.`);
  assert(!history.some((existing) => canonicalMatch(existing) === content), "La stessa partita è già presente nello storico.");
  return prepared;
}

export function calculateRankings(players, matches) {
  const totals = new Map(players.map((name) => [name, {
    name, presenze: 0, vittorie: 0, assist: 0, gol: 0
  }]));
  for (const match of matches) {
    for (const name of match.present) totals.get(name).presenze += 1;
    for (const name of match.winners) totals.get(name).vittorie += 1;
    for (const [name, amount] of Object.entries(match.assists)) totals.get(name).assist += amount;
    for (const [name, amount] of Object.entries(match.goals)) totals.get(name).gol += amount;
  }
  return Object.fromEntries(STAT_KEYS.map((stat) => [stat,
    [...totals.values()].sort((a, b) => b[stat] - a[stat] || compareNames(a.name, b.name))
  ]));
}

export function playerVariations(players, match) {
  const present = new Set(match.present);
  const winners = new Set(match.winners);
  return [...players].sort(compareNames).map((name) => ({
    name,
    presenze: present.has(name) ? 1 : 0,
    vittorie: winners.has(name) ? 1 : 0,
    assist: match.assists[name] ?? 0,
    gol: match.goals[name] ?? 0
  }));
}
