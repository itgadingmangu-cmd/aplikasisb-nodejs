const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const { User, Lembaga, Pengaturan, SiklusTahun, sequelize } = require('./models');

const app = express();

// --- KONFIGURASI EXPRESS ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'rahasia-proker-senkom-2026',
  resave: false,
  saveUninitialized: false
}));

app.use((req, res, next) => {
  res.locals.success_msg = req.session.success_msg || null;
  res.locals.error_msg = req.session.error_msg || null;
  delete req.session.success_msg;
  delete req.session.error_msg;
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/logo/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function isSuperAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'superadmin') return next();
  res.status(403).send("Akses ditolak: Halaman ini khusus untuk Superadmin!");
}

// --- RUTE HALAMAN UTAMA (DASHBOARD SUPERADMIN) ---
app.get('/', isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    let pengaturan = await Pengaturan.findOne();
    if (!pengaturan) {
      pengaturan = await Pengaturan.create({ nama_aplikasi: 'Aplikasi Program Kerja', tahun_aktif: 2026 });
    }

    const tahunAktifStr = String(pengaturan.tahun_aktif);

    let currentSiklus = await SiklusTahun.findOne({ where: { tahun: tahunAktifStr } });
    if (!currentSiklus) {
      await SiklusTahun.create({ tahun: tahunAktifStr, status: 'Aktif' });
    }

    const listLembaga = await Lembaga.findAll();
    const dataUser = await User.findAll({ include: ['Bidang'] });
    
    const siklusList = await SiklusTahun.findAll({ order: [['tahun', 'DESC']] });
    const listTahun = siklusList.map(s => String(s.tahun));

    res.render('index', { 
      pengaturan, 
      listLembaga,
      dataUser,
      listTahun,
      userSession: req.session.user 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Terjadi kesalahan pada server: " + err.message);
  }
});

// --- RUTE AUTH ---
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'superadmin' ? '/' : '/lembaga/dashboard');
  }
  res.render('login');
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });

    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,         
        lembagaId: user.lembagaId 
      };
      return res.redirect(user.role === 'superadmin' ? '/' : '/lembaga/dashboard');
    } else {
      req.session.error_msg = "Username atau password salah!";
      res.redirect('/login');
    }
  } catch (err) {
    res.status(500).send("Terjadi kesalahan: " + err.message);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- MANAJEMEN LEMBAGA ---
app.post('/lembaga/tambah', isAuthenticated, isSuperAdmin, upload.single('logo'), async (req, res) => {
  try {
    const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;
    const logo = req.file ? req.file.filename : null;
    await Lembaga.create({ nama_organisasi, nama_ketua, nomor_hp, alamat, logo });
    req.session.success_msg = "Lembaga berhasil ditambahkan!";
    res.redirect('/');
  } catch (err) {
    req.session.error_msg = "Gagal menambah lembaga: " + err.message;
    res.redirect('/');
  }
});

app.post('/lembaga/edit/:id', isAuthenticated, isSuperAdmin, upload.single('logo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;
    let lembaga = await Lembaga.findByPk(id);
    if (!lembaga) return res.status(404).send("Lembaga tidak ditemukan");

    lembaga.nama_organisasi = nama_organisasi;
    lembaga.nama_ketua = nama_ketua;
    lembaga.nomor_hp = nomor_hp;
    lembaga.alamat = alamat;
    if (req.file) lembaga.logo = req.file.filename;

    await lembaga.save();
    req.session.success_msg = "Data lembaga berhasil diperbarui!";
    res.redirect('/');
  } catch (err) {
    req.session.error_msg = "Gagal memperbarui lembaga: " + err.message;
    res.redirect('/');
  }
});

// --- MANAJEMEN USER ---
app.post('/user/tambah', isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { nama_lengkap, username, password, role } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);
    await User.create({ nama_lengkap, username, password: hashedPassword, role: role || 'admin_lembaga' });
    req.session.success_msg = "User baru berhasil ditambahkan!";
    res.redirect('/');
  } catch (err) {
    req.session.error_msg = "Gagal menambah user: " + err.message;
    res.redirect('/');
  }
});

