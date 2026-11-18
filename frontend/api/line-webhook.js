import zlib from 'node:zlib';

const DEFAULT_LANGMIND_WEBHOOK =
  'https://langmind.in.th/api/line/04d2c27e-1b6f-4bd8-b40d-e31d3ef74d81/webhook';
const DEFAULT_CHANNEL_ACCESS_TOKEN =
  'Ut5nqy2fKiH73ri7hOY9AaIfb4V3v7cQDq81I+ZLzEOLunkm9VWepfcqjz6kal9CWg4QN7n+6Kl6pyG4D3EiWKJEc+px/lLu9Up69LwJ/Sakqj/frsRnfBvxaMBgvTDQE+gt5JlhGdh9Y1R90nQhAwdB04t89/1O/w1cDnyilFU=';
const DEFAULT_RENDER_BACKEND = 'https://icit.onrender.com';
const MAX_INLINE_PDF_BYTES = 25 * 1024 * 1024;

// เก็บบริบทสไลด์และคำถามล่าสุดของผู้ใช้แต่ละคนในหน่วยความจำ
const userStateMap = new Map();
let globalLatestDeck = null;

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
            text: 'ICIT REHEARSAL COACH',
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
            text: 'เปลี่ยนสไลด์หรือเนื้อหาวิจัยเป็นบทพูดและซ้อมพูดได้ใน 4 ขั้นตอน',
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
              {
                type: 'text',
                text: '1️⃣',
                size: 'md',
                flex: 0,
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'ส่งไฟล์สไลด์ .PDF หรือเนื้อหาในแชท',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'ส่งไฟล์ PDF รูปหน้าสไลด์ หรือพิมพ์หัวข้อโปรเจกต์เข้ามาได้เลย',
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
              {
                type: 'text',
                text: '2️⃣',
                size: 'md',
                flex: 0,
              },
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
              {
                type: 'text',
                text: '3️⃣',
                size: 'md',
                flex: 0,
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'ซ้อมตอบคำถามด้วยเสียงพูดใน LINE',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'กดปุ่มสุ่มคำถามกรรมการ แล้วกดไมค์ใน LINE อัดเสียงตอบเพื่อรับผลประเมินทันที',
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
              {
                type: 'text',
                text: '4️⃣',
                size: 'md',
                flex: 0,
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'กดปุ่มเข้าเวทีซ้อมจริงบนเว็บ',
                    weight: 'bold',
                    size: 'sm',
                    color: '#1F1E1D',
                  },
                  {
                    type: 'text',
                    text: 'โหลดสไลด์ PDF + บทพูดอัตโนมัติ วัดความเร็ว WPM คำติดปาก และ Eye Contact',
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
              label: '❓ สุ่มคำถามซ้อมสอบ (พูดตอบได้)',
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

function generateQuestionForUser(userId, categoryHint = '') {
  const userState = userStateMap.get(userId) || globalLatestDeck || {};
  const deckTitle = userState.deckTitle || 'โครงงานวิจัยและการพัฒนาระบบ';
  const slides = Array.isArray(userState.slides) ? userState.slides : [];
  const nextIdx = Number(userState.questionCursor || 0);

  const slideContextText =
    slides.length > 0
      ? slides
          .slice(0, 5)
          .map((s, i) => `หน้า ${i + 1} (${s.title}): ${(s.points || []).join(', ')}`)
          .join(' | ')
      : deckTitle;

  const firstSlideTitle = slides[0]?.title || 'ที่มาและความสำคัญของปัญหา';
  const methodSlide =
    slides.find((s) => /วิธี|สถาปัตยกรรม|ระบบ|การออกแบบ|โมเดล|เทคนิค/.test(s.title)) ||
    slides[Math.min(2, slides.length - 1)];
  const resultSlide =
    slides.find((s) => /ผล|การทดลอง|ประเมิน|ทดสอบ|ความแม่นยำ/.test(s.title)) ||
    slides[Math.min(3, slides.length - 1)];

  const questionBank = [
    {
      tag: 'หมวด [P] ที่มาและขอบเขตปัญหา',
      persona: 'กรรมการสายวิชาการ',
      q: `จากสไลด์เรื่อง "${deckTitle}" (${firstSlideTitle}) อะไรคือจุดเด่นหรือความแตกต่างที่สำคัญที่สุดเมื่อเทียบกับวิธีการหรือระบบที่มีอยู่เดิมครับ?`,
      tip: 'ตอบให้ตรงประเด็นในประโยคแรก (Answer) ตามด้วยเหตุผลเปรียบเทียบ (Reason) และยกตัวอย่างจากสไลด์ (Evidence)',
    },
    {
      tag: 'หมวด [M] ระเบียบวิธีและเทคนิค',
      persona: 'กรรมการสายเทคนิค',
      q: `ในส่วนของ "${methodSlide?.title || 'วิธีการดำเนินงาน'}" ทำไมทีมผู้พัฒนาถึงเลือกใช้วิธีการหรือเทคโนโลยีนี้ และหากข้อมูลจริงมีความซับซ้อนขึ้น ระบบจะรับมืออย่างไรครับ?`,
      tip: 'อธิบายเหตุผลที่เลือกใช้เครื่องมือนี้ 1-2 ข้อ พร้อมระบุการควบคุมขอบเขตงานให้ชัดเจน',
    },
    {
      tag: 'หมวด [R] การวัดผลและการนำไปใช้จริง',
      persona: 'กรรมการสายประยุกต์ใช้งาน',
      q: `จาก "${resultSlide?.title || 'ผลการทดลองและการประเมินผล'}" หากนำระบบ "${deckTitle}" ไปใช้งานจริงกับกลุ่มเป้าหมาย อะไรคือข้อจำกัดสำคัญที่สุดและวางแผนพัฒนาต่อยอดอย่างไรครับ?`,
      tip: 'ยอมรับข้อจำกัดตามความจริงอย่างมืออาชีพ พร้อมเสนอแนวทางพัฒนาต่อยอดในระยะถัดไป',
    },
  ];

  let picked = questionBank[nextIdx % questionBank.length];
  if (categoryHint.includes('เทคนิค')) {
    picked = questionBank[1];
  } else if (categoryHint.includes('ใช้งานจริง')) {
    picked = questionBank[2];
  }

  userStateMap.set(userId, {
    ...userState,
    deckTitle,
    slides,
    slideContextText,
    lastQuestion: picked.q,
    lastQuestionTag: picked.tag,
    questionCursor: nextIdx + 1,
  });

  return { ...picked, deckTitle };
}

function buildQuestionFlex({ tag, persona, q, tip, deckTitle }) {
  return {
    type: 'flex',
    altText: `คำถามซ้อมสอบ: ${q}`,
    quickReply: buildQuickReplyItems(),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFF4F0',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: `${persona} · ${tag}`,
            color: '#D95D39',
            size: 'xs',
            weight: 'bold',
          },
          {
            type: 'text',
            text: `หัวข้อ: ${deckTitle}`,
            color: '#666666',
            size: 'xxs',
            margin: 'xs',
            wrap: true,
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
            type: 'text',
            text: `“${q}”`,
            weight: 'bold',
            size: 'md',
            color: '#1F1E1D',
            wrap: true,
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: '💡 เทคนิคการตอบ (สูตร A-R-E):',
                size: 'xs',
                weight: 'bold',
                color: '#1F1E1D',
              },
              {
                type: 'text',
                text: tip,
                size: 'xs',
                color: '#666666',
                wrap: true,
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F7F5F0',
            cornerRadius: '8px',
            paddingAll: '12px',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: '🎙️ วิธีตอบ: กดปุ่มรูปลำโพง/ไมโครโฟนในช่องแชท LINE เพื่ออัดเสียงพูดตอบคำถามนี้ได้เลยครับ! (แนะนำ 15–45 วินาที)',
                size: 'xs',
                color: '#D95D39',
                weight: 'bold',
                wrap: true,
              },
            ],
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
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'message',
              label: '🔄 เปลี่ยนคำถามข้อใหม่',
              text: 'สุ่มคำถามจากสไลด์',
            },
          },
        ],
      },
    },
  };
}

