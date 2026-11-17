import crypto from 'node:crypto';

const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';

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
    const maxPages = Math.min(doc.numPages, 20);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push({ page: i, text: text || `(สไลด์หน้าที่ ${i} เป็นภาพกราฟิก)` });
    }
    return { numPages: doc.numPages, pages };
  } catch (err) {
    console.warn('[LINE PDF Bridge] pdfjs extract fallback:', err?.message);
    return { numPages: 1, pages: [] };
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
      ''
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
    // กรณี LINE กดปุ่ม Verify Webhook (events ว่าง)
    if (events.length === 0) {
      return res.status(200).json({ ok: true, verified: true });
    }

    let modified = false;
    const nextEvents = [];

    for (const ev of events) {
      const isPdfFile =
        ev?.type === 'message' &&
        ev?.message?.type === 'file' &&
        String(ev?.message?.fileName || '')
          .toLowerCase()
          .endsWith('.pdf');

      if (isPdfFile && channelAccessToken) {
        modified = true;
        const messageId = ev.message.id;
        const fileName = ev.message.fileName || 'slides.pdf';
        let extractedSummary = '';

        try {
          const contentRes = await fetch(
            `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
            {
              headers: {
                Authorization: `Bearer ${channelAccessToken}`,
              },
            },
          );
          if (contentRes.ok) {
            const arrayBuf = await contentRes.arrayBuffer();
            const { numPages, pages } = await extractPdfPagesText(Buffer.from(arrayBuf));
            if (pages.length > 0) {
              extractedSummary =
                `จำนวนทั้งหมด ${numPages} หน้า:\n` +
                pages.map((p) => `หน้าที่ ${p.page}: ${p.text}`).join('\n');
            }
          }
        } catch (err) {
          console.warn('[LINE PDF Bridge] Failed to fetch/parse PDF from LINE:', err?.message);
        }

        const syntheticText = [
          `ผมส่งไฟล์สไลด์ PDF ชื่อ "${fileName}" (รหัสไฟล์ pdfId=${messageId})`,
          extractedSummary
            ? `เนื้อหาที่ดึงได้จากสไลด์ PDF:\n${extractedSummary}`
            : `กรุณาช่วยจัดโครงสร้างสไลด์และร่างบทพูดสำหรับไฟล์ ${fileName}`,
          `\n[คำสั่งสำคัญ: กรุณาสรุปสไลด์และร่างบทพูดให้ครบทุกหน้า พร้อมสร้างลิงก์เข้าซ้อมพรีเซนต์ทันทีในข้อความนี้เลย โดยต้องใส่ pdfId=${messageId} ลงในลิงก์ด้วยตามรูปแบบนี้: https://icit-gamma.vercel.app/?pdfId=${messageId}&topic=ชื่อเรื่อง&aud=teacher&time=5&s1=หัวข้อหน้า1:ประเด็น1,ประเด็น2|บทพูดหน้า1&s2=หัวข้อหน้า2:ประเด็น1,ประเด็น2|บทพูดหน้า2 ]`,
        ].join('\n\n');

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
