import { open, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  calculateRankings,
  normalizeName,
  playerVariations,
  prepareMatch,
  sha256Hex,
  validateHistory,
  validatePlayers,
  ValidationError
} from "../js/rankings.js";

const SECTION_NAMES = new Map([
  ["Presenti:", "present"],
  ["Vincitori:", "winners"],
  ["Gol:", "goals"],
  ["Assist:", "assists"]
]);
const COMPACT_SECTION_NAMES = new Map([
  ["Presenti", "present"],
  ["Vincitori", "winners"],
  ["Vittoria", "winners"],
  ["Gol", "goals"],
  ["Assist", "assists"]
]);
const REQUIRED_SECTIONS = ["present", "winners", "goals", "assists"];
const RANKING_LABELS = [
  ["presenze", "Presenze"],
  ["vittorie", "Vittorie"],
  ["assist", "Assist"],
  ["gol", "Gol"]
];

function fail(message) {
  throw new ValidationError(message);
}

function parseStatLine(line, section, seen) {
  const match = /^(.*?)\s+(\S+)$/u.exec(line);
  if (!match) fail(`${section}: riga non valida: ${line}.`);
  const [, name, rawAmount] = match;
  if (!/^[1-9]\d*$/u.test(rawAmount)) {
    fail(`${section}: il valore di ${name} deve essere un intero positivo.`);
  }
  const key = normalizeName(name);
  if (seen.has(key)) fail(`${section}: nome duplicato: ${name}.`);
  seen.add(key);
  return [name, Number(rawAmount)];
}

function addItem(parsed, section, rawItem, listSeen, statSeen) {
  const item = rawItem.trim();
  if (item === "") fail(`${section === "present" ? "Presenti" : section === "winners" ? "Vincitori" : section === "goals" ? "Gol" : "Assist"}: voce vuota.`);
  if (section === "present" || section === "winners") {
    const key = normalizeName(item);
    if (listSeen[section].has(key)) fail(`${section === "present" ? "Presenti" : "Vincitori"}: nome duplicato: ${item}.`);
    listSeen[section].add(key);
    parsed[section].push(item);
    return;
  }
  const [name, amount] = parseStatLine(item, section === "goals" ? "Gol" : "Assist", statSeen[section]);
  parsed[section][name] = amount;
}

export function parseMatchText(text) {
  const lines = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n");
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  const dateLine = lines[index]?.trim() ?? "";
  const dateMatch = /^Data:\s*(\S+)$/u.exec(dateLine);
  if (!dateMatch) fail("La prima riga deve essere 'Data: YYYY-MM-DD'.");
  index += 1;

  const parsed = { date: dateMatch[1], present: [], winners: [], goals: {}, assists: {} };
  const found = new Set();
  let current = null;
  const statSeen = { goals: new Set(), assists: new Set() };
  const listSeen = { present: new Set(), winners: new Set() };

  for (; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "") continue;
    if (SECTION_NAMES.has(line)) {
      current = SECTION_NAMES.get(line);
      if (found.has(current)) fail(`Sezione duplicata: ${line}`);
      found.add(current);
      continue;
    }
    const compactMatch = /^(Presenti|Vincitori|Vittoria|Gol|Assist):\s*(.*)$/u.exec(line);
    if (compactMatch) {
      const [, label, values] = compactMatch;
      current = COMPACT_SECTION_NAMES.get(label);
      if (found.has(current)) fail(`Sezione duplicata: ${label}:`);
      found.add(current);
      if (values.trim() !== "" || current === "present") {
        for (const item of values.split(",")) addItem(parsed, current, item, listSeen, statSeen);
      }
      current = null;
      continue;
    }
    if (current === null) fail(`Riga fuori da una sezione: ${line}.`);
    addItem(parsed, current, line, listSeen, statSeen);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!found.has(section)) fail(`Sezione mancante: ${section}.`);
  }
  return parsed;
}

