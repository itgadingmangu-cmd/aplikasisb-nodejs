'use strict';
const models = require('../models');
const { Proposal, RealisasiLpj, Proker, Bidang, Lembaga } = models;
const RealisasiBiaya = models.RealisasiBiaya || null;
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const PUBLIC_UPLOADS_ROOT = path.resolve(__dirname, '../public/uploads');
const REALISASI_DIR = path.resolve(PUBLIC_UPLOADS_ROOT, 'realisasi');
const MAX_REALISASI_FILE_SIZE = 512 * 1024; // 512 KB per berkas

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

const NON_EDITOR_ROLES = new Set([
    'ketua',
    'bendahara_utama',
    'bendahara',
    'sekretaris',
    'pimpinan',
    'admin_lembaga',
    'lembaga_admin'
]);

function parsePositiveId(rawId) {
    const num = Number(rawId);
    return Number.isInteger(num) && num > 0 ? num : null;
}

function normalizeRole(rawRole) {
    return String(rawRole || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function resolveUserContext(req) {
    const sess = req && req.session ? req.session : {};
    const user = (sess.user && typeof sess.user === 'object')
        ? sess.user
        : ((req && req.user && typeof req.user === 'object') ? req.user : {});

    const role = normalizeRole(user.role || sess.role);
    const bidangId = parsePositiveId(user.id_bidang || user.bidangId || sess.id_bidang || sess.bidangId);

    return {
        user,
        role,
        bidangId
    };
}

function evaluateLpjAccess(req, proposal) {
    const { role, bidangId } = resolveUserContext(req);
    const prokerBidangId = proposal && proposal.Proker
        ? parsePositiveId(proposal.Proker.bidangId || proposal.Proker.id_bidang)
        : null;

    if (role === 'superadmin') {
        return {
            canEditLpj: true,
            accessMode: 'edit',
            accessNote: 'Mode pengisian & penyuntingan LPJ aktif (Superadmin).'
        };
    }

    if (NON_EDITOR_ROLES.has(role)) {
        let peranLabel = 'Pemeriksa / Pemantau';
        if (role === 'ketua' || role === 'pimpinan') {
            peranLabel = 'Ketua (Mode Pemeriksaan Pelaksanaan Kegiatan)';
        } else if (role === 'bendahara_utama' || role === 'bendahara') {
            peranLabel = 'Bendahara Utama (Mode Pemeriksaan Anggaran & Realisasi)';
        } else if (role === 'sekretaris') {
            peranLabel = 'Sekretaris (Mode Pemeriksaan Dokumen)';
        } else if (role === 'admin_lembaga' || role === 'lembaga_admin') {
            peranLabel = 'Admin Lembaga (Mode Pemantauan)';
        }

        return {
            canEditLpj: false,
            accessMode: 'review',
            accessNote: `${peranLabel} — tampilan baca-saja untuk meninjau laporan LPJ tanpa mengubah data bidang.`
        };
    }

    if (bidangId && prokerBidangId && bidangId === prokerBidangId) {
        return {
            canEditLpj: true,
            accessMode: 'edit',
            accessNote: 'Mode pengisian LPJ aktif untuk pengurus bidang pengampu program kerja.'
        };
    }

    return {
        canEditLpj: false,
        accessMode: 'readonly',
        accessNote: 'Mode baca-saja — Anda hanya dapat melihat laporan LPJ pada bidang ini.'
    };
}

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

function extractUploadedFilePath(req, fieldNames) {
    if (!req || !req.files) {
        return null;
    }

    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
    for (const name of names) {
        const list = req.files[name];
        if (Array.isArray(list) && list.length > 0 && list[0]) {
            const fileObj = list[0];
            if (fileObj.lpjRelativePath) {
                return String(fileObj.lpjRelativePath).replace(/\\/g, '/');
            }
            if (fileObj.filename) {
                const tahun = fileObj.lpjTahun || resolveTahunLpj(req);
                return `lpj/${tahun}/${path.basename(fileObj.filename)}`;
            }
        }
    }

    return null;
}

function safeUnlinkOldFile(relativeOrFilename, fallbackSubdir = 'lpj') {
    if (!relativeOrFilename || typeof relativeOrFilename !== 'string') {
        return;
    }

    const cleaned = relativeOrFilename.replace(/^\/+/, '').replace(/\\/g, '/');
    const targetCandidate = cleaned.includes('/')
        ? path.resolve(PUBLIC_UPLOADS_ROOT, cleaned)
        : path.resolve(PUBLIC_UPLOADS_ROOT, fallbackSubdir, path.basename(cleaned));

    // Pastikan file yang dihapus berada strict di dalam PUBLIC_UPLOADS_ROOT
    if (!targetCandidate.startsWith(PUBLIC_UPLOADS_ROOT + path.sep)) {
        return;
    }

    try {
        if (fs.existsSync(targetCandidate) && fs.statSync(targetCandidate).isFile()) {
            fs.unlinkSync(targetCandidate);
        }
    } catch (err) {
        console.warn('Gagal menghapus file lama LPJ:', err.message);
    }
}

function cleanupUploadedRequestFiles(req) {
    if (!req || !req.files || typeof req.files !== 'object') {
        return;
    }
    const groups = Object.values(req.files);
    for (const list of groups) {
        if (!Array.isArray(list)) continue;
        for (const fileObj of list) {
            if (!fileObj) continue;
            if (fileObj.path && typeof fileObj.path === 'string') {
                const resolved = path.resolve(fileObj.path);
                if (resolved.startsWith(PUBLIC_UPLOADS_ROOT + path.sep)) {
                    try {
                        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                            fs.unlinkSync(resolved);
                        }
                    } catch (err) {
                        console.warn('Gagal membersihkan file unggahan tertolak:', err.message);
                    }
                }
            } else {
                const relPath = extractUploadedFilePath({ files: { _tmp: [fileObj] } }, ['_tmp']);
                if (relPath) {
                    safeUnlinkOldFile(relPath);
                }
            }
        }
    }
}

function sanitizeAnggaran(rawVal, fallbackVal = 0) {
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
        return fallbackVal;
    }
    const normalized = String(rawVal).replace(/[^0-9.-]/g, '');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallbackVal;
    }
    return parsed;
}

