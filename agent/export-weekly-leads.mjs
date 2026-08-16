/**
 * Build and email the weekly auto-shop lead sheet.
 *
 * The workbook is intentionally plain: one sheet, one header row, no merged
 * cells, no dashboard, no charts. It contains only qualified auto-repair leads
 * with no functioning website and a phone number. Email is optional.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { d1, assertD1Env, logRun } from './lib/d1.mjs';
import { sendOperator } from './lib/mail.mjs';
import { OFFER } from './config/offer.mjs';

const INCLUDE_BACKLOG = String(process.env.INCLUDE_BACKLOG || '').toLowerCase() === 'true';
const DRY = process.argv.includes('--dry-run');
// How far back "this batch" reaches. The Sunday job wants 8 days. An on-demand
// run fired two days after the last one still wants the leads it just found, so
// the window is a parameter rather than a constant buried in the query.
const WINDOW_DAYS = Math.min(Math.max(Number(process.env.EXPORT_WINDOW_DAYS) || 8, 1), 365);
const LABEL = process.env.EXPORT_LABEL || 'weekly';

if (OFFER.id !== 'metro-detroit-auto-repair') {
  throw new Error(`weekly export only supports metro-detroit-auto-repair; got ${OFFER.id}`);
}
if (!DRY) assertD1Env();

const columns = [
  ['Business Name', 'name', 30],
  ['Category', 'primary_type', 22],
  ['City', 'city', 18],
  ['State', 'state', 8],
  ['Phone', 'phone', 18],
  ['Email', 'email', 30],
  ['Website Status', 'website_status', 18],
  ['Google Maps', 'maps_url', 42],
  ['Street Address', 'address_street', 30],
  ['ZIP', 'address_zip', 10],
  ['Rating', 'rating', 10],
  ['Review Count', 'review_count', 13],
  ['Score', 'score', 10],
  ['Priority', 'priority', 12],
  ['First Seen', 'first_seen_at', 20],
  ['Notes', 'score_reason', 48],
];

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function cellXml(ref, value, style = 0) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function worksheetXml(rows) {
  const totalRows = rows.length + 1;
  const lastCol = colName(columns.length - 1);
  const header = columns.map(([title], i) => cellXml(`${colName(i)}1`, title, 1)).join('');
  const body = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    const cells = columns.map(([, key], colIndex) => {
      const value = key === 'website_status' ? 'No website' : row[key];
      return cellXml(`${colName(colIndex)}${excelRow}`, value);
    }).join('');
    return `<row r="${excelRow}">${cells}</row>`;
  }).join('');
  const cols = columns.map(([, , width], i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCol}${totalRows}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData><row r="1">${header}</row>${body}</sheetData>
  <autoFilter ref="A1:${lastCol}${totalRows}"/>
</worksheet>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function zipStore(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const [name, raw] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);

    offset += local.length + filename.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

function buildXlsx(rows) {
  const entries = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`],
    ['xl/worksheets/sheet1.xml', worksheetXml(rows)],
  ];
  return zipStore(entries);
}

async function main() {
  const rows = DRY ? [
    {
      name: 'Example Auto Repair', primary_type: 'Auto repair shop', city: 'Novi', state: 'MI',
      phone: '(248) 555-0100', email: 'owner@example.com', maps_url: 'https://maps.google.com/example',
      address_street: '123 Main St', address_zip: '48375', rating: 4.8, review_count: 87,
      score: 91, priority: 'HIGH', first_seen_at: '2026-08-15 12:00:00', score_reason: 'Independent local shop; no website.',
    },
  ] : await d1(`SELECT name, primary_type, city, state, phone, email, maps_url,
      address_street, address_zip, rating, review_count, score, priority,
      first_seen_at, score_reason
    FROM leads
    WHERE vertical=? AND disqualified=0 AND website IS NULL AND phone IS NOT NULL
      AND storefront='yes' AND COALESCE(score,0) >= ?
      ${INCLUDE_BACKLOG ? '' : `AND first_seen_at >= datetime('now','-${WINDOW_DAYS} days')`}
    ORDER BY COALESCE(score,0) DESC, COALESCE(review_count,0) DESC, name`,
    [OFFER.vertical, OFFER.scoring.high]);

  const xlsx = buildXlsx(rows);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${LABEL}-auto-shop-leads-${date}.xlsx`;
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(`artifacts/${filename}`, xlsx);

  if (DRY) {
    console.log(`dry run: wrote artifacts/${filename} with ${rows.length} sample row(s)`);
    return;
  }

  const emailCount = rows.filter((r) => r.email).length;

  // Where the pipeline actually looked, and where it will look next. Without
  // this the report gives no way to tell fresh ground from a repeat sweep.
  const territories = await d1(
    `SELECT territory, last_swept_at, new_leads, exhausted
       FROM territory_state WHERE offer_id=?
      ORDER BY last_swept_at DESC LIMIT 3`,
    [OFFER.id]
  ).catch(() => []);
  const nextUp = await d1(
    `SELECT COUNT(*) AS n FROM territory_state WHERE offer_id=? AND exhausted=1`,
    [OFFER.id]
  ).catch(() => []);

  const territoryLine = territories.length
    ? `<p>Most recent territories: ${territories
      .map((t) => `${t.territory}${t.exhausted ? ' (exhausted)' : ''}`)
      .join(', ')}. ${nextUp[0]?.n ?? 0} territory/territories marked exhausted so far.</p>`
    : '';

  const html = `<p><strong>${rows.length}</strong> qualified auto-shop lead${rows.length === 1 ? '' : 's'} in this batch.</p>
<p>${emailCount} have an email address. Every row has a phone number and Google reports no website; the research pass re-checks the highest-priority leads.</p>
${territoryLine}
<p>The Excel file is attached. It is intentionally a plain table.</p>`;

  await sendOperator({
    subject: `Singh Dynamics: ${rows.length} ${LABEL} auto-shop leads`,
    html,
    attachments: [{ filename, content: xlsx.toString('base64') }],
  });

  await logRun({
    job: 'weekly-auto-leads',
    itemsIn: rows.length,
    itemsOut: rows.length,
    summary: `emailed ${rows.length} qualified auto-shop leads (${LABEL}, ${INCLUDE_BACKLOG ? 'backlog included' : `${WINDOW_DAYS}-day window`}); ${emailCount} with email`,
  });

  console.log(`emailed ${filename}: ${rows.length} lead(s), ${emailCount} with email`);
}

main().catch(async (err) => {
  console.error(err);
  if (!DRY) await logRun({ job: 'weekly-auto-leads', ok: 0, error: err.message });
  process.exit(1);
});
