const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiCalendarDate(isoTime) {
  const time = new Date(isoTime);
  if (!Number.isFinite(time.getTime())) return "";
  return new Date(time.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function validateFormalSiteReceipt(receipt, manifest, priorRuns = [], options = {}) {
  const errors = [];
  const startedAt = new Date(receipt?.startedAt || "");
  const downloadedAt = new Date(receipt?.downloadedAt || "");
  const date = taipeiCalendarDate(receipt?.startedAt);
  if (receipt?.evaluationKind !== "formal_site_scan") errors.push("評分類型必須是formal_site_scan");
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(downloadedAt.getTime())) errors.push("缺少有效的掃描與下載時間");
  else if (downloadedAt < startedAt) errors.push("下載時間早於掃描開始時間");
  else if (taipeiCalendarDate(receipt.downloadedAt) !== date) errors.push("掃描與下載必須在同一個台北日曆日完成");
  const expectedLiveUrl = options.expectedLiveUrl;
  if (expectedLiveUrl && receipt?.liveUrl !== expectedLiveUrl) errors.push("網址不是指定的正式網站");
  if (!Number.isInteger(receipt?.deploymentVersion) || receipt.deploymentVersion <= 0) errors.push("缺少正式部署版本");
  if (!receipt?.outputSha256 || receipt.outputSha256 !== options.outputSha256) errors.push("下載Excel雜湊不一致");

  const expectedSources = (manifest?.files || []).map((file) => file.sha256).sort();
  const actualSources = Array.isArray(receipt?.sourceSha256s) ? [...receipt.sourceSha256s].sort() : [];
  if (JSON.stringify(actualSources) !== JSON.stringify(expectedSources)) errors.push("正式掃圖來源不是完整且相同的佛斯特原圖");

  const sameDayRuns = date ? priorRuns.filter((run) => taipeiCalendarDate(run.startedAt) === date).length : 0;
  if (sameDayRuns >= 2) errors.push(`台北日期${date}已記錄${sameDayRuns}次正式測試，禁止超過每日2次`);
  return { ok: errors.length === 0, date, runNumber: sameDayRuns + 1, errors };
}
