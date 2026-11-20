import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const localPresetStore = new Map([
  [
    'DEMO01',
    {
      presetId: 'DEMO01',
      deckName: 'โปรเจกต์จบ: ระบบ AI โค้ชซ้อมนำเสนออัจฉริยะ (LangMind x ICIT)',
      audience: 'teacher',
      rehearsalMode: 'per_slide',
      timeBudget: { presentMinutes: 5, qaMinutes: 5 },
      slides: [
        {
          id: 1,
          title: 'ที่มาและความสำคัญของปัญหา (Problem Statement)',
          points: [
            'นักศึกษาจบใหม่กว่า 70% มีความกังวลในการนำเสนอและตอบคำถามกรรมการสอบ',
            'การซ้อมพูดคนเดียวไม่สามารถวัดความเร็วการพูด (WPM) เดดแอร์ และการสบตาได้',
            'อาจารย์ที่ปรึกษามีภาระงานสูง ไม่สามารถซ้อมพรีเซนต์ตัวต่อตัวได้บ่อยครั้ง',
          ],
          script:
            'สวัสดีคณะกรรมการทุกท่านครับ โครงงานของพวกเราเริ่มต้นจากปัญหาที่นักศึกษาชั้นปีสุดท้ายส่วนใหญ่ต้องเผชิญ คือแม้จะทำวิจัยหรือพัฒนาระบบมาอย่างดี แต่เมื่อต้องนำเสนอในเวลาจำกัดเพียง 5 ถึง 10 นาที กลับไม่สามารถสรุปประเด็นสำคัญได้ทัน และมักตื่นเต้นจนเกิดเดดแอร์หรือพูดคำฟุ่มเฟือย รวมถึงอาจารย์ที่ปรึกษาแต่ละท่านต้องดูแลนักศึกษาหลายกลุ่ม จึงเป็นเรื่องยากที่จะช่วยซ้อมพรีเซนต์ให้ครบทุกคนครับ',
          text: 'ที่มาและความสำคัญของปัญหา | นักศึกษากังวลการนำเสนอ ซ้อมคนเดียววัดผลไม่ได้ อาจารย์ที่ปรึกษาภาระงานสูง',
        },
        {
          id: 2,
          title: 'แนวคิดและสถาปัตยกรรมระบบ (LangMind + ICIT Rehearsal)',
          points: [
            'ส่งเนื้อหารายงานผ่าน LINE OA ให้ LangMind AI Agent (Pathumma LLM) ช่วยย่อยเป็นสไลด์และบทพูด',
            'อ้างอิงโครงสร้างการเล่าเรื่องและเกณฑ์การให้คะแนนของคณะผ่านระบบ RAG',
            'สร้างลิงก์เชื่อมต่อไปยังเว็บซ้อมพรีเซนต์อัจฉริยะพร้อมโหลดสไลด์และบทพูดอัตโนมัติ',
          ],
          script:
            'เพื่อแก้ปัญหานี้ เราจึงออกแบบเวิร์กโฟลว์ไร้รอยต่อ โดยให้นักศึกษาส่งเนื้อหาโปรเจกต์เข้าทาง LINE Official Account ที่เชื่อมต่อกับ LangMind AI Agent ตัว Agent จะดึงเกณฑ์การประเมินจากฐานความรู้ RAG เพื่อสรุปเนื้อหาเป็นหัวข้อสไลด์ ประเด็นสำคัญ และร่างบทพูดที่พอดีกับเวลา จากนั้นส่งลิงก์กลับมาในแชท LINE พอกดลิงก์ปุ๊บก็จะเข้าสู่หน้าเว็บซ้อมพรีเซนต์พร้อมบทพูดชุดนี้ทันทีครับ',
          text: 'แนวคิดและสถาปัตยกรรมระบบ | ส่งเนื้อหาผ่าน LINE OA ให้ LangMind Agent สรุปสไลด์และบทพูดผ่าน RAG แล้วส่งลิงก์เข้าเว็บซ้อมทันที',
        },
        {
          id: 3,
          title: 'ระบบตรวจจับและวิเคราะห์ผลการซ้อมแบบเรียลไทม์',
          points: [
            'วิเคราะห์เสียงพูด: วัดความเร็ว (คำ/นาที), นับคำติดปาก (Filler Words) และเตือนช่วงเงียบ (Dead Air)',
            'วิเคราะห์ภาษากาย: ใช้ MediaPipe ตรวจจับการสบตากล้อง (Eye Contact) และการก้มอ่านโพย',
            'จำลองห้องสอบจริง: มีระบบสุ่มถามแทรกระหว่างพูด และช่วงกรรมการ AI ถาม-ตอบท้ายการนำเสนอ',
          ],
          script:
            'เมื่อเข้ามาในหน้าเว็บซ้อมพรีเซนต์ ระบบจะทำงานเป็นโค้ชส่วนตัวแบบเรียลไทม์ โดยใช้ไมโครโฟนถอดเสียงพูดภาษาไทยเพื่อวัดความเร็วคำต่อนาที นับคำติดปากอย่างคำว่า เอ่อ อ่า และแจ้งเตือนเมื่อเงียบเกิน 2.5 วินาที พร้อมทั้งใช้กล้องตรวจจับเปอร์เซ็นต์การสบตา นอกจากนี้ยังมีฟีเจอร์จำลองกรรมการสอบสุ่มถามแทรกระหว่างพรีเซนต์และถามตอบช่วงท้ายด้วยเสียง เพื่อให้คุ้นเคยกับแรงกดดันในห้องสอบจริงครับ',
          text: 'ระบบตรวจจับและวิเคราะห์ผลการซ้อม | วัด WPM คำติดปาก เดดแอร์ ตรวจ Eye Contact และจำลอง Q&A',
        },
        {
          id: 4,
          title: 'ผลลัพธ์การทดลองและแนวทางการขยายผล',
          points: [
            'ลดเวลาเตรียมโครงร่างสไลด์และบทพูดของนักศึกษาลงกว่า 70%',
            'ผู้ซ้อมมีค่าเฉลี่ย Eye Contact ดีขึ้น และลดการใช้คำฟุ่มเฟือยลงอย่างชัดเจนหลังซ้อมครบ 3 รอบ',
            'พร้อมขยายผลสู่รายวิชาสัมมนาและโครงงานจบของทุกคณะทั่วประเทศ',
          ],
          script:
            'จากผลการทดลองใช้งานพบว่า นักศึกษาสามารถลดเวลาในการเตรียมโครงสร้างสไลด์และบทพูดลงได้กว่า 70 เปอร์เซ็นต์ และเมื่อได้ซ้อมพูดจริงผ่านระบบครบ 3 รอบ พบว่าความเร็วการพูดอยู่ในเกณฑ์เหมาะสมมากขึ้นและลดคำติดปากลงได้อย่างชัดเจน ระบบนี้สามารถนำไปขยายผลใช้กับทุกคณะและมหาวิทยาลัย รวมถึงการซ้อมขอทุนวิจัยได้ทันที ขอบคุณคณะกรรมการทุกท่านครับ พร้อมรับฟังคำถามครับ',
          text: 'ผลลัพธ์การทดลองและการขยายผล | ลดเวลาเตรียมบทพูด 70% เพิ่มความมั่นใจและขยายผลได้ทุกมหาวิทยาลัย',
        },
      ],
      createdAt: new Date().toISOString(),
    },
  ],
])

