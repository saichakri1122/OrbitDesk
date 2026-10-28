-- Run this after creating the support_desk database. The API also creates these tables at startup.
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
