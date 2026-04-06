import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });
const { Client } = pkg;

const c = new Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: false,
});
await c.connect();
const r = await c.query(
  "select current_setting('transaction_read_only') as read_only, inet_server_addr()::text as server"
);
console.log(r.rows[0]);
await c.end();
