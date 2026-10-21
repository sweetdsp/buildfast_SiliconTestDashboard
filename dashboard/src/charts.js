/* Dependency-free chart helpers. Every function returns an HTML/SVG string. */
(function (root) {
'use strict';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const tip = (html) => `data-tip="${esc(html)}"`;
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const STATE = { pass: 'var(--good)', fail: 'var(--crit)', blocked: 'var(--warn)' };
const ICON = { good: '&#10003;', warning: '!', serious: '!', critical: '&#10005;', info: 'i', muted: '&middot;' };

function chip(level, text) { return `<span class="st st-${level}"><i aria-hidden="true">${ICON[level] || ''}</i>${esc(text)}</span>`; }

function tableView(headers, rows) {
  return `<details class="tv"><summary>Table view</summary><div class="scroll"><table class="t"><thead><tr>${headers.map((h, i) => `<th class="${i ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function legend(items) {
  return `<div class="legend">${items.map((i) => `<span><span class="sw" style="background:${i.color}"></span>${esc(i.name)}</span>`).join('')}</div>`;
}

function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

/* line chart: xs labels, series [{name,color,values,dash}], hlines [{y,label}] */
function lineChart(o) {
  const W = 640, H = o.height || 200, L = o.yLabelW || 46, R = 14, T = 12, B = 26, pw = W - L - R, ph = H - T - B;
  const all = o.series.flatMap((s) => s.values.filter((v) => v != null)).concat((o.hlines || []).map((h) => h.y));
  let min = o.yMin != null ? o.yMin : Math.min(0, ...all), max = o.yMax != null ? o.yMax : niceMax(Math.max(...all) * 1.08);
  if (max === min) max = min + 1;
  const n = o.xs.length, X = (i) => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), Y = (v) => T + ph - ((v - min) / (max - min)) * ph;
  const yf = o.yFmt || ((v) => nf(v, max < 10 ? 1 : 0));
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = min + ((max - min) * k) / 4, y = Y(v); g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${esc(yf(v))}</text>`; }
  const step = Math.max(1, Math.ceil(n / 7));
  o.xs.forEach((x, i) => { if (i % step === 0) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(x)}</text>`; });
  (o.hlines || []).forEach((h) => { g += `<line x1="${L}" x2="${W - R}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="var(--ink2)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${L + 6}" y="${Y(h.y) - 5}" text-anchor="start" style="fill:var(--ink2)">${esc(h.label)}</text>`; });
  o.series.forEach((s) => {
    const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v)]));
    const segs = []; let cur = []; pts.forEach((p) => { if (p) cur.push(p); else { if (cur.length) segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
    if (o.area) segs.forEach((sg) => { g += `<polygon points="${sg.map((p) => p.join(',')).join(' ')} ${sg[sg.length - 1][0]},${T + ph} ${sg[0][0]},${T + ph}" style="fill:${s.color};opacity:.14"/>`; });
    segs.forEach((sg) => { g += `<polyline fill="none" stroke-linejoin="round" stroke-linecap="round" stroke-width="2" ${s.dash ? 'stroke-dasharray="6 5"' : ''} style="stroke:${s.color}" points="${sg.map((p) => p.join(',')).join(' ')}"/>`; });
    if (n <= 14) pts.forEach((p, i) => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="4" style="fill:${s.color};stroke:var(--surface)" stroke-width="2"/>`; });
  });
  const bw = pw / Math.max(1, n - 1 || 1);
  o.xs.forEach((x, i) => {
    const rows = o.series.filter((s) => s.values[i] != null).map((s) => `<span class="sw" style="background:${s.color}"></span>${esc(s.name)}: <b>${esc(yf(s.values[i]))}</b>`).join('<br>');
    g += `<rect class="hit" x="${X(i) - bw / 2}" y="${T}" width="${bw}" height="${ph}" ${tip(`<b>${esc(x)}</b><br>${rows}`)}/>`;
  });
  const aria = esc(o.aria || o.title || 'Line chart');
  return (o.series.length > 1 || o.forceLegend ? legend(o.series.map((s) => ({ name: s.name, color: s.color }))) : '') +
    `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">${g}</svg>` +
    tableView(['', ...o.series.map((s) => s.name)], o.xs.map((x, i) => [x, ...o.series.map((s) => (s.values[i] == null ? '' : yf(s.values[i])))]));
}

/* donut: parts [{label,value,color}] */
function donut(o) {
  const S = o.size || 150, r = S / 2 - 12, C = 2 * Math.PI * r, tot = o.parts.reduce((a, p) => a + p.value, 0) || 1, gap = 2;
  let off = 0, g = `<circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="16"/>`;
  o.parts.forEach((p) => {
    if (!p.value) return;
    const len = (p.value / tot) * C, vis = Math.max(1, len - gap);
    g += `<circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke-width="16" stroke-dasharray="${vis} ${C - vis}" stroke-dashoffset="${-off}" transform="rotate(-90 ${S / 2} ${S / 2})" style="stroke:${p.color}" ${tip(`<span class="sw" style="background:${p.color}"></span>${esc(p.label)}: <b>${nf(p.value)}</b> (${nf((p.value / tot) * 100, 1)}%)`)}/>`;
    off += len;
  });
  g += `<text x="${S / 2}" y="${S / 2 + 2}" text-anchor="middle" style="fill:var(--ink);font-size:${S / 6.2}px;font-weight:700">${esc(o.center || '')}</text><text x="${S / 2}" y="${S / 2 + S / 7}" text-anchor="middle" style="font-size:11px">${esc(o.sub || '')}</text>`;
  return `<svg class="chart" style="max-width:${S}px;margin:auto" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(o.aria || 'Donut chart')}">${g}</svg>`;
}

/* health ring */
function ring(score, level) {
  const S = 190, r = 80, C = 2 * Math.PI * r, v = Math.max(0, Math.min(100, score)) / 100 * C;
  const col = level === 'good' ? 'var(--good)' : level === 'warning' ? 'var(--warn)' : 'var(--crit)';
  return `<svg class="chart" viewBox="0 0 ${S} ${S}" role="img" aria-label="Health index ${Math.round(score)} out of 100"><circle cx="95" cy="95" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="14"/><circle cx="95" cy="95" r="${r}" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="${v} ${C - v}" transform="rotate(-90 95 95)" style="stroke:${col}"/></svg>`;
}

/* horizontal bars: rows [{label,value,color,tip}] */
function hbars(rows, o = {}) {
  const max = o.max || Math.max(1, ...rows.map((r) => r.value));
  return rows.map((r) => `<div class="hbar" ${r.tip ? tip(r.tip) : ''}><div class="ink2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div><div><div class="b" style="width:${(r.value / max) * 100}%;background:${r.color || 'var(--s1)'}"></div></div><div class="num" style="text-align:right">${esc(r.text != null ? r.text : nf(r.value))}</div></div>`).join('');
}

/* feature failure bars: rows [{name, total, pass, fail, blocked, coverage}] */
function featureBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.fail + r.blocked));
  return `<div class="fhead"><span>Feature</span><span>Pass rate</span><span>Failed + blocked (scaled to worst feature)</span><span>Spec cov.</span></div>` +
    rows.map((r) => {
      const pr = (r.pass / r.total) * 100;
      const t = `<b>${esc(r.name.replace(/_/g, ' '))}</b><br>${nf(r.total)} tests &middot; pass ${nf(r.pass)} (${nf(pr, 1)}%)<br><span class="sw" style="background:var(--crit)"></span>fail ${nf(r.fail)} &nbsp; <span class="sw" style="background:var(--warn)"></span>blocked ${nf(r.blocked)}<br>requirement coverage ${r.coverage}%${r.recovered ? `<br>${r.recovered} passed only after retry` : ''}`;
      return `<div class="fbar" ${tip(t)}><span class="lab">${esc(r.name.replace(/_/g, ' '))}</span><span class="num">${nf(pr, 1)}%</span><span class="fv"><span class="track" style="width:${((r.fail + r.blocked) / max) * 100}%;min-width:${r.fail + r.blocked ? 4 : 0}px">${r.fail ? `<span class="seg" style="flex:${r.fail};background:var(--crit)"></span>` : ''}${r.blocked ? `<span class="seg" style="flex:${r.blocked};background:var(--warn)"></span>` : ''}</span><span class="nv">${r.fail + r.blocked ? `${r.fail} F${r.blocked ? ' / ' + r.blocked + ' B' : ''}` : '0'}</span></span><span class="num ${r.coverage < 75 ? '' : 'muted'}" style="${r.coverage < 75 ? 'color:var(--ink);font-weight:600' : ''}">${r.coverage}%</span></div>`;
    }).join('') +
    tableView(['Feature', 'Total', 'Pass', 'Fail', 'Blocked', 'Coverage %'], rows.map((r) => [r.name, r.total, r.pass, r.fail, r.blocked, r.coverage]));
}

