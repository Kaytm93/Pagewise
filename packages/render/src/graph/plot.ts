import { RenderError } from '../errors';
import { type CompiledExpression, compileExpression } from './expression';
import type { GraphSpec } from './spec';

const W = 480;
const H = 320;
const M = { left: 42, right: 16, top: 16, bottom: 30 };
const SAMPLES = 640;

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Zahlen im Text immer gleich schreiben (Dezimalkomma, keine Rundungsreste), damit die Ausgabe stabil ist. */
const fmt = (value: number) => {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};
const num = (value: number) => (Math.round(value * 100) / 100).toString();
const label = (value: number) => fmt(value).replace('.', ',').replace('-', '−');

/** „Schöne“ Teilung einer Achse: Schritte 1, 2 oder 5 mal Zehnerpotenz, höchstens etwa `target` Marken. */
export function niceTicks(min: number, max: number, target = 8): number[] {
  const span = max - min;
  const rough = span / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let value = first; value <= max + step * 1e-9 && ticks.length < 60; value += step) {
    ticks.push(Math.round(value / step) * step || 0);
  }
  return ticks;
}

interface Sampled {
  f: CompiledExpression;
  ys: number[];
}

function sample(f: CompiledExpression, xs: number[]): Sampled {
  return { f, ys: xs.map((x) => f(x)) };
}

