import type { CabinetCropInput, SegmentationPlan } from "./segmentation";

export type PreflightStatus = "ready" | "warning" | "blocked";

export type PreflightCheck = {
  id: string;
  scope: string;
  label: string;
  status: PreflightStatus;
  detail: string;
};

export type PreflightReport = {
  ready: boolean;
  blockingCount: number;
  warningCount: number;
  checks: PreflightCheck[];
};

const clean = (value: unknown) => String(value || "").trim();

function isProjectNameOnly(note: string) {
  const namesProject = /(?:案件|專案|工程|project).*(?:名稱|name)|(?:名稱|name).*(?:案件|專案|工程|project)/i.test(note);
  const containsStructure = /單位|尺寸|寬|高|深|內部|結構|門|符號|裁切|桶身|立面|背條|抽屜|中立|擋板/.test(note);
  return namesProject && !containsStructure;
}

function isAlreadyCoveredByDeterministicCheck(note: string) {
  return /door\/?front|門面裁切|缺(?:少|乏)?(?:門板|正立面)|(?:門板|正立面).*(?:缺少|未提供|沒有)|缺(?:少|乏)?內部|內部圖.*(?:缺少|未提供|沒有)|底部.*(?:寬|尺寸)|bottomSegment|單位.*(?:不明|未知)|低信心|桶身.*(?:編號|順序|配對)/i.test(note);
}

