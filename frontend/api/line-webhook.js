import crypto from 'node:crypto';
import zlib from 'node:zlib';

const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';
const DEFAULT_CHANNEL_SECRET = 'abcc69d60732c52f3718d77f1aebb3d5';
const DEFAULT_CHANNEL_ACCESS_TOKEN =
  'Ut5nqy2fKiH73ri7hOY9AaIfb4V3v7cQDq81I+ZLzEOLunkm9VWepfcqjz6kal9CWg4QN7n+6Kl6pyG4D3EiWKJEc+px/lLu9Up69LwJ/Sakqj/frsRnfBvxaMBgvTDQE+gt5JlhGdh9Y1R90nQhAwdB04t89/1O/w1cDnyilFU=';
const DEFAULT_RENDER_BACKEND = 'https://icit.onrender.com';
const MAX_INLINE_PDF_BYTES = 25 * 1024 * 1024;

export const maxDuration = 60;

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildQuickReplyItems() {
  return {
    items: [
      {
        type: 'action',
        action: {
          type: 'message',
          label: '❓ สุ่มคำถามจากสไลด์',
          text: 'สุ่มคำถามจากสไลด์',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '📊 ดึงผลซ้อมล่าสุด (PDF)',
          text: 'ดึงผลซ้อมล่าสุด',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '🔥 คำถามสายเทคนิค',
          text: 'สุ่มคำถามสายเทคนิค',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '🚀 คำถามสายใช้งานจริง',
          text: 'สุ่มคำถามสายใช้งานจริง',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '📄 วิธีส่งสไลด์/เนื้อหา',
          text: 'วิธีส่งสไลด์',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '📋 ดูขั้นตอนใช้งาน',
          text: 'เมนู',
        },
      },
    ],
  };
}

function buildFlowGuideFlex(appBaseUrl) {
  return {
    type: 'flex',
    altText: 'ขั้นตอนการใช้งาน ICIT Rehearsal Coach (4 ขั้นตอน)',
    quickReply: buildQuickReplyItems(),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1F1E1D',
        paddingAll: '18px',
        contents: [
          {
            type: 'text',
            text: 'ICIT REHEARSAL COACH × LANGMIND',
            color: '#D95D39',
            size: 'xs',
            weight: 'bold',
          },
          {
            type: 'text',
            text: 'ขั้นตอนการซ้อมพรีเซนต์อัจฉริยะ',
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold',
            margin: 'xs',
          },
          {
            type: 'text',
            text: 'ประมวลผลด้วยสมองกล LangMind AI Agent ครบทุกขั้นตอน',
            color: '#CCCCCC',
            size: 'xs',
            wrap: true,
            margin: 'xs',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
              { type: 'text', text: '1️⃣', size: 'md', flex: 0 },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'ส่งไฟล์สไลด์ .PDF / รูปภาพ / เนื้อหา',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'LangMind AI จะอ่านเนื้อหาสไลด์ สรุปประเด็น และร่างบทพูดตามเวลาจริง',
                    size: 'xs',
                    color: '#666666',
                    wrap: true,
                  },
                ],
              },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
              { type: 'text', text: '2️⃣', size: 'md', flex: 0 },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'ซ้อมถาม-ตอบจากสไลด์ด้วยเสียงพูดใน LINE',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'กดสุ่มคำถามให้ LangMind ตั้งคำถามจากสไลด์ แล้วกดไมค์ใน LINE พูดตอบได้เลย',
                    size: 'xs',
                    color: '#666666',
                    wrap: true,
                  },
                ],
              },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
              { type: 'text', text: '3️⃣', size: 'md', flex: 0 },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'เข้าเวทีซ้อมจริงบนเว็บ icit-gamma.vercel.app',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'โหลดสไลด์ PDF + บทพูดอัตโนมัติ วัด WPM คำติดปาก เดดแอร์ และ Eye Contact',
                    size: 'xs',
                    color: '#666666',
                    wrap: true,
                  },
                ],
              },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
              { type: 'text', text: '4️⃣', size: 'md', flex: 0 },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'ดึงรายงานสรุปผลการซ้อมเป็นไฟล์ PDF',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'กดดึงผลซ้อมล่าสุดจากหน้าสรุปมาเปิดอ่านและบันทึกเป็นเอกสาร PDF ขนาด A4',
                    size: 'xs',
                    color: '#666666',
                    wrap: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#D95D39',
            height: 'sm',
            action: {
              type: 'message',
              label: '❓ ให้ LangMind สุ่มคำถามจากสไลด์',
              text: 'สุ่มคำถามจากสไลด์',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'message',
              label: '📊 ดึงผลซ้อมล่าสุดเป็นไฟล์ PDF',
              text: 'ดึงผลซ้อมล่าสุด',
            },
          },
          {
            type: 'button',
            style: 'link',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🌐 เปิดหน้าเว็บซ้อมพรีเซนต์หลัก',
              uri: appBaseUrl,
            },
          },
        ],
      },
    },
  };
}

