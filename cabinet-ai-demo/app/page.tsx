"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { createCabinetCrops, createOrientationGuides, createUprightImages } from "./image-crop";
import type { OrientationAudit } from "./orientation-audit";
import type { CabinetCropInput, SegmentationPlan } from "./segmentation";
import type { CarcassResult } from "./carcass";
import { SOP_RULES } from "./sop-rules";
import { pdfFileToImages } from "./pdf-to-images";
import type { DocumentEvidence } from "./document-evidence";
import { createCabinetEnhancements, createCarcassScanImages, createOverviewEnhancements } from "./scan-preprocess";
import { shouldRetryCarcassScan, type ScanFailure } from "./scan-retry";
import { downloadEstimateWorkbook } from "./xlsx-export";
import { missingStructuralSourceCabinetIds, nonDoorClientTimeoutMs, selectStructuralCropsForRequest } from "./non-door-scan-budget";
import { doorClientTimeoutMs } from "./door-scan-budget";
import { missingDoorSourceCabinetIds, selectDoorCropsForRequest } from "./door-scan";
import { collectSlantedHandleMarkerEvidence } from "./slanted-handle-audit";
import { buildPreflightReport } from "./preflight";

type ApiError = { error?: string; code?: string };
type MaterialRow = { item: string; spec: string; qty: number; note: string };
type HardwareRow = { item: string; qty: number; unit: string; note: string };
type CabinetSummary = {
  id: string; name: string; widthMm: number; heightMm: number; depthMm: number;
  fixedShelves: number; adjustableShelves: number; drawerCount: number;
  middleDividers?: unknown[]; baffles?: unknown[]; confidence: "high" | "medium" | "low"; evidence: string;
};
type NonDoorPayload = {
  analysis: {
    projectName?: string; summary?: string; cabinets: CabinetSummary[];
    independentPanels?: unknown[]; kickboards?: unknown[]; mirrors?: unknown[]; specialHardware?: unknown[];
    questions?: string[]; warnings?: string[];
  };
  result: { materials: MaterialRow[]; hardware: HardwareRow[]; notes: string[] };
  scope: "carcass_before_faces" | "complete_including_doors";
  formulaMode: "deterministic";
  evidenceMode?: { vectorPdfPages: number; carcassDimensionLocks?: number; dimensionCandidates?: number; dimensionClosures?: number; dimensionConflicts?: number; enhancedOverviewImages: number; enhancedCabinetCrops: number; recognitionPasses: string };
};
type PreparedImage = { name: string; dataUrl: string; documentEvidence?: DocumentEvidence };

const REQUEST_TIMEOUT_MS = 75_000;
const SEGMENTATION_TIMEOUT_MS = 120_000;

