import zlib from 'node:zlib';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec || 0)));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')} นาที`;
}

function decodeReportData(dParam) {
  if (!dParam) return null;
  try {
    const buf = Buffer.from(dParam, 'base64url');
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      const unzipped = zlib.inflateRawSync(buf);
      return JSON.parse(unzipped.toString('utf8'));
    }
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const urlObj = new URL(req.url, `https://${req.headers.host || 'icit-gamma.vercel.app'}`);
  const dParam = urlObj.searchParams.get('d') || '';
  const autoPrint = urlObj.searchParams.get('print') === '1';

  const data = decodeReportData(dParam) || {
    deckName: 'รายงานสรุปผลการซ้อมนำเสนอ (ICIT Rehearsal)',
    audience: 'teacher',
    totalDurationSec: 285,
    avgWpm: 134,
    avgEyeContactPct: 78,
    slideCount: 5,
    slides: [],
    qa: [],
    summary: null,
  };

  const audienceMap = {
    teacher: 'อาจารย์ / คณะกรรมการสอบ',
    executive: 'ผู้บริหาร / คณะกรรมการตัดสินทุน',
    general: 'บุคคลทั่วไป',
  };

  const deckName = data.deckName || 'ชุดสไลด์ซ้อมนำเสนอ';
  const audienceLabel = audienceMap[data.audience] || 'อาจารย์ / คณะกรรมการสอบ';
  const totalDuration = formatDuration(data.totalDurationSec || 0);
  const avgWpm = Number(data.avgWpm || 0);
  const eyePct =
    data.avgEyeContactPct !== null && data.avgEyeContactPct !== undefined
      ? `${data.avgEyeContactPct}%`
      : 'ไม่ได้เปิดกล้อง';
  const paceStatus =
    avgWpm > 160
      ? 'เร็วเกินไป (>160 คำ/นาที)'
      : avgWpm > 0 && avgWpm < 95
        ? 'ช้าเกินไป (<95 คำ/นาที)'
        : avgWpm > 0
          ? 'เหมาะสมตามเกณฑ์ (125–145 คำ/นาที)'
          : 'รอการวัดผล';

  const slides = Array.isArray(data.slides) ? data.slides : [];
  const qaList = Array.isArray(data.qa) ? data.qa : [];
  const aiSummary = data.summary || {};

  const slidesRowsHtml =
    slides.length > 0
      ? slides
          .map(
            (s, i) => `
          <tr>
            <td style="text-align:center;font-weight:bold;">หน้า ${(s.index ?? i) + 1}</td>
            <td><strong>${escapeHtml(s.title || `สไลด์หน้าที่ ${i + 1}`)}</strong></td>
            <td style="text-align:center;">${formatDuration(s.duration || 0)}</td>
            <td style="text-align:center;">${s.wpm || 0} คำ/นาที</td>
            <td style="text-align:center;">${s.fillersCount ?? 0} ครั้ง</td>
            <td style="text-align:center;">${s.deadAirCount ?? 0} ครั้ง</td>
            <td>${escapeHtml(s.transcript || s.script || '-')}</td>
          </tr>`,
          )
          .join('')
      : `<tr><td colspan="7" style="text-align:center;color:#666;">ไม่มีข้อมูลรายสไลด์</td></tr>`;

  const qaRowsHtml =
    qaList.length > 0
      ? qaList
          .map(
            (q, i) => `
          <tr>
            <td style="text-align:center;font-weight:bold;">ข้อที่ ${i + 1}</td>
            <td>${escapeHtml(q.question || '-')}</td>
            <td>${escapeHtml(q.answerTranscript || '-')}</td>
            <td style="text-align:center;font-weight:bold;">${q.score !== undefined && q.score !== null ? `${q.score}/10` : '-'}</td>
          </tr>`,
          )
          .join('')
      : '';

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>รายงานผลการซ้อมพรีเซนต์ - ${escapeHtml(deckName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: #f0eeeb;
      font-family: 'Sarabun', sans-serif;
      color: #1f1e1d;
      line-height: 1.6;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: #1f1e1d;
      color: #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,0.15);
    }
    .toolbar-title {
      font-size: 14px;
      font-weight: 700;
    }
    .btn-pdf {
      background: #d95d39;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 9px 18px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .page {
      max-width: 210mm;
      margin: 24px auto;
      background: #fff;
      padding: 20mm 18mm;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      border-radius: 6px;
    }
    .header-box {
      border-bottom: 2px solid #1f1e1d;
      padding-bottom: 14px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .brand {
      color: #d95d39;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    h1 {
      margin: 4px 0 0;
      font-size: 22px;
      font-weight: 700;
    }
    h2 {
      margin: 22px 0 10px;
      font-size: 16px;
      font-weight: 700;
      color: #1f1e1d;
      border-left: 4px solid #d95d39;
      padding-left: 10px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi-card {
      border: 1px solid #e2ddd5;
      background: #faf8f5;
      border-radius: 8px;
      padding: 12px;
    }
    .kpi-label {
      font-size: 12px;
      color: #666;
    }
    .kpi-val {
      font-size: 20px;
      font-weight: 700;
      margin-top: 4px;
    }
    .kpi-sub {
      font-size: 11px;
      color: #d95d39;
      margin-top: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 8px;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 8px 10px;
      vertical-align: top;
    }
    th {
      background: #f3f1ed;
      font-weight: 700;
      text-align: center;
    }
    .summary-box {
      border: 1px solid #e2ddd5;
      background: #fff9f6;
      border-radius: 8px;
      padding: 14px 16px;
      margin-top: 12px;
      font-size: 14px;
    }
    @media print {
      body { background: #fff; }
      .toolbar { display: none !important; }
      .page {
        margin: 0;
        padding: 10mm;
        box-shadow: none;
        max-width: 100%;
      }
    }
    @media (max-width: 640px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .page { margin: 10px; padding: 16px; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-title">📄 รายงานสรุปผลการซ้อมนำเสนอ (PDF Report)</div>
    <button class="btn-pdf" onclick="window.print()">📥 บันทึกเป็นไฟล์ PDF / พิมพ์</button>
  </div>

  <div class="page">
    <div class="header-box">
      <div>
        <div class="brand">ICIT REHEARSAL COACH × LANGMIND AI</div>
        <h1>รายงานวิเคราะห์ผลการซ้อมนำเสนอ (Rehearsal Evaluation Report)</h1>
        <div style="font-size:14px;color:#555;margin-top:4px;">
          <strong>หัวข้อการนำเสนอ:</strong> ${escapeHtml(deckName)} &nbsp;|&nbsp;
          <strong>กลุ่มผู้ฟัง:</strong> ${escapeHtml(audienceLabel)}
        </div>
      </div>
      <div style="text-align:right;font-size:12px;color:#666;">
        วันที่ออกรายงาน:<br/>${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>

    <h2>1. สรุปตัวชี้วัดภาพรวม (Overall Performance Metrics)</h2>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">เวลาพูดรวมทั้งหมด</div>
        <div class="kpi-val">${totalDuration}</div>
        <div class="kpi-sub">จำนวน ${slides.length || data.slideCount || 0} สไลด์</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">ความเร็วการพูดเฉลี่ย</div>
        <div class="kpi-val">${avgWpm} คำ/นาที</div>
        <div class="kpi-sub">${escapeHtml(paceStatus)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">การสบตากล้อง (Eye Contact)</div>
        <div class="kpi-val">${escapeHtml(eyePct)}</div>
        <div class="kpi-sub">เกณฑ์แนะนำ ≥ 70%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">คะแนนภาพรวม / ความพร้อม</div>
        <div class="kpi-val">${data.overallScore ? `${data.overallScore}/100` : avgWpm >= 110 && avgWpm <= 155 ? 'ดีเยี่ยม (A)' : 'พร้อมสอบ (B+)'}</div>
        <div class="kpi-sub">ประเมินตามเกณฑ์มาตรฐาน</div>
      </div>
    </div>

    ${
      aiSummary?.overallFeedback || aiSummary?.summary
        ? `<h2>2. บทวิเคราะห์และคำแนะนำจาก AI Coach</h2>
           <div class="summary-box">
             ${escapeHtml(aiSummary.overallFeedback || aiSummary.summary)}
           </div>`
        : ''
    }

    <h2>${aiSummary?.overallFeedback || aiSummary?.summary ? '3' : '2'}. รายละเอียดผลการซ้อมพูดและบทพูดรายสไลด์ (Slide-by-Slide Analysis)</h2>
    <table>
      <thead>
        <tr>
          <th style="width:65px;">สไลด์</th>
          <th style="width:160px;">หัวข้อสไลด์</th>
          <th style="width:80px;">เวลาที่ใช้</th>
          <th style="width:85px;">ความเร็ว</th>
          <th style="width:70px;">คำติดปาก</th>
          <th style="width:70px;">เดดแอร์</th>
          <th>ข้อความที่พูดจริง / บทพูดแนะนำ</th>
        </tr>
      </thead>
      <tbody>
        ${slidesRowsHtml}
      </tbody>
    </table>

    ${
      qaRowsHtml
        ? `<h2>ผลการซ้อมตอบคำถามคณะกรรมการ (Q&A Defense)</h2>
           <table>
             <thead>
               <tr>
                 <th style="width:70px;">ข้อที่</th>
                 <th style="width:240px;">คำถามจากกรรมการ AI</th>
                 <th>คำตอบของผู้ซ้อม</th>
                 <th style="width:80px;">คะแนน</th>
               </tr>
             </thead>
             <tbody>
               ${qaRowsHtml}
             </tbody>
           </table>`
        : ''
    }
  </div>
  ${autoPrint ? '<script>window.onload = () => setTimeout(() => window.print(), 400);</script>' : ''}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
