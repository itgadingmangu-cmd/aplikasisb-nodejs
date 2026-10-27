'use strict';
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Pengaturans', 'tahun_aktif', { type: Sequelize.INTEGER, defaultValue: 2026 });
    await queryInterface.addColumn('ProgramKerjas', 'tahun', { type: Sequelize.INTEGER, defaultValue: 2026 });
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Pengaturans', 'tahun_aktif');
    await queryInterface.removeColumn('ProgramKerjas', 'tahun');
  }
};
