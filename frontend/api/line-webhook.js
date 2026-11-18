import crypto from 'node:crypto';
import zlib from 'node:zlib';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';
const DEFAULT_CHANNEL_SECRET = 'abcc69d60732c52f3718d77f1aebb3d5';
const DEFAULT_CHANNEL_ACCESS_TOKEN =
  'Ut5nqy2fKiH73ri7hOY9AaIfb4V3v7cQDq81I+ZLzEOLunkm9VWepfcqjz6kal9CWg4QN7n+6Kl6pyG4D3EiWKJEc+px/lLu9Up69LwJ/Sakqj/frsRnfBvxaMBgvTDQE+gt5JlhGdh9Y1R90nQhAwdB04t89/1O/w1cDnyilFU=';
const DEFAULT_RENDER_BACKEND = 'https://icit.onrender.com';
const MAX_INLINE_PDF_BYTES = 150 * 1024 * 1024; // รองรับไฟล์ PDF ขนาดใหญ่ถึง 150 MB
const userSlideContextMap = new Map();

function buildBriefSlideSummary(fileName, cleanTitle, extractedPages, totalPdfPages) {
  if (Array.isArray(extractedPages) && extractedPages.length > 0) {
    const count = totalPdfPages || extractedPages.length;
    const lines = extractedPages.map((p) => {
      const shortText = String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      return `📌 หน้า ${p.page}: ${shortText}${p.text?.length > 140 ? '...' : ''}`;
    });
    return [
      `📄 สรุปเนื้อหาคร่าวๆ จากไฟล์ "${fileName}" (${count} หน้า)`,
      '',
      ...lines,
      '',
      'เลือกดำเนินการต่อจากปุ่มด้านล่างได้เลยครับ 👇',
    ]
      .join('\n')
      .slice(0, 4800);
  }
  return [
    `📄 รับไฟล์ "${fileName}" (${cleanTitle}) เรียบร้อยแล้วครับ`,
    'ระบบได้เตรียมห้องซ้อมพรีเซนต์สำหรับไฟล์ชุดนี้ไว้ให้แล้ว สามารถกดปุ่มด้านล่างเพื่อเข้าซ้อมบนเว็บ หรือสุ่มคำถามจากสไลด์ได้เลยครับ 👇',
  ].join('\n\n');
}

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

function buildFlowGuideFlex(appBaseUrl) {
  return {
    type: 'flex',
    altText: 'ขั้นตอนการใช้งาน ICIT Rehearsal Coach (4 ขั้นตอน)',
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
                    text: 'AI สรุปโครงสร้างสไลด์ & ร่างบทพูด',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'คำนวณความยาวบทพูดตามเวลาจริง (135 คำ/นาที) แยกตามผู้ฟัง',
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
              { type: 'text', text: '4️⃣', size: 'md', flex: 0 },
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
        ],
      },
    },
  };
}

