import { Pool } from 'pg';

const MAX_ANSWER_LEN = 500;
const MAX_NAME_LEN = 60;

// ponytail: pool dibuat sekali per cold start, dipakai ulang tiap invocation.
// Pakai connection string "Transaction pooler" (port 6543) dari Supabase,
// bukan direct connection (5432), biar gak kehabisan koneksi di serverless.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ponytail: cache tetap hidup selama instance serverless-nya warm, jadi
// CREATE TABLE cuma jalan sekali per cold start, bukan tiap request.
// Pindah ke migration terpisah kalau ini pernah butuh diaudit jadi schema resmi.
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS answers (
      id SERIAL PRIMARY KEY,
      question_id TEXT NOT NULL,
      name TEXT,
      answer TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  tableReady = true;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const questionId = String(req.query.questionId || '');
    if (!questionId) return res.status(400).json({ error: 'questionId required' });
    await ensureTable();
    const { rows } = await pool.query(
      `SELECT id, name, answer, created_at FROM answers
       WHERE question_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [questionId]
    );
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { questionId, name, answer } = req.body || {};
    if (!questionId || !answer || !String(answer).trim()) {
      return res.status(400).json({ error: 'questionId and answer required' });
    }
    const cleanAnswer = String(answer).trim().slice(0, MAX_ANSWER_LEN);
    const cleanName = (String(name || '').trim() || 'Anonim').slice(0, MAX_NAME_LEN);
    await ensureTable();
    await pool.query(
      `INSERT INTO answers (question_id, name, answer) VALUES ($1, $2, $3)`,
      [String(questionId), cleanName, cleanAnswer]
    );
    return res.status(201).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
}
