import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool, initializeDatabase } from './db.js';
dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 5000);
const STATUSES = ['Open', 'In Progress', 'Waiting on Customer', 'Resolved'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v) => typeof v === 'string' ? v.trim() : '';
function validateTicket(body, partial = false) {
  const errors = {};
  if (!partial || body.subject !== undefined) if (!clean(body.subject)) errors.subject = 'Subject is required.';
  if (!partial || body.customerName !== undefined) if (!clean(body.customerName)) errors.customerName = 'Customer name is required.';
  if (!partial || body.description !== undefined) if (!clean(body.description)) errors.description = 'Description is required.';
  if (body.status !== undefined && !STATUSES.includes(body.status)) errors.status = 'Invalid status.';
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) errors.priority = 'Invalid priority.';
  if (body.customerEmail !== undefined && clean(body.customerEmail) && !/^\S+@\S+\.\S+$/.test(clean(body.customerEmail))) errors.customerEmail = 'Enter a valid email address.';
  return errors;
}
const ticketShape = (r) => ({
  id: Number(r.id), subject: r.subject, customerName: r.customer_name, customerEmail: r.customer_email,
  description: r.description, status: r.status, priority: r.priority, assignee: r.assignee,
  createdAt: r.created_at, updatedAt: r.updated_at,
  overdue: r.status !== 'Resolved' && Date.now() - new Date(r.created_at).getTime() > 24 * 60 * 60 * 1000,
});
async function activity(client, ticketId, eventType, description, actor = 'Support Agent') {
  await client.query('INSERT INTO ticket_activity(ticket_id,event_type,description,actor) VALUES($1,$2,$3,$4)', [ticketId, eventType, description, actor]);
}
app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status='Open')::int AS open,
    COUNT(*) FILTER (WHERE status='In Progress')::int AS in_progress,
    COUNT(*) FILTER (WHERE status='Resolved')::int AS resolved,
    COUNT(*) FILTER (WHERE priority='Urgent' AND status <> 'Resolved')::int AS urgent,
    COUNT(*) FILTER (WHERE status <> 'Resolved' AND created_at < NOW() - INTERVAL '24 hours')::int AS overdue
    FROM tickets`);
  res.json(rows[0]);
}));

app.get('/api/tickets', asyncRoute(async (req, res) => {
  const { search = '', status = '', priority = '', assignee = '', sort = 'updated' } = req.query;
  const clauses = []; const values = [];
  const add = (sql, val) => { values.push(val); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (search) add("(subject ILIKE '%' || ? || '%' OR customer_name ILIKE '%' || ? || '%' OR customer_email ILIKE '%' || ? || '%')", search);
  // Use explicit indexes for repeated search parameter to keep SQL parameterized.
  let where = '';
  if (search) { values.push(search); const n=values.length; clauses.push(`(subject ILIKE '%' || $${n} || '%' OR customer_name ILIKE '%' || $${n} || '%' OR customer_email ILIKE '%' || $${n} || '%')`); }
  if (status && STATUSES.includes(status)) { values.push(status); clauses.push(`status=$${values.length}`); }
  if (priority && PRIORITIES.includes(priority)) { values.push(priority); clauses.push(`priority=$${values.length}`); }
  if (assignee) { values.push(assignee); clauses.push(`assignee=$${values.length}`); }
  if (clauses.length) where = `WHERE ${clauses.join(' AND ')}`;
  const order = sort === 'priority' ? "CASE priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, updated_at DESC" : 'updated_at DESC';
  const { rows } = await pool.query(`SELECT * FROM tickets ${where} ORDER BY ${order} LIMIT 250`, values);
  res.json(rows.map(ticketShape));
}));

app.post('/api/tickets', asyncRoute(async (req, res) => {
  const errors = validateTicket(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please correct the highlighted fields.', details: errors });
  const b = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`INSERT INTO tickets(subject,customer_name,customer_email,description,status,priority,assignee)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [clean(b.subject), clean(b.customerName), clean(b.customerEmail), clean(b.description), STATUSES.includes(b.status) ? b.status : 'Open', PRIORITIES.includes(b.priority) ? b.priority : 'Medium', clean(b.assignee) || 'Unassigned']);
    const t = rows[0];
    await activity(client, t.id, 'created', `Ticket created with ${t.priority} priority and ${t.status} status.`);
    await client.query('COMMIT'); res.status(201).json(ticketShape(t));
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.get('/api/tickets/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ticket not found.' });
  const [entries, events] = await Promise.all([
    pool.query('SELECT id,entry_type,content,author,created_at FROM ticket_entries WHERE ticket_id=$1 ORDER BY created_at ASC,id ASC', [req.params.id]),
    pool.query('SELECT id,event_type,description,actor,created_at FROM ticket_activity WHERE ticket_id=$1 ORDER BY created_at ASC,id ASC', [req.params.id]),
  ]);
  res.json({ ...ticketShape(rows[0]), entries: entries.rows.map(x => ({ id:Number(x.id), type:x.entry_type, content:x.content, author:x.author, createdAt:x.created_at })), activity: events.rows.map(x => ({ id:Number(x.id), type:x.event_type, description:x.description, actor:x.actor, createdAt:x.created_at })) });
}));

