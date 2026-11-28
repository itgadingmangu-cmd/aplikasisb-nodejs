'use strict';
const models = require('../models');
const { Proposal, RealisasiLpj, Proker, Bidang, Lembaga, Pengaturan } = models;
const RealisasiBiaya = models.RealisasiBiaya || null;
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const PUBLIC_UPLOADS_ROOT = path.resolve(__dirname, '../public/uploads');
const LPJ_UPLOADS_ROOT = path.resolve(PUBLIC_UPLOADS_ROOT, 'lpj');
const REALISASI_DIR = path.resolve(PUBLIC_UPLOADS_ROOT, 'realisasi');
const MAX_REALISASI_FILE_SIZE = 512 * 1024; // 512 KB per berkas

const ALLOWED_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.pdf'
]);

const ALLOWED_FOTO_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp'
]);

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
]);

const ALLOWED_FOTO_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp'
]);

const ALLOWED_FIELDS = new Set([
    'foto_kegiatan',
    'nota_belanja',
    'bukti_nota',
    'bukti_transfer_bendahara'
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
    const jabatan = String(user.jabatan || sess.jabatan || '').trim().toLowerCase();
    const namaBidang = String(user.nama_bidang || sess.nama_bidang || '').trim().toLowerCase();
    const bidangId = parsePositiveId(user.id_bidang || user.bidangId || sess.id_bidang || sess.bidangId);
    const lembagaId = parsePositiveId(user.activeLembagaId || user.lembagaId || sess.activeLembagaId || sess.lembagaId);

    const isPengurusBidang = role === 'pengurus_bidang' || role === 'bidang';
    const isWakil = jabatan.includes('wakil') || namaBidang.includes('wakil');

    const isKetua = !isPengurusBidang && (
        role === 'ketua'
        || jabatan === 'ketua'
        || /^ketua(\s|$)/i.test(jabatan)
    );

    const isBendaharaUtama = !isPengurusBidang && !isWakil && (
        role === 'bendahara_utama'
        || role === 'bendahara'
        || jabatan === 'bendahara'
        || jabatan.includes('bendahara utama')
        || namaBidang === 'bendahara'
    );

    const isLembagaAccount = !isPengurusBidang && !isKetua && !isBendaharaUtama && (
        role === 'admin_lembaga'
        || role === 'lembaga_admin'
        || role === 'superadmin'
        || jabatan.includes('admin lembaga')
        || jabatan.includes('sekretaris')
    );

    return {
        user,
        role,
        jabatan,
        namaBidang,
        bidangId,
        lembagaId,
        isPengurusBidang,
        isWakil,
        isKetua,
        isBendaharaUtama,
        isLembagaAccount
    };
}

function canReviewLpj(req, proposal) {
    const { isKetua, isBendaharaUtama, lembagaId } = resolveUserContext(req);
    if (!isKetua && !isBendaharaUtama) {
        return false;
    }
    const proposalLembagaId = proposal
        ? parsePositiveId(proposal.lembagaId || (proposal.Proker && proposal.Proker.lembagaId))
        : null;
    if (lembagaId && proposalLembagaId && lembagaId !== proposalLembagaId) {
        return false;
    }
    return true;
}

function isLembagaExemptFromFotoLpj(req, proposal) {
    const { role, isPengurusBidang, isKetua, isBendaharaUtama, isLembagaAccount, bidangId } = resolveUserContext(req);
    if (role === 'superadmin' || isLembagaAccount) {
        return true;
    }
    if (isPengurusBidang) {
        return false;
    }
    if (isKetua || isBendaharaUtama) {
        return true;
    }
    const prokerBidangId = proposal && proposal.Proker
        ? parsePositiveId(proposal.Proker.bidangId || proposal.Proker.id_bidang)
        : null;
    const namaBidangProker = String(
        (proposal && proposal.Proker && proposal.Proker.Bidang && proposal.Proker.Bidang.nama_bidang) || ''
    ).trim().toLowerCase();

    if (!prokerBidangId && !bidangId) {
        return true;
    }
    if (namaBidangProker.includes('lembaga') || namaBidangProker.includes('umum / lembaga')) {
        return true;
    }
    return false;
}

function evaluateLpjAccess(req, proposal) {
    const {
        role,
        jabatan,
        namaBidang,
        bidangId,
        isPengurusBidang,
        isKetua,
        isBendaharaUtama,
        isLembagaAccount
    } = resolveUserContext(req);

    const prokerBidangId = proposal && proposal.Proker
        ? parsePositiveId(proposal.Proker.bidangId || proposal.Proker.id_bidang)
        : null;
    const lpjStatusLower = String(
        (proposal && proposal.RealisasiLpj && proposal.RealisasiLpj.status_lpj) || ''
    ).trim().toLowerCase();
    const isFinalApproved = lpjStatusLower.includes('setuju');
    const allowReview = canReviewLpj(req, proposal);

    if (role === 'superadmin') {
        return {
            canEditLpj: !isFinalApproved,
            canReviewLpj: allowReview,
            isFinalApproved,
            accessMode: isFinalApproved ? 'approved' : 'edit',
            accessNote: isFinalApproved
                ? 'LPJ telah berstatus Disetujui (proses selesai).'
                : 'Mode pengisian & penyuntingan LPJ aktif (Superadmin).'
        };
    }

    if (isPengurusBidang) {
        const matchesBidang = Boolean(bidangId && prokerBidangId && bidangId === prokerBidangId);
        if (matchesBidang) {
            return {
                canEditLpj: !isFinalApproved,
                canReviewLpj: false,
                isFinalApproved,
                accessMode: isFinalApproved ? 'approved' : 'edit',
                accessNote: isFinalApproved
                    ? 'LPJ telah Disetujui — proses selesai dan data dikunci.'
                    : 'Mode pengisian LPJ aktif untuk pengurus bidang pengampu program kerja.'
            };
        }
        return {
            canEditLpj: false,
            canReviewLpj: false,
            isFinalApproved,
            accessMode: 'readonly',
            accessNote: `Mode baca-saja — Anda hanya dapat melihat laporan LPJ pada ${namaBidang || 'bidang Anda'}.`
        };
    }

    if (isKetua || isBendaharaUtama || isLembagaAccount || jabatan.includes('sekretaris')) {
        let peranLabel = 'Pemeriksa / Pemantau';
        if (isKetua) {
            peranLabel = 'Ketua (Pemeriksa Pelaksanaan Kegiatan)';
        } else if (isBendaharaUtama) {
            peranLabel = 'Bendahara Utama (Pemeriksa Realisasi Anggaran)';
        } else if (jabatan.includes('sekretaris')) {
            peranLabel = 'Sekretaris (Mode Pemeriksaan Dokumen)';
        } else if (isLembagaAccount) {
            peranLabel = 'Admin Lembaga (Mode Pemantauan)';
        }

        return {
            canEditLpj: false,
            canReviewLpj: allowReview,
            isFinalApproved,
            accessMode: isFinalApproved ? 'approved' : (allowReview ? 'review' : 'readonly'),
            accessNote: isFinalApproved
                ? `${peranLabel} — LPJ sudah Disetujui dan proses telah selesai.`
                : (allowReview
                    ? `${peranLabel} — Anda dapat memeriksa LPJ dan menekan Setujui LPJ (Selesai) atau Minta Revisi LPJ.`
                    : `${peranLabel} — tampilan pemeriksaan laporan LPJ tanpa mengubah data bidang.`)
        };
    }

    if (bidangId && prokerBidangId && bidangId === prokerBidangId) {
        return {
            canEditLpj: !isFinalApproved,
            canReviewLpj: false,
            isFinalApproved,
            accessMode: isFinalApproved ? 'approved' : 'edit',
            accessNote: isFinalApproved
                ? 'LPJ telah Disetujui — proses selesai dan data dikunci.'
                : 'Mode pengisian LPJ aktif untuk pengurus bidang pengampu program kerja.'
        };
    }

    const labelBidang = namaBidang || 'bidang ini';
    return {
        canEditLpj: false,
        canReviewLpj: false,
        isFinalApproved,
        accessMode: 'readonly',
        accessNote: `Mode baca-saja — Anda hanya dapat melihat laporan LPJ pada ${labelBidang}.`
    };
}

async function resolveTahunLpj(req, proposal) {
    const fallbackYear = String(new Date().getFullYear());
    const candidate =
        (req && req.body && (req.body.tahun || req.body.tahun_anggaran)) ||
        (req && req.lpjTahun) ||
        (proposal && proposal.Proker && proposal.Proker.tahun) ||
        (proposal && proposal.tahun);

    const matchFromReqOrProker = candidate ? String(candidate).match(/\b(20\d{2})\b/) : null;
    if (matchFromReqOrProker) {
        return matchFromReqOrProker[1];
    }

    if (Pengaturan && typeof Pengaturan.findOne === 'function') {
        try {
            const setting = await Pengaturan.findOne({ attributes: ['tahun_aktif'] });
            const matchSetting = setting && setting.tahun_aktif ? String(setting.tahun_aktif).match(/\b(20\d{2})\b/) : null;
            if (matchSetting) {
                return matchSetting[1];
            }
        } catch (_) {}
    }

    return fallbackYear;
}

function resolveSafeExtension(file, fotoOnly = false) {
    const extFromName = path.extname(file.originalname || '').toLowerCase();
    const allowedSet = fotoOnly ? ALLOWED_FOTO_EXTENSIONS : ALLOWED_EXTENSIONS;
    if (allowedSet.has(extFromName)) {
        return extFromName === '.jpeg' ? '.jpg' : extFromName;
    }

    const mimeToExt = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'application/pdf': '.pdf'
    };

    const resolved = mimeToExt[file.mimetype] || null;
    if (!resolved) return null;
    if (fotoOnly && !ALLOWED_FOTO_EXTENSIONS.has(resolved)) return null;
    return resolved;
}

