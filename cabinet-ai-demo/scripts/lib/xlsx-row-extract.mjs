import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

const FUNCTIONAL_DOOR_MATERIAL = /^(?:4E門板|鋁框門(?:板)?)$/i;
const DOOR_PANEL_MATERIAL = /^(?:4E門板|鋁框門(?:板)?|假門板|屜頭)$/i;
const DOOR_HARDWARE = /GS鉸鍊|油壓器|J型?手把|斜手把|長斜把/i;

export function bomRowScope(row) {
  const item = String(row?.item || "").trim();
  if (DOOR_HARDWARE.test(item)) return "door-hardware";
  if (DOOR_PANEL_MATERIAL.test(item)) return "door-panels";
  return "other";
}

export function rowMatchesScope(row, scope = "full") {
  if (scope === "full") return true;
  const item = String(row?.item || "").trim();
  if (scope === "non-door") return !FUNCTIONAL_DOOR_MATERIAL.test(item) && !DOOR_HARDWARE.test(item);
  if (scope === "door-panels") return bomRowScope(row) === "door-panels";
  if (scope === "door-hardware") return bomRowScope(row) === "door-hardware";
  if (scope === "door-related") return bomRowScope(row) !== "other";
  throw new Error(`unknown BOM scope: ${scope}`);
}

export function filterRowsByScope(rows, scope = "full") {
  return rows.filter((row) => rowMatchesScope(row, scope));
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function columnIndex(reference) {
  let result = 0;
  for (const char of String(reference).match(/[A-Z]+/)?.[0] || "") result = result * 26 + char.charCodeAt(0) - 64;
  return result - 1;
}

function textRuns(xml) {
  return [...String(xml || "").matchAll(/<(?:x:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:x:)?t>/g)]
    .map((match) => decodeXml(match[1])).join("");
}

function sharedStrings(xml) {
  return [...String(xml || "").matchAll(/<(?:x:)?si\b[^>]*>([\s\S]*?)<\/(?:x:)?si>/g)]
    .map((match) => textRuns(match[1]));
}

export function parseSheet(xml, strings = []) {
  const rows = [];
  for (const match of xml.matchAll(/<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)) {
    const row = [];
    // Keep self-closing blank cells (for example <c r="C2"/>) from
    // consuming the next non-empty cell. A greedy attribute capture can take
    // the slash and then follow the normal closing-tag branch, shifting every
    // later value one column to the left.
    for (const cell of match[1].matchAll(/<(?:x:)?c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:x:)?c\s*>)/g)) {
      const attributes = cell[1] || "";
      const reference = attributes.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!reference) continue;
      const body = cell[2] || "";
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] || "n";
      const raw = body.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/)?.[1] ?? textRuns(body);
      row[columnIndex(reference)] = type === "s" ? (strings[Number(raw)] ?? "") : decodeXml(raw);
    }
    rows.push(row);
  }
  return rows;
}

export async function workbookSheets(path) {
  const files = unzipSync(new Uint8Array(await readFile(path)));
  const strings = files["xl/sharedStrings.xml"] ? sharedStrings(strFromU8(files["xl/sharedStrings.xml"])) : [];
  const sheets = Object.entries(files)
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, bytes]) => parseSheet(strFromU8(bytes), strings));
  if (!sheets.length) throw new Error(`${path} has no readable worksheets`);
  return sheets;
}

function positiveNumber(value) {
  const text = String(value ?? "").trim();
  return text !== "" && Number.isFinite(Number(text)) && Number(text) > 0;
}

function materialDataRow(row) {
  return String(row[0] || "").trim() && String(row[1] || "").trim()
    && positiveNumber(row[2]) && positiveNumber(row[3])
    && positiveNumber(row[4]) && positiveNumber(row[6]);
}

export function referenceRows(sheets, selectedCabinet = "", selectedScope = "full") {
  const allMaterials = (sheets[0] || []).filter(materialDataRow);
  const cabinetNames = new Set(allMaterials.map((row) => String(row[0] || "").trim()));
  const materials = allMaterials.filter((row) => {
    const cabinet = String(row[0] || "").trim();
    const item = String(row[1] || "").trim();
    return (!selectedCabinet || cabinet === selectedCabinet)
      && rowMatchesScope({ item }, selectedScope);
  }).map((row) => ({
    item: row[1], spec: `${row[2]} × ${row[3]}`, thickness: row[4], qty: row[6], note: row[7],
  }));
  const hardware = (sheets[1] || []).filter((row) => {
    const cabinet = String(row[0] || "").trim();
    const item = String(row[1] || "").trim();
    return cabinetNames.has(cabinet) && item && positiveNumber(row[3])
      && (!selectedCabinet || cabinet === selectedCabinet)
      && rowMatchesScope({ item }, selectedScope);
  }).map((row) => ({
    item: row[1], spec: String(row[2] || "").trim() === "—" ? "" : row[2], thickness: "", qty: row[3], note: row[5],
  }));
  return [...materials, ...hardware];
}

export function outputRows(sheets) {
  let hardware = false;
  const rows = [];
  for (const row of sheets[0] || []) {
    const item = String(row[0] || "").trim();
    if (item === "非門五金" || item === "五金") { hardware = true; continue; }
    if (!item || item === "項目" || /^案件名稱：/.test(item) || !positiveNumber(row[4])) continue;
    if (!hardware && (!String(row[1] || "").trim() || !positiveNumber(row[3]))) continue;
    rows.push({ item, spec: row[1], thickness: hardware ? "" : row[3], qty: row[4], note: row[11] });
  }
  return rows;
}
