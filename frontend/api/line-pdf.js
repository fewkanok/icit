export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const urlObj = new URL(req.url, `https://${req.headers.host || 'icit-gamma.vercel.app'}`);
  const messageId = (urlObj.searchParams.get('id') || '').trim();
  const token = (
    urlObj.searchParams.get('token') ||
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    ''
  ).trim();

  if (!messageId || !/^[A-Za-z0-9_-]+$/.test(messageId)) {
    return res.status(400).json({ message: 'รหัสไฟล์ PDF ไม่ถูกต้อง' });
  }

  if (!token) {
    return res.status(400).json({
      message: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN บน Vercel',
    });
  }

  try {
    const lineRes = await fetch(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!lineRes.ok) {
      return res.status(lineRes.status).json({
        message: 'ไม่สามารถดึงไฟล์ PDF จาก LINE ได้ (ไฟล์อาจหมดอายุแล้ว)',
      });
    }

    const arrayBuf = await lineRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({
      message: err?.message || 'เกิดข้อผิดพลาดในการดึงไฟล์ PDF จาก LINE',
    });
  }
}
