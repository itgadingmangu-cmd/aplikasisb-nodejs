const { Setting } = require('../models');

const superadminController = {
    getSettings: async (req, res) => {
        try {
            let setting = await Setting.findOne();
            if (!setting) {
                setting = await Setting.create({ app_name: 'Aplikasi Program Kerja', app_logo: '' });
            }
            res.render('superadmin/settings', {
                title: 'Pengaturan Global Aplikasi',
                userSession: req.session.user,
                setting: setting
            });
        } catch (error) {
            console.error("ERROR SUPERADMIN SETTINGS:", error);
            res.status(500).send('Terjadi kesalahan pada server: ' + error.message);
        }
    },

    updateSettings: async (req, res) => {
        try {
            const { app_name } = req.body;
            let setting = await Setting.findOne();
            if (!setting) {
                setting = await Setting.create({ app_name: 'Aplikasi Program Kerja' });
            }

            let app_logo = setting.app_logo;
            if (req.file) {
                app_logo = req.file.filename;
            }

            await setting.update({
                app_name: app_name || setting.app_name,
                app_logo: app_logo
            });

            req.session.success_msg = 'Pengaturan global berhasil diperbarui!';
            res.redirect('/superadmin/settings');
        } catch (error) {
            console.error("ERROR UPDATE SETTINGS:", error);
            req.session.error_msg = 'Gagal memperbarui pengaturan.';
            res.redirect('/superadmin/settings');
        }
    }
};

module.exports = superadminController;
