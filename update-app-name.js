const { Pengaturan } = require('./models');

async function updateAppName() {
  try {
    let pengaturan = await Pengaturan.findOne();
    if (pengaturan) {
      pengaturan.nama_aplikasi = 'Aplikasi Program Kerja';
      await pengaturan.save();
      console.log('Nama aplikasi berhasil diubah menjadi: Aplikasi Program Kerja');
    } else {
      await Pengaturan.create({
        nama_aplikasi: 'Aplikasi Program Kerja',
        tahun_aktif: '2026'
      });
      console.log('Pengaturan baru dibuat dengan nama: Aplikasi Program Kerja');
    }
    process.exit();
  } catch (err) {
    console.error('Gagal memperbarui nama aplikasi:', err);
    process.exit(1);
  }
}

updateAppName();
