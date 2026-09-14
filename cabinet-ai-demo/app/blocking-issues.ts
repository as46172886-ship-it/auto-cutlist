export function blockingIssueClass(issue: string) {
  if (/抽屜.{0,12}(?:數量|分組)|逐組抽屜/.test(issue)) return "drawer-data";
  if (/(?:抽牆高度|抽牆高|完成屜頭高度|屜頭高|抽面高度|抽屜格寬|中心線邊界|扣99|扣90|扣81|抽補板)/.test(issue)) return "drawer-data";
  if (/抽屜區.{0,12}門區|固格數為0|兩區之間.*橫板/.test(issue)) return "drawer-separation";
  if (/中立板|中立.*上下接點|並排抽/.test(issue)) return "middle-divider";
  if (/鉸鍊|鉸鏈/.test(issue)) return "hinge-schedule";
  if (/斜把擋板|擋板高度|擋板.*分段/.test(issue)) return "baffle";
  if (/擋板實體數量|segment|分段群組/.test(issue)) return "baffle-segments";
  if (/4E門.*(?:開口尺寸|完成門面尺寸)|門高.*門寬|門板標記與完成尺寸|門型／門號.*完成門/.test(issue)) return "door-size";
  if (/4E門片數|門片(?:數量|片數)|左右開向|開向符號|片數依據|已鎖定結果|無法偵測門板|門板掃描|未定位<／>|不列.*門片|門片.{0,24}無法.{0,24}(?:確認|辨識)|無法.{0,24}(?:確認|辨識).{0,24}門片/.test(issue)) return "door-count";
  if (/門片與手把|J把.*斜把|手把數量/.test(issue)) return "door-handles";
  if (/24mm(?:斜把縫|扣|關係)|slantedGap24/.test(issue)) return "door-gap-24";
  if (/深度群組|缺少.{0,12}深度|深度.{0,12}(?:未知|未確認|未標)/.test(issue)) return "depth";
  if (/缺少.{0,8}(?:桶身)?寬度|缺少寬度/.test(issue)) return "width";
  if (/缺少.{0,8}(?:桶身)?(?:外側總)?高|缺少外側總高/.test(issue)) return "height";
  if (/超過.{0,8}1000|尚未完成分桶/.test(issue)) return "cabinet-split";
  if (/尺寸鏈/.test(issue)) return "dimension-chain";
  if (/獨立板件|封板.*(?:尺寸|片數)|確認數量/.test(issue)) return "panel-data";
  if (/調整腳|腳高|A10|A12/.test(issue)) return "feet";
  if (/特殊櫃.*背條|背條數尚未確認/.test(issue)) return "special-back-strip";
  if (/板厚|扣數組合|非標準扣數/.test(issue)) return "board-profile";
  if (/可用深度|滑軌.*深度/.test(issue)) return "drawer-slide-depth";
  if (/特殊五金/.test(issue)) return "special-hardware";
  if (/斜把退縮|退縮數|retreat/.test(issue)) return "slanted-retreat";
  return `text:${issue.trim().replace(/\s+/g, " ")}`;
}

export function mergeBlockingIssues(issues: string[]) {
  const merged = new Map<string, string>();
  for (const raw of issues) {
    const issue = String(raw || "").trim();
    if (!issue) continue;
    const key = blockingIssueClass(issue);
    if (!merged.has(key)) merged.set(key, issue);
  }
  return [...merged.values()];
}

export function hasBlockingIssueClass(issues: string[], candidate: string) {
  const key = blockingIssueClass(candidate);
  return issues.some((issue) => blockingIssueClass(issue) === key);
}

type ApplicabilityAnalysis = {
  cabinets?: Array<{
    cabinetKind?: string;
    isHanging?: boolean;
    footState?: string;
    specialBackStripState?: string;
    drawerCount?: number;
    innerDrawerCount?: number;
    sideBySideDrawers?: boolean;
    drawerGroups?: Array<{ count?: number; sideBySide?: boolean; slantedHandle?: boolean }>;
    middleDividers?: unknown[];
    doors?: Array<{
      type?: string;
      count?: number;
      slantedHandle?: boolean;
      slantedHandleCount?: number;
      jHandleCount?: number;
      includesSlantedGap24?: boolean;
    }>;
    baffles?: unknown[];
  }>;
  independentPanels?: unknown[];
  specialHardware?: unknown[];
};

