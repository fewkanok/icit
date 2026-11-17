import crypto from 'node:crypto';

const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';
const DEFAULT_CHANNEL_SECRET = 'abcc69d60732c52f3718d77f1aebb3d5';
const DEFAULT_CHANNEL_ACCESS_TOKEN =
  'Ut5nqy2fKiH73ri7hOY9AaIfb4V3v7cQDq81I+ZLzEOLunkm9VWepfcqjz6kal9CWg4QN7n+6Kl6pyG4D3EiWKJEc+px/lLu9Up69LwJ/Sakqj/frsRnfBvxaMBgvTDQE+gt5JlhGdh9Y1R90nQhAwdB04t89/1O/w1cDnyilFU=';
const MAX_INLINE_PDF_BYTES = 10 * 1024 * 1024; // ดึงข้อความเฉพาะไฟล์ไม่เกิน 10MB เพื่อให้ทันเวลา 10 วินาทีของ Vercel

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
    const maxPages = Math.min(doc.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        pages.push({ page: i, text: text.slice(0, 300) });
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
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || 'icit-gamma.vercel.app';
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

        if (isPdf && channelAccessToken && (!fileSize || fileSize <= MAX_INLINE_PDF_BYTES)) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2500);
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
                  `เนื้อหาจากสไลด์ PDF (${numPages} หน้า):\n` +
                  pages.map((p) => `หน้า ${p.page}: ${p.text}`).join('\n');
              }
            }
          } catch (err) {
            console.warn('[LINE PDF Bridge] Skip inline PDF extraction:', err?.message);
          }
        }

        const cleanTitle = fileName.replace(/\.pdf$/i, '').replace(/[_\-]+/g, ' ').trim();
        const syntheticText = extractedSummary
          ? [
              `ผมส่งไฟล์สไลด์ "${fileName}" (pdfId=${messageId})`,
              extractedSummary,
              `ช่วยสรุปบทพูดสั้นๆ กระชับ และส่งลิงก์ซ้อมพรีเซนต์ทันทีในรูปแบบ: ${appBaseUrl}/?pdfId=${messageId}&topic=${cleanTitle.replace(/\s+/g, '_')}&aud=teacher&time=5&s1=... (ตอบกระชับ ไม่เกิน 1200 ตัวอักษร)`,
            ].join('\n')
          : [
              `ผมส่งไฟล์สไลด์ชื่อ "${fileName}" (ขนาด ${(fileSize / (1024 * 1024)).toFixed(1)} MB) เข้ามาครับ`,
              `เนื่องจากไฟล์มีขนาดใหญ่เกินกว่าจะดึงข้อความทั้งหมดในแชทได้ กรุณาตอบกลับสั้นๆ ทักทายและให้ลิงก์เข้าหน้าเว็บเตรียมสไลด์ทันทีในรูปแบบนี้: ${appBaseUrl}/?topic=${cleanTitle.replace(/\s+/g, '_')}&aud=teacher&time=5 พร้อมแนะนำให้ผู้ใช้พิมพ์หัวข้อสั้นๆ หรือส่งรูปหน้าสไลด์มาในแชทเพื่อเขียนบทพูดได้เลยครับ`,
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
