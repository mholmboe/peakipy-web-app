/**
 * Readers for instrument-native powder XRD formats: PANalytical .xrdml and
 * Bruker .brml / .uxd. Browser port of the parsers in core/xrd_formats.py
 * (peakipy's Python desktop app), trimmed to the two-theta/intensity arrays
 * this app needs.
 */

import type { DataPoint } from './peakFitting';

// ---------------------------------------------------------------------------
// XRDML (PANalytical / Malvern Panalytical)
// ---------------------------------------------------------------------------

export function parseXrdml(xmlText: string): DataPoint[] {
  const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error('Could not parse XRDML file: invalid XML');
  }

  const dataPoints = xmlDoc.getElementsByTagName('dataPoints')[0];
  if (!dataPoints) {
    throw new Error('No dataPoints found in XRDML file');
  }

  const intensitiesEl = dataPoints.getElementsByTagName('intensities')[0];
  if (!intensitiesEl || !intensitiesEl.textContent) {
    throw new Error('No intensities found in XRDML dataPoints');
  }
  const intensities = parseNumericList(intensitiesEl.textContent);
  const nPoints = intensities.length;

  const positionsEls = Array.from(dataPoints.getElementsByTagName('positions'));
  const twoThetaEl =
    positionsEls.find((el) => el.getAttribute('axis') === '2Theta') ?? positionsEls[0];
  if (!twoThetaEl) {
    throw new Error('No 2Theta positions found in XRDML file');
  }

  let twoTheta: number[] = [];
  const listPositionsEl = twoThetaEl.getElementsByTagName('listPositions')[0];
  if (listPositionsEl?.textContent) {
    twoTheta = parseNumericList(listPositionsEl.textContent);
  } else {
    const startEl = twoThetaEl.getElementsByTagName('startPosition')[0];
    const endEl = twoThetaEl.getElementsByTagName('endPosition')[0];
    if (!startEl?.textContent || !endEl?.textContent) {
      throw new Error('Could not resolve 2Theta axis in XRDML file');
    }
    const start = parseFloat(startEl.textContent);
    const end = parseFloat(endEl.textContent);
    twoTheta = linspace(start, end, nPoints);
  }

  if (twoTheta.length === 0 || intensities.length === 0) {
    throw new Error('XRDML file contains no measurement data');
  }

  const n = Math.min(twoTheta.length, intensities.length);
  const data: DataPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = { x: twoTheta[i], y: intensities[i] };
  }
  return data;
}

function parseNumericList(text: string): number[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      if (token.toLowerCase() === 'nan') return 0;
      const v = parseFloat(token);
      return Number.isNaN(v) ? 0 : v;
    });
}

function linspace(start: number, end: number, n: number): number[] {
  if (n <= 1) return [start];
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => start + i * step);
}

// ---------------------------------------------------------------------------
// Bruker UXD (legacy text format)
// ---------------------------------------------------------------------------

export function parseUxd(text: string): DataPoint[] {
  const lines = text.split(/\r?\n/);

  let dataStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.startsWith('_2THETA_INTENSITY') || stripped.startsWith('_2THETACOUNTS')) {
      dataStart = i + 1;
      break;
    }
  }
  if (dataStart === -1) {
    throw new Error('No data section (_2THETA_INTENSITY) found in UXD file');
  }

  const data: DataPoint[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!stripped || stripped.startsWith('_')) continue;
    const parts = stripped.split(/[\s,;]+/);
    if (parts.length < 2) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      data.push({ x, y });
    }
  }

  if (data.length === 0) {
    throw new Error('No numeric two-theta/intensity rows found in UXD file');
  }
  return data;
}

// ---------------------------------------------------------------------------
// Bruker BRML (a zip archive of XML documents)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

function listZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Find the End Of Central Directory record by scanning backward for its
  // signature (it may be followed by a variable-length comment).
  let eocdOffset = -1;
  const searchStart = Math.max(0, bytes.length - 65536 - 22);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Not a valid .brml archive (no zip End Of Central Directory record found)');
  }

  const numEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < numEntries; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('Corrupt .brml archive (central directory entry signature mismatch)');
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
    const name = new TextDecoder('utf-8').decode(nameBytes);

    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }
  return entries;
}

