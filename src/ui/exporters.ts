import { strToU8, zipSync } from 'fflate';
import type { ResponseDoc, Status } from '../../shared/domain';

export const STATUS_RU: Record<Status, string> = { pending: 'На проверке', approved: 'Показано', rejected: 'Скрыто' };
export const fmtDate = (ms: number) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(ms);

const HEAD = ['№', 'Имя и фамилия', 'Идея', 'Дата и время (Алматы)', 'Статус'];
const rows = (list: ResponseDoc[]) => [...list].sort((a, b) => a.createdAt - b.createdAt)
  .map((r, i) => [i + 1, r.name, r.idea, fmtDate(r.createdAt), STATUS_RU[r.status]] as (string | number)[]);

function download(name: string, blob: Blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// Текст, начинающийся со знака формулы, не должен выполняться в Excel
const safeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function exportCsv(list: ResponseDoc[]) {
  const q = (v: string | number) => `"${safeCell(String(v)).replace(/"/g, '""')}"`;
  const body = [HEAD, ...rows(list)].map((r) => r.map(q).join(';')).join('\r\n');
  download('idei-seminara.csv', new Blob(['﻿', body], { type: 'text/csv;charset=utf-8' }));
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number) => String.fromCharCode(65 + i);

export function buildXlsx(list: ResponseDoc[]) {
  const cell = (v: string | number, c: number, r: number, s: number) => typeof v === 'number'
    ? `<c r="${col(c)}${r}" s="${s}"><v>${v}</v></c>`
    : `<c r="${col(c)}${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const data = [HEAD, ...rows(list)].map((row, i) => `<row r="${i + 1}">${row.map((v, c) => cell(v, c, i + 1, i ? 2 : 1)).join('')}</row>`).join('');
  const widths = [6, 28, 70, 24, 15].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    '[Content_Types].xml': strToU8(`${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Идеи" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(`${X}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${data}</sheetData></worksheet>`),
  });
}
export function exportXlsx(list: ResponseDoc[]) {
  download('idei-seminara.xlsx', new Blob([buildXlsx(list)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
