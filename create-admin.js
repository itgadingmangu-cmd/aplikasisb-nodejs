const { User } = require('./models');

async function run() {
  try {
    await User.create({
      nama_lengkap: 'Super Administrator',
      username: 'admin',
      password: '123',
      role: 'admin',
      id_bidang: null
    });
    console.log('SUKSES: Akun admin berhasil dibuat!');
  } catch (err) {
    console.log('GAGAL (mungkin username sudah ada):', err.message);
  }
  process.exit();
}

run();