async function hitungTotalRealisasiBiaya(prokerId) {
    if (!RealisasiBiaya || !prokerId) {
        return 0;
    }
    try {
        const rows = await RealisasiBiaya.findAll({
            where: { prokerId },
            attributes: ['nominal_realisasi']
        });
        if (!Array.isArray(rows) || rows.length === 0) {
            return 0;
        }
        return rows.reduce((sum, item) => {
            const val = Number(item && item.nominal_realisasi);
            return sum + (Number.isFinite(val) && val > 0 ? val : 0);
        }, 0);
    } catch (err) {
        console.warn('[LPJ-REALISASI-WARN] Gagal menghitung akumulasi RealisasiBiaya:', err.message);
        return 0;
    }
}

const realisasiStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            fs.mkdirSync(REALISASI_DIR, { recursive: true });
            return cb(null, REALISASI_DIR);
        } catch (err) {
            return cb(err);
        }
    },
    filename: (req, file, cb) => {
        const ext = resolveSafeExtension(file);
        if (!ext) {
            return cb(new Error('Ekstensi berkas tidak diizinkan.'));
        }
        const prefix = String(file.fieldname || 'realisasi').replace(/[^a-zA-Z0-9_-]/g, '') || 'realisasi';
        const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        return cb(null, `${prefix}-${suffix}${ext}`);
    }
});

const uploadRealisasi = multer({
    storage: realisasiStorage,
    limits: {
        fileSize: MAX_REALISASI_FILE_SIZE,
        files: 3
    },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_FIELDS.has(file.fieldname)) {
            return cb(new Error(`Field upload tidak dikenali: ${file.fieldname}`));
        }
        const ext = resolveSafeExtension(file);
        if (!ext || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
            return cb(new Error('Format berkas harus berupa JPG, PNG, WEBP, atau PDF dengan ukuran maksimal 512 KB!'));
        }
        return cb(null, true);
    }
});