function langmindLocalPlugin() {
  return {
    name: 'langmind-local-preset-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/langmind/preset')) {
          return next()
        }

        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method === 'GET') {
          const match = req.url.match(/\/api\/langmind\/preset\/([^/?#]+)/)
          const code = match?.[1]?.toUpperCase()
          const item = code ? localPresetStore.get(code) : null
          if (!item) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ message: 'ไม่พบข้อมูลสไลด์สำหรับรหัสนี้' }))
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(item))
          return
        }

        if (req.method === 'POST') {
          let bodyStr = ''
          req.on('data', (chunk) => {
            bodyStr += chunk
          })
          req.on('end', () => {
            try {
              const body = JSON.parse(bodyStr || '{}')
              const rawSlides = Array.isArray(body.slides) ? body.slides : []
              if (!rawSlides.length) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ message: 'กรุณาส่ง slides อย่างน้อย 1 หน้า' }))
                return
              }
              const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
              let presetId = ''
              for (let i = 0; i < 6; i++) {
                presetId += chars[Math.floor(Math.random() * chars.length)]
              }
              const slides = rawSlides.map((s, idx) => {
                const title = String(s?.title || `สไลด์หน้าที่ ${idx + 1}`).trim()
                const script = String(s?.script || s?.text || '').trim()
                const points = Array.isArray(s?.points)
                  ? s.points.map((p) => String(p).trim()).filter(Boolean)
                  : [title]
                return {
                  id: idx + 1,
                  title,
                  points,
                  script,
                  text: [title, points.join(' | '), script].filter(Boolean).join('\n'),
                }
              })
              const preset = {
                presetId,
                deckName: String(body.deckName || 'สไลด์จาก LangMind AI').trim(),
                audience: body.audience || 'teacher',
                rehearsalMode: body.rehearsalMode === 'full' ? 'continuous' : body.rehearsalMode || 'per_slide',
                timeBudget: {
                  presentMinutes: Number(body.presentMinutes ?? 5),
                  qaMinutes: Number(body.qaMinutes ?? 5),
                },
                slides,
                createdAt: new Date().toISOString(),
              }
              localPresetStore.set(presetId, preset)
              const host = req.headers.host || 'localhost:5173'
              const rehearsalUrl = `http://${host}/?preset=${presetId}`
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(
                JSON.stringify({
                  ok: true,
                  presetId,
                  rehearsalUrl,
                  autoStartUrl: `${rehearsalUrl}&autoStart=1`,
                  slideCount: slides.length,
                }),
              )
            } catch (e) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ message: e.message || 'Invalid JSON' }))
            }
          })
          return
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    langmindLocalPlugin(),
    react(),
    tailwindcss(),
  ],
  build: {
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/group': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
