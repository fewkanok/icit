const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';
const DEFAULT_CHANNEL_ACCESS_TOKEN =
  'Ut5nqy2fKiH73ri7hOY9AaIfb4V3v7cQDq81I+ZLzEOLunkm9VWepfcqjz6kal9CWg4QN7n+6Kl6pyG4D3EiWKJEc+px/lLu9Up69LwJ/Sakqj/frsRnfBvxaMBgvTDQE+gt5JlhGdh9Y1R90nQhAwdB04t89/1O/w1cDnyilFU=';
const MAX_INLINE_PDF_BYTES = 12 * 1024 * 1024;

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

function toUrlSafeSlug(text) {
  return String(text || '')
    .replace(/[|:,?&=#%+]/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
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
    const maxPages = Math.min(doc.numPages, 8);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push({
        page: i,
        text: text.slice(0, 260),
      });
    }
    return { numPages: doc.numPages, pages };
  } catch (err) {
    console.warn('[LINE PDF Bridge] pdfjs extract fallback:', err?.message);
    return { numPages: 0, pages: [] };
  }
}

function buildSlidesFromPdfOrTopic(cleanTitle, pages) {
  const validPages = pages.filter((p) => p.text && p.text.length > 3);
  if (validPages.length > 0) {
    return validPages.map((p, idx) => {
      const sentences = p.text
        .split(/(?<=[.!?])\s+|\s{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
      const title = (sentences[0] || `สไลด์หน้าที่ ${idx + 1}`).slice(0, 60);
      const points =
        sentences.slice(1, 4).length > 0
          ? sentences.slice(1, 4).map((s) => s.slice(0, 70))
          : [p.text.slice(0, 80)];
      const script = `สำหรับสไลด์หน้าที่ ${idx + 1} หัวข้อ ${title} ประเด็นสำคัญคือ ${p.text.slice(0, 220)} ครับ`;
      return { title, points, script };
    });
  }

  // กรณีไฟล์ PDF เป็นภาพสแกนหรือขนาดใหญ่เกิน 12MB ให้สร้างโครงสร้างสไลด์มาตรฐาน 5 หน้าตามชื่อไฟล์ทันที
  return [
    {
      title: `ที่มาและความสำคัญ (${cleanTitle})`,
      points: [
        'สภาพปัญหาปัจจุบันและเหตุผลที่ต้องพัฒนาโครงงานนี้',
        'ช่องว่างของระบบเดิมและโอกาสในการนำเทคโนโลยีมาช่วย',
        'ประโยชน์ที่คาดว่าจะได้รับจากโครงงาน',
      ],
      script: `สวัสดีคณะกรรมการทุกท่านครับ วันนี้พวกเราขอนำเสนอโครงงานเรื่อง ${cleanTitle} โดยเริ่มต้นจากปัญหาสำคัญที่เราพบในปัจจุบัน และเหตุผลที่ต้องพัฒนาโซลูชันนี้ขึ้นมาแก้ไขครับ`,
    },
    {
      title: 'วัตถุประสงค์และขอบเขตของโครงงาน',
      points: [
        'วัตถุประสงค์หลักของการพัฒนาและวิจัย',
        'ขอบเขตด้านระบบ กลุ่มเป้าหมาย และข้อมูลที่ใช้ทดสอบ',
        'ตัวชี้วัดความสำเร็จของโครงงาน',
      ],
      script: `สำหรับวัตถุประสงค์หลักของโครงงาน ${cleanTitle} คือการพัฒนาระบบที่ตอบโจทย์ผู้ใช้งานจริงภายใต้ขอบเขตและตัวชี้วัดที่เราได้กำหนดไว้อย่างชัดเจนครับ`,
    },
    {
      title: 'สถาปัตยกรรมระบบและวิธีการดำเนินงาน',
      points: [
        'ขั้นตอนการทำงานตั้งแต่รับข้อมูลจนถึงการประมวลผล',
        'เครื่องมือ เทคโนโลยี และทฤษฎีที่เลือกใช้',
        'การออกแบบส่วนติดต่อผู้ใช้และการเชื่อมต่อระบบ',
      ],
      script: `ในส่วนของวิธีการดำเนินงาน เราได้ออกแบบสถาปัตยกรรมระบบให้ทำงานเป็นลำดับขั้น ตั้งแต่การรับข้อมูล ประมวลผล ไปจนถึงการแสดงผลลัพธ์อย่างมีประสิทธิภาพครับ`,
    },
    {
      title: 'ผลการทดลองและการประเมินประสิทธิภาพ',
      points: [
        'ผลการทดสอบการทำงานจริงเทียบกับเกณฑ์ที่ตั้งไว้',
        'การวิเคราะห์ความแม่นยำและความเร็วในการประมวลผล',
        'สรุปความพึงพอใจและผลกระทบจากการใช้งาน',
      ],
      script: `จากผลการทดลองและประเมินประสิทธิภาพ พบว่าระบบสามารถทำงานได้ตรงตามวัตถุประสงค์ที่ตั้งไว้ และช่วยลดเวลาการทำงานลงได้อย่างชัดเจนครับ`,
    },
    {
      title: 'สรุปผล ข้อจำกัด และแนวทางการพัฒนาต่อยอด',
      points: [
        'สรุปผลสำเร็จตามวัตถุประสงค์ของโครงงาน',
        'ข้อจำกัดที่พบระหว่างการพัฒนาและทดสอบจริง',
        'แนวทางการขยายผลและพัฒนาต่อยอดในอนาคต',
      ],
      script: `โดยสรุป โครงงาน ${cleanTitle} สามารถตอบโจทย์ปัญหาที่ตั้งไว้ได้ครบถ้วน และพร้อมนำไปพัฒนาต่อยอดขยายผลในอนาคต ขอบคุณคณะกรรมการทุกท่านครับ พร้อมรับฟังคำถามครับ`,
    },
  ];
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
        const cleanTitle = fileName.replace(/\.pdf$/i, '').replace(/[_\-]+/g, ' ').trim() || 'สไลด์นำเสนอ';

        let extractedPages = [];
        if (isPdf && (!fileSize || fileSize <= MAX_INLINE_PDF_BYTES)) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3500);
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
              const { pages } = await extractPdfPagesText(Buffer.from(arrayBuf));
              extractedPages = pages;
            }
          } catch (err) {
            console.warn('[LINE PDF Bridge] Skip inline PDF extraction:', err?.message);
          }
        }

        const slides = buildSlidesFromPdfOrTopic(cleanTitle, extractedPages);
        const slideParams = slides
          .map((s, idx) => {
            const t = toUrlSafeSlug(s.title);
            const pts = s.points.map((p) => toUrlSafeSlug(p)).join(',');
            const sc = toUrlSafeSlug(s.script);
            return `s${idx + 1}=${t}:${pts}|${sc}`;
          })
          .join('&');

        const pdfParam = isPdf && (!fileSize || fileSize <= 35 * 1024 * 1024) ? `pdfId=${messageId}&` : '';
        const rehearsalUrl = `${appBaseUrl}/?${pdfParam}topic=${toUrlSafeSlug(cleanTitle)}&aud=teacher&time=5&${slideParams}`;

        const slideLines = slides
          .map(
            (s, i) =>
              `📌 หน้าที่ ${i + 1}: ${s.title}\n• ประเด็น: ${s.points.join(' / ')}\n🎙️ บทพูด: "${s.script}"`,
          )
          .join('\n\n');

        const sizeNote =
          fileSize > MAX_INLINE_PDF_BYTES
            ? `\n\n💡 หมายเหตุ: ไฟล์ "${fileName}" มีขนาดใหญ่ (${(fileSize / (1024 * 1024)).toFixed(1)} MB) เมื่อกดลิงก์เข้าหน้าเว็บแล้ว คุณสามารถลากไฟล์ PDF นี้วางในช่องอัปโหลดบนเว็บเพื่อแสดงภาพสไลด์จริงคู่กับบทพูดชุดนี้ได้ทันทีครับ!`
            : '';

        const replyText = [
          `รับไฟล์สไลด์ "${fileName}" เรียบร้อยแล้วครับ! ผมจัดโครงสร้างสไลด์ (${slides.length} หน้า) พร้อมร่างบทพูดแนะนำสำหรับการนำเสนอ (เวลา 5 นาที) ให้ดังนี้ครับ:\n`,
          slideLines,
          `\n🎯 กดลิงก์ด้านล่างเพื่อเข้าห้องซ้อมพรีเซนต์พร้อมสไลด์และบทพูดชุดนี้ได้ทันทีครับ:\n👉 ${rehearsalUrl}`,
          sizeNote,
        ]
          .filter(Boolean)
          .join('\n');

        await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${channelAccessToken}`,
          },
          body: JSON.stringify({
            replyToken: ev.replyToken,
            messages: [
              {
                type: 'text',
                text: replyText.slice(0, 4900),
              },
            ],
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