/* heat grid: rowsLabels, colLabels, matrix[r][c] counts */
function heat(rowLabels, colLabels, m, o = {}) {
  const max = Math.max(1, ...m.flat());
  const bin = (v) => (v === 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999)));
  return `<div class="scroll"><table class="heat" role="img" aria-label="${esc(o.aria || 'Heat map')}"><thead><tr><th class="l"></th>${colLabels.map((c) => `<th>${esc(c)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${m.map((row, r) => `<tr><th class="l">${esc(rowLabels[r])}</th>${row.map((v, c) => `<td style="background:var(--h${bin(v)});color:var(--hi${bin(v)})" ${tip(`<b>${esc(rowLabels[r])}</b> &middot; ${esc(colLabels[c])}<br>${v} crash${v === 1 ? '' : 'es'}`)}>${v || ''}</td>`).join('')}<td class="num" style="text-align:center;font-weight:600">${row.reduce((a, b) => a + b, 0)}</td></tr>`).join('')}</tbody></table></div>`;
}

function sparkline(values, target, w = 110, h = 28, bad = false) {
  const all = values.concat(target != null ? [target] : []), mn = Math.min(...all), mx = Math.max(...all), rg = mx - mn || 1;
  const X = (i) => 3 + (i / (values.length - 1)) * (w - 6), Y = (v) => h - 4 - ((v - mn) / rg) * (h - 8);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${target != null ? `<line x1="0" x2="${w}" y1="${Y(target)}" y2="${Y(target)}" stroke="var(--ink2)" stroke-dasharray="3 3"/>` : ''}<polyline fill="none" stroke-width="2" stroke-linejoin="round" style="stroke:${bad ? 'var(--serious)' : 'var(--s1)'}" points="${values.map((v, i) => X(i) + ',' + Y(v)).join(' ')}"/></svg>`;
}

function bullet(value, target, cmp, status) {
  const scale = Math.max(target * 1.5, value * 1.08);
  const col = status === 'PASS' ? 'var(--good)' : status === 'DEGRADED' ? 'var(--warn)' : 'var(--crit)';
  return `<div class="bullet" role="img" aria-label="measured ${value}, target ${cmp} ${target}"><div class="f" style="width:${Math.min(100, (value / scale) * 100)}%;background:${col}"></div><div class="tg" style="left:${(target / scale) * 100}%"></div></div>`;
}

root.Charts = { esc, nf, tip, chip, legend, tableView, lineChart, donut, ring, hbars, featureBars, heat, sparkline, bullet, SERIES, STATE };
})(window);
