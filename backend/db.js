const { Pool } = require('pg');
const fs=require('node:fs');
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD_FILE ? fs.readFileSync(process.env.DB_PASSWORD_FILE,'utf8').trim() : process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT||5432),
  max: Number(process.env.DB_POOL_SIZE||10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  ...(process.env.DB_SSL_CA_FILE?{ssl:{rejectUnauthorized:true,ca:fs.readFileSync(process.env.DB_SSL_CA_FILE,'utf8')}}:{}),
});
pool.on('error',error=>console.error(JSON.stringify({service:'database',error:'Idle connection failed',code:error.code||'unknown'})));
module.exports = pool;
