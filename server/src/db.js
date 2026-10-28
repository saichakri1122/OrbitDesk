import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is missing. Copy server/.env.example to server/.env and configure PostgreSQL.');
}
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true'
    ? { rejectUnauthorized: process.env.NODE_ENV === 'production' && process.env.PGSSL_ALLOW_SELF_SIGNED !== 'true' }
    : undefined,
});

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      subject VARCHAR(200) NOT NULL,
      customer_name VARCHAR(120) NOT NULL,
      customer_email VARCHAR(254) NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Waiting on Customer','Resolved')),
      priority VARCHAR(20) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Urgent')),
      assignee VARCHAR(120) NOT NULL DEFAULT 'Unassigned',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ticket_entries (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('reply','note')),
      content TEXT NOT NULL,
      author VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ticket_activity (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      event_type VARCHAR(60) NOT NULL,
      description TEXT NOT NULL,
      actor VARCHAR(120) NOT NULL DEFAULT 'Support Agent',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee);
    CREATE INDEX IF NOT EXISTS idx_entries_ticket_id ON ticket_entries(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_ticket_id ON ticket_activity(ticket_id, created_at);
  `);
}