async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const off = entry.localHeaderOffset;
  if (view.getUint32(off, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`Corrupt .brml archive (local header signature mismatch for ${entry.name})`);
  }
  const fileNameLength = view.getUint16(off + 26, true);
  const extraFieldLength = view.getUint16(off + 28, true);
  const dataStart = off + 30 + fileNameLength + extraFieldLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    // Stored (no compression).
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(
        'This browser does not support decompressing .brml files (missing the Compression ' +
          'Streams API). Try a recent Chrome, Edge, or Firefox, or use the desktop app.'
      );
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compressed]).stream().pipeThrough(ds);
    const decompressed = await new Response(stream).arrayBuffer();
    return new Uint8Array(decompressed);
  }
  throw new Error(`Unsupported zip compression method (${entry.compressionMethod}) in .brml file`);
}

async function readZipEntryText(
  buffer: ArrayBuffer,
  entries: ZipEntry[],
  name: string
): Promise<string | null> {
  const entry = entries.find((e) => e.name === name || e.name.endsWith('/' + name));
  if (!entry) return null;
  const bytes = await readZipEntry(buffer, entry);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function parseBrml(buffer: ArrayBuffer): Promise<DataPoint[]> {
  const entries = listZipEntries(buffer);

  const rawDataNames = await resolveRawDataNames(buffer, entries);
  if (rawDataNames.length === 0) {
    throw new Error('.brml archive contains no RawData*.xml entries');
  }

  for (const name of rawDataNames) {
    const entry = entries.find((e) => e.name === name);
    if (!entry) continue;
    const bytes = await readZipEntry(buffer, entry);
    const xmlText = new TextDecoder('utf-8').decode(bytes);
    const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xmlDoc.getElementsByTagName('parsererror')[0]) continue;

    const data = extractBrmlScan(xmlDoc);
    if (data) return data;
  }

  throw new Error('.brml archive: found the XML but no scan with usable two-theta/intensity data');
}

async function resolveRawDataNames(buffer: ArrayBuffer, entries: ZipEntry[]): Promise<string[]> {
  const containerEntry = entries.find((e) => e.name.endsWith('DataContainer.xml'));
  if (containerEntry) {
    const text = await readZipEntryText(buffer, entries, containerEntry.name);
    if (text) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const folder = containerEntry.name.includes('/')
        ? containerEntry.name.slice(0, containerEntry.name.lastIndexOf('/'))
        : '';
      const refs = Array.from(doc.getElementsByTagName('RawDataReferenceList')[0]?.children ?? []);
      const listed: string[] = [];
      for (const ref of refs) {
        const value = (ref.textContent || '').trim();
        if (!value) continue;
        const candidates = folder ? [value, `${folder}/${value}`] : [value];
        for (const cand of candidates) {
          if (entries.some((e) => e.name === cand) && !listed.includes(cand)) {
            listed.push(cand);
          }
        }
      }
      if (listed.length > 0) return listed;
    }
  }
  return entries
    .map((e) => e.name)
    .filter((n) => /RawData\d*\.xml$/i.test(n))
    .sort();
}

function extractBrmlScan(xmlDoc: Document): DataPoint[] | null {
  const routes = Array.from(xmlDoc.getElementsByTagName('DataRoute'));
  for (const route of routes) {
    const info = route.getElementsByTagName('ScanInformation')[0];
    const scanName = info?.getAttribute('ScanName') || '';
    if (scanName.includes('NonAmbientModeData')) continue;

    const rows = Array.from(route.getElementsByTagName('Datum'))
      .map((d) => (d.textContent || '').split(',').map((v) => parseFloat(v)))
      .filter((row) => row.every((v) => !Number.isNaN(v)) && row.length > 0);
    if (rows.length < 2) continue;

    const idx = datumIndices(route);
    const width = Math.min(...rows.map((r) => r.length));
    let ttIndex = idx.twoTheta;
    let inIndex = idx.intensity;

    if (ttIndex === undefined || ttIndex >= width) {
      ttIndex = findIncreasingAxisColumn(rows, width, route);
      if (ttIndex === undefined) {
        throw new Error(
          'BRML: no DataViews entry for TwoTheta and no column that looks like an increasing angle axis'
        );
      }
    }
    if (inIndex === undefined || inIndex >= width) {
      inIndex = width - 1;
    }

    const enabledIndex = idx.enabled;
    const kept = rows.filter(
      (r) => enabledIndex === undefined || enabledIndex >= r.length || r[enabledIndex] !== 0
    );
    if (kept.length < 2) continue;

    const data: DataPoint[] = kept
      .map((r) => ({ x: r[ttIndex!], y: r[inIndex!] }))
      .sort((a, b) => a.x - b.x);
    return data;
  }
  return null;
}

