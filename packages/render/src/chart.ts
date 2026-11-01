import { fail, hasControlChars, ok, type RenderError, type Result } from './errors';
import { niceTicks } from './graph/plot';

/**
 * Diagramm (Balken, Linien, Kreis) als SVG (D-078): für Auswertungen und Vergleiche in Biologie, Geografie,
 * Wirtschaft und Politik. Eigener Zeichner ohne Bibliothek, keine `eval`-Ausdrücke; die Werte stehen im JSON.
 */
export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartSpec {
  type: ChartType;
  /** Beschriftungen der Rubriken (x-Achse oder Kreisstücke). */
  categories: string[];
  series: { name: string; values: number[] }[];
  /** Einheit oder Achsenbeschriftung der Werte, zum Beispiel "°C". */
  unit: string | undefined;
}

const MAX = { categories: 24, series: 4, label: 40, source: 8_192 } as const;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Json, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function readLabel(value: unknown, max: number = MAX.label): Result<string> {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > max ||
    hasControlChars(value) ||
    /[\r\n\t]/.test(value)
  ) {
    return fail('invalid_chart', 'label');
  }
  return ok(value);
}

/**
 * Liest den Inhalt eines Diagramms (JSON): `type` (`bar`, `line` oder `pie`), `categories` (Beschriftungen) und
 * `series` (je `name` und `values`, so viele Werte wie Rubriken), optional `unit`. Ein Kreisdiagramm hat genau eine
 * Reihe mit nicht negativen Werten und einer Summe über null. Unbekannte Felder werden abgelehnt.
 */
export function parseChartSpec(source: string): Result<ChartSpec> {
  if (source.trim() === '') return fail('empty');
  if (source.length > MAX.source) return fail('too_large');
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return fail('invalid_json');
  }
  if (!isObject(json) || !hasOnly(json, ['type', 'categories', 'series', 'unit'])) {
    return fail('invalid_chart');
  }
  const type = json.type;
  if (type !== 'bar' && type !== 'line' && type !== 'pie') return fail('invalid_chart', 'type');

  const rawCategories = json.categories;
  if (
    !Array.isArray(rawCategories) ||
    rawCategories.length < 1 ||
    rawCategories.length > MAX.categories
  ) {
    return fail('invalid_chart', 'categories');
  }
  const categories: string[] = [];
  for (const entry of rawCategories) {
    const label = readLabel(entry);
    if (!label.ok) return label;
    categories.push(label.value);
  }

  const rawSeries = json.series;
  if (!Array.isArray(rawSeries) || rawSeries.length < 1 || rawSeries.length > MAX.series) {
    return fail('invalid_chart', 'series');
  }
  if (type === 'pie' && rawSeries.length !== 1) return fail('invalid_chart', 'series');
  const series: ChartSpec['series'] = [];
  for (const entry of rawSeries) {
    if (!isObject(entry) || !hasOnly(entry, ['name', 'values'])) {
      return fail('invalid_chart', 'series');
    }
    const name = readLabel(entry.name);
    if (!name.ok) return name;
    const values = entry.values;
    if (!Array.isArray(values) || values.length !== categories.length) {
      return fail('invalid_chart', 'values');
    }
    const numbers: number[] = [];
    for (const value of values) {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) {
        return fail('invalid_chart', 'values');
      }
      if (type === 'pie' && value < 0) return fail('invalid_chart', 'values');
      numbers.push(value);
    }
    series.push({ name: name.value, values: numbers });
  }
  if (type === 'pie' && (series[0]?.values ?? []).reduce((a, b) => a + b, 0) <= 0) {
    return fail('invalid_chart', 'values');
  }

  let unit: string | undefined;
  if (json.unit !== undefined) {
    const read = readLabel(json.unit, 20);
    if (!read.ok) return read;
    unit = read.value;
  }
  return ok({ type, categories, series, unit });
}

