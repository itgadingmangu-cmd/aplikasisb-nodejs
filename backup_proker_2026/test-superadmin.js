const { User, Lembaga, Pengaturan, SiklusTahun, sequelize } = require('./models');

async function runSuperadminTests() {
  console.log('=========================================');
  console.log('🚀 MEMULAI TES MENYELURUH MODUL SUPERADMIN');
  console.log('=========================================');

  let passed = 0;
  let failed = 0;

  try {
    // 1. Tes Koneksi Database
    await sequelize.authenticate();
    console.log('✅ [TEST 1] Koneksi Database PostgreSQL: BERHASIL');
    passed++;
  } catch (err) {
    console.error('❌ [TEST 1] Koneksi Database PostgreSQL: GAGAL', err.message);
    failed++;
  }

  try {
    // 2. Tes Keberadaan Akun Superadmin
    const superadmin = await User.findOne({ where: { role: 'superadmin' } });
    if (superadmin) {
      console.log(`✅ [TEST 2] Akun Superadmin Ditemukan (Username: ${superadmin.username}): BERHASIL`);
      passed++;
    } else {
      console.error('❌ [TEST 2] Akun Superadmin Tidak Ditemukan: GAGAL');
      failed++;
    }
  } catch (err) {
    console.error('❌ [TEST 2] Cek Akun Superadmin Error:', err.message);
    failed++;
  }

  try {
    // 3. Tes Pengaturan Global & Tahun Aktif
    const pengaturan = await Pengaturan.findOne();
    if (pengaturan) {
      console.log(`✅ [TEST 3] Pengaturan Global Ditemukan (Aplikasi: ${pengaturan.nama_aplikasi}, Tahun: ${pengaturan.tahun_aktif}): BERHASIL`);
      passed++;
    } else {
      console.error('❌ [TEST 3] Pengaturan Global Belum Ada: GAGAL');
      failed++;
    }
  } catch (err) {
    console.error('❌ [TEST 3] Cek Pengaturan Global Error:', err.message);
    failed++;
  }

  try {
    // 4. Tes Tabel Lembaga
    const countLembaga = await Lembaga.count();
    console.log(`✅ [TEST 4] Tabel Lembaga Aktif (Total Lembaga Terdaftar: ${countLembaga}): BERHASIL`);
    passed++;
  } catch (err) {
    console.error('❌ [TEST 4] Cek Tabel Lembaga Error:', err.message);
    failed++;
  }

  try {
    // 5. Tes Siklus Tahun Anggaran (History)
    const siklusList = await SiklusTahun.findAll();
    console.log(`✅ [TEST 5] Tabel Siklus Tahun Aktif (Total Arsip Tahun: ${siklusList.length}): BERHASIL`);
    passed++;
  } catch (err) {
    console.error('❌ [TEST 5] Cek Siklus Tahun Error:', err.message);
    failed++;
  }

  console.log('=========================================');
  console.log(`🏁 HASIL AKHIR PENGUJIAN: ${passed} Lolos, ${failed} Gagal`);
  console.log('=========================================');
  
  process.exit(failed > 0 ? 1 : 0);
}

runSuperadminTests();
