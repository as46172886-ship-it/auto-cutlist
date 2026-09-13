import { strToU8, zipSync } from "fflate";

export type WorkbookMaterialRow = { item: string; spec: string; qty: number; note: string; thicknessMm?: number };
export type WorkbookHardwareRow = { item: string; qty: number; unit: string; note: string };

type CellValue = string | number;
type SheetCell = { value?: CellValue; style?: number };

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value: CellValue) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function cellXml(row: number, column: number, cell: SheetCell) {
  const ref = `${columnName(column)}${row}`;
  const style = ` s="${cell.style || 0}"`;
  if (cell.value === undefined || cell.value === "") return `<c r="${ref}"${style}/>`;
  if (typeof cell.value === "number") return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
}

function worksheetXml(rows: SheetCell[][], merges: string[], widths: number[], freezeRow = 2, includeAutoFilter = true) {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const data = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: maxColumns }, (_, columnIndex) => cellXml(rowIndex + 1, columnIndex + 1, row[columnIndex] || {})).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="25" customHeight="1"' : ''}>${cells}</row>`;
  }).join("");
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((range) => `<mergeCell ref="${range}"/>`).join("")}</mergeCells>` : "";
  const filterXml = includeAutoFilter ? `<autoFilter ref="A2:L${rows.length}"/>` : "";
  // SpreadsheetML has a strict child-element order. In particular, autoFilter
  // must precede mergeCells; Excel removes the whole worksheet when reversed.
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${columnName(maxColumns)}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="21"/><cols>${columns}</cols><sheetData>${data}</sheetData>${filterXml}${mergeXml}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`;
}

function materialThicknessMm(item: string) {
  if (/明鏡|鏡子/.test(item)) return 5;
  if (/檯面/.test(item)) return 25;
  if (/抽補板/.test(item)) return 25;
  if (/背板|抽底板|襯板/.test(item)) return 8;
  return 18;
}

const MATERIAL_ORDER = [
  "側板", "頂底板", "頂板", "底板", "中立板", "固格板", "活格板", "抽框", "框中立", "橫木",
  "前抽牆", "內抽前抽牆", "邊抽牆", "抽底板", "屜頭", "4E門板", "假門板", "側封板", "封板", "填縫板",
  "軌道板", "擋板", "襯板", "背板", "踢腳板", "檯面", "背條", "明鏡",
];
const HARDWARE_ORDER = ["A10", "A12", "KD", "抽木榫", "白固格器", "黃固格器", "活格利", "滑軌", "GS鉸鍊", "油壓器", "J型手把", "斜手把", "伸縮衣桿", "鏡珠"];

function itemOrder(item: string, order: string[]) {
  const exact = order.indexOf(item);
  if (exact >= 0) return exact;
  const fuzzy = order.findIndex((label) => item.includes(label));
  return fuzzy < 0 ? order.length : fuzzy;
}

export function compactProductionNote(note: string, item = "", spec = "") {
  const normalized = String(note || "").replaceAll("D-40", "D−40");
  const countedDirections = [...new Set([...normalized.matchAll(/\d+左、\d+右/g)].map((match) => match[0]))];
  const jDirectionNotes = [...new Set([...normalized.matchAll(/(左開|右開|左右開)／J把×(\d+)/g)].map((match) => `${match[1]}J把×${match[2]}`))];
  const jDirections = new Set(jDirectionNotes.map((item) => item.match(/^(左開|右開|左右開)/)?.[1]).filter(Boolean));
  const singleDirections = [...new Set([...normalized.matchAll(/左開|右開|左右開/g)].map((match) => match[0]))]
    .filter((direction) => !jDirections.has(direction));
  const directionNotes = countedDirections.length ? countedDirections : singleDirections;
  const genericJNotes = jDirectionNotes.length ? [] : [...new Set([...normalized.matchAll(/J把×\d+/g)].map((match) => match[0]))];
  const handleNotes = [...new Set([...normalized.matchAll(/(?:上|下|長)斜把(?:×\d+)?/g)].map((match) =>
    /^(?:4E門板|假門板|屜頭)$/.test(item) ? match[0].replace(/×\d+$/, "") : match[0],
  ))];
  const matches = [
    ...normalized.matchAll(/活格深度採D−40/g),
    ...normalized.matchAll(/\d+L\d+SA/gi),
    ...normalized.matchAll(/\d+用，前縮\d+mm/g),
    ...(item === "中立板" ? [...normalized.matchAll(/上\d+、下\d+(?:；[^；。]*中立板處理)?/g)] : []),
    ...(item === "活格板" ? [...normalized.matchAll(/\d+桶由中立板分隔/g)] : []),
    ...normalized.matchAll(/不再拆成[^；。]+/g),
    ...(item === "踢腳板" ? [] : [...normalized.matchAll(/現場\d+/g)]),
    ...(item === "踢腳板" ? [] : [...normalized.matchAll(/餘長\d+\+固定預留500/g)]),
    ...normalized.matchAll(/紋向(?:vertical|horizontal|直|橫)/gi),
    ...normalized.matchAll(/2\.5料/g),
  ].map((match) => match[0]);
  if (directionNotes.length && handleNotes.length) {
    matches.push(`${directionNotes[0]}，${handleNotes[0]}`, ...directionNotes.slice(1), ...handleNotes.slice(1));
  } else matches.push(...directionNotes, ...handleNotes);
  matches.push(...jDirectionNotes, ...genericJNotes);
  if (item === "活格板" && /D−40/.test(normalized)) matches.unshift("活格深度採D−40");
  if (item === "固格板" && /前縮19/.test(normalized) && !matches.some((value) => /前縮19mm/.test(value))) {
    const finishedDepth = Number(String(spec).match(/^\s*(\d+)/)?.[1] || 0);
    if (finishedDepth) matches.push(`${finishedDepth + 19}用，前縮19mm`);
  }
  return [...new Set(matches)].join("；");
}

