require('dotenv').config();
const express = require('express');
const db = require('./models');
const { User, Bidang, ProgramKerja, Pengajuan, Laporan } = db;

const app = express();
const port = 3000;

// Konfigurasi template engine EJS & pembacaan form HTML
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rute Tampilan Antarmuka (UI)
app.get('/', async (req, res) => {
  try {
    const dataBidang = await Bidang.findAll();
    res.render('index', { dataBidang });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// --- API BIDANG ---
app.post('/bidang', async (req, res) => {
  try {
    const { nama_bidang, username, password } = req.body;
    await Bidang.create({ nama_bidang, username, password });
    res.redirect('/'); // Mengembalikan ke halaman dasbor setelah simpan
  } catch (err) {
    res.status(500).send(err.message);
  }
});
app.get('/bidang', async (req, res) => {
  try {
    const data = await Bidang.findAll();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API PROGRAM KERJA ---
app.post('/programkerja', async (req, res) => {
  try {
    const { id_bidang, nama_kegiatan, jadwal_bulan, volume, biaya_satuan, total_biaya } = req.body;
    const newData = await ProgramKerja.create({ id_bidang, nama_kegiatan, jadwal_bulan, volume, biaya_satuan, total_biaya });
    res.status(201).json(newData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/programkerja', async (req, res) => {
  try {
    const data = await ProgramKerja.findAll({ include: Bidang });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API PENGAJUAN ---
app.post('/pengajuan', async (req, res) => {
  try {
    const { id_program, id_bidang, tanggal_pengajuan, status, catatan_admin } = req.body;
    const newData = await Pengajuan.create({ id_program, id_bidang, tanggal_pengajuan, status, catatan_admin });
    res.status(201).json(newData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/pengajuan', async (req, res) => {
  try {
    const data = await Pengajuan.findAll({ include: [ProgramKerja, Bidang] });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API LAPORAN ---
app.post('/laporan', async (req, res) => {
  try {
    const { id_pengajuan, tanggal_realisasi, file_bukti } = req.body;
    const newData = await Laporan.create({ id_pengajuan, tanggal_realisasi, file_bukti });
    res.status(201).json(newData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/laporan', async (req, res) => {
  try {
    const data = await Laporan.findAll({ include: Pengajuan });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
