import { scoreExactRows, scoreExactRowSections } from "./lib/exact-row-score.mjs";
import { bomRowScope, filterRowsByScope, outputRows, referenceRows, workbookSheets } from "./lib/xlsx-row-extract.mjs";

const [referencePath, outputPath, cabinetName, scope = "full"] = process.argv.slice(2);
if (!referencePath || !outputPath) {
  throw new Error("usage: node scripts/score-xlsx-exact.mjs <reference.xlsx> <output.xlsx> [cabinet-name]");
}

const expected = referenceRows(await workbookSheets(referencePath), cabinetName, scope);
const actual = filterRowsByScope(outputRows(await workbookSheets(outputPath)), scope);
console.log(JSON.stringify({
  cabinet: cabinetName || "全部",
  scope,
  ...scoreExactRows(expected, actual),
  sections: scope === "full" ? scoreExactRowSections(expected, actual, bomRowScope) : undefined,
}, null, 2));