/** Prüft ein Diagramm, ohne es zu zeichnen. `null`, wenn es sich zeichnen lässt. */
export function validateChart(source: string): RenderError | null {
  const spec = parseChartSpec(source);
  return spec.ok ? null : spec.error;
}

/** Feste Farbfolge (Okabe und Ito, farbfehlsichtig-tauglich); sie gilt auf hellem und dunklem Grund. */
const PALETTE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#D55E00',
  '#56B4E9',
  '#F0E442',
  '#999999',
];

const W = 480;
const H = 320;
const M = { left: 52, right: 16, top: 20, bottom: 58 } as const;

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (value: number) => String(Math.round(value * 100) / 100);
/** Zahl mit deutschem Komma und ohne unnötige Nachkommastellen. */
const fmt = (value: number) =>
  String(Math.round(value * 1000) / 1000)
    .replace('.', ',')
    .replace('-', '−');
/** Beschriftung kürzen, damit sie unter die Säule passt. */
const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function legend(names: string[], colors: string[], y: number): string {
  // Bis zu vier Einträge nebeneinander, gleich breit.
  const slot = (W - M.left - M.right) / Math.max(1, names.length);
  return names
    .map((name, i) => {
      const x = M.left + i * slot;
      return `<rect x="${num(x)}" y="${y - 9}" width="10" height="10" fill="${colors[i]}"/><text class="pg-label" fill="currentColor" x="${num(x + 15)}" y="${y}" font-size="11">${escapeXml(shorten(name, Math.max(6, Math.floor(slot / 7))))}</text>`;
    })
    .join('');
}

function pie(spec: ChartSpec): string {
  const values = spec.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + b, 0);
  const cx = 150;
  const cy = H / 2;
  const r = 110;
  let angle = -Math.PI / 2;
  const parts: string[] = [];
  const rows: string[] = [];
  values.forEach((value, i) => {
    const share = value / total;
    const color = PALETTE[i % PALETTE.length] as string;
    if (share > 0) {
      if (share >= 0.9999) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`);
      } else {
        const next = angle + share * Math.PI * 2;
        const large = share > 0.5 ? 1 : 0;
        const p = (a: number) => `${num(cx + r * Math.cos(a))} ${num(cy + r * Math.sin(a))}`;
        parts.push(
          `<path d="M${cx} ${cy}L${p(angle)}A${r} ${r} 0 ${large} 1 ${p(next)}Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`,
        );
        angle = next;
      }
    }
    const y = 40 + i * 20;
    rows.push(
      `<rect x="290" y="${y - 10}" width="11" height="11" fill="${color}"/><text class="pg-label" fill="currentColor" x="308" y="${y}" font-size="12">${escapeXml(shorten(spec.categories[i] ?? '', 18))} · ${fmt(Math.round(share * 1000) / 10)} %</text>`,
    );
  });
  return parts.join('') + rows.join('');
}

function axes(spec: ChartSpec) {
  const all = spec.series.flatMap((s) => s.values);
  const low = Math.min(0, ...all);
  const high = Math.max(0, ...all);
  const pad = high === low ? 1 : 0;
  const ticks = niceTicks(low, high + pad, 6);
  const min = Math.min(low, ticks[0] ?? low);
  const max = Math.max(high + pad, ticks[ticks.length - 1] ?? high);
  const innerH = H - M.top - M.bottom;
  const py = (value: number) => M.top + (1 - (value - min) / (max - min)) * innerH;
  const grid = ticks
    .map(
      (tick) =>
        `<line class="pg-grid" x1="${M.left}" y1="${num(py(tick))}" x2="${W - M.right}" y2="${num(py(tick))}"/><text class="pg-label" fill="currentColor" x="${M.left - 6}" y="${num(py(tick) + 4)}" text-anchor="end" font-size="11">${fmt(tick)}</text>`,
    )
    .join('');
  const baseline = `<line class="pg-axis" stroke="currentColor" x1="${M.left}" y1="${num(py(0))}" x2="${W - M.right}" y2="${num(py(0))}"/>`;
  const unit = spec.unit
    ? `<text class="pg-label" fill="currentColor" x="${M.left}" y="${M.top - 7}" font-size="11">${escapeXml(spec.unit)}</text>`
    : '';
  return { py, grid, baseline, unit };
}