interface DatumIndices {
  twoTheta?: number;
  theta?: number;
  intensity?: number;
  enabled?: number;
  time?: number;
}

function datumIndices(route: Element): DatumIndices {
  const idx: DatumIndices = {};
  const views = Array.from(route.getElementsByTagName('RawDataView')).filter(
    (v) => v.parentElement?.tagName === 'DataViews'
  );
  for (const view of views) {
    const start = parseInt(view.getAttribute('Start') || '0', 10);
    const logic = view.getAttribute('LogicName') || '';
    const kind =
      view.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ||
      view.getAttribute('xsi:type') ||
      '';
    if (logic === 'MeasuredTime') {
      idx.time = start;
    } else if (logic === 'AbsorptionFactor') {
      idx.enabled = start;
    } else if (kind.includes('VaryingRawDataView')) {
      const fields = Array.from(view.getElementsByTagName('FieldDefinitions'));
      fields.forEach((field, i) => {
        const name = field.getAttribute('FieldName') || field.getAttribute('AxisId') || '';
        if (name === 'TwoTheta') idx.twoTheta = start + i;
        else if (name === 'Theta') idx.theta = start + i;
      });
    } else if (kind.includes('RecordedRawDataView')) {
      const rec = view.getElementsByTagName('Recording')[0];
      if (rec?.getAttribute('LogicName') === 'ScanCounter') {
        idx.intensity = start;
      }
    }
  }
  return idx;
}

function findIncreasingAxisColumn(
  rows: number[][],
  width: number,
  route: Element
): number | undefined {
  let lo: number | undefined;
  let hi: number | undefined;
  for (const field of Array.from(route.getElementsByTagName('FieldDefinitions'))) {
    if (field.getAttribute('FieldName') !== 'TwoTheta') continue;
    const restriction = field.getElementsByTagName('Restriction')[0];
    if (!restriction) continue;
    const minEl = restriction.getElementsByTagName('Minimum')[0];
    const maxEl = restriction.getElementsByTagName('Maximum')[0];
    lo = minEl?.textContent ? parseFloat(minEl.textContent) : undefined;
    hi = maxEl?.textContent ? parseFloat(maxEl.textContent) : undefined;
    break;
  }

  for (let c = 0; c < width; c++) {
    const col = rows.map((r) => r[c]);
    let increasing = true;
    for (let i = 1; i < col.length; i++) {
      if (col[i] <= col[i - 1]) {
        increasing = false;
        break;
      }
    }
    if (!increasing) continue;
    if (lo === undefined || hi === undefined || (lo - 1 <= col[0] && col[col.length - 1] <= hi + 1)) {
      return c;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const XRD_EXTENSIONS = ['.xrdml', '.brml', '.uxd'];

export function isXrdFormat(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return XRD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Read a File (text or native XRD format) and return DataPoint[].
 */
export async function loadDataFile(
  file: File,
  parseText: (content: string) => DataPoint[]
): Promise<DataPoint[]> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.brml')) {
    const buffer = await file.arrayBuffer();
    return parseBrml(buffer);
  }

  const text = await file.text();
  if (lower.endsWith('.xrdml')) return parseXrdml(text);
  if (lower.endsWith('.uxd')) return parseUxd(text);
  return parseText(text);
}