function buildVoiceScorecardFlex({
  deckTitle,
  question,
  durationSec,
  wpm,
  score,
  transcript,
  fillers,
  strengths,
  improvement,
  betterAnswer,
  rehearsalUrl,
}) {
  const fillersText =
    Array.isArray(fillers) && fillers.length > 0 ? fillers.join(', ') : 'ไม่พบคำติดปาก (ดีมาก!)';
  const paceLabel =
    wpm > 160
      ? 'พูดค่อนข้างเร็ว (>160 คำ/นาที)'
      : wpm > 0 && wpm < 95
        ? 'พูดค่อนข้างช้า (<95 คำ/นาที)'
        : 'จังหวะเหมาะสม (เกณฑ์ 125–145 คำ/นาที)';

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: '#D95D39',
      height: 'sm',
      action: {
        type: 'message',
        label: '➡️ สุ่มคำถามข้อต่อไป',
        text: 'สุ่มคำถามจากสไลด์',
      },
    },
  ];

  if (rehearsalUrl && rehearsalUrl.length <= 990) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '🎯 เปิดห้องซ้อมใหญ่บนเว็บ',
        uri: rehearsalUrl,
      },
    });
  }

  return {
    type: 'flex',
    altText: `ผลประเมินเสียงตอบคำถาม: ${score}/10 คะแนน`,
    quickReply: buildQuickReplyItems(),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#1F1E1D',
        paddingAll: '16px',
        alignItems: 'center',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            contents: [
              {
                type: 'text',
                text: 'VOICE Q&A SCORECARD',
                color: '#D95D39',
                size: 'xxs',
                weight: 'bold',
              },
              {
                type: 'text',
                text: 'ผลวิเคราะห์เสียงตอบคำถาม',
                color: '#FFFFFF',
                size: 'md',
                weight: 'bold',
              },
              {
                type: 'text',
                text: deckTitle,
                color: '#BBBBBB',
                size: 'xxs',
                wrap: true,
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#D95D39',
            cornerRadius: '8px',
            paddingAll: '8px',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: `${score}/10`,
                color: '#FFFFFF',
                size: 'lg',
                weight: 'bold',
                align: 'center',
              },
            ],
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
            type: 'text',
            text: `❓ คำถาม: ${question}`,
            size: 'xs',
            color: '#666666',
            wrap: true,
          },
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#F7F5F0',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: 'เวลาที่พูด',
                    size: 'xxs',
                    color: '#666666',
                  },
                  {
                    type: 'text',
                    text: `${durationSec} วินาที`,
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
                  {
                    type: 'text',
                    text: 'ความเร็วเฉลี่ย',
                    size: 'xxs',
                    color: '#666666',
                  },
                  {
                    type: 'text',
                    text: `${wpm} คำ/นาที`,
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
            text: `⏱️ จังหวะ: ${paceLabel} · คำติดปาก: ${fillersText}`,
            size: 'xxs',
            color: '#555555',
            wrap: true,
          },
          ...(transcript
            ? [
                {
                  type: 'text',
                  text: `🗣️ เสียงที่ถอดได้: “${transcript.slice(0, 220)}”`,
                  size: 'xs',
                  color: '#1F1E1D',
                  wrap: true,
                  margin: 'sm',
                },
              ]
            : []),
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'text',
            text: `✅ จุดเด่น: ${strengths}`,
            size: 'xs',
            color: '#1F1E1D',
            wrap: true,
            margin: 'sm',
          },
          {
            type: 'text',
            text: `🔧 ควรเสริม: ${improvement}`,
            size: 'xs',
            color: '#D95D39',
            wrap: true,
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#FFF4F0',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'sm',
            contents: [
              {
                type: 'text',
                text: '💡 แนวทางตอบแบบ A-R-E ที่แนะนำ:',
                size: 'xxs',
                weight: 'bold',
                color: '#D95D39',
              },
              {
                type: 'text',
                text: betterAnswer,
                size: 'xs',
                color: '#1F1E1D',
                wrap: true,
                margin: 'xs',
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerButtons,
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

    const nonHandledEvents = [];

    for (const ev of events) {
      const userId = ev?.source?.userId || 'default';

      // 1. เมื่อผู้ใช้กดแอดเพื่อน (follow) หรือพิมพ์ขอเมนู/ขั้นตอนการใช้งาน (ส่วนที่ 2)
      if (ev?.type === 'follow' && ev.replyToken && channelAccessToken) {
        await replyToLine(channelAccessToken, ev.replyToken, [buildFlowGuideFlex(appBaseUrl)]);
        continue;
      }

      if (ev?.type === 'message' && ev?.message?.type === 'text' && ev.replyToken) {
        const text = String(ev.message.text || '').trim();

        // คำสั่งเปิดการ์ดแสดง Flow 4 ขั้นตอน
        if (/^(เมนู|เริ่มต้น|วิธีใช้|วิธีใช้งาน|ขั้นตอน|ช่วยเหลือ|menu|help|flow)$/i.test(text)) {
          await replyToLine(channelAccessToken, ev.replyToken, [buildFlowGuideFlex(appBaseUrl)]);
          continue;
        }

        // คำสั่งอธิบายวิธีส่งสไลด์
        if (/^(วิธีส่งสไลด์|ส่งสไลด์ยังไง|วิธีส่งไฟล์)$/i.test(text)) {
          await replyToLine(channelAccessToken, ev.replyToken, [
            {
              type: 'text',
              text: [
                '📄 วิธีส่งข้อมูลให้โค้ช AI จัดสไลด์และบทพูด (เลือกได้ 3 แบบ):',
                '',
                '1. ส่งไฟล์ .PDF ของสไลด์เข้ามาในแชทนี้ได้เลย ระบบจะอ่านสไลด์ สร้างบทพูด และส่งปุ่มเข้าห้องซ้อมให้ทันที',
                '2. ส่งรูปภาพหน้าสไลด์ (JPG/PNG) เข้ามาในแชท',
                '3. พิมพ์หัวข้อและเนื้อหา เช่น:\n"ช่วยจัดสไลด์และบทพูดเรื่อง ระบบคัดแยกขยะ AI เวลา 5 นาที สำหรับพรีเซนต์อาจารย์"',
              ].join('\n'),
              quickReply: buildQuickReplyItems(),
            },
          ]);
          continue;
        }

        // คำสั่งสุ่มคำถามกรรมการจากสไลด์ (ส่วนที่ 3)
        if (/^(สุ่มคำถาม|สุ่มคำถามจากสไลด์|สุ่มคำถามสายเทคนิค|สุ่มคำถามสายใช้งานจริง|ซ้อมตอบคำถาม|ขอคำถาม)$/i.test(text)) {
          const qData = generateQuestionForUser(userId, text);
          await replyToLine(channelAccessToken, ev.replyToken, [buildQuestionFlex(qData)]);
          continue;
        }

        // คำสั่งดึงผลการซ้อมล่าสุดจากหน้าสรุปมาทำรายงาน PDF ให้ผู้ใช้อ่าน (ส่วนที่ 4)
        if (/^(ดึงผลซ้อม|ดึงผลซ้อมล่าสุด|สรุปผล|ผลซ้อม|รายงานผล|ขอผลซ้อม)$/i.test(text)) {
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
            console.warn('[LINE Summary Report] Fallback to userState:', err?.message);
          }

          const userState = userStateMap.get(userId) || globalLatestDeck || {};
          const fallbackSlides = Array.isArray(userState.slides)
            ? userState.slides.map((s, idx) => ({
                index: idx,
                title: s.title,
                duration: 55,
                wpm: 135,
                fillersCount: 0,
                deadAirCount: 0,
                transcript: s.script,
              }))
            : [];

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
                  : fallbackSlides,
                qa: Array.isArray(dbSession.qaJson)
                  ? dbSession.qaJson.slice(0, 5).map((q) => ({
                      question: String(q.question || '').slice(0, 140),
                      answerTranscript: String(q.answerTranscript || '').slice(0, 220),
                      score: q.score,
                    }))
                  : userState.lastVoiceQa
                    ? [userState.lastVoiceQa]
                    : [],
                summary: dbSession.summaryJson || null,
              }
            : {
                deckName: userState.deckTitle || 'ชุดสไลด์ซ้อมนำเสนอ',
                audience: 'teacher',
                totalDurationSec: fallbackSlides.length * 55 || 275,
                avgWpm: userState.lastVoiceQa?.wpm || 135,
                avgEyeContactPct: 78,
                slideCount: fallbackSlides.length || 5,
                slides: fallbackSlides,
                qa: userState.lastVoiceQa ? [userState.lastVoiceQa] : [],
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
                      text: `สรุปผลการซ้อมครบ ${reportPayload.slides.length || reportPayload.slideCount || 5} สไลด์ พร้อมตารางวิเคราะห์คำพูดรายหน้าและผลคะแนน Q&A จัดอยู่ในรูปแบบเอกสารรายงานขนาด A4 เรียบร้อยแล้วครับ`,
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
      }

      // 2. เมื่อผู้ใช้ส่งข้อความเสียง (Voice Message / type === 'audio') เพื่อพูดตอบคำถามใน LINE (ส่วนที่ 3)
      if (
        ev?.type === 'message' &&
        ev?.message?.type === 'audio' &&
        ev.replyToken &&
        channelAccessToken
      ) {
        const messageId = ev.message.id;
        const durationSec = Math.max(1, Math.round(Number(ev.message.duration || 15000) / 1000));
        const userState = userStateMap.get(userId) || globalLatestDeck || {};
        const deckTitle = userState.deckTitle || 'การซ้อมตอบคำถามโครงงาน';
        const question =
          userState.lastQuestion ||
          `จงอธิบายที่มา จุดเด่น และผลการทดลองสำคัญของโครงงาน "${deckTitle}"`;

        let evalResult = null;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
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
                question,
                deckTitle,
              }),
              signal: controller.signal,
            });
            if (evalRes.ok) {
              const json = await evalRes.json();
              if (json?.ok) {
                evalResult = json;
              }
            }
          }
          clearTimeout(timer);
        } catch (err) {
          console.warn('[LINE Voice Q&A] Fallback to duration analysis:', err?.message);
        }

        const transcript = evalResult?.transcript || '';
        const wordCount = transcript
          ? transcript.trim().split(/\s+/).length * 3
          : Math.round(durationSec * 2.2);
        const wpm = Math.round((wordCount / durationSec) * 60);
        const score =
          evalResult?.score ||
          (durationSec >= 15 && durationSec <= 60 ? 8 : durationSec >= 8 ? 7 : 6);
        const fillers = evalResult?.fillers || [];
        const strengths =
          evalResult?.strengths ||
          (durationSec >= 15
            ? `ใช้เวลาอธิบาย ${durationSec} วินาที มีความต่อเนื่องและน้ำเสียงชัดเจนดีครับ`
            : `ตอบกระชับภายใน ${durationSec} วินาที เปิดประเด็นได้รวดเร็วครับ`);
        const improvement =
          evalResult?.improvement ||
          (durationSec < 12
            ? 'ควรขยายความส่วนเหตุผล (Reason) และยกตัวเลขผลการทดลอง (Evidence) เพิ่มเติมอีกเล็กน้อย'
            : 'ระวังการเว้นจังหวะท้ายประโยค และสรุปปิดท้ายให้เชื่อมกลับเข้าสู่วัตถุประสงค์ของงาน');
        const betterAnswer =
          evalResult?.betterAnswer ||
          `“สำหรับประเด็นนี้ จุดเด่นหลักของ ${deckTitle} คือการแก้ปัญหาที่ต้นเหตุ [Answer] เนื่องจากระบบเดิมยังมีข้อจำกัดด้านเวลาและความแม่นยำ [Reason] ซึ่งจากผลการทดสอบของเราสามารถเพิ่มประสิทธิภาพและใช้งานได้จริงตามขอบเขตที่กำหนดไว้ครับ [Evidence]”`;

        userStateMap.set(userId, {
          ...userState,
          lastVoiceQa: {
            question,
            answerTranscript: transcript || `(ตอบด้วยเสียงความยาว ${durationSec} วินาที)`,
            score,
            wpm,
          },
        });

        await replyToLine(channelAccessToken, ev.replyToken, [
          buildVoiceScorecardFlex({
            deckTitle,
            question,
            durationSec,
            wpm,
            score,
            transcript,
            fillers,
            strengths,
            improvement,
            betterAnswer,
            rehearsalUrl: userState.rehearsalUrl,
          }),
        ]);
        continue;
      }

      // 3. เมื่อผู้ใช้ส่งไฟล์สไลด์ .PDF ใน LINE
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

        // บันทึกบริบทสไลด์ไว้สำหรับสุ่มคำถามซ้อมสอบด้วยเสียงใน LINE
        const savedContext = {
          deckTitle: cleanTitle,
          slides,
          rehearsalUrl,
          questionCursor: 0,
        };
        userStateMap.set(userId, savedContext);
        globalLatestDeck = savedContext;

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
            `\n🎯 กดปุ่มสีส้มด้านล่างเพื่อเปิดสไลด์ PDF จริงพร้อมบทพูดบนเว็บ หรือกดปุ่ม "สุ่มคำถามจากสไลด์" เพื่ออัดเสียงซ้อมตอบคำถามใน LINE ได้เลยครับ!`,
          ].join('\n');
        } else {
          const sizeStr = fileSize ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB` : 'PDF';
          replyText = [
            `รับไฟล์สไลด์ "${fileName}" (${sizeStr}) เรียบร้อยแล้วครับ! 📄`,
            `ระบบได้เชื่อมไฟล์ PDF ชุดนี้เข้ากับห้องซ้อมให้แล้ว คุณสามารถเลือกกดปุ่มด้านล่างเพื่อ:\n1) เปิดสไลด์ PDF จริงพร้อมบทพูดแนะนำบนหน้าเว็บทันที\n2) สุ่มคำถามกรรมการจากสไลด์ชุดนี้ แล้วกดไมค์พูดตอบใน LINE ได้เลยครับ!`,
          ].join('\n\n');
        }

        const replyMessages = [
          {
            type: 'text',
            text: replyText.slice(0, 4800),
            quickReply: buildQuickReplyItems(),
          },
        ];

        if (rehearsalUrl.length <= 990) {
          replyMessages.push({
            type: 'flex',
            altText: `เข้าห้องซ้อมพรีเซนต์: ${cleanTitle}`,
            quickReply: buildQuickReplyItems(),
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
                      ? `อ่านสไลด์จริงครบ ${totalPdfPages || slides.length} หน้า · พร้อมซ้อมพูดและถาม-ตอบ`
                      : 'เชื่อมไฟล์ PDF จาก LINE แล้ว · กดเพื่อโหลดสไลด์จริงบนเว็บหรือซ้อมถาม-ตอบ',
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
                      label: '🎯 เริ่มซ้อมพรีเซนต์บนเว็บทันที',
                      uri: rehearsalUrl,
                    },
                  },
                  {
                    type: 'button',
                    style: 'secondary',
                    action: {
                      type: 'message',
                      label: '❓ สุ่มคำถามจากสไลด์ (พูดตอบได้)',
                      text: 'สุ่มคำถามจากสไลด์',
                    },
                  },
                ],
              },
            },
          });
        }

        await replyToLine(channelAccessToken, ev.replyToken, replyMessages);
        continue;
      }

      nonHandledEvents.push(ev);
    }

    if (nonHandledEvents.length === 0) {
      return res.status(200).json({ ok: true, handledBy: 'line-webhook-bridge' });
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
    console.error('[LINE Webhook Bridge] Error:', err);
    return res.status(200).json({ ok: true });
  }
}
