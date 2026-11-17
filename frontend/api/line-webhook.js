import crypto from 'node:crypto';

const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';
const DEFAULT_CHANNEL_SECRET = 'abcc69d60732c52f3718d77f1aebb3d5';
const MAX_INLINE_PDF_BYTES = 12 * 1024 * 1024; // ดึงข้อความเฉพาะไฟล์ PDF ไม่เกิน 12MB เพื่อไม่ให้เกินเวลา Webhook

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

async function extractPdfPagesText(pdfBuffer) {
  try {
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
    const maxPages = Math.min(doc.numPages, 15);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        pages.push({ page: i, text: text.slice(0, 500) });
      }
    }
    return { numPages: doc.numPages, pages };
  } catch (err) {
    console.warn('[LINE PDF Bridge] pdfjs extract fallback:', err?.message);
    return { numPages: 0, pages: [] };
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'ICIT x LangMind LINE PDF Webhook Bridge' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const rawBuffer = await readRawBody(req);
    const rawText = rawBuffer.toString('utf8');
    const urlObj = new URL(req.url, `https://${req.headers.host || 'icit-gamma.vercel.app'}`);

    const channelSecret = (
      urlObj.searchParams.get('secret') ||
      process.env.LINE_CHANNEL_SECRET ||
      DEFAULT_CHANNEL_SECRET
    ).trim();
    const channelAccessToken = (
      urlObj.searchParams.get('token') ||
      process.env.LINE_CHANNEL_ACCESS_TOKEN ||
      ''
    ).trim();
    const langmindWebhook = (
      urlObj.searchParams.get('webhook') ||
      process.env.LANGMIND_WEBHOOK_URL ||
      DEFAULT_LANGMIND_WEBHOOK
    ).trim();

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
    const nextEvents = [];

    for (const ev of events) {
      const isFileMessage = ev?.type === 'message' && ev?.message?.type === 'file';

      if (isFileMessage) {
        modified = true;
        const messageId = ev.message.id;
        const fileName = String(ev.message.fileName || 'slides.pdf').trim();
        const fileSize = Number(ev.message.fileSize || 0);
        const isPdf = fileName.toLowerCase().endsWith('.pdf');
        let extractedSummary = '';

        // ดึงข้อความจาก PDF เฉพาะกรณีมี Access Token และขนาดไฟล์ไม่เกิน 12MB
        if (isPdf && channelAccessToken && (!fileSize || fileSize <= MAX_INLINE_PDF_BYTES)) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4500);
            const contentRes = await fetch(
              `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
              {
                headers: {
                  Authorization: `Bearer ${channelAccessToken}`,
                },
                signal: controller.signal,
              },
            );
            clearTimeout(timer);
            if (contentRes.ok) {
              const arrayBuf = await contentRes.arrayBuffer();
              const { numPages, pages } = await extractPdfPagesText(Buffer.from(arrayBuf));
              if (pages.length > 0) {
                extractedSummary =
                  `เนื้อหาที่ดึงได้จากสไลด์ PDF (${numPages} หน้า):\n` +
                  pages.map((p) => `หน้าที่ ${p.page}: ${p.text}`).join('\n');
              }
            }
          } catch (err) {
            console.warn('[LINE PDF Bridge] Skip inline PDF extraction:', err?.message);
          }
        }

        const cleanTitle = fileName.replace(/\.pdf$/i, '').replace(/[_\-]+/g, ' ').trim();
        const syntheticText = extractedSummary
          ? [
              `ผมส่งไฟล์สไลด์ PDF ชื่อ "${fileName}" (pdfId=${messageId})`,
              extractedSummary,
              `กรุณาสรุปโครงสร้างสไลด์และร่างบทพูดให้ครบทุกหน้า พร้อมส่งลิงก์เข้าเว็บซ้อมพรีเซนต์ให้ทันทีในข้อความนี้เลย (หากใส่ pdfId=${messageId} ในลิงก์ได้ให้ใส่ด้วย)`,
            ].join('\n\n')
          : [
              `ผมส่งไฟล์สไลด์ชื่อ "${fileName}" เข้ามาครับ`,
              `กรุณาช่วยจัดโครงสร้างสไลด์ 5 หน้า และร่างบทพูดแนะนำสำหรับการนำเสนอเรื่อง "${cleanTitle}" (กลุ่มผู้ฟัง: อาจารย์/กรรมการสอบ, เวลา 5 นาที) พร้อมเก็งคำถาม 3 ข้อ และสร้างลิงก์เข้าห้องซ้อมพรีเซนต์ https://icit-gamma.vercel.app/?topic=...&aud=teacher&time=5&s1=... ให้ผมกดเข้าไปซ้อมพูดได้ทันทีในข้อความนี้เลยครับ`,
            ].join('\n');

        nextEvents.push({
          ...ev,
          message: {
            id: messageId,
            type: 'text',
            text: syntheticText,
          },
        });
      } else {
        nextEvents.push(ev);
      }
    }

    const forwardBody = modified
      ? JSON.stringify({ ...payload, events: nextEvents })
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
    console.error('[LINE PDF Bridge] Error:', err);
    return res.status(200).json({ ok: true });
  }
}
