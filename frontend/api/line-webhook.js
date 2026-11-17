import zlib from 'node:zlib';

const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';
const DEFAULT_CHANNEL_ACCESS_TOKEN =
  'Ut5nqy2fKiH73ri7hOY9AaIfb4V3v7cQDq81I+ZLzEOLunkm9VWepfcqjz6kal9CWg4QN7n+6Kl6pyG4D3EiWKJEc+px/lLu9Up69LwJ/Sakqj/frsRnfBvxaMBgvTDQE+gt5JlhGdh9Y1R90nQhAwdB04t89/1O/w1cDnyilFU=';
const MAX_INLINE_PDF_BYTES = 25 * 1024 * 1024;

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
        pages.push({
          page: i,
          text: text.slice(0, 240),
        });
      }
    }
    return { numPages: doc.numPages, pages };
  } catch (err) {
    console.warn('[LINE PDF Bridge] pdfjs extract fallback:', err?.message);
    return { numPages: 0, pages: [] };
  }
}

function buildSlidesFromExtractedPages(pages) {
  const validPages = pages.filter((p) => p.text && p.text.length > 2);
  if (validPages.length === 0) {
    return { isCustom: false, slides: [] };
  }

  return {
    isCustom: true,
    slides: validPages.map((p, idx) => {
      const sentences = p.text
        .split(/(?<=[.!?])\s+|\s{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
      const title = (sentences[0] || `สไลด์หน้าที่ ${p.page || idx + 1}`).slice(0, 70);
      const points =
        sentences.slice(1, 4).length > 0
          ? sentences.slice(1, 4).map((s) => s.slice(0, 80))
          : [p.text.slice(0, 90)];
      const script =
        idx === 0
          ? `สวัสดีคณะกรรมการทุกท่านครับ สำหรับสไลด์แรก หัวข้อ ${title} เนื้อหาสำคัญคือ ${p.text.slice(0, 200)} ครับ`
          : `ในสไลด์หน้าที่ ${p.page || idx + 1} หัวข้อ ${title} ประเด็นสำคัญคือ ${p.text.slice(0, 200)} ครับ`;
      return { title, points, script };
    }),
  };
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
    const hostHeader =
      req.headers['x-forwarded-host'] || req.headers.host || 'icit-gamma.vercel.app';
    const appBaseUrl = `https://${hostHeader}`;
    const urlObj = new URL(req.url, appBaseUrl);

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

    const nonFileEvents = [];

    for (const ev of events) {
      const isFileMessage = ev?.type === 'message' && ev?.message?.type === 'file';

      if (isFileMessage && ev.replyToken && channelAccessToken) {
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
            const timer = setTimeout(() => controller.abort(), 5500);
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
              extractedPages = pages;
              totalPdfPages = numPages;
            }
          } catch (err) {
            console.warn('[LINE PDF Bridge] Skip inline PDF extraction:', err?.message);
          }
        }

        const { isCustom, slides } = buildSlidesFromExtractedPages(extractedPages);

        // แนบ pdfId ลงไปในลิงก์เสมอ เพื่อให้หน้าเว็บดึงไฟล์ PDF จริงจาก LINE ไปแปลงเป็นภาพสไลด์และดึงข้อความทุกหน้าอัตโนมัติ
        const compactPayload = isCustom
          ? {
              n: cleanTitle,
              a: 'teacher',
              m: 'per_slide',
              pm: 5,
              qm: 5,
              pdfId: messageId,
              sl: slides.map((s) => ({
                t: s.title,
                p: s.points,
                s: s.script,
              })),
            }
          : {
              n: cleanTitle,
              a: 'teacher',
              m: 'per_slide',
              pm: 5,
              qm: 5,
              pdfId: messageId,
              auto: 1,
            };

        const compressedBytes = zlib.deflateRawSync(
          Buffer.from(JSON.stringify(compactPayload), 'utf8'),
        );
        const encodedZ = compressedBytes.toString('base64url');
        const rehearsalUrl = `${appBaseUrl}/?z=${encodedZ}`;

        let replyText = '';
        if (isCustom) {
          const slideLines = slides
            .map(
              (s, i) =>
                `📌 หน้าที่ ${i + 1}: ${s.title}\n• ประเด็น: ${s.points.join(' / ')}\n🎙️ บทพูด: "${s.script}"`,
            )
            .join('\n\n');
          replyText = [
            `อ่านไฟล์สไลด์ "${fileName}" (${totalPdfPages || slides.length} หน้า) เรียบร้อยแล้วครับ! สรุปประเด็นและบทพูดจากเนื้อหาจริงในสไลด์ของคุณได้ดังนี้ครับ:\n`,
            slideLines,
            `\n🎯 กดปุ่มสีส้มด้านล่าง (หรือลิงก์นี้) เพื่อเปิดสไลด์ PDF จริงพร้อมบทพูดบนเว็บได้ทันที:\n${rehearsalUrl}`,
          ].join('\n');
        } else {
          const sizeStr = fileSize ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB` : 'PDF';
          replyText = [
            `รับไฟล์สไลด์ "${fileName}" (${sizeStr}) เรียบร้อยแล้วครับ! 📄`,
            `ระบบได้เชื่อมไฟล์ PDF ชุดนี้เข้ากับห้องซ้อมบนเว็บให้โดยตรงแล้ว เมื่อคุณกดปุ่ม "เริ่มซ้อมพรีเซนต์ทันที" ด้านล่าง หน้าเว็บจะดึงไฟล์สไลด์ PDF ของคุณไปเปิดแสดงผลทุกหน้า พร้อมสร้างบทพูดแนะนำจากเนื้อหาในแต่ละหน้าให้อัตโนมัติทันทีครับ:\n${rehearsalUrl}`,
          ].join('\n\n');
        }

        const replyMessages = [
          {
            type: 'text',
            text: replyText.slice(0, 4800),
          },
        ];

        if (rehearsalUrl.length <= 990) {
          replyMessages.push({
            type: 'flex',
            altText: `เข้าห้องซ้อมพรีเซนต์: ${cleanTitle}`,
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
                    text: cleanTitle,
                    weight: 'bold',
                    size: 'lg',
                    wrap: true,
                  },
                  {
                    type: 'text',
                    text: isCustom
                      ? `อ่านสไลด์จริงครบ ${totalPdfPages || slides.length} หน้า · พร้อมบทพูดและไฟล์ PDF`
                      : 'เชื่อมไฟล์ PDF จาก LINE แล้ว · กดเพื่อโหลดสไลด์จริงบนเว็บทันที',
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
                      label: 'เริ่มซ้อมพรีเซนต์ทันที',
                      uri: rehearsalUrl,
                    },
                  },
                ],
              },
            },
          });
        }

        await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${channelAccessToken}`,
          },
          body: JSON.stringify({
            replyToken: ev.replyToken,
            messages: replyMessages,
          }),
        }).catch((err) => {
          console.error('[LINE PDF Bridge] Direct reply failed:', err?.message);
        });
      } else {
        nonFileEvents.push(ev);
      }
    }

    if (nonFileEvents.length === 0) {
      return res.status(200).json({ ok: true, handledBy: 'line-pdf-bridge' });
    }

    const signature = req.headers['x-line-signature'] || '';
    const forwardRes = await fetch(langmindWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'x-line-signature': signature } : {}),
      },
      body: rawBuffer,
    });

    const respText = await forwardRes.text().catch(() => '');
    return res.status(200).send(respText || 'OK');
  } catch (err) {
    console.error('[LINE PDF Bridge] Error:', err);
    return res.status(200).json({ ok: true });
  }
}