function normalizeHardware(item: string) {
  const slide = item.match(/^(\d+)滑軌$/);
  if (slide) return { item, spec: `${slide[1]}cm` };
  const rod = item.match(/^(\d+)伸縮衣(?:架|桿)$/);
  if (rod) return { item: item.replace("衣架", "衣桿"), spec: `${rod[1]}cm` };
  return { item, spec: "" };
}

function productionRows(projectName: string, materials: WorkbookMaterialRow[], hardware: WorkbookHardwareRow[]) {
  const rows: SheetCell[][] = [];
  const merges: string[] = ["A1:L1", "B2:C2"];
  rows.push([{ value: `案件名稱：${projectName}　｜　完整料單`, style: 1 }, ...Array.from({ length: 11 }, () => ({ style: 1 }))]);
  rows.push([
    { value: "項目", style: 2 }, { value: "規格（mm）", style: 2 }, { style: 2 }, { value: "厚度", style: 2 },
    { value: "數量", style: 2 }, { value: "單價", style: 2 }, { value: "才數", style: 2 }, { value: "總才數", style: 2 },
    { value: "總價", style: 2 }, { style: 2 }, { style: 2 }, { value: "備註", style: 2 },
  ]);
  const sortedMaterials = [...materials].sort((a, b) => itemOrder(a.item, MATERIAL_ORDER) - itemOrder(b.item, MATERIAL_ORDER) || a.item.localeCompare(b.item, "zh-Hant") || b.spec.localeCompare(a.spec, "zh-Hant", { numeric: true }));
  for (const row of sortedMaterials) {
    const rowNumber = rows.length + 1;
    merges.push(`B${rowNumber}:C${rowNumber}`);
    rows.push([
      { value: row.item, style: 3 }, { value: row.spec, style: 4 }, { style: 3 }, { value: row.thicknessMm || materialThicknessMm(row.item), style: 7 },
      { value: row.qty, style: 7 }, { style: 7 }, { style: 7 }, { style: 7 }, { style: 7 }, { style: 3 }, { style: 3 },
      { value: compactProductionNote(row.note, row.item, row.spec), style: 5 },
    ]);
  }
  const sectionRow = rows.length + 1;
  merges.push(`A${sectionRow}:L${sectionRow}`);
  rows.push([{ value: "五金", style: 6 }, ...Array.from({ length: 11 }, () => ({ style: 6 }))]);
  const sortedHardware = [...hardware].sort((a, b) => itemOrder(a.item, HARDWARE_ORDER) - itemOrder(b.item, HARDWARE_ORDER) || a.item.localeCompare(b.item, "zh-Hant"));
  for (const row of sortedHardware) {
    const normalized = normalizeHardware(row.item);
    const rowNumber = rows.length + 1;
    merges.push(`B${rowNumber}:C${rowNumber}`);
    rows.push([
      { value: normalized.item, style: 3 }, { value: normalized.spec, style: 4 }, { style: 3 }, { style: 7 },
      { value: row.qty, style: 7 }, { style: 7 }, { style: 7 }, { style: 7 }, { style: 7 }, { style: 3 }, { style: 3 },
      { value: compactProductionNote(row.note, normalized.item, normalized.spec), style: 5 },
    ]);
  }
  return { rows, merges };
}

function auditRows(materials: WorkbookMaterialRow[], hardware: WorkbookHardwareRow[], notes: string[]) {
  const rows: SheetCell[][] = [[
    { value: "類別", style: 2 }, { value: "項目", style: 2 }, { value: "規格／單位", style: 2 }, { value: "數量", style: 2 }, { value: "固定公式與圖據", style: 2 },
  ]];
  for (const row of materials) rows.push([{ value: "板料", style: 3 }, { value: row.item, style: 3 }, { value: row.spec, style: 4 }, { value: row.qty, style: 7 }, { value: row.note, style: 5 }]);
  for (const row of hardware) rows.push([{ value: "五金", style: 3 }, { value: row.item, style: 3 }, { value: row.unit, style: 4 }, { value: row.qty, style: 7 }, { value: row.note, style: 5 }]);
  for (const note of notes) rows.push([{ value: "提醒", style: 3 }, { value: "待確認", style: 3 }, { style: 4 }, { style: 7 }, { value: note, style: 5 }]);
  return rows;
}

export function buildEstimateWorkbook(projectName: string, materials: WorkbookMaterialRow[], hardware: WorkbookHardwareRow[], notes: string[] = []) {
  const production = productionRows(projectName, materials, hardware);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView/></bookViews><sheets><sheet name="料單" sheetId="1" r:id="rId1"/><sheet name="驗算依據" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF14523E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F67C7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(production.rows, production.merges, [18, 15, 4, 8, 8, 10, 10, 10, 11, 3, 3, 34])),
    "xl/worksheets/sheet2.xml": strToU8(worksheetXml(auditRows(materials, hardware, notes), [], [10, 18, 20, 8, 90], 1, false)),
  };
  return zipSync(files, { level: 6 });
}

export function downloadEstimateWorkbook(projectName: string, materials: WorkbookMaterialRow[], hardware: WorkbookHardwareRow[], notes: string[] = []) {
  const bytes = buildEstimateWorkbook(projectName, materials, hardware, notes);
  const safeName = (projectName || "本次圖面").replace(/[\\/:*?"<>|]+/g, "-");
  const payload = Uint8Array.from(bytes).buffer;
  const href = URL.createObjectURL(new Blob([payload], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${safeName}_完整料單.xlsx`;
  anchor.click();
  URL.revokeObjectURL(href);
}