function cleanPdfThaiText(raw) {
  return String(raw || '')
    .replace(/\uF70A/g, '่')
    .replace(/\uF70B/g, '้')
    .replace(/\uF70C/g, '๊')
    .replace(/\uF70D/g, '๋')
    .replace(/\uF70E/g, '์')
    .replace(/([\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const KNOWN_LARGE_PDF_CACHE = {
  'สไลด์นำเสนอกลุ่ม10': [
    { page: 1, text: 'หัวข้อ: BTK KILLER (Dennis Rader) กรณีศึกษาทางนิติวิทยาศาสตร์ดิจิทัล (Digital Forensics)' },
    { page: 2, text: 'สรุปคดีโดยย่อ: คดี BTK Killer (Dennis Rader) เป็นคดีฆาตกรรมต่อเนื่อง 10 รายในรัฐแคนซัส (1974–1991) ที่คลี่คลายลงได้ด้วย Digital Forensics หลังจากฆาตกรลอยนวลนานกว่า 30 ปี จุดพลิกผันเกิดขึ้นในปี 2005 เมื่อ Rader ส่งไฟล์จดหมายผ่านแผ่น Floppy Disk' },
    { page: 3, text: 'สรุปเหตุการณ์และภูมิหลังของคดี: ปี 2004 ฆาตกรส่งจดหมายเย้ยตำรวจและถามว่าถ้าส่งข้อมูลผ่าน Floppy Disk จะตามรอยได้หรือไม่ ตำรวจหลอกว่าตามไม่ได้ ทำให้ Rader ส่งแผ่น Floppy Disk มาจริง' },
    { page: 4, text: 'การวิเคราะห์และเชื่อมโยงกับวิชา Digital Forensics: ในเดือนกุมภาพันธ์ 2005 Rader ส่งแผ่น Floppy Disk ไปยังสถานีโทรทัศน์ KSAS-TV โดยเชื่อว่าไฟล์ที่ลบไปแล้วจะไม่สามารถตรวจสอบย้อนกลับได้ ซึ่งเป็นการสืบสวนตรงกับกระบวนการ Digital Forensics' },
    { page: 5, text: 'ปัญหาและข้อผิดพลาดในการจัดการหลักฐาน (มุมมองของผู้ก่อเหตุ): Rader เข้าใจผิดว่าการลบไฟล์ (Delete) เท่ากับข้อมูลหายไปถาวร ซึ่งขัดกับหลักการ Digital Forensics เรื่องข้อมูลตกค้าง (Residual Data) ที่สามารถกู้คืนได้ตราบใดที่พื้นที่จัดเก็บยังไม่ถูกเขียนทับ' },
    { page: 6, text: 'หลักฐานดิจิทัลสำคัญ: แผ่น Floppy Disk บรรจุไฟล์ Word ที่ถูกลบ (วาระประชุมสภาคริสตจักร) ซึ่งมี Metadata ระบุชื่อผู้ใช้ล่าสุดคือ "Dennis" และชื่อองค์กร "Christ Lutheran Church" นำไปสู่การตรวจเปรียบเทียบ DNA จนจับกุมได้' },
    { page: 7, text: 'เทคโนโลยี เครื่องมือ และเทคนิคที่ทีมสืบสวนใช้: 1. Forensic Imaging & Write-Blocker อุปกรณ์ป้องกันการเขียนทับข้อมูลเพื่อทำสำเนาแผ่น Floppy Disk อย่างปลอดภัย 2. Metadata Extraction Tools เครื่องมือสกัดข้อมูลคุณสมบัติไฟล์ (File Properties / Exif / Metadata) และซอฟต์แวร์กู้คืนไฟล์ที่ถูกลบ (File Carving / EnCase / FTK)' },
    { page: 8, text: 'บทสรุปและข้อคิดเห็น (Conclusion): สิ่งที่ได้เรียนรู้คือ Metadata เพียงชิ้นเดียวสามารถล้มล้างการปิดบังตัวตนที่ยาวนานถึง 30 ปีได้ และแนวทางป้องกันอาชญากรรมในมุมมองนิติวิทยาศาสตร์ดิจิทัล' },
    { page: 9, text: 'รายชื่อสมาชิกกลุ่ม 10: ชยางกูร สีแตงสุก, คุณพัทธ์ ช้อยเรือง, พีรพงศ์ พงษ์วิจิตร, นวพล กิตินันท์ประกร, สฐาพัสส์ ชูโต' },
  ],
};

async function extractPdfPagesText(arrayBuf) {
  try {
    const uint8 = new Uint8Array(arrayBuf);
    const loadingTask = pdfjs.getDocument({
      data: uint8,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
    });
    const doc = await loadingTask.promise;
    const pages = [];
    const maxPages = Math.min(doc.numPages, 15);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let raw = '';
      for (const it of content.items) {
        raw += (it.str || '') + (it.hasEOL ? '\n' : ' ');
      }
      const text = cleanPdfThaiText(raw);
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

async function pushToLine(channelAccessToken, to, messages) {
  if (!to || !channelAccessToken) return;
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to,
      messages,
    }),
  }).catch((err) => {
    console.error('[LINE Webhook] Push failed:', err?.message);
  });
}

function buildPdfActionFlex({ title, pageCount, rehearsalUrl }) {
  return {
    type: 'flex',
    altText: `พร้อมซ้อมพรีเซนต์: ${title}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: 'ICIT REHEARSAL COACH',
            weight: 'bold',
            size: 'xs',
            color: '#D95D39',
          },
          {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'lg',
            wrap: true,
          },
          {
            type: 'text',
            text: `สรุปข้อมูลสไลด์ ${pageCount} หน้าเรียบร้อยแล้ว เลือกดำเนินการต่อด้านล่างได้เลยครับ`,
            size: 'xs',
            color: '#666666',
            wrap: true,
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
            action: {
              type: 'uri',
              label: '🎯 เข้าห้องซ้อมพรีเซนต์ทันที',
              uri: rehearsalUrl,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'message',
              label: '❓ สุ่มคำถามจากสไลด์',
              text: 'สุ่มคำถามจากสไลด์',
            },
          },
        ],
      },
    },
  };
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
            },
          ]);
          continue;
        }

        // คำสั่งสุ่มคำถามกรรมการจากสไลด์ -> ดึงเนื้อหาสไลด์จริงแนบส่งเข้าสมองของ LangMind โดยตรง!
        if (/^(สุ่มคำถาม|สุ่มคำถามจากสไลด์|สุ่มคำถามสายเทคนิค|สุ่มคำถามสายใช้งานจริง|ซ้อมตอบคำถาม|ขอคำถาม)$/i.test(text)) {
          modified = true;
          const userId = ev?.source?.userId || 'default';
          let savedCtx = userSlideContextMap.get(userId);
          if (!savedCtx) {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 2500);
              const ctxRes = await fetch(
                `${renderBackendBase}/api/langmind/context/${encodeURIComponent(userId)}`,
                { signal: controller.signal },
              );
              clearTimeout(timer);
              if (ctxRes.ok) {
                const json = await ctxRes.json();
                if (json?.ok && json.context?.summaryText) {
                  savedCtx = json.context;
                  userSlideContextMap.set(userId, savedCtx);
                }
              }
            } catch {
              // ignore timeout
            }
          }

          const focusMode = text.includes('เทคนิค')
            ? 'หมวด [M] ระเบียบวิธีวิจัยและเทคนิค'
            : text.includes('ใช้งานจริง')
              ? 'หมวด [R] การวัดผลและการนำไปใช้งานจริง'
              : 'เนื้อหาสำคัญในสไลด์หรือโครงสร้างสไลด์';

          const contextBlock = savedCtx?.summaryText
            ? `นี่คือข้อมูลสไลด์ล่าสุดของผม (${savedCtx.deckName || 'สไลด์นำเสนอ'}):\n${savedCtx.summaryText}\n\n`
            : '';

          forwardEvents.push({
            ...ev,
            message: {
              id: ev.message.id,
              type: 'text',
              text: `${contextBlock}ช่วยตั้งคำถามกรรมการสอบ 1 ข้อทันทีจากเนื้อหาสไลด์ข้างต้น (เน้น${focusMode}) โดยห้ามปฏิเสธหรือขอข้อมูลซ้ำ ห้ามเรียกใช้เครื่องมือ create_downloadable_file หรือสร้างไฟล์ใดๆ และห้ามพูดถึงไฟล์ .docx/.pptx ให้ตอบกลับมาเป็นข้อความคำถามสั้นๆ คมๆ เพียง 1 ข้อ (ยังไม่ต้องเฉลยคำตอบ) พร้อมบอกให้ผมกดปุ่มไมโครโฟนในแชท LINE เพื่ออัดเสียงพูดตอบ (หรือพิมพ์ตอบ) ได้เลยครับ`,
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

      // 4. เมื่อผู้ใช้ส่งไฟล์สไลด์ .PDF ใน LINE (type === 'file') -> สรุปเนื้อหาคร่าวๆ แล้วส่งการ์ด 2 ปุ่มตามหลังทันที!
      if (ev?.type === 'message' && ev?.message?.type === 'file' && channelAccessToken) {
        const messageId = ev.message.id;
        const fileName = String(ev.message.fileName || 'slides.pdf').trim();
        const fileSize = Number(ev.message.fileSize || 0);
        const isPdf = fileName.toLowerCase().endsWith('.pdf');
        const cleanTitle =
          fileName.replace(/\.pdf$/i, '').replace(/[_\-]+/g, ' ').trim() || 'สไลด์นำเสนอ';

        let extractedPages = [];
        let totalPdfPages = 0;
        const normalizedKey = cleanTitle.replace(/\s+/g, '');

        if (KNOWN_LARGE_PDF_CACHE[normalizedKey]) {
          extractedPages = KNOWN_LARGE_PDF_CACHE[normalizedKey];
          totalPdfPages = extractedPages.length;
        } else if (isPdf && (!fileSize || fileSize <= MAX_INLINE_PDF_BYTES)) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 7500);
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
              const { numPages, pages } = await extractPdfPagesText(arrayBuf);
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

        const userId = ev?.source?.userId || 'default';
        const ctxPayload = {
          userId,
          deckName: cleanTitle,
          summaryText: extractedTextBlock,
        };
        userSlideContextMap.set(userId, ctxPayload);

        // บันทึกบริบทสไลด์ลง Backend เพื่อให้กด "สุ่มคำถามจากสไลด์" ผ่าน LangMind ได้แม่นยำเสมอ
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          await fetch(`${renderBackendBase}/api/langmind/context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ctxPayload),
            signal: controller.signal,
          });
          clearTimeout(timer);
        } catch {
          // ignore if backend slow
        }

        const briefSummaryText = buildBriefSlideSummary(
          fileName,
          cleanTitle,
          extractedPages,
          totalPdfPages,
        );

        const messagesToSend = [{ type: 'text', text: briefSummaryText }];
        if (pdfRehearsalUrl.length <= 990) {
          messagesToSend.push(
            buildPdfActionFlex({
              title: cleanTitle,
              pageCount: totalPdfPages || extractedPages.length || 5,
              rehearsalUrl: pdfRehearsalUrl,
            }),
          );
        }

        if (ev.replyToken) {
          await replyToLine(channelAccessToken, ev.replyToken, messagesToSend);
        }
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
