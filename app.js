require('dotenv').config();
const express = require('express');
const db = require('./models');
const { User, Bidang, ProgramKerja, Pengajuan, Laporan } = db;

const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('API Sistem Informasi Program Kerja berjalan!');
});

app.post('/bidang', async (req, res) => {
  try {
    const { nama_bidang, username, password } = req.body;
    const newBidang = await Bidang.create({ nama_bidang, username, password });
    res.status(201).json(newBidang);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
