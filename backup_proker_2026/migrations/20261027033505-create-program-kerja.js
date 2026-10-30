'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ProgramKerjas', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      id_bidang: {
        type: Sequelize.INTEGER
      },
      nama_kegiatan: {
        type: Sequelize.STRING
      },
      jadwal_bulan: {
        type: Sequelize.STRING
      },
      volume: {
        type: Sequelize.INTEGER
      },
      biaya_satuan: {
        type: Sequelize.INTEGER
      },
      total_biaya: {
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('ProgramKerjas');
  }
};