function bars(spec: ChartSpec): string {
  const { py, grid, baseline, unit } = axes(spec);
  const innerW = W - M.left - M.right;
  const slot = innerW / spec.categories.length;
  const group = slot * 0.74;
  const width = group / spec.series.length;
  const out: string[] = [grid, unit];
  spec.categories.forEach((category, c) => {
    const x0 = M.left + c * slot + (slot - group) / 2;
    spec.series.forEach((series, s) => {
      const value = series.values[c] ?? 0;
      const top = py(Math.max(value, 0));
      const bottom = py(Math.min(value, 0));
      out.push(
        `<rect x="${num(x0 + s * width)}" y="${num(top)}" width="${num(Math.max(1, width - 1))}" height="${num(Math.max(0.5, bottom - top))}" fill="${PALETTE[s % PALETTE.length]}"/>`,
      );
    });
    const tilt = spec.categories.length > 8;
    const x = M.left + c * slot + slot / 2;
    const y = H - M.bottom + 14;
    out.push(
      `<text class="pg-label" fill="currentColor" x="${num(x)}" y="${y}" text-anchor="${tilt ? 'end' : 'middle'}" font-size="11"${tilt ? ` transform="rotate(-35 ${num(x)} ${y})"` : ''}>${escapeXml(shorten(category, tilt ? 12 : Math.max(5, Math.floor(slot / 6))))}</text>`,
    );
  });
  out.push(baseline);
  return out.join('');
}

function lines(spec: ChartSpec): string {
  const { py, grid, baseline, unit } = axes(spec);
  const innerW = W - M.left - M.right;
  const n = spec.categories.length;
  const px = (c: number) =>
    M.left + (n === 1 ? innerW / 2 : (c / (n - 1)) * innerW * 0.94 + innerW * 0.03);
  const out: string[] = [grid, baseline, unit];
  spec.series.forEach((series, s) => {
    const color = PALETTE[s % PALETTE.length];
    const path = series.values
      .map((v, c) => `${c === 0 ? 'M' : 'L'}${num(px(c))} ${num(py(v))}`)
      .join('');
    out.push(
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`,
    );
    for (const [c, v] of series.values.entries()) {
      out.push(`<circle cx="${num(px(c))}" cy="${num(py(v))}" r="3.5" fill="${color}"/>`);
    }
  });
  const tilt = n > 8;
  spec.categories.forEach((category, c) => {
    const y = H - M.bottom + 14;
    out.push(
      `<text class="pg-label" fill="currentColor" x="${num(px(c))}" y="${y}" text-anchor="${tilt ? 'end' : 'middle'}" font-size="11"${tilt ? ` transform="rotate(-35 ${num(px(c))} ${y})"` : ''}>${escapeXml(shorten(category, tilt ? 12 : 10))}</text>`,
    );
  });
  return out.join('');
}

/** Zeichnet das Diagramm als SVG-Text. Wirft `RenderError` mit festem Code. */
export function renderChart(source: string): string {
  const spec = parseChartSpec(source);
  if (!spec.ok) throw spec.error;
  const chart = spec.value;
  const body =
    chart.type === 'pie' ? pie(chart) : chart.type === 'bar' ? bars(chart) : lines(chart);
  const names = chart.series.map((s) => s.name);
  const colors = chart.series.map((_, i) => PALETTE[i % PALETTE.length] as string);
  const key = chart.type !== 'pie' && chart.series.length > 1 ? legend(names, colors, H - 8) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" font-family="Inter, system-ui, sans-serif">${body}${key}</svg>`;
}