function relocateUploadedFileToYearDir(fileObj, tahun) {
    if (!fileObj || !fileObj.filename) return null;
    const cleanYear = String(tahun || new Date().getFullYear()).replace(/[^0-9]/g, '') || String(new Date().getFullYear());
    const baseName = path.basename(fileObj.filename);
    const yearDir = path.resolve(LPJ_UPLOADS_ROOT, cleanYear);
    fs.mkdirSync(yearDir, { recursive: true });

    const targetPath = path.resolve(yearDir, baseName);
    if (!targetPath.startsWith(yearDir + path.sep)) {
        return null;
    }

    const currentCandidates = [
        fileObj.path ? path.resolve(fileObj.path) : null,
        path.resolve(LPJ_UPLOADS_ROOT, baseName)
    ].filter(Boolean);

    for (const srcPath of currentCandidates) {
        if (srcPath === targetPath) {
            if (fs.existsSync(targetPath)) {
                fileObj.path = targetPath;
                fileObj.lpjRelativePath = `lpj/${cleanYear}/${baseName}`;
                return fileObj.lpjRelativePath;
            }
        } else if (srcPath.startsWith(PUBLIC_UPLOADS_ROOT + path.sep) && fs.existsSync(srcPath) && fs.statSync(srcPath).isFile()) {
            fs.renameSync(srcPath, targetPath);
            fileObj.path = targetPath;
            fileObj.lpjRelativePath = `lpj/${cleanYear}/${baseName}`;
            return fileObj.lpjRelativePath;
        }
    }

    if (fs.existsSync(targetPath)) {
        fileObj.path = targetPath;
        fileObj.lpjRelativePath = `lpj/${cleanYear}/${baseName}`;
        return fileObj.lpjRelativePath;
    }

    return `lpj/${cleanYear}/${baseName}`;
}