export function buildPreflightReport(plan: SegmentationPlan, actualCrops?: CabinetCropInput[]): PreflightReport {
  const checks: PreflightCheck[] = [];
  const add = (check: PreflightCheck) => checks.push(check);

  for (const image of plan.orientationAudit?.images || []) {
    const bottom = image.bottomHorizontalDimensionTexts.length ? image.bottomHorizontalDimensionTexts.join("／") : "未讀到";
    const side = image.sideVerticalDimensionTexts.length ? image.sideVerticalDimensionTexts.join("／") : "未讀到";
    const basis = image.orientationBasis === "numbers_and_width_agree" ? "數字方向與寬度鏈一致"
      : image.orientationBasis === "numbers_only" ? "僅數字方向成立"
        : image.orientationBasis === "width_only" ? "僅寬度鏈方向成立"
          : image.orientationBasis === "conflict" ? "數字方向與寬度鏈衝突"
            : "方向證據不足";
    add({
      id: `orientation-${image.imageName}`,
      scope: image.imageName,
      label: "圖面旋正與寬高軸向",
      status: image.confidence === "low" ? "blocked" : image.confidence === "medium" ? "warning" : "ready",
      detail: `已獨立檢查四個方向並鎖定順時針 ${image.rotationToUprightDeg}°；${basis}；底部水平寬度鏈：${bottom}；側邊垂直高度鏈：${side}。`,
    });
  }

  if (plan.drawingUnit === "unknown" || !plan.drawingUnit) {
    add({ id: "drawing-unit", scope: "整份圖面", label: "尺寸單位", status: "blocked", detail: "尚未鎖定 cm 或 mm；單位不明時不得換算或拆料。" });
  } else if (plan.drawingUnit === "mixed") {
    add({ id: "drawing-unit", scope: "整份圖面", label: "尺寸單位", status: "warning", detail: "圖面同時出現 cm 與 mm；後續必須逐筆保留原始標註再換算。" });
  } else {
    add({ id: "drawing-unit", scope: "整份圖面", label: "尺寸單位", status: "ready", detail: `已鎖定為 ${plan.drawingUnit}。` });
  }

  const cabinetIds = plan.cabinets.map((cabinet) => clean(cabinet.cabinetId));
  const duplicateIds = cabinetIds.filter((id, index) => id && cabinetIds.indexOf(id) !== index);
  const orderKeys = plan.cabinets.map((cabinet) => `${clean(cabinet.elevationId)}:${cabinet.widthOrder}`);
  const duplicateOrders = orderKeys.filter((key, index) => key && orderKeys.indexOf(key) !== index);
  const missingIdentity = plan.cabinets.some((cabinet) => !clean(cabinet.cabinetId) || !clean(cabinet.elevationId) || !(cabinet.widthOrder > 0));
  add({
    id: "cabinet-identity",
    scope: "整份圖面",
    label: "桶身與立面配對",
    status: missingIdentity || duplicateIds.length > 0 || duplicateOrders.length > 0 ? "blocked" : "ready",
    detail: missingIdentity
      ? "有桶身缺少 cabinetId、elevationId 或由左到右的順序。"
      : duplicateIds.length > 0 || duplicateOrders.length > 0
        ? "桶身編號或同一立面的寬度順序重複，必須先重新分桶。"
        : `已建立 ${plan.cabinets.length} 個不重複桶身並保留立面順序。`,
  });

  const sourceImages = new Set(plan.views.map((view) => clean(view.imageName)).filter(Boolean));
  const orphanCrops = plan.cabinets.flatMap((cabinet) => cabinet.sourceCrops.filter((crop) => !sourceImages.has(clean(crop.sourceImageName))).map((crop) => `${cabinet.cabinetId}/${crop.cropId}`));
  add({
    id: "crop-sources",
    scope: "整份圖面",
    label: "裁切來源",
    status: orphanCrops.length ? "blocked" : "ready",
    detail: orphanCrops.length ? `找不到原圖來源：${orphanCrops.join("、")}。` : "每個規劃裁切都能回指到已上傳的原圖。",
  });

  for (const cabinet of plan.cabinets) {
    const scope = clean(cabinet.cabinetId) || "未編號桶身";
    const plannedRoles = new Set(cabinet.sourceCrops.map((crop) => crop.role));
    const hasInternal = plannedRoles.has("internal");
    const hasFace = plannedRoles.has("door") || plannedRoles.has("front");

    add({
      id: `${scope}-bottom-width`, scope, label: "底部單段寬",
      status: cabinet.bottomSegmentMm > 0 ? "ready" : "blocked",
      detail: cabinet.bottomSegmentMm > 0
        ? `已由底部水平尺寸鏈直接讀到 ${cabinet.bottomSegmentMm} mm。`
        : "底部單段寬仍為 0；不得用門寬或外總寬反推。",
    });
    add({
      id: `${scope}-internal`, scope, label: "內部結構證據",
      status: hasInternal ? "ready" : "blocked",
      detail: hasInternal ? "已有內部圖裁切，可判斷固格、活格、抽屜、中立與擋板。" : "缺少內部圖；只有正立面或門板圖不能直接拆料。",
    });
    add({
      id: `${scope}-face`, scope, label: "門面／正立面證據",
      status: hasFace ? "ready" : "warning",
      detail: hasFace
        ? "已有門板或正立面裁切，可另行鎖定 <／> 符號與門片範圍。"
        : "沒有獨立門面裁切；仍會先用同桶內部裁切做三次 <／> 掃描，掃不到才保留門板待確認，絕不由桶寬猜片數。",
    });
    add({
      id: `${scope}-confidence`, scope, label: "分桶信心",
      status: cabinet.confidence === "low" ? "blocked" : cabinet.confidence === "medium" ? "warning" : "ready",
      detail: cabinet.confidence === "low"
        ? "分桶信心低，必須補拍或重新裁切後再分析。"
        : cabinet.confidence === "medium" ? "分桶可繼續，但後續結構確認要人工特別核對。" : "桶身邊界與底寬證據清楚。",
    });

    if (actualCrops) {
      const croppedRoles = new Set(actualCrops.filter((crop) => crop.cabinetId === cabinet.cabinetId).map((crop) => crop.role));
      const actualInternal = croppedRoles.has("internal");
      const actualFace = croppedRoles.has("door") || croppedRoles.has("front");
      add({
        id: `${scope}-actual-crops`, scope, label: "實際裁切完成",
        status: !actualInternal ? "blocked" : hasFace && !actualFace ? "warning" : "ready",
        detail: !actualInternal
          ? "實際裁切缺少內部圖，無法進入完整分析。"
          : actualFace ? "內部與門面裁切皆已實際產生，可交給完整分析。"
            : "內部裁切已實際產生；門片符號會直接在這份同桶裁切上掃描三次。",
      });
    }
  }

  const additionalNotes = (plan.unresolved || []).map(clean).filter(Boolean).filter((note) => !isProjectNameOnly(note) && !isAlreadyCoveredByDeterministicCheck(note));
  if (additionalNotes.length) add({
    id: "segmentation-notes",
    scope: "整份圖面",
    label: "分圖備註",
    status: "warning",
    detail: additionalNotes.join("；"),
  });

  const blockingCount = checks.filter((check) => check.status === "blocked").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  return { ready: blockingCount === 0, blockingCount, warningCount, checks };
}