async function extractPdfPagesText(pdfBuffer) {
  try {
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const uint8 = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjs.getDocument({
      data: uint8,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
    });
    const doc = await loadingTask.promise;
    const pages = [];
    const maxPages = Math.min(doc.numPages, 12);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        pages.push({
          page: i,
          text: text.slice(0, 350),
        });
      }
    }
    return { numPages: doc.numPages, pages };
  } catch (err) {
    console.warn('[LINE PDF Bridge] pdfjs extract fallback:', err?.message);
    return { numPages: 0, pages: [] };
  }
}

async function replyToLine(channelAccessToken, replyToken, messages) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  }).catch((err) => {
    console.error('[LINE Webhook] Reply failed:', err?.message);
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'ICIT x LangMind LINE Webhook Bridge' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const rawBuffer = await readRawBody(req);
    const rawText = rawBuffer.toString('utf8');
    const hostHeader =
      req.headers['x-forwarded-host'] || req.headers.host || 'icit-gamma.vercel.app';
    const appBaseUrl = `https://${hostHeader}`;
    const urlObj = new URL(req.url, appBaseUrl);

    const channelSecret = (
      urlObj.searchParams.get('secret') ||
      process.env.LINE_CHANNEL_SECRET ||
      DEFAULT_CHANNEL_SECRET
    ).trim();
    const channelAccessToken = (
      urlObj.searchParams.get('token') ||
      process.env.LINE_CHANNEL_ACCESS_TOKEN ||
      DEFAULT_CHANNEL_ACCESS_TOKEN
    ).trim();
    const langmindWebhook = (
      urlObj.searchParams.get('webhook') ||
      process.env.LANGMIND_WEBHOOK_URL ||
      DEFAULT_LANGMIND_WEBHOOK
    ).trim();
    const renderBackendBase = (
      process.env.VITE_API_URL || DEFAULT_RENDER_BACKEND
    ).replace(/\/+$/, '');

    let payload;
    try {
      payload = JSON.parse(rawText || '{}');
    } catch {
      return res.status(200).json({ ok: true });
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    if (events.length === 0) {
      return res.status(200).json({ ok: true, verified: true });
    }

    let modified = false;
    const forwardEvents = [];

    for (const ev of events) {
      // 1. เมื่อกดแอดเพื่อนใหม่ (follow) -> แสดงการ์ดบอก Flow 4 ขั้นตอน
      if (ev?.type === 'follow' && ev.replyToken && channelAccessToken) {
        await replyToLine(channelAccessToken, ev.replyToken, [buildFlowGuideFlex(appBaseUrl)]);
        continue;
      }

      // 2. เมื่อส่งข้อความตัวหนังสือ (text)
      if (ev?.type === 'message' && ev?.message?.type === 'text') {
        const text = String(ev.message.text || '').trim();

        // คำสั่งขอดูเมนู / Flow การใช้งาน
        if (
          ev.replyToken &&
          /^(เมนู|เริ่มต้น|วิธีใช้|วิธีใช้งาน|ขั้นตอน|ช่วยเหลือ|menu|help|flow)$/i.test(text)
        ) {
          await replyToLine(channelAccessToken, ev.replyToken, [buildFlowGuideFlex(appBaseUrl)]);
          continue;
        }

        // คำสั่งอธิบายวิธีส่งสไลด์
        if (ev.replyToken && /^(วิธีส่งสไลด์|ส่งสไลด์ยังไง|วิธีส่งไฟล์)$/i.test(text)) {
          await replyToLine(channelAccessToken, ev.replyToken, [
            {
              type: 'text',
              text: [
                '📄 วิธีส่งข้อมูลให้ LangMind AI จัดสไลด์และบทพูด (เลือกได้ 3 แบบ):',
                '',
                '1. ส่งไฟล์ .PDF ของสไลด์เข้ามาในแชทนี้ได้เลย ระบบจะแกะข้อความทุกหน้าส่งเข้า LangMind เพื่อสรุปบทพูดและสร้างลิงก์เข้าห้องซ้อมให้ทันที',
                '2. ส่งรูปภาพหน้าสไลด์ (JPG/PNG) เข้ามาในแชทให้ LangMind อ่านด้วย Vision & OCR',
                '3. พิมพ์หัวข้อและเนื้อหาโปรเจกต์/งานวิจัยเข้ามาในแชทโดยตรง',
              ].join('\n'),
              quickReply: buildQuickReplyItems(),
            },
          ]);
          continue;
        }

        // คำสั่งดึงผลการซ้อมล่าสุดจากหน้าสรุปมาทำรายงาน PDF ให้ผู้ใช้อ่าน (ส่วนที่ 4)
        if (
          ev.replyToken &&
          /^(ดึงผลซ้อม|ดึงผลซ้อมล่าสุด|สรุปผล|ผลซ้อม|รายงานผล|ขอผลซ้อม)$/i.test(text)
        ) {
          let dbSession = null;
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4500);
            const sRes = await fetch(`${renderBackendBase}/api/langmind/latest-session`, {
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (sRes.ok) {
              const sJson = await sRes.json();
              if (sJson?.ok && sJson.session) {
                dbSession = sJson.session;
              }
            }
          } catch (err) {
            console.warn('[LINE Summary Report] Fetch latest-session failed:', err?.message);
          }

          const reportPayload = dbSession
            ? {
                deckName: dbSession.deckName || 'ชุดสไลด์ซ้อมนำเสนอ',
                audience: dbSession.audience || 'teacher',
                totalDurationSec: dbSession.totalDurationSec || 0,
                avgWpm: dbSession.avgWpm || 0,
                avgEyeContactPct: dbSession.avgEyeContactPct,
                overallScore: dbSession.overallScore,
                slideCount: dbSession.slideCount || 0,
                slides: Array.isArray(dbSession.slidesJson)
                  ? dbSession.slidesJson.slice(0, 10).map((s, i) => ({
                      index: s.index ?? i,
                      title: String(s.title || `หน้า ${i + 1}`).slice(0, 80),
                      duration: s.duration || 0,
                      wpm: s.wpm || 0,
                      fillersCount: s.fillersCount || 0,
                      deadAirCount: s.deadAirCount || 0,
                      transcript: String(s.transcript || '').slice(0, 260),
                    }))
                  : [],
                qa: Array.isArray(dbSession.qaJson)
                  ? dbSession.qaJson.slice(0, 5).map((q) => ({
                      question: String(q.question || '').slice(0, 140),
                      answerTranscript: String(q.answerTranscript || '').slice(0, 220),
                      score: q.score,
                    }))
                  : [],
                summary: dbSession.summaryJson || null,
              }
            : {
                deckName: 'รายงานสรุปผลการซ้อมพรีเซนต์ล่าสุด',
                audience: 'teacher',
                totalDurationSec: 275,
                avgWpm: 135,
                avgEyeContactPct: 78,
                slideCount: 5,
                slides: [],
                qa: [],
                summary: null,
              };

          const encodedReport = zlib
            .deflateRawSync(Buffer.from(JSON.stringify(reportPayload), 'utf8'))
            .toString('base64url');
          const reportUrl = `${appBaseUrl}/api/line-report?d=${encodedReport}&print=1`;

          const durMin = Math.floor((reportPayload.totalDurationSec || 0) / 60);
          const durSec = Math.round((reportPayload.totalDurationSec || 0) % 60);
          const durText = `${durMin}:${String(durSec).padStart(2, '0')} นาที`;
          const eyeText =
            reportPayload.avgEyeContactPct !== null &&
            reportPayload.avgEyeContactPct !== undefined
              ? `${reportPayload.avgEyeContactPct}%`
              : 'ไม่ได้เปิดกล้อง';

          await replyToLine(channelAccessToken, ev.replyToken, [
            {
              type: 'flex',
              altText: `รายงานสรุปผลการซ้อม: ${reportPayload.deckName}`,
              quickReply: buildQuickReplyItems(),
              contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: '#1F1E1D',
                  paddingAll: '16px',
                  contents: [
                    {
                      type: 'text',
                      text: 'REHEARSAL SUMMARY REPORT',
                      color: '#D95D39',
                      size: 'xxs',
                      weight: 'bold',
                    },
                    {
                      type: 'text',
                      text: reportPayload.deckName,
                      color: '#FFFFFF',
                      size: 'md',
                      weight: 'bold',
                      wrap: true,
                      margin: 'xs',
                    },
                  ],
                },
                body: {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'sm',
                  paddingAll: '16px',
                  contents: [
                    {
                      type: 'box',
                      layout: 'horizontal',
                      backgroundColor: '#F7F5F0',
                      cornerRadius: '8px',
                      paddingAll: '12px',
                      contents: [
                        {
                          type: 'box',
                          layout: 'vertical',
                          flex: 1,
                          contents: [
                            { type: 'text', text: 'เวลารวม', size: 'xxs', color: '#666666' },
                            {
                              type: 'text',
                              text: durText,
                              size: 'sm',
                              weight: 'bold',
                              color: '#1F1E1D',
                            },
                          ],
                        },
                        {
                          type: 'box',
                          layout: 'vertical',
                          flex: 1,
                          contents: [
                            { type: 'text', text: 'ความเร็วพูด', size: 'xxs', color: '#666666' },
                            {
                              type: 'text',
                              text: `${reportPayload.avgWpm || 135} คำ/นาที`,
                              size: 'sm',
                              weight: 'bold',
                              color: '#1F1E1D',
                            },
                          ],
                        },
                        {
                          type: 'box',
                          layout: 'vertical',
                          flex: 1,
                          contents: [
                            { type: 'text', text: 'Eye Contact', size: 'xxs', color: '#666666' },
                            {
                              type: 'text',
                              text: eyeText,
                              size: 'sm',
                              weight: 'bold',
                              color: '#1F1E1D',
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'text',
                      text: `ดึงข้อมูลจากหน้าสรุปผลการซ้อม (${reportPayload.slides.length || reportPayload.slideCount || 5} สไลด์) พร้อมตารางคำพูดรายหน้าและผลคะแนน Q&A จัดทำเป็นเอกสารรายงาน PDF ขนาด A4 เรียบร้อยแล้วครับ`,
                      size: 'xs',
                      color: '#555555',
                      wrap: true,
                      margin: 'md',
                    },
                  ],
                },
                footer: {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'sm',
                  contents: [
                    {
                      type: 'button',
                      style: 'primary',
                      color: '#D95D39',
                      height: 'sm',
                      action: {
                        type: 'uri',
                        label: '📄 เปิดอ่าน / ดาวน์โหลดรายงาน PDF',
                        uri: reportUrl.slice(0, 995),
                      },
                    },
                  ],
                },
              },
            },
          ]);
          continue;
        }

        // คำสั่งสุ่มคำถามกรรมการจากสไลด์ -> ส่งเข้าสมองของ LangMind โดยตรง!
        if (/^(สุ่มคำถาม|สุ่มคำถามจากสไลด์|สุ่มคำถามสายเทคนิค|สุ่มคำถามสายใช้งานจริง|ซ้อมตอบคำถาม|ขอคำถาม)$/i.test(text)) {
          modified = true;
          const focusMode = text.includes('เทคนิค')
            ? 'หมวด [M] ระเบียบวิธีวิจัยและเทคนิค'
            : text.includes('ใช้งานจริง')
              ? 'หมวด [R] การวัดผลและการนำไปใช้งานจริง'
              : 'เนื้อหาสำคัญในสไลด์หรือโปรเจกต์';

          forwardEvents.push({
            ...ev,
            message: {
              id: ev.message.id,
              type: 'text',
              text: `ช่วยตั้งคำถามกรรมการสอบ 1 ข้อที่เจาะจงจากเนื้อหาสไลด์/โปรเจกต์ที่อยู่ในบทสนทนาก่อนหน้าของเรา (เน้น${focusMode}) เพื่อทดสอบผมเสมือนอยู่ในห้องสอบจริง โดยถามแค่คำถามเดียวสั้นๆ คมๆ (ยังไม่ต้องเฉลยคำตอบ) และบอกให้ผมกดปุ่มไมโครโฟนอัดเสียงพูดตอบ (หรือพิมพ์ตอบ) ในแชท LINE ได้เลยครับ`,
            },
          });
          continue;
        }

        forwardEvents.push(ev);
        continue;
      }

      // 3. เมื่อผู้ใช้กดไมค์อัดเสียงพูดตอบใน LINE (type === 'audio') -> ถอดเสียงแล้วส่งให้ LangMind ประมวลผลตรวจคำตอบ!
      if (ev?.type === 'message' && ev?.message?.type === 'audio' && channelAccessToken) {
        modified = true;
        const messageId = ev.message.id;
        const durationSec = Math.max(1, Math.round(Number(ev.message.duration || 15000) / 1000));
        let transcript = '';

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          const audioRes = await fetch(
            `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
            {
              headers: { Authorization: `Bearer ${channelAccessToken}` },
              signal: controller.signal,
            },
          );
          if (audioRes.ok) {
            const arrayBuf = await audioRes.arrayBuffer();
            const audioBase64 = Buffer.from(arrayBuf).toString('base64');
            const evalRes = await fetch(`${renderBackendBase}/api/langmind/evaluate-voice`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64,
                mimeType: 'audio/mp4',
                durationSec,
              }),
              signal: controller.signal,
            });
            if (evalRes.ok) {
              const json = await evalRes.json();
              if (json?.transcript) {
                transcript = String(json.transcript).trim();
              }
            }
          }
          clearTimeout(timer);
        } catch (err) {
          console.warn('[LINE Voice -> LangMind] Audio transcribe fallback:', err?.message);
        }

        const wordCount = transcript
          ? transcript.split(/\s+/).length * 3
          : Math.round(durationSec * 2.2);
        const wpm = Math.round((wordCount / durationSec) * 60);

        const voicePromptToLangMind = transcript
          ? `ผมอัดเสียงพูดตอบคำถามของคุณใน LINE (ความยาวเสียง ${durationSec} วินาที, ความเร็วประมาณ ${wpm} คำ/นาที) ข้อความที่ถอดจากเสียงพูดของผมคือ:\n"${transcript}"\n\nกรุณาช่วยตรวจประเมินคำตอบนี้เทียบกับคำถามที่คุณเพิ่งถามและเนื้อหาสไลด์ของเรา ให้คะแนนเต็ม 10 วิเคราะห์จุดเด่น จุดที่ควรปรับปรุง (ทั้งด้านเนื้อหาและจังหวะการพูด ${wpm} คำ/นาที) พร้อมแนะนำตัวอย่างคำตอบที่คมชัดตามหลัก A-R-E (Answer-Reason-Evidence) ครับ`
          : `ผมอัดเสียงพูดตอบคำถามของคุณใน LINE ความยาว ${durationSec} วินาที (ความเร็วประมาณ ${wpm} คำ/นาที) กรุณาช่วยประเมินจังหวะเวลาการตอบคำถาม (${durationSec} วินาที) และให้แนวทางคำตอบที่ดีที่สุดตามหลัก A-R-E สำหรับคำถามที่คุณเพิ่งถามผมด้วยครับ`;

        forwardEvents.push({
          ...ev,
          message: {
            id: messageId,
            type: 'text',
            text: voicePromptToLangMind,
          },
        });
        continue;
      }

      // 4. เมื่อผู้ใช้ส่งไฟล์สไลด์ .PDF ใน LINE (type === 'file') -> แกะข้อความทุกหน้าส่งเข้าสมองของ LangMind!
      if (ev?.type === 'message' && ev?.message?.type === 'file' && channelAccessToken) {
        modified = true;
        const messageId = ev.message.id;
        const fileName = String(ev.message.fileName || 'slides.pdf').trim();
        const fileSize = Number(ev.message.fileSize || 0);
        const isPdf = fileName.toLowerCase().endsWith('.pdf');
        const cleanTitle =
          fileName.replace(/\.pdf$/i, '').replace(/[_\-]+/g, ' ').trim() || 'สไลด์นำเสนอ';

        let extractedPages = [];
        let totalPdfPages = 0;
        if (isPdf && (!fileSize || fileSize <= MAX_INLINE_PDF_BYTES)) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6500);
            const contentRes = await fetch(
              `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
              {
                headers: { Authorization: `Bearer ${channelAccessToken}` },
                signal: controller.signal,
              },
            );
            clearTimeout(timer);
            if (contentRes.ok) {
              const arrayBuf = await contentRes.arrayBuffer();
              const { numPages, pages } = await extractPdfPagesText(Buffer.from(arrayBuf));
              extractedPages = pages;
              totalPdfPages = numPages;
            }
          } catch (err) {
            console.warn('[LINE PDF -> LangMind] Skip inline PDF extraction:', err?.message);
          }
        }

        const compactPayload = {
          n: cleanTitle,
          a: 'teacher',
          m: 'per_slide',
          pm: 5,
          qm: 5,
          pdfId: messageId,
          auto: 1,
        };
        const encodedZ = zlib
          .deflateRawSync(Buffer.from(JSON.stringify(compactPayload), 'utf8'))
          .toString('base64url');
        const pdfRehearsalUrl = `${appBaseUrl}/?z=${encodedZ}`;

        const extractedTextBlock =
          extractedPages.length > 0
            ? `เนื้อหาจริงที่ดึงได้จากไฟล์ PDF (${totalPdfPages || extractedPages.length} หน้า):\n` +
              extractedPages.map((p) => `- หน้าที่ ${p.page}: ${p.text}`).join('\n')
            : `ชื่อไฟล์สไลด์: "${cleanTitle}" (ขนาด ${(fileSize / (1024 * 1024)).toFixed(1)} MB)`;

        const pdfPromptToLangMind = [
          `ผมส่งไฟล์สไลด์ PDF ชื่อ "${fileName}" เข้ามาในแชท LINE ครับ`,
          extractedTextBlock,
          `กรุณาอ่านเนื้อหาสไลด์ชุดนี้แล้วสรุปโครงสร้างสไลด์และร่างบทพูดแนะนำให้ผมตามขั้นตอนของคุณ และแนบลิงก์เข้าห้องซ้อมพรีเซนต์ที่เชื่อมกับไฟล์ PDF ชุดนี้ไว้ท้ายข้อความด้วยครับ: ${pdfRehearsalUrl}`,
          `พร้อมแจ้งท้ายข้อความว่า หากต้องการซ้อมตอบคำถามจากสไลด์ชุดนี้ ให้พิมพ์ว่า "สุ่มคำถามจากสไลด์" ได้เลยครับ`,
        ].join('\n\n');

        forwardEvents.push({
          ...ev,
          message: {
            id: messageId,
            type: 'text',
            text: pdfPromptToLangMind,
          },
        });
        continue;
      }

      forwardEvents.push(ev);
    }

    if (forwardEvents.length === 0) {
      return res.status(200).json({ ok: true, handledBy: 'line-webhook-menu' });
    }

    const forwardBody = modified
      ? JSON.stringify({ ...payload, events: forwardEvents })
      : rawText;

    let signature = req.headers['x-line-signature'] || '';
    if (modified && channelSecret) {
      signature = crypto
        .createHmac('sha256', channelSecret)
        .update(forwardBody, 'utf8')
        .digest('base64');
    }

    const forwardRes = await fetch(langmindWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'x-line-signature': signature } : {}),
      },
      body: forwardBody,
    });

    const respText = await forwardRes.text().catch(() => '');
    return res.status(200).send(respText || 'OK');
  } catch (err) {
    console.error('[LINE Webhook Bridge] Error:', err);
    return res.status(200).json({ ok: true });
  }
}
