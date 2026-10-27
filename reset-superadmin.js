const { User } = require('./models');
const bcrypt = require('bcrypt');

async function resetSuperAdmin() {
  try {
    const hashedPassword = bcrypt.hashSync('B31i72sA', 10);
    
    // Cek apakah superadmin sudah ada
    let user = await User.findOne({ where: { username: 'superadmin' } });
    
    if (user) {
      // Jika sudah ada, update password dan role-nya
      user.password = hashedPassword;
      user.role = 'superadmin';
      await user.save();
      console.log('Password akun superadmin berhasil di-reset!');
    } else {
      // Jika belum ada, buat baru
      await User.create({
        nama_lengkap: 'Super Administrator',
        username: 'superadmin',
        password: hashedPassword,
        role: 'superadmin',
        lembagaId: null
      });
      console.log('Akun superadmin baru berhasil dibuat!');
    }
    process.exit();
  } catch (err) {
    console.error('Gagal reset superadmin:', err);
    process.exit(1);
  }
}

resetSuperAdmin();