export function blockingIssueIsApplicable(issue: string, analysis: ApplicabilityAnalysis) {
  const cabinets = analysis.cabinets || [];
  const issueClass = blockingIssueClass(issue);
  const hasDoors = cabinets.some((cabinet) => (cabinet.doors || []).some((door) => door.type === "4E"));
  const hasDrawers = cabinets.some((cabinet) => Number(cabinet.drawerCount) > 0
    || Number(cabinet.innerDrawerCount) > 0
    || (cabinet.drawerGroups || []).length > 0);
  const hasDivider = cabinets.some((cabinet) => (cabinet.middleDividers || []).length > 0
    || cabinet.sideBySideDrawers
    || (cabinet.drawerGroups || []).some((group) => group.sideBySide));
  const hasSlantedOpening = cabinets.some((cabinet) => (cabinet.baffles || []).length > 0
    || (cabinet.drawerGroups || []).some((group) => group.slantedHandle)
    || (cabinet.doors || []).some((door) => door.slantedHandle || Number(door.slantedHandleCount) > 0));

  if (issueClass === "door-count" && /(?:無法偵測門板|沒有回應|門板掃描|未定位<／>)/.test(issue)) return true;
  if (["door-size", "door-count", "door-handles", "door-gap-24", "hinge-schedule"].includes(issueClass)) return hasDoors;
  if (["drawer-data", "drawer-separation", "drawer-slide-depth"].includes(issueClass)) return hasDrawers;
  if (issueClass === "middle-divider") return hasDivider;
  if (["baffle", "baffle-segments", "slanted-retreat"].includes(issueClass)) return hasSlantedOpening;
  if (issueClass === "feet") return cabinets.some((cabinet) => cabinet.cabinetKind === "floor" && !cabinet.isHanging && cabinet.footState !== "absent");
  if (issueClass === "special-back-strip") return cabinets.some((cabinet) => ["tv", "mirror", "special"].includes(String(cabinet.cabinetKind)) && cabinet.specialBackStripState === "unknown");
  if (issueClass === "panel-data") return (analysis.independentPanels || []).length > 0;
  if (issueClass === "special-hardware") return (analysis.specialHardware || []).length > 0;
  return true;
}

export function filterApplicableBlockingIssues(issues: string[], analysis: ApplicabilityAnalysis) {
  return issues.filter((issue) => blockingIssueIsApplicable(issue, analysis));
}

const DOOR_ADVISORY_CLASSES = new Set(["door-size", "door-count", "door-handles", "door-gap-24", "hinge-schedule"]);

export function isDoorAdvisoryIssue(issue: string) {
  return DOOR_ADVISORY_CLASSES.has(blockingIssueClass(issue));
}

export function filterBlockingIssues(issues: string[], analysis: ApplicabilityAnalysis) {
  return filterApplicableBlockingIssues(issues, analysis).filter((issue) => !isDoorAdvisoryIssue(issue));
}

function doorIssueScopes(issues: string[]) {
  const scopes = issues.flatMap((issue) => issue.match(/\b[A-Z][A-Z0-9-]*\d+\b/g) || [])
    .filter((scope) => !/^(?:A10|A12|[QR]\d+)$/.test(scope));
  return [...new Set(scopes)];
}

export function mergeDoorAdvisoryIssues(issues: string[]) {
  const doorIssues = issues.map((issue) => String(issue || "").trim())
    .filter((issue) => issue && isDoorAdvisoryIssue(issue) && blockingIssueClass(issue) !== "door-gap-24");
  if (!doorIssues.length) return [];
  const scopes = doorIssueScopes(doorIssues);
  const scopeText = scopes.length ? `${scopes.join("、")} ` : "";
  if (doorIssues.some((issue) => /(?:無法偵測門板|沒有回應|門板掃描已提早結束)/.test(issue))) {
    return [`${scopeText}無法偵測門板；本次不列該桶門板與門用五金，桶身及其他已確認料件照常拆料。`];
  }
  const labelsByClass: Record<string, string> = {
    "door-count": "片數／開向",
    "door-size": "開口尺寸／完成門面尺寸",
    "door-handles": "手把數量",
    "hinge-schedule": "鉸鍊門高",
  };
  const detailLabels = [...new Set(doorIssues.map((issue) => labelsByClass[blockingIssueClass(issue)]).filter(Boolean))];
  return [`${scopeText}門板的${detailLabels.join("、")}尚未完整；本次不列尚未閉合的門板與門用五金，桶身及其他已確認料件照常拆料。`];
}