const realisasiLpjController = {
    uploadMiddleware: uploadRealisasi.fields([
        { name: 'foto_kegiatan', maxCount: 1 },
        { name: 'nota_belanja', maxCount: 1 },
        { name: 'bukti_transfer_bendahara', maxCount: 1 },
        { name: 'bukti_nota', maxCount: 1 }
    ]),

    // 1. Menampilkan Form / Detail LPJ untuk Proposal yang sudah dicairkan
    formLpj: async (req, res) => {
        try {
            const proposalId = parsePositiveId(req.params.id);
            if (!proposalId) {
                req.session.error_msg = 'ID Proposal tidak valid.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const proposal = await Proposal.findOne({
                where: { id: proposalId },
                include: [
                    { model: Proker, as: 'Proker', include: [{ model: Bidang, as: 'Bidang' }] },
                    { model: Lembaga, as: 'Lembaga' },
                    { model: RealisasiLpj, as: 'RealisasiLpj' }
                ]
            });

            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const totalRealisasiTercatat = await hitungTotalRealisasiBiaya(proposal.prokerId);
            const { user } = resolveUserContext(req);
            const access = evaluateLpjAccess(req, proposal);

            return res.render('proker/form_lpj', {
                title: `Laporan Pertanggungjawaban (LPJ) - ${proposal.Proker ? proposal.Proker.nama_program : 'Proposal'}`,
                proposal,
                totalRealisasiTercatat,
                canEditLpj: access.canEditLpj,
                accessMode: access.accessMode,
                accessNote: access.accessNote,
                userSession: user
            });
        } catch (error) {
            console.error('ERROR FORM LPJ:', error);
            req.session.error_msg = 'Gagal memuat form LPJ: ' + error.message;
            return res.redirect('/lembaga-admin/proposal');
        }
    },

    // 2. Menyimpan atau Memperbarui Data LPJ beserta Upload Berkas
    storeOrUpdateLpj: async (req, res) => {
        try {
            const proposalId = parsePositiveId(req.params.id);
            if (!proposalId) {
                cleanupUploadedRequestFiles(req);
                req.session.error_msg = 'ID Proposal tidak valid.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const proposal = await Proposal.findOne({
                where: { id: proposalId },
                include: [{ model: Proker, as: 'Proker' }]
            });
            if (!proposal) {
                cleanupUploadedRequestFiles(req);
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const access = evaluateLpjAccess(req, proposal);
            if (!access.canEditLpj) {
                cleanupUploadedRequestFiles(req);
                req.session.error_msg = 'Anda tidak memiliki hak untuk mengubah data LPJ pada pengajuan ini (mode pemeriksaan/baca-saja).';
                return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
            }

            const { realisasi_anggaran, deskripsi_kegiatan } = req.body || {};

            const totalRealisasiTercatat = await hitungTotalRealisasiBiaya(proposal.prokerId);
            const hasManualNominal = realisasi_anggaran !== undefined && String(realisasi_anggaran).trim() !== '';

            const fotoKegiatanPath = extractUploadedFilePath(req, ['foto_kegiatan']);
            const notaBelanjaPath = extractUploadedFilePath(req, ['nota_belanja', 'bukti_nota']);
            const buktiTransferPath = extractUploadedFilePath(req, ['bukti_transfer_bendahara']);

            const cleanDeskripsi =
                typeof deskripsi_kegiatan === 'string' ? deskripsi_kegiatan.trim() : undefined;

            let lpj = await RealisasiLpj.findOne({ where: { proposalId } });

            if (lpj) {
                const oldFoto = lpj.foto_kegiatan;
                const oldNota = lpj.nota_belanja;
                const oldBukti = lpj.bukti_transfer_bendahara;

                const fallbackNominal = lpj.realisasi_anggaran || totalRealisasiTercatat || 0;
                lpj.realisasi_anggaran = hasManualNominal
                    ? sanitizeAnggaran(realisasi_anggaran, fallbackNominal)
                    : fallbackNominal;

                if (cleanDeskripsi !== undefined) {
                    lpj.deskripsi_kegiatan = cleanDeskripsi;
                }

                if (fotoKegiatanPath) {
                    lpj.foto_kegiatan = fotoKegiatanPath;
                }
                if (notaBelanjaPath) {
                    lpj.nota_belanja = notaBelanjaPath;
                }
                if (buktiTransferPath) {
                    lpj.bukti_transfer_bendahara = buktiTransferPath;
                }

                lpj.status_lpj = 'Menunggu Review';
                await lpj.save();

                if (fotoKegiatanPath && oldFoto && oldFoto !== fotoKegiatanPath) {
                    safeUnlinkOldFile(oldFoto);
                }
                if (notaBelanjaPath && oldNota && oldNota !== notaBelanjaPath) {
                    safeUnlinkOldFile(oldNota);
                }
                if (buktiTransferPath && oldBukti && oldBukti !== buktiTransferPath) {
                    safeUnlinkOldFile(oldBukti);
                }
            } else {
                const initialNominal = hasManualNominal
                    ? sanitizeAnggaran(realisasi_anggaran, totalRealisasiTercatat)
                    : totalRealisasiTercatat;

                await RealisasiLpj.create({
                    proposalId,
                    lembagaId: proposal.lembagaId,
                    realisasi_anggaran: initialNominal,
                    deskripsi_kegiatan: cleanDeskripsi || '',
                    foto_kegiatan: fotoKegiatanPath,
                    nota_belanja: notaBelanjaPath,
                    bukti_transfer_bendahara: buktiTransferPath,
                    status_lpj: 'Menunggu Review'
                });
            }

            req.session.success_msg = 'Laporan Pertanggungjawaban (LPJ) berhasil disimpan dan dikirim untuk direview!';
            return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
        } catch (error) {
            cleanupUploadedRequestFiles(req);
            console.error('ERROR STORE/UPDATE LPJ:', error);
            if (error && error.code === 'LIMIT_FILE_SIZE') {
                req.session.error_msg = 'Gagal menyimpan LPJ: Ukuran file melebihi batas maksimal 512 KB!';
            } else {
                req.session.error_msg = 'Gagal menyimpan LPJ: ' + (error && error.message ? error.message : 'Terjadi kesalahan.');
            }
            const fallbackUrl = req.params && req.params.id
                ? `/lembaga-admin/proker/proposal/lpj/${req.params.id}`
                : '/lembaga-admin/proposal';
            return res.redirect(req.get('Referer') || fallbackUrl);
        }
    }
};

module.exports = realisasiLpjController;
