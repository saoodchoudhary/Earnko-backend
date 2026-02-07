const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { adminAuth } = require('../../middleware/auth');
const HomepageBanner = require('../../models/HomepageBanner');

const router = express.Router();

// Multer setup (same style as stores logo upload)
const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'banner', ext).replace(/\s+/g, '-').slice(0, 40);
    const stamp = Date.now();
    cb(null, `${base}-${stamp}${ext || '.png'}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // ~3MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Only image files allowed'));
    cb(null, true);
  }
});

// GET /api/admin/banners
router.get('/', adminAuth, async (_req, res) => {
  try {
    const items = await HomepageBanner.find({}).sort({ sortOrder: 1, updatedAt: -1 }).lean();
    res.json({ success: true, data: { items } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/admin/banners  (create banner WITHOUT image first OR with imageUrl placeholder)
router.post('/', adminAuth, async (req, res) => {
  try {
    const payload = {
      title: req.body?.title || '',
      subtitle: req.body?.subtitle || '',
      linkUrl: req.body?.linkUrl || '',
      buttonText: req.body?.buttonText || 'Shop Now',
      platform: req.body?.platform || '',
      sortOrder: Number(req.body?.sortOrder || 0),
      isActive: req.body?.isActive !== false,
      startsAt: req.body?.startsAt || null,
      endsAt: req.body?.endsAt || null,
      // imageUrl REQUIRED by schema; set temporary until upload OR allow sending existing
      imageUrl: req.body?.imageUrl || '/uploads/placeholder.png',
    };

    const created = await HomepageBanner.create(payload);
    res.status(201).json({ success: true, data: { item: created } });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Bad request', error: err.message });
  }
});

// PUT /api/admin/banners/:id
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const patch = {
      title: req.body?.title,
      subtitle: req.body?.subtitle,
      linkUrl: req.body?.linkUrl,
      buttonText: req.body?.buttonText,
      platform: req.body?.platform,
      sortOrder: req.body?.sortOrder != null ? Number(req.body.sortOrder) : undefined,
      isActive: req.body?.isActive,
      startsAt: req.body?.startsAt === '' ? null : req.body?.startsAt,
      endsAt: req.body?.endsAt === '' ? null : req.body?.endsAt,
    };

    // remove undefined keys
    Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);

    const updated = await HomepageBanner.findByIdAndUpdate(id, patch, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { item: updated } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
});

// POST /api/admin/banners/:id/image  (UPLOAD IMAGE FILE)
router.post('/:id/image', adminAuth, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const publicPath = `/uploads/${req.file.filename}`;
    const updated = await HomepageBanner.findByIdAndUpdate(id, { imageUrl: publicPath }, { new: true }).lean();
    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });

    res.json({ success: true, data: { item: updated } });
  } catch (err) {
    console.error('Admin banner image upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal server error' });
  }
});

// DELETE /api/admin/banners/:id
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const deleted = await HomepageBanner.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ success: false, message: 'Not found' });

    // optionally remove file from disk if it's a local uploads file
    try {
      const img = deleted?.imageUrl || '';
      if (img.startsWith('/uploads/')) {
        const filePath = path.join(uploadsRoot, path.basename(img));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    } catch {}

    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;