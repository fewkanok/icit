import zlib from 'node:zlib';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const hostHeader =
    req.headers['x-forwarded-host'] || req.headers.host || 'icit-gamma.vercel.app';
  const appBaseUrl = `https://${hostHeader}`;

  if (req.method !== 'POST') {
    return res.status(200).json({
      ok: true,
      service: 'ICIT Vercel Preset Link Builder',
      endpoint: `${appBaseUrl}/api/preset`,
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const rawSlides = Array.isArray(body.slides) ? body.slides : [];
    if (rawSlides.length === 0) {
      return res.status(400).json({ message: 'กรุณาส่งรายการสไลด์ (slides) อย่างน้อย 1 หน้า' });
    }

    const deckName = String(body.deckName || body.title || body.topic || 'สไลด์จาก LangMind AI')
      .trim()
      .slice(0, 150);
    const audience = ['teacher', 'executive', 'general'].includes(body.audience)
      ? body.audience
      : 'teacher';
    const rehearsalMode =
      body.rehearsalMode === 'full' || body.rehearsalMode === 'continuous'
        ? 'continuous'
        : 'per_slide';
    const presentMinutes = Number(body.presentMinutes ?? 5) || 5;
    const qaMinutes = Number(body.qaMinutes ?? 5) || 5;

    const slides = rawSlides.slice(0, 15).map((s, idx) => ({
      t: String(s?.title || `สไลด์หน้าที่ ${idx + 1}`).trim().slice(0, 120),
      p: (Array.isArray(s?.points) ? s.points : [s?.title || `หน้า ${idx + 1}`])
        .map((pt) => String(pt || '').trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 5),
      s: String(s?.script || s?.text || '').trim().slice(0, 800),
    }));

    const compactPayload = {
      n: deckName,
      a: audience,
      m: rehearsalMode,
      pm: presentMinutes,
      qm: qaMinutes,
      ...(body.pdfId ? { pdfId: String(body.pdfId) } : {}),
      sl: slides,
    };

    const compressedBytes = zlib.deflateRawSync(
      Buffer.from(JSON.stringify(compactPayload), 'utf8'),
    );
    const encodedZ = compressedBytes.toString('base64url');
    const fullRehearsalUrl = `${appBaseUrl}/?z=${encodedZ}`;

    // ย่อลิงก์ให้สั้นกระชับอัตโนมัติ (Fallback เป็น fullRehearsalUrl หากเกิน 2.5 วินาที)
    let shortUrl = fullRehearsalUrl;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const tinyRes = await fetch(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(fullRehearsalUrl)}`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      if (tinyRes.ok) {
        const text = (await tinyRes.text()).trim();
        if (text.startsWith('http')) {
          shortUrl = text;
        }
      }
    } catch {
      // ใช้ fullRehearsalUrl แทนได้ทันที
    }

    return res.status(200).json({
      ok: true,
      deckName,
      slideCount: slides.length,
      rehearsalUrl: shortUrl,
      fullRehearsalUrl,
      message: `สร้างลิงก์เข้าห้องซ้อมสำเร็จ: ${shortUrl}`,
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      message: err?.message || 'ข้อมูล JSON ไม่ถูกต้อง',
    });
  }
}
