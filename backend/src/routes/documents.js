import express from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma.js';
import { uploadToS3, deleteFromS3, getS3SignedUrl } from '../config/s3.js';
import { authenticate } from '../middleware/auth.js';
import { uploadMiddleware } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { processDocument } from '../controllers/documentController.js';
import { documentListCache, analyticsCache } from '../config/cache.js';

const router = express.Router();
router.use(authenticate);

// Safe response helper — prevents ERR_HTTP_HEADERS_SENT if timeout or prior
// handler already sent a response (e.g. the gateway timeout fires first on a
// slow S3 upload, then the upload completes and tries to respond again).
const safeSend = (res, statusOrPayload, payload) => {
  if (res.headersSent) return;
  if (payload !== undefined) {
    res.status(statusOrPayload).json(payload);
  } else {
    res.json(statusOrPayload);
  }
};

// Invalidate all document/analytics caches for a user
const bustUserCaches = (userId) => {
  documentListCache.delete(`docs:${userId}`);
  analyticsCache.delete(`analytics:${userId}`);
  analyticsCache.delete(`analytics:usage:${userId}`);
};

// GET /api/documents - List user's documents (cached 30s with request coalescing)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const userId = req.user.id;

    const isDefaultQuery = !search && !status && parseInt(page) === 1 && parseInt(limit) === 20;

    const fetchFn = async () => {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const where = {
        userId,
        ...(status && { status }),
        ...(search && { title: { contains: search, mode: 'insensitive' } }),
      };

      const [documents, total] = await Promise.all([
        prisma.document.findMany({
          where,
          skip,
          take: parseInt(limit),
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, title: true, fileName: true, fileSize: true,
            pageCount: true, status: true, isScanned: true,
            ocrConfidence: true, tokenCount: true, createdAt: true, thumbnail: true,
          },
        }),
        prisma.document.count({ where }),
      ]);

      return {
        documents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      };
    };

    const payload = isDefaultQuery
      ? await documentListCache.getOrFetch(`docs:${userId}`, fetchFn, 30_000)
      : await fetchFn();

    safeSend(res, payload);
  } catch (error) {
    console.error('List documents error:', error);
    safeSend(res, 500, { error: 'Failed to fetch documents' });
  }
});

// GET /api/documents/:id - Get single document
router.get('/:id', async (req, res) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!document) return safeSend(res, 404, { error: 'Document not found' });
    safeSend(res, { document });
  } catch (error) {
    safeSend(res, 500, { error: 'Failed to fetch document' });
  }
});

// POST /api/documents/upload - Upload a document to AWS S3
// NOTE: excluded from gateway request timeout (uploads can take >25s for large files)
router.post('/upload', uploadLimiter, uploadMiddleware.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return safeSend(res, 400, { error: 'No file uploaded' });
    }

    const { title } = req.body;
    const fileName  = req.file.originalname;
    const fileSize  = req.file.size;
    const mimeType  = req.file.mimetype;
    const buffer    = req.file.buffer;

    const ext   = path.extname(fileName);
    const s3Key = `documents/${req.user.id}/${uuidv4()}${ext}`;

    await uploadToS3(buffer, s3Key, mimeType);

    const document = await prisma.document.create({
      data: {
        userId:   req.user.id,
        title:    title || fileName.replace(/\.(pdf|png|jpg|jpeg|tiff?)$/i, ''),
        fileName,
        filePath: s3Key,
        fileSize,
        mimeType,
        status:   'PROCESSING',
      },
    });

    bustUserCaches(req.user.id);

    // Process asynchronously — do NOT await, just fire-and-forget
    processDocument(document.id, buffer, fileName)
      .then(() => bustUserCaches(req.user.id))
      .catch(err => console.error('processDocument error:', err));

    // Respond immediately after DB record created — processing continues in background
    safeSend(res, 201, {
      message: 'Document uploaded to S3. Processing started.',
      document: {
        id:       document.id,
        title:    document.title,
        fileName: document.fileName,
        fileSize: document.fileSize,
        status:   document.status,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    safeSend(res, 500, { error: 'Upload failed' });
  }
});

// GET /api/documents/:id/status - Check processing status
router.get('/:id/status', async (req, res) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: {
        id: true, status: true, pageCount: true,
        tokenCount: true, isScanned: true, ocrConfidence: true,
      },
    });
    if (!document) return safeSend(res, 404, { error: 'Document not found' });
    safeSend(res, { document });
  } catch (error) {
    safeSend(res, 500, { error: 'Failed to get status' });
  }
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!document) return safeSend(res, 404, { error: 'Document not found' });

    try { await deleteFromS3(document.filePath); }
    catch (s3Err) { console.warn('S3 delete warning:', s3Err.message); }

    await prisma.document.delete({ where: { id: req.params.id } });
    bustUserCaches(req.user.id);

    safeSend(res, { message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    safeSend(res, 500, { error: 'Delete failed' });
  }
});

// GET /api/documents/:id/file - Redirect to a pre-signed S3 URL
router.get('/:id/file', async (req, res) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!document) return safeSend(res, 404, { error: 'Not found' });

    const signedUrl = await getS3SignedUrl(document.filePath, 3600);
    if (!res.headersSent) res.redirect(302, signedUrl);
  } catch (error) {
    console.error('File serve error:', error);
    safeSend(res, 500, { error: 'Failed to serve file' });
  }
});

export default router;
