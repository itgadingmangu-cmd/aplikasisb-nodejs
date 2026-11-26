const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const BASE_LPJ_DIR = path.resolve(__dirname, '../public/uploads/lpj');
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB per berkas

const ALLOWED_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.pdf'
]);

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
]);

const ALLOWED_FIELDS = new Set([
    'foto_kegiatan',
    'nota_belanja',
    'bukti_nota',
    'bukti_transfer_bendahara'
]);

function resolveTahunLpj(req) {
    const fallbackYear = String(new Date().getFullYear());
    const candidate =
        (req && req.body && (req.body.tahun || req.body.tahun_anggaran)) ||
        (req && req.lpjTahun) ||
        fallbackYear;

    const match = String(candidate).match(/\b(20\d{2})\b/);
    return match ? match[1] : fallbackYear;
}

function resolveSafeExtension(file) {
    const extFromName = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_EXTENSIONS.has(extFromName)) {
        return extFromName === '.jpeg' ? '.jpg' : extFromName;
    }

    const mimeToExt = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'application/pdf': '.pdf'
    };

    return mimeToExt[file.mimetype] || null;
}

function sanitizeFieldPrefix(fieldname) {
    const safe = String(fieldname || 'file').replace(/[^a-zA-Z0-9_-]/g, '');
    return safe || 'file';
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const tahun = resolveTahunLpj(req);
            const targetDir = path.resolve(BASE_LPJ_DIR, tahun);

            // Cegah path traversal di luar BASE_LPJ_DIR
            if (!targetDir.startsWith(BASE_LPJ_DIR + path.sep)) {
                return cb(new Error('Jalur folder tujuan LPJ tidak valid.'));
            }

            fs.mkdirSync(targetDir, { recursive: true });

            // Simpan metadata tahun agar sinkron dengan controller
            req.lpjTahun = tahun;
            file.lpjTahun = tahun;

            return cb(null, targetDir);
        } catch (err) {
            return cb(err);
        }
    },
    filename: (req, file, cb) => {
        const ext = resolveSafeExtension(file);
        if (!ext) {
            return cb(new Error('Ekstensi berkas tidak diizinkan.'));
        }

        const prefix = sanitizeFieldPrefix(file.fieldname);
        const timestamp = Date.now();
        const randomHex = crypto.randomBytes(6).toString('hex');
        const filename = `${prefix}-${timestamp}-${randomHex}${ext}`;

        const tahun = file.lpjTahun || resolveTahunLpj(req);
        file.lpjRelativePath = `lpj/${tahun}/${filename}`;

        return cb(null, filename);
    }
});

function fileFilter(req, file, cb) {
    if (!ALLOWED_FIELDS.has(file.fieldname)) {
        return cb(new Error(`Field upload tidak dikenali: ${file.fieldname}`));
    }

    const ext = resolveSafeExtension(file);
    if (!ext || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return cb(new Error('Format berkas harus berupa JPG, PNG, WEBP, atau PDF.'));
    }

    return cb(null, true);
}

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 3
    }
});

const uploadLpjFiles = upload.fields([
    { name: 'foto_kegiatan', maxCount: 1 },
    { name: 'nota_belanja', maxCount: 1 },
    { name: 'bukti_nota', maxCount: 1 },
    { name: 'bukti_transfer_bendahara', maxCount: 1 }
]);

module.exports = uploadLpjFiles;
