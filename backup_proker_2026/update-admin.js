const { User } = require('./models');

async function run() {
  try {
    // Cari akun admin lama, lalu update, atau buat baru jika belum ada
    const [user, created] = await User.findOrCreate({
      where: { username: 'admin' },
      defaults: {
        nama_lengkap: 'Super Administrator',
        username: 'superadmin',
        password: 'B31i72sA',
        role: 'admin',
        id_bidang: null
      }
    });

    if (!created) {
      user.username = 'superadmin';
      user.password = 'B31i72sA';
      user.role = 'admin';
      await user.save();
      console.log('SUKSES: Akun berhasil diubah menjadi username: superadmin');
    } else {
      console.log('SUKSES: Akun superadmin baru berhasil dibuat!');
    }
  } catch (err) {
    console.log('GAGAL:', err.message);
  }
  process.exit();
}

run();