function extractUploadedFilePath(req, fieldNames, tahun) {
    if (!req || !req.files) {
        return null;
    }

    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
    for (const name of names) {
        const list = req.files[name];
        if (Array.isArray(list) && list.length > 0 && list[0]) {
            const fileObj = list[0];
            if (fileObj.lpjRelativePath) {
                return String(fileObj.lpjRelativePath).replace(/\\/g, '/').replace(/^\/+/, '');
            }
            if (fileObj.filename) {
                return relocateUploadedFileToYearDir(fileObj, tahun);
            }
        }
    }

    if (Array.isArray(req.files)) {
        for (const fileObj of req.files) {
            if (!fileObj || !fileObj.fieldname) continue;
            if (names.includes(fileObj.fieldname) && fileObj.filename) {
                return relocateUploadedFileToYearDir(fileObj, tahun);
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
    const groups = Array.isArray(req.files) ? [req.files] : Object.values(req.files);
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
            } else if (fileObj.filename) {
                safeUnlinkOldFile(`lpj/${path.basename(fileObj.filename)}`);
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
        const isFoto = file.fieldname === 'foto_kegiatan';
        const ext = resolveSafeExtension(file, isFoto);
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
        const isFoto = file.fieldname === 'foto_kegiatan';
        const ext = resolveSafeExtension(file, isFoto);
        const mimeSet = isFoto ? ALLOWED_FOTO_MIME_TYPES : ALLOWED_MIME_TYPES;
        if (!ext || !mimeSet.has(file.mimetype)) {
            return cb(new Error(
                isFoto
                    ? 'Foto dokumentasi LPJ harus berupa JPG, PNG, atau WEBP dengan ukuran maksimal 512 KB!'
                    : 'Format berkas harus berupa JPG, PNG, WEBP, atau PDF dengan ukuran maksimal 512 KB!'
            ));
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
            const fotoRequired = !isLembagaExemptFromFotoLpj(req, proposal);

            return res.render('proker/form_lpj', {
                title: `Laporan Pertanggungjawaban (LPJ) - ${proposal.Proker ? proposal.Proker.nama_program : 'Proposal'}`,
                proposal,
                totalRealisasiTercatat,
                canEditLpj: access.canEditLpj,
                canReviewLpj: access.canReviewLpj,
                isFinalApproved: access.isFinalApproved,
                fotoRequired,
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
                include: [{ model: Proker, as: 'Proker', include: [{ model: Bidang, as: 'Bidang' }] }]
            });
            if (!proposal) {
                cleanupUploadedRequestFiles(req);
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const access = evaluateLpjAccess(req, proposal);
            if (!access.canEditLpj) {
                cleanupUploadedRequestFiles(req);
                req.session.error_msg = access.isFinalApproved
                    ? 'LPJ sudah Disetujui dan prosesnya telah selesai sehingga tidak dapat diubah.'
                    : 'Anda tidak memiliki hak untuk mengubah data LPJ pada pengajuan ini.';
                return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
            }

            const tahunLpj = await resolveTahunLpj(req, proposal);
            const { realisasi_anggaran, deskripsi_kegiatan } = req.body || {};

            const totalRealisasiTercatat = await hitungTotalRealisasiBiaya(proposal.prokerId);
            const hasManualNominal = realisasi_anggaran !== undefined && String(realisasi_anggaran).trim() !== '';

            const fotoKegiatanPath = extractUploadedFilePath(req, ['foto_kegiatan'], tahunLpj);
            const notaBelanjaPath = extractUploadedFilePath(req, ['nota_belanja', 'bukti_nota'], tahunLpj);
            const buktiTransferPath = extractUploadedFilePath(req, ['bukti_transfer_bendahara'], tahunLpj);

            const cleanDeskripsi =
                typeof deskripsi_kegiatan === 'string' ? deskripsi_kegiatan.trim() : undefined;

            let lpj = await RealisasiLpj.findOne({ where: { proposalId } });

            const fotoRequired = !isLembagaExemptFromFotoLpj(req, proposal);
            const effectiveFoto = fotoKegiatanPath || (lpj && lpj.foto_kegiatan) || null;
            if (fotoRequired && !effectiveFoto) {
                cleanupUploadedRequestFiles(req);
                req.session.error_msg = 'Foto Dokumentasi Kegiatan wajib diunggah (JPG, PNG, atau WEBP, maksimal 512 KB).';
                return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
            }

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
    },

    // 3. Keputusan Review LPJ oleh Ketua atau Bendahara Utama (selesai begitu salah satu klik Disetujui)
    reviewLpj: async (req, res) => {
        try {
            const proposalId = parsePositiveId(req.params.id);
            if (!proposalId) {
                req.session.error_msg = 'ID Proposal tidak valid.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const proposal = await Proposal.findOne({
                where: { id: proposalId },
                include: [
                    { model: Proker, as: 'Proker' },
                    { model: RealisasiLpj, as: 'RealisasiLpj' }
                ]
            });

            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            if (!canReviewLpj(req, proposal)) {
                req.session.error_msg = 'Akses ditolak. Review LPJ khusus untuk Ketua atau Bendahara Utama.';
                return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
            }

            const lpj = proposal.RealisasiLpj || await RealisasiLpj.findOne({ where: { proposalId } });
            if (!lpj) {
                req.session.error_msg = 'Data LPJ belum dibuat oleh bidang pengaju.';
                return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
            }

            const rawKeputusan = String((req.body && req.body.keputusan) || '').trim().toLowerCase();
            const catatan = (req.body && typeof req.body.catatan_lpj === 'string')
                ? req.body.catatan_lpj.trim()
                : '';

            let nextStatus = null;
            if (rawKeputusan === 'setujui' || rawKeputusan === 'disetujui') {
                nextStatus = 'Disetujui';
            } else if (rawKeputusan === 'revisi' || rawKeputusan === 'revisi_lpj') {
                nextStatus = 'Revisi LPJ';
            }

            if (!nextStatus) {
                req.session.error_msg = 'Pilihan keputusan review LPJ tidak valid.';
                return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
            }

            lpj.status_lpj = nextStatus;
            lpj.catatan_lpj = catatan || null;
            await lpj.save();

            const { user } = resolveUserContext(req);
            const namaReviewer = (user && (user.nama_lengkap || user.jabatan)) || 'Pemeriksa';

            req.session.success_msg = nextStatus === 'Disetujui'
                ? `LPJ berhasil Disetujui oleh ${namaReviewer}. Proses LPJ telah selesai.`
                : `Status LPJ diperbarui menjadi Revisi LPJ oleh ${namaReviewer}.`;

            return res.redirect(`/lembaga-admin/proker/proposal/lpj/${proposalId}`);
        } catch (error) {
            console.error('ERROR REVIEW LPJ:', error);
            req.session.error_msg = 'Gagal memproses review LPJ: ' + (error && error.message ? error.message : 'Terjadi kesalahan.');
            const fallbackUrl = req.params && req.params.id
                ? `/lembaga-admin/proker/proposal/lpj/${req.params.id}`
                : '/lembaga-admin/proposal';
            return res.redirect(fallbackUrl);
        }
    }
};

module.exports = realisasiLpjController;