async function postJson<T>(url: string, body: unknown, timeoutMessage: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    let payload: T & ApiError;
    try { payload = JSON.parse(raw) as T & ApiError; }
    catch { payload = { error: response.ok ? "AI回傳格式無法讀取。" : `讀圖服務回傳 ${response.status}，請稍後再試。` } as T & ApiError; }
    if (!response.ok) {
      const failure = new Error(payload.error || "讀圖失敗，請重新掃描。") as ScanFailure;
      failure.code = payload.code;
      failure.status = response.status;
      throw failure;
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const failure = new Error(timeoutMessage) as ScanFailure;
      failure.code = "timeout";
      failure.status = 504;
      throw failure;
    }
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export default function Home() {
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyPhase, setBusyPhase] = useState("");
  const [busySeconds, setBusySeconds] = useState(0);
  const [error, setError] = useState("");
  const [orientation, setOrientation] = useState<OrientationAudit | null>(null);
  const [segmentation, setSegmentation] = useState<SegmentationPlan | null>(null);
  const [payload, setPayload] = useState<NonDoorPayload | null>(null);
  const [tab, setTab] = useState<"materials" | "hardware">("materials");

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setBusySeconds((seconds) => seconds + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function reset(nextFiles: File[]) {
    setFiles(nextFiles); setOrientation(null); setSegmentation(null); setPayload(null); setError(""); setTab("materials");
  }
  function addFiles(list: FileList | File[]) {
    const all = Array.from(list);
    const next = all.filter((file) => (file.type.startsWith("image/") || file.type === "application/pdf" || /\.pdf$/i.test(file.name)) && file.size <= 20 * 1024 * 1024).slice(0, 6);
    reset(next);
    if (!next.length && all.length) setError("只接受 JPG、PNG、WEBP 或 PDF；圖片每張12MB、PDF每份20MB以內。");
  }
  function onInput(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) addFiles(event.target.files); }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }
  async function toDataUrl(file: File) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
    });
  }

  async function fileToImages(file: File): Promise<PreparedImage[]> {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return await pdfFileToImages(file, 6);
    return [{ name: file.name, dataUrl: await toDataUrl(file) }];
  }

  async function scan() {
    if (!files.length) { setError("請先上傳完整圖面；同一案件的內部圖、立面與細節圖可一起上傳。"); return; }
    setBusy(true); setBusySeconds(0); setError(""); setOrientation(null); setSegmentation(null); setPayload(null);
    try {
      setBusyPhase("準備照片、掃描圖與PDF頁面");
      const prepared = (await Promise.all(files.map(fileToImages))).flat().slice(0, 6);
      const images = prepared.map(({ name, dataUrl }) => ({ name, dataUrl }));
      const documentEvidence = prepared.flatMap((item) => item.documentEvidence ? [item.documentEvidence] : []);
      setBusyPhase("第1關：四方向比較，鎖定寬高軸");
      const orientationImages = await createOrientationGuides(images);
      const locked = await postJson<OrientationAudit>("/api/orient", { images, orientationImages }, "方向辨識超過75秒，已停止本次等待；請重試。");
      setOrientation(locked);
      setBusyPhase("第2關：旋正後同時鎖定W／H／D與分桶");
      const uprightImages = await createUprightImages(images, locked.images);
      const overviewImages = await createOverviewEnhancements(uprightImages);
      const [carcassImages, carcassRetryImages] = await Promise.all([
        createCarcassScanImages(uprightImages, "primary"),
        createCarcassScanImages(uprightImages, "retry"),
      ]);
      const scanCarcass = async () => {
        try {
          return await postJson<CarcassResult>("/api/carcass", { images: carcassImages, orientation: locked, documentEvidence, scanProfile: "primary" }, "桶身W／H／D辨識超過75秒，已停止本次等待。");
        } catch (failure) {
          if (!shouldRetryCarcassScan(failure)) throw failure;
          setBusyPhase("第2關：第一次未回應，正在自動縮圖重試W／H／D");
          return await postJson<CarcassResult>("/api/carcass", { images: carcassRetryImages, orientation: locked, documentEvidence, scanProfile: "retry" }, "桶身W／H／D自動重試仍未完成，請更換較清晰的原圖。");
        }
      };
      const [carcass, plan] = await Promise.all([
        scanCarcass(),
        postJson<SegmentationPlan>("/api/segment", { images, orientation: locked }, "分桶與桶內裁切複核超過120秒，已停止本次等待；請重試。", SEGMENTATION_TIMEOUT_MS),
      ]);
      setSegmentation(plan);
      const plannedPreflight = buildPreflightReport(plan);
      if (!plannedPreflight.ready) {
        const blocked = plannedPreflight.checks.filter((check) => check.status === "blocked").map((check) => `${check.scope}：${check.detail}`);
        throw new Error(`前置分桶資料尚未閉合：${blocked.join("；")}`);
      }
      setBusyPhase("第3關：逐桶放大並掃描桶身、內裝與獨立構件");
      const crops = await createCabinetCrops(images, plan);
      const croppedPreflight = buildPreflightReport(plan, crops);
      if (!croppedPreflight.ready) {
        const missingActual = plan.cabinets
          .filter((cabinet) => !crops.some((crop) => crop.cabinetId === cabinet.cabinetId && crop.role === "internal" && (crop.scanPass || 1) === 1))
          .map((cabinet) => cabinet.cabinetId);
        throw new Error(missingActual.length
          ? `已完成分桶，但瀏覽器實際裁切找不到${missingActual.join("、")}的桶內原圖；請確認上傳檔未更名，或補上較清楚的內部立面後再掃描。`
          : `實際裁切證據尚未閉合：${croppedPreflight.checks.filter((check) => check.status === "blocked").map((check) => `${check.scope}：${check.detail}`).join("；")}`);
      }
      const structuralCrops = selectStructuralCropsForRequest(crops, 18);
      if (!structuralCrops.length) throw new Error("未產生可用的桶內結構裁切，請換較完整圖面。");
      const missingStructureCabinets = missingStructuralSourceCabinetIds(structuralCrops, plan.cabinets.map((cabinet) => cabinet.cabinetId));
      if (missingStructureCabinets.length) throw new Error(`送出掃描前缺少${missingStructureCabinets.join("、")}的桶內原圖，本次不產生可能漏桶的料單；請分成立面或減少細節圖後再掃描。`);
      setBusyPhase("第3關：原圖與線稿逐桶交叉掃描");
      const enhancedCrops = await createCabinetEnhancements(structuralCrops as CabinetCropInput[]);
      const nonDoorResult = await postJson<NonDoorPayload>("/api/non-door", {
        images: uprightImages,
        overviewImages,
        documentEvidence,
        carcass,
        segmentation: plan,
        cabinetCrops: [...structuralCrops as CabinetCropInput[], ...enhancedCrops],
      }, "非門構件掃描超過完整逐桶批次預算，已停止本次等待；請重試。", nonDoorClientTimeoutMs(plan.cabinets.length));
      setBusyPhase("最後一關：完整確認門片寬高、開向與加工，再產生料單");
      const doorCrops = selectDoorCropsForRequest(crops, 100);
      if (!doorCrops.length) throw new Error("未產生可用的門面裁切，無法完成含門料單。");
      const missingDoorCabinets = missingDoorSourceCabinetIds(doorCrops, plan.cabinets.map((cabinet) => cabinet.cabinetId));
      if (missingDoorCabinets.length) throw new Error(`裁切上限後缺少${missingDoorCabinets.join("、")}可回查的門面／桶內原圖，本次不猜門板或開向；請分成立面後再掃描。`);
      const completeResult = await postJson<NonDoorPayload>("/api/doors", {
        analysis: nonDoorResult.analysis,
        segmentation: plan,
        cabinetCrops: doorCrops,
        slantedHandleMarkerEvidence: collectSlantedHandleMarkerEvidence(doorCrops.flatMap((crop) => crop.slantedHandleMarkerEvidence ? [crop.slantedHandleMarkerEvidence] : [])),
      }, "門板與門五金辨識超過完整三輪預算，已停止本次等待；桶身結果不會被改寫，請稍後再試。", doorClientTimeoutMs(plan.cabinets.length));
      setPayload(completeResult);
      window.setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "完整料單辨識失敗。"); }
    finally { setBusy(false); setBusyPhase(""); }
  }

  function exportRows() {
    if (!payload) return;
    const name = payload.analysis.projectName || "本次圖面";
    downloadEstimateWorkbook(name, payload.result.materials, payload.result.hardware, payload.result.notes);
  }

  return <main>
    <header className="topbar"><div className="brand"><span className="logo">全</span><span>板料 AI</span></div><div className="chips"><span>含門完整料單</span><span className="live">● AI抄圖／程式算料</span></div></header>
    <section className="hero">
      <p className="eyebrow">COMPLETE CABINET CUTLIST</p><h1>桶身、抽屜、門板與五金一起驗算。</h1>
      <p>電子PDF直接擷取文字座標與向量線；照片、掃描圖會建立灰階與線稿增強。AI盤點圖面證據；板件扣數、門縫、鉸鍊、油壓器與其他固定數量由程式公式計算。</p>
      <ol className="steps"><li className={!orientation ? "active" : "done"}><b>{orientation ? "✓" : "1"}</b><span>方向</span></li><li className={orientation && !segmentation ? "active" : segmentation ? "done" : ""}><b>{segmentation ? "✓" : "2"}</b><span>分桶</span></li><li className={segmentation && !payload ? "active" : payload ? "done" : ""}><b>{payload ? "✓" : "3"}</b><span>完整料單</span></li></ol>
    </section>
    <section className="card glossary-card">
      <div className="section-title"><div><small>正式輸出範圍</small><h2>不是只有桶身</h2></div><span>{SOP_RULES.length} 條 SOP</span></div>
      <div className="symbol-grid"><article><b>桶</b><span>基本與內裝</span><p>側、頂底、背、背條、固格、活格、中立、擋板。</p></article><article><b>抽</b><span>抽屜全套</span><p>抽牆、抽底、屜頭、抽補板、滑軌與木榫。</p></article><article><b>獨</b><span>獨立構件</span><p>封板、填縫、假門板、踢腳、檯面、鏡子。</p></article><article><b>五</b><span>非門五金</span><p>調整腳、KD、層板五金、衣桿及圖示特殊五金。</p></article></div>
      <p className="privacy">納入：功能4E門板、門開向、GS鉸鍊、油壓器、J手把與斜手把。鋁框門仍依SOP延後，不在本輪自動拆料。</p>
    </section>
    <section className="card upload-card">
      <div className="section-title"><div><small>開始掃描</small><h2>上傳同一案件的完整圖面</h2></div><span>最多6張／每張12MB</span></div>
      <div className={`dropzone ${dragging ? "dragging" : ""}`} onClick={() => picker.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} role="button" tabIndex={0}>
        <input ref={picker} hidden multiple type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf" onChange={onInput} /><strong>拖曳照片、掃描圖或PDF電子圖</strong><span>內部圖、正立面、側視與細節可一起上傳；電子PDF保留原始文字與線條，掃描圖另做去灰與線稿增強。</span>
      </div>
      {files.length > 0 && <div className="file-list">{files.map((file) => <span key={file.name}>✓ {file.name}</span>)}</div>}{error && <div className="error" role="alert">{error}</div>}
      <button className="primary scan-button" onClick={scan} disabled={busy || !files.length}>{busy ? `${busyPhase} · ${busySeconds} 秒` : "開始掃描完整料單"}</button><p className="privacy">任何數字或門面符號看不清都會列待確認，不用常見尺寸補猜；W／H／D逾時會自動縮圖重試一次。</p>
    </section>
    {orientation && <section className="card orientation-card"><div className="section-title"><div><small>方向硬鎖</small><h2>寬、高、深已先分流</h2></div><span>{orientation.images.length}張</span></div><div className="orientation-list">{orientation.images.map((item) => <article key={item.imageName}><b>{item.imageName}</b><span>原圖順時針 {item.rotationToUprightDeg}°</span><p>水平寬度鏈：{item.bottomHorizontalDimensionTexts.join("／") || "未讀到"}</p><p>垂直高度鏈：{item.sideVerticalDimensionTexts.join("／") || "未讀到"}</p></article>)}</div></section>}
    {payload && <section className="card" id="results">
      <div className="section-title"><div><small>掃描結果</small><h2>{payload.analysis.projectName || "本次圖面"}</h2></div><span className="result-status complete">固定公式計算</span></div>{payload.analysis.summary && <p>{payload.analysis.summary}</p>}
      {payload.evidenceMode && <p className="privacy">辨識證據：W／H／D鎖定 {payload.evidenceMode.carcassDimensionLocks || 0}／尺寸候選 {payload.evidenceMode.dimensionCandidates || 0}／閉合修正 {payload.evidenceMode.dimensionClosures || 0}／衝突阻擋 {payload.evidenceMode.dimensionConflicts || 0}／電子PDF向量頁 {payload.evidenceMode.vectorPdfPages}／全圖增強 {payload.evidenceMode.enhancedOverviewImages}／逐桶線稿 {payload.evidenceMode.enhancedCabinetCrops}；{payload.evidenceMode.recognitionPasses}</p>}
      <div className="cabinet-grid">{payload.analysis.cabinets.map((cabinet) => <article className="cabinet cabinet-complete" key={cabinet.id}><div className="cabinet-head"><b>{cabinet.id} · {cabinet.name}</b><em>{cabinet.confidence === "high" ? "高信心" : cabinet.confidence === "medium" ? "中信心" : "低信心"}</em></div><div className="dimension-values"><span><small>W</small><strong>{cabinet.widthMm || "—"}</strong><i>mm</i></span><span><small>H</small><strong>{cabinet.heightMm || "—"}</strong><i>mm</i></span><span><small>D</small><strong>{cabinet.depthMm || "—"}</strong><i>mm</i></span></div><p>固格 {cabinet.fixedShelves || 0}／活格 {cabinet.adjustableShelves || 0}／抽屜 {cabinet.drawerCount || 0}／中立 {cabinet.middleDividers?.length || 0}／擋板 {cabinet.baffles?.length || 0}</p><small>{cabinet.evidence}</small></article>)}</div>
      {!!payload.analysis.questions?.length && <div className="questions"><h3>缺少的圖面證據</h3>{payload.analysis.questions.map((item) => <p key={item}>• {item}</p>)}</div>}{!!payload.analysis.warnings?.length && <div className="warnings"><h3>驗算提醒</h3>{payload.analysis.warnings.map((item) => <p key={item}>• {item}</p>)}</div>}
      <div className="materials-head"><div><small>含門完整料單</small><h3>{payload.result.materials.length}筆板料／{payload.result.hardware.length}筆五金</h3></div><span>同品項同規格已合併</span></div>
      <div className="tabs"><button className={tab === "materials" ? "active" : ""} onClick={() => setTab("materials")}>板料 {payload.result.materials.length}</button><button className={tab === "hardware" ? "active" : ""} onClick={() => setTab("hardware")}>五金 {payload.result.hardware.length}</button></div>
      <div className="table-wrap"><table>{tab === "materials" ? <><thead><tr><th>板件</th><th>完成尺寸（mm）</th><th>數量</th><th>公式與圖據</th></tr></thead><tbody>{payload.result.materials.map((row, index) => <tr key={`material-${index}-${row.item}-${row.spec}`}><td><b>{row.item}</b></td><td>{row.spec}</td><td>{row.qty}</td><td>{row.note}</td></tr>)}</tbody></> : <><thead><tr><th>五金</th><th>數量</th><th>單位</th><th>公式與圖據</th></tr></thead><tbody>{payload.result.hardware.map((row, index) => <tr key={`hardware-${index}-${row.item}-${row.unit}`}><td><b>{row.item}</b></td><td>{row.qty}</td><td>{row.unit}</td><td>{row.note}</td></tr>)}</tbody></>}</table></div>
      {!!payload.result.notes.length && <details className="rule-details"><summary>查看計算提醒</summary>{payload.result.notes.map((item) => <p key={item}>• {item}</p>)}</details>}<div className="actions"><button onClick={exportRows}>下載 Excel 完整料單（板料＋五金）</button></div>
    </section>}
    <footer>AI負責抄圖；所有下料扣數與固定數量由程式計算。鋁框門維持延後確認，其餘門板與門五金進入結果。</footer>
  </main>;
}
