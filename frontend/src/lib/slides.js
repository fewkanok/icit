import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const isPdf = (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
const isImage = (f) => f.type.startsWith('image/');

/**
 * แปลงไฟล์ที่ผู้ใช้เลือกเป็นรายการสไลด์ { id, src, text }
 * - PDF 1 ไฟล์ → แยกเป็นหน้า (render เป็นรูป + ดึงข้อความในหน้า)
 * - รูปหลายรูป → 1 รูป = 1 สไลด์ เรียงตามชื่อไฟล์
 * ทุกอย่างทำในเบราว์เซอร์ ไม่ได้ส่งไฟล์ออกไปไหน
 */
export async function filesToSlides(files, onProgress) {
  const pdf = files.find(isPdf);
  if (pdf) return pdfToSlides(pdf, onProgress);

  const images = files
    .filter(isImage)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (images.length === 0) throw new Error('รองรับเฉพาะไฟล์ PDF หรือรูปภาพ (PNG, JPG)');

  return images.map((file, i) => ({ id: i + 1, src: URL.createObjectURL(file), text: '' }));
}

async function pdfToSlides(file, onProgress) {
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const slides = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;

    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();

    slides.push({ id: n, src: canvas.toDataURL('image/jpeg', 0.85), text });
    onProgress?.(n, doc.numPages);
  }
  return slides;
}

export const SAMPLE_DECK = {
  name: 'สไลด์แนะนำตัว (2 หน้า)',
  slides: [
    {
      id: 1,
      title: 'แนะนำตัว & ประวัติการศึกษา',
      points: [
        'ชื่อ - นามสกุล (ชื่อเล่น) และอายุ',
        'การศึกษา: คณะ / สาขา / สถาบันการศึกษา',
        'จุดเด่นหรือนิยามความเป็นตัวเอง 1 ประโยค',
      ],
    },
    {
      id: 2,
      title: 'ทักษะ & เป้าหมายในอนาคต',
      points: [
        'ทักษะเด่นหรือสิ่งที่คุณสนใจเป็นพิเศษ (เช่น เขียนโค้ด, ออกแบบ, กิจกรรม)',
        'เป้าหมายที่อยากพัฒนา หรือสิ่งที่อยากทำต่อไปในอนาคต',
        'กล่าวขอบคุณผู้ฟัง และพร้อมตอบคำถาม',
      ],
    },
  ],
};