function parseJson(raw, fileName) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${fileName} non contiene JSON valido: ${error.message}`);
  }
}

export async function previewCode(rawMatch, rawPlayers, rawHistory) {
  const framed = [rawMatch, rawPlayers, rawHistory]
    .map((value) => `${new TextEncoder().encode(value).length}:${value}`)
    .join("|");
  return sha256Hex(`calcetto-preview-v1|${framed}`);
}

async function loadAndValidate(root) {
  const files = {
    match: path.join(root, "partita.txt"),
    players: path.join(root, "data", "players.json"),
    history: path.join(root, "data", "matches.json")
  };
  const [rawMatch, rawPlayers, rawHistory] = await Promise.all([
    readFile(files.match, "utf8"),
    readFile(files.players, "utf8"),
    readFile(files.history, "utf8")
  ]);
  const players = validatePlayers(parseJson(rawPlayers, "players.json"));
  const history = await validateHistory(parseJson(rawHistory, "matches.json"), players);
  const input = parseMatchText(rawMatch);
  const match = await prepareMatch(input, players, history);
  const code = await previewCode(rawMatch, rawPlayers, rawHistory);
  return { files, rawHistory, players, history, match, code };
}

function writePreview(output, data) {
  output(`Partita interpretata: ${data.match.id}`);
  output(`Data: ${data.match.date}`);
  output(`Presenti: ${data.match.present.join(", ")}`);
  output(`Vincitori: ${data.match.winners.length ? data.match.winners.join(", ") : "nessuno"}`);
  output(`Gol: ${Object.entries(data.match.goals).map(([name, value]) => `${name} ${value}`).join(", ") || "nessuno"}`);
  output(`Assist: ${Object.entries(data.match.assists).map(([name, value]) => `${name} ${value}`).join(", ") || "nessuno"}`);
  output("");
  output("Variazioni:");
  for (const item of playerVariations(data.players, data.match)) {
    output(`${item.name}: Presenze +${item.presenze}, Vittorie +${item.vittorie}, Assist +${item.assist}, Gol +${item.gol}`);
  }
  const rankings = calculateRankings(data.players, [...data.history, data.match]);
  for (const [key, label] of RANKING_LABELS) {
    output("");
    output(`Classifica ${label}:`);
    rankings[key].forEach((entry, index) => output(`${index + 1}. ${entry.name} ${entry[key]}`));
  }
  output("");
  output(`CODICE_ANTEPRIMA: ${data.code}`);
}

function backupStamp(date) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

async function writeExclusive(file, content) {
  const handle = await open(file, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function createUniqueBackup(directory, rawHistory, now) {
  await mkdir(directory, { recursive: true });
  const base = `matches-${backupStamp(now)}.json`;
  for (let suffix = 0; ; suffix += 1) {
    const name = suffix === 0 ? base : base.replace(/\.json$/u, `-${suffix}.json`);
    const target = path.join(directory, name);
    try {
      await writeExclusive(target, rawHistory);
      return target;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

async function applyUpdate(root, data, now) {
  const storedMatch = { ...data.match, updatedAt: now.toISOString() };
  const nextHistory = `${JSON.stringify({ matches: [...data.history, storedMatch] }, null, 2)}\n`;
  const historyDirectory = path.dirname(data.files.history);
  const temporary = path.join(historyDirectory, `.matches-${process.pid}-${now.getTime()}.tmp`);
  await writeExclusive(temporary, nextHistory);
  try {
    const backup = await createUniqueBackup(path.join(historyDirectory, "backups"), data.rawHistory, now);
    await rename(temporary, data.files.history);
    return { backup, storedMatch };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function runUpdate({ root, args, output = console.log, now = () => new Date() }) {
  const [mode, suppliedCode, ...extra] = args;
  if (extra.length > 0 || !["--preview", "--apply"].includes(mode)) {
    fail("Uso: node tools/update-match.js --preview | --apply CODICE_ANTEPRIMA");
  }
  if (mode === "--preview" && suppliedCode !== undefined) fail("--preview non accetta altri argomenti.");
  if (mode === "--apply" && !/^[a-f0-9]{64}$/u.test(suppliedCode ?? "")) {
    fail("--apply richiede un CODICE_ANTEPRIMA SHA-256 valido.");
  }
  const data = await loadAndValidate(root);
  if (mode === "--preview") {
    writePreview(output, data);
    return { mode, code: data.code, match: data.match };
  }
  if (suppliedCode !== data.code) fail("Codice anteprima non valido: uno o più file sono cambiati dopo l'anteprima.");
  const { backup, storedMatch } = await applyUpdate(root, data, now());
  output(`Partita ${data.match.id} registrata.`);
  output(`Backup creato: ${path.relative(root, backup)}`);
  return { mode, match: storedMatch, backup };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const root = path.resolve(path.dirname(currentFile), "..");
  runUpdate({ root, args: process.argv.slice(2) }).catch((error) => {
    console.error(`Errore: ${error.message}`);
    process.exitCode = 1;
  });
}