/** Wertebereich aus den Funktionswerten, wenn keiner angegeben ist: ohne Ausreißer, mit etwas Rand. */
function autoRange(samples: Sampled[], points: GraphSpec['points']): [number, number] {
  const values = samples
    .flatMap((s) => s.ys)
    .filter((y) => Number.isFinite(y) && Math.abs(y) <= 1e4)
    .concat(points.map((p) => p.y))
    .sort((a, b) => a - b);
  if (values.length === 0) return [-5, 5];
  const lo = values[Math.floor(values.length * 0.02)] as number;
  const hi = values[Math.ceil(values.length * 0.98) - 1] as number;
  let min = Math.min(lo, 0);
  let max = Math.max(hi, 0);
  if (max - min < 1e-6) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

/**
 * Zeichnet den Graphen als SVG-Text. Die Ausgabe ist deterministisch (gleiche Eingabe, gleicher Text) und
 * enthält keine Stilangaben und kein Skript: Aussehen über Klassen (`pg-*`), mit `currentColor` als Rückfall,
 * damit sie auch ohne Stylesheet sichtbar ist (zum Beispiel im PDF).
 *
 * Wirft `RenderError` bei ungültigen Ausdrücken. Kurven werden bei Unstetigkeiten (Polstellen, Lücken)
 * unterbrochen, nicht verbunden.
 */
export function renderGraphSvg(spec: GraphSpec): string {
  const [x0, x1] = spec.x;
  const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => x0 + ((x1 - x0) * i) / SAMPLES);
  const compiled = spec.functions.map((entry) => compileExpression(entry.expr));
  const samples = compiled.map((f) => sample(f, xs));
  const [y0, y1] = spec.y ?? autoRange(samples, spec.points);

  const px = (x: number) => M.left + ((x - x0) / (x1 - x0)) * (W - M.left - M.right);
  const py = (y: number) => H - M.bottom - ((y - y0) / (y1 - y0)) * (H - M.top - M.bottom);
  const yRange = y1 - y0;
  const body: string[] = [];

  if (spec.grid) {
    for (const tick of niceTicks(x0, x1)) {
      body.push(
        `<line class="pg-grid" x1="${num(px(tick))}" y1="${M.top}" x2="${num(px(tick))}" y2="${H - M.bottom}"/>`,
      );
    }
    for (const tick of niceTicks(y0, y1, 6)) {
      body.push(
        `<line class="pg-grid" x1="${M.left}" y1="${num(py(tick))}" x2="${W - M.right}" y2="${num(py(tick))}"/>`,
      );
    }
  }

  // Achsen: durch den Nullpunkt, wenn er sichtbar ist, sonst am Rand
  const axisX = Math.min(Math.max(py(0), M.top), H - M.bottom);
  const axisY = Math.min(Math.max(px(0), M.left), W - M.right);
  body.push(
    `<line class="pg-axis" stroke="currentColor" x1="${M.left}" y1="${num(axisX)}" x2="${W - M.right}" y2="${num(axisX)}"/>`,
    `<line class="pg-axis" stroke="currentColor" x1="${num(axisY)}" y1="${M.top}" x2="${num(axisY)}" y2="${H - M.bottom}"/>`,
  );
  for (const tick of niceTicks(x0, x1)) {
    if (Math.abs(tick) < 1e-9) continue;
    body.push(
      `<line class="pg-tick" stroke="currentColor" x1="${num(px(tick))}" y1="${num(axisX - 3)}" x2="${num(px(tick))}" y2="${num(axisX + 3)}"/>`,
      `<text class="pg-label" fill="currentColor" x="${num(px(tick))}" y="${H - M.bottom + 15}" text-anchor="middle" font-size="11">${escapeXml(label(tick))}</text>`,
    );
  }
  for (const tick of niceTicks(y0, y1, 6)) {
    if (Math.abs(tick) < 1e-9) continue;
    body.push(
      `<line class="pg-tick" stroke="currentColor" x1="${num(axisY - 3)}" y1="${num(py(tick))}" x2="${num(axisY + 3)}" y2="${num(py(tick))}"/>`,
      `<text class="pg-label" fill="currentColor" x="${M.left - 6}" y="${num(py(tick) + 4)}" text-anchor="end" font-size="11">${escapeXml(label(tick))}</text>`,
    );
  }

  // Kurven: ein Pfad aus Teilstücken, unterbrochen bei fehlenden Werten und großen Sprüngen
  samples.forEach((s, index) => {
    let d = '';
    let previous: number | null = null;
    xs.forEach((x, i) => {
      const y = s.ys[i] as number;
      const visible = Number.isFinite(y) && y >= y0 - yRange * 2 && y <= y1 + yRange * 2;
      if (!visible) {
        previous = null;
        return;
      }
      const jump = previous !== null && Math.abs(y - previous) > yRange * 1.5;
      d +=
        previous === null || jump ? `M${num(px(x))} ${num(py(y))}` : `L${num(px(x))} ${num(py(y))}`;
      previous = y;
    });
    if (d) {
      body.push(
        `<path class="pg-fn pg-fn-${index % 6}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="${d}"/>`,
      );
    }
  });

  spec.points.forEach((point) => {
    const cx = px(point.x);
    const cy = py(point.y);
    if (cx < M.left || cx > W - M.right || cy < M.top || cy > H - M.bottom) return;
    body.push(
      `<circle class="pg-point" fill="currentColor" cx="${num(cx)}" cy="${num(cy)}" r="4"/>`,
    );
    if (point.label) {
      body.push(
        `<text class="pg-label" fill="currentColor" x="${num(cx + 7)}" y="${num(cy - 7)}" font-size="12">${escapeXml(point.label)}</text>`,
      );
    }
  });

  // Legende, nur wenn eine Funktion beschriftet ist
  spec.functions.forEach((entry, index) => {
    if (!entry.label) return;
    const y = M.top + 12 + index * 16;
    body.push(
      `<line class="pg-fn pg-fn-${index % 6}" stroke="currentColor" stroke-width="2" x1="${W - M.right - 90}" y1="${y - 4}" x2="${W - M.right - 70}" y2="${y - 4}"/>`,
      `<text class="pg-label" fill="currentColor" x="${W - M.right - 64}" y="${y}" font-size="12">${escapeXml(entry.label)}</text>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" class="pg-graph" viewBox="0 0 ${W} ${H}" role="img" font-family="Inter, system-ui, sans-serif">${body.join('')}</svg>`;
}

export { RenderError };
