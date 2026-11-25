require('dotenv').config();

const dbPassword = process.env.DB_PASSWORD || process.env.DB_PASS;
const dbHost = process.env.DB_HOST;
const useSsl =
  process.env.DB_SSL === 'true' ||
  (typeof dbHost === 'string' && dbHost.includes('supabase.com'));

const baseConfig = {
  username: process.env.DB_USER,
  password: dbPassword,
  database: process.env.DB_NAME,
  host: dbHost,
  port: Number(process.env.DB_PORT) || 5432,
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    // Memaksa koneksi menggunakan IPv4 untuk menghindari ENETUNREACH
    family: 4,
  },
};

module.exports = {
  development: {
    ...baseConfig,
    ...(useSsl
      ? {
          dialectOptions: {
            ...baseConfig.dialectOptions,
            ssl: {
              require: true,
              rejectUnauthorized: false,
            },
          },
        }
      : {}),
  },
  production: {
    ...baseConfig,
    pool: {
      max: Number(process.env.DB_POOL_MAX) || 5,
      min: Number(process.env.DB_POOL_MIN) || 0,
      acquire: Number(process.env.DB_POOL_ACQUIRE) || 20000,
      idle: Number(process.env.DB_POOL_IDLE) || 10000,
    },
    ...(useSsl
      ? {
          dialectOptions: {
            ...baseConfig.dialectOptions,
            ssl: {
              require: true,
              rejectUnauthorized: false,
            },
          },
        }
      : {}),
  },
};