app.patch('/api/tickets/:id', asyncRoute(async (req, res) => {
  const errors = validateTicket(req.body, true);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Invalid ticket fields.', details: errors });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!found.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ticket not found.' }); }
    const old = found.rows[0], b = req.body;
    const next = {
      subject: b.subject === undefined ? old.subject : clean(b.subject),
      customerName: b.customerName === undefined ? old.customer_name : clean(b.customerName),
      customerEmail: b.customerEmail === undefined ? old.customer_email : clean(b.customerEmail),
      description: b.description === undefined ? old.description : clean(b.description),
      status: b.status === undefined ? old.status : b.status,
      priority: b.priority === undefined ? old.priority : b.priority,
      assignee: b.assignee === undefined ? old.assignee : (clean(b.assignee) || 'Unassigned'),
    };
    if (!next.subject || !next.customerName || !next.description || !STATUSES.includes(next.status) || !PRIORITIES.includes(next.priority)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Subject, customer name, description, valid status and priority are required.' }); }
    const { rows } = await client.query(`UPDATE tickets SET subject=$1,customer_name=$2,customer_email=$3,description=$4,status=$5,priority=$6,assignee=$7,updated_at=NOW() WHERE id=$8 RETURNING *`, [next.subject,next.customerName,next.customerEmail,next.description,next.status,next.priority,next.assignee,req.params.id]);
    if (old.status !== next.status) await activity(client, old.id, 'status_changed', `Status changed from ${old.status} to ${next.status}.`);
    if (old.priority !== next.priority) await activity(client, old.id, 'priority_changed', `Priority changed from ${old.priority} to ${next.priority}.`);
    if (old.assignee !== next.assignee) await activity(client, old.id, 'assignment_changed', `Assignee changed from ${old.assignee} to ${next.assignee}.`);
    await client.query('COMMIT'); res.json(ticketShape(rows[0]));
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.post('/api/tickets/:id/entries', asyncRoute(async (req, res) => {
  const content = clean(req.body.content); const type = req.body.type;
  if (!content) return res.status(400).json({ error: 'Reply or note content is required.' });
  if (!['reply','note'].includes(type)) return res.status(400).json({ error: 'Entry type must be reply or note.' });
  const author = clean(req.body.author) || 'Support Agent';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticket = await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!ticket.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ticket not found.' }); }
    const { rows } = await client.query('INSERT INTO ticket_entries(ticket_id,entry_type,content,author) VALUES($1,$2,$3,$4) RETURNING id,entry_type,content,author,created_at', [req.params.id,type,content,author]);
    await client.query('UPDATE tickets SET updated_at=NOW() WHERE id=$1', [req.params.id]);
    await activity(client, req.params.id, type === 'reply' ? 'public_reply' : 'internal_note', `${type === 'reply' ? 'Public reply' : 'Internal note'} added by ${author}.`, author);
    await client.query('COMMIT'); const x=rows[0]; res.status(201).json({ id:Number(x.id), type:x.entry_type, content:x.content, author:x.author, createdAt:x.created_at });
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.use((req,res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === '23503') return res.status(400).json({ error: 'Related record does not exist.' });
  res.status(500).json({ error: 'Internal server error. Check the API terminal for details.' });
});
initializeDatabase().then(() => app.listen(PORT, () => console.log(`Support Desk API running at http://localhost:${PORT}`))).catch(err => { console.error('Database initialization failed:', err.message); process.exit(1); });
