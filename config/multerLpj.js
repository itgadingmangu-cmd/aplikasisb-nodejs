const multer = require('multer');
const path = require('path');

// Konfigurasi Penyimpanan Berkas LPJ
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Menyimpan file ke folder publik uploads yang sudah ada di proyek Anda
        cb(null, 'public/uploads/'); 
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Batas ukuran file 5MB per berkas
});

// Middleware untuk menangani 3 jenis file LPJ sekaligus
const uploadLpjFiles = upload.fields([
    { name: 'foto_kegiatan', maxCount: 1 },
    { name: 'nota_belanja', maxCount: 1 },
    { name: 'bukti_transfer_bendahara', maxCount: 1 }
]);

module.exports = uploadLpjFiles;
