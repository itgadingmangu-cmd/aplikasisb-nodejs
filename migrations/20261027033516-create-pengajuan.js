'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Pengajuans', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      id_program: {
        type: Sequelize.INTEGER
      },
      id_bidang: {
        type: Sequelize.INTEGER
      },
      tanggal_pengajuan: {
        type: Sequelize.DATE
      },
      status: {
        type: Sequelize.STRING
      },
      catatan_admin: {
        type: Sequelize.TEXT
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
    await queryInterface.dropTable('Pengajuans');
  }
};