app.post('/user/edit/:id', isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_lengkap, username, password, role } = req.body;
    let user = await User.findByPk(id);
    if (!user) return res.status(404).send("User tidak ditemukan");

    user.nama_lengkap = nama_lengkap;
    user.username = username;
    user.role = role;
    if (password && password.trim() !== "") {
      user.password = bcrypt.hashSync(password, 10);
    }
    await user.save();
    req.session.success_msg = "Data user berhasil diperbarui!";
    res.redirect('/');
  } catch (err) {
    req.session.error_msg = "Gagal mengupdate user: " + err.message;
    res.redirect('/');
  }
});

app.get('/user/hapus/:id', isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    await User.destroy({ where: { id: req.params.id } });
    req.session.success_msg = "User berhasil dihapus!";
    res.redirect('/');
  } catch (err) {
    req.session.error_msg = "Gagal menghapus user.";
    res.redirect('/');
  }
});

// --- PENGATURAN GLOBAL & SIKLUS TAHUN ---
app.post('/pengaturan', isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { nama_aplikasi, tahun_aktif } = req.body;
    const tahunInt = parseInt(tahun_aktif, 10);
    let pengaturan = await Pengaturan.findOne();

    if (pengaturan) {
      pengaturan.nama_aplikasi = nama_aplikasi;
      pengaturan.tahun_aktif = tahunInt;
      await pengaturan.save();
    } else {
      await Pengaturan.create({ nama_aplikasi, tahun_aktif: tahunInt });
    }

    await SiklusTahun.update({ status: 'Arsip' }, { where: {} });
    let [siklus, created] = await SiklusTahun.findOrCreate({
      where: { tahun: String(tahunInt) },
      defaults: { status: 'Aktif' }
    });
    if (!created) {
      siklus.status = 'Aktif';
      await siklus.save();
    }

    req.session.success_msg = `Tahun Anggaran aktif berhasil diatur ke ${tahunInt}!`;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.session.error_msg = "Gagal menyimpan pengaturan: " + err.message;
    res.redirect('/');
  }
});

app.get('/siklus-ta/pilih/:tahun', isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const targetTahunInt = parseInt(req.params.tahun, 10);
    const targetTahunStr = String(targetTahunInt);

    let pengaturan = await Pengaturan.findOne();
    if (pengaturan) {
      pengaturan.tahun_aktif = targetTahunInt;
      await pengaturan.save();
    }

    await SiklusTahun.update({ status: 'Arsip' }, { where: {} });
    await SiklusTahun.update({ status: 'Aktif' }, { where: { tahun: targetTahunStr } });

    req.session.success_msg = `Berhasil beralih ke Tahun Anggaran ${targetTahunInt}`;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.session.error_msg = "Gagal beralih tahun: " + err.message;
    res.redirect('/');
  }
});

app.get('/lembaga/dashboard', isAuthenticated, (req, res) => {
  res.send("Selamat datang di Dashboard Operasional Admin Lembaga!");
});

async function createSuperUser() {
  try {
    const superadminUsername = 'superadmin';
    const adminExists = await User.findOne({ where: { username: superadminUsername } });
    if (!adminExists) {
      const hashedPassword = bcrypt.hashSync('B31i72sA', 10);
      await User.create({
        nama_lengkap: 'Super Administrator',
        username: superadminUsername,
        password: hashedPassword,
        role: 'superadmin',
        lembagaId: null
      });
      console.log('Akun Superuser berhasil dibuat.');
    }
  } catch (err) {
    console.error(err);
  }
}

// --- MENJALANKAN SERVER & SINKRONISASI DATABASE ---
const PORT = 3000;
sequelize.sync({ alter: true }).then(async () => {
  console.log('Database & tabel berhasil disinkronkan.');
  await createSuperUser();
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Gagal sinkronisasi database:', err);
});
