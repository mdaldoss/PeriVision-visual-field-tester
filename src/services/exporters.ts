import type { Session } from "../core/types";
import { renderReportCanvas, type ReportOptions } from "./report";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))),
      "image/png",
    );
  });
}

export function sessionSlug(session: Session): string {
  return `perivision-${session.startedAt.slice(0, 19).replace(/[:T]/g, "-")}`;
}

/** One PNG per eye, at 2x for a crisp print. */
export async function exportEyePng(session: Session, index: number): Promise<void> {
  const result = session.results[index];
  const canvas = renderReportCanvas(reportOptions(session, index), 2);
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `${sessionSlug(session)}-${result.eye}.png`);
}

/** One PDF for the session, a page per eye, sized to fit A4 portrait. */
export async function exportSessionPdf(session: Session): Promise<void> {
  // Loaded on demand: the PDF library is a large dependency and most users
  // never press this button.
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`PeriVision visual field - ${session.startedAt.slice(0, 10)}`);
  pdf.setCreator("PeriVision (screening tool, not a medical device)");

  const A4 = { w: 595.28, h: 841.89 };
  const margin = 24;

  for (let i = 0; i < session.results.length; i++) {
    const canvas = renderReportCanvas(reportOptions(session, i), 2);
    const blob = await canvasToBlob(canvas);
    const png = await pdf.embedPng(await blob.arrayBuffer());

    const page = pdf.addPage([A4.w, A4.h]);
    const maxW = A4.w - margin * 2;
    const maxH = A4.h - margin * 2;
    const scale = Math.min(maxW / png.width, maxH / png.height);
    const w = png.width * scale;
    const h = png.height * scale;
    page.drawImage(png, {
      x: (A4.w - w) / 2,
      y: A4.h - margin - h,
      width: w,
      height: h,
    });
  }

  const bytes = await pdf.save();
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
  downloadBlob(blob, `${sessionSlug(session)}.pdf`);
}

/**
 * The full session as JSON, event log included, so a run can be re-analysed or
 * replayed later without going through this app at all.
 */
export function exportSessionJson(session: Session): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${sessionSlug(session)}.json`);
}

export function reportOptions(session: Session, index: number): ReportOptions {
  return {
    result: session.results[index],
    config: session.config,
    device: session.device,
    appVersion: session.appVersion,
    dateISO: session.startedAt,
  };
}
