import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool, initializeDatabase } from './db.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 5000);
const STATUSES = ['Open', 'In Progress', 'Waiting on Customer', 'Resolved'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

// Security: Disable X-Powered-By fingerprinting
app.disable('x-powered-by');

// Security: Standard hardening headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// In-memory sliding window rate limiter (prevents flooding / DoS)
const rateLimitMap = new Map();
function rateLimiter(maxRequests = 300, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + windowMs;
    } else {
      entry.count++;
    }
    rateLimitMap.set(ip, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }
    next();
  };
}
app.use('/api/', rateLimiter(400, 60000));

// CORS configuration: Support localhost and 127.0.0.1 origins
const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Origin not allowed.'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v) => typeof v === 'string' ? v.trim() : '';

// Validation with schema length limits
function validateTicket(body, partial = false) {
  const errors = {};
  const s = clean(body.subject);
  const cn = clean(body.customerName);
  const ce = clean(body.customerEmail);
  const desc = clean(body.description);
  const asgn = clean(body.assignee);

  if (!partial || body.subject !== undefined) {
    if (!s) errors.subject = 'Subject is required.';
    else if (s.length > 200) errors.subject = 'Subject cannot exceed 200 characters.';
  }
  if (!partial || body.customerName !== undefined) {
    if (!cn) errors.customerName = 'Customer name is required.';
    else if (cn.length > 120) errors.customerName = 'Customer name cannot exceed 120 characters.';
  }
  if (!partial || body.description !== undefined) {
    if (!desc) errors.description = 'Description is required.';
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    errors.status = 'Invalid status. Must be Open, In Progress, Waiting on Customer, or Resolved.';
  }
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) {
    errors.priority = 'Invalid priority. Must be Low, Medium, High, or Urgent.';
  }
  if (body.customerEmail !== undefined && ce) {
    if (ce.length > 254) errors.customerEmail = 'Email cannot exceed 254 characters.';
    else if (!/^\S+@\S+\.\S+$/.test(ce)) errors.customerEmail = 'Enter a valid email address.';
  }
  if (body.assignee !== undefined && asgn && asgn.length > 120) {
    errors.assignee = 'Assignee name cannot exceed 120 characters.';
  }
  return errors;
}

// Middleware: Validate integer ticket ID in route params
function validateTicketId(req, res, next) {
  const idStr = req.params.id;
  if (!/^\d+$/.test(idStr) || Number(idStr) <= 0 || Number(idStr) > Number.MAX_SAFE_INTEGER) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }
  next();
}

const ticketShape = (r) => ({
  id: Number(r.id),
  subject: r.subject,
  customerName: r.customer_name,
  customerEmail: r.customer_email,
  description: r.description,
  status: r.status,
  priority: r.priority,
  assignee: r.assignee,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  overdue: r.status !== 'Resolved' && Date.now() - new Date(r.created_at).getTime() > 24 * 60 * 60 * 1000,
});

async function activity(client, ticketId, eventType, description, actor = 'Support Agent') {
  await client.query(
    'INSERT INTO ticket_activity(ticket_id, event_type, description, actor) VALUES($1, $2, $3, $4)',
    [ticketId, eventType, description, clean(actor) || 'Support Agent']
  );
}

// Health check endpoint
app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

// Dashboard metrics endpoint: Includes Waiting on Customer
app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status='Open')::int AS open,
    COUNT(*) FILTER (WHERE status='In Progress')::int AS in_progress,
    COUNT(*) FILTER (WHERE status='Waiting on Customer')::int AS waiting,
    COUNT(*) FILTER (WHERE status='Resolved')::int AS resolved,
    COUNT(*) FILTER (WHERE priority='Urgent' AND status <> 'Resolved')::int AS urgent,
    COUNT(*) FILTER (WHERE status <> 'Resolved' AND created_at < NOW() - INTERVAL '24 hours')::int AS overdue
    FROM tickets`);
  res.json(rows[0]);
}));

// List / filter / search / sort tickets
app.get('/api/tickets', asyncRoute(async (req, res) => {
  const { search = '', status = '', priority = '', assignee = '', sort = 'updated', page = '1', limit = '250' } = req.query;
  const clauses = [];
  const values = [];

  const searchTerm = clean(search);
  if (searchTerm) {
    values.push(searchTerm);
    const n = values.length;
    clauses.push(`(subject ILIKE '%' || $${n} || '%' OR customer_name ILIKE '%' || $${n} || '%' OR customer_email ILIKE '%' || $${n} || '%')`);
  }

  if (status && STATUSES.includes(status)) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }
  if (priority && PRIORITIES.includes(priority)) {
    values.push(priority);
    clauses.push(`priority = $${values.length}`);
  }
  if (assignee && clean(assignee)) {
    values.push(clean(assignee));
    clauses.push(`assignee = $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = sort === 'priority'
    ? "CASE priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, updated_at DESC"
    : 'updated_at DESC';

  const safeLimit = Math.min(250, Math.max(1, parseInt(String(limit), 10) || 250));
  const safePage = Math.max(1, parseInt(String(page), 10) || 1);
  const offset = (safePage - 1) * safeLimit;

  values.push(safeLimit);
  const limitIdx = values.length;
  values.push(offset);
  const offsetIdx = values.length;

  const { rows } = await pool.query(
    `SELECT * FROM tickets ${where} ORDER BY ${order} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    values
  );
  res.json(rows.map(ticketShape));
}));

// Create ticket
app.post('/api/tickets', asyncRoute(async (req, res) => {
  const errors = validateTicket(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', details: errors });
  }
  const b = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tickets(subject, customer_name, customer_email, description, status, priority, assignee)
       VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        clean(b.subject),
        clean(b.customerName),
        clean(b.customerEmail),
        clean(b.description),
        STATUSES.includes(b.status) ? b.status : 'Open',
        PRIORITIES.includes(b.priority) ? b.priority : 'Medium',
        clean(b.assignee) || 'Unassigned',
      ]
    );
    const t = rows[0];
    const actor = clean(b.actor) || 'Support Agent';
    await activity(client, t.id, 'created', `Ticket created with ${t.priority} priority and ${t.status} status.`, actor);
    await client.query('COMMIT');
    res.status(201).json(ticketShape(t));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Get ticket details with entries and activity
app.get('/api/tickets/:id', validateTicketId, asyncRoute(async (req, res) => {
  const ticketId = req.params.id;
  const { rows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  if (!rows.length) return res.status(404).json({ error: 'Ticket not found.' });

  const [entries, events] = await Promise.all([
    pool.query(
      'SELECT id, entry_type, content, author, created_at FROM ticket_entries WHERE ticket_id = $1 ORDER BY created_at ASC, id ASC',
      [ticketId]
    ),
    pool.query(
      'SELECT id, event_type, description, actor, created_at FROM ticket_activity WHERE ticket_id = $1 ORDER BY created_at ASC, id ASC',
      [ticketId]
    ),
  ]);

  res.json({
    ...ticketShape(rows[0]),
    entries: entries.rows.map((x) => ({
      id: Number(x.id),
      type: x.entry_type,
      content: x.content,
      author: x.author,
      createdAt: x.created_at,
    })),
    activity: events.rows.map((x) => ({
      id: Number(x.id),
      type: x.event_type,
      description: x.description,
      actor: x.actor,
      createdAt: x.created_at,
    })),
  });
}));

// Partial update ticket
app.patch('/api/tickets/:id', validateTicketId, asyncRoute(async (req, res) => {
  const ticketId = req.params.id;
  const errors = validateTicket(req.body, true);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Invalid ticket fields.', details: errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const old = found.rows[0];
    const b = req.body;
    const actor = clean(b.actor) || 'Support Agent';

    const next = {
      subject: b.subject === undefined ? old.subject : clean(b.subject),
      customerName: b.customerName === undefined ? old.customer_name : clean(b.customerName),
      customerEmail: b.customerEmail === undefined ? old.customer_email : clean(b.customerEmail),
      description: b.description === undefined ? old.description : clean(b.description),
      status: b.status === undefined ? old.status : b.status,
      priority: b.priority === undefined ? old.priority : b.priority,
      assignee: b.assignee === undefined ? old.assignee : (clean(b.assignee) || 'Unassigned'),
    };

    if (
      !next.subject ||
      !next.customerName ||
      !next.description ||
      !STATUSES.includes(next.status) ||
      !PRIORITIES.includes(next.priority)
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Subject, customer name, description, valid status and priority are required.' });
    }

    const { rows } = await client.query(
      `UPDATE tickets SET subject = $1, customer_name = $2, customer_email = $3, description = $4,
       status = $5, priority = $6, assignee = $7, updated_at = NOW() WHERE id = $8 RETURNING *`,
      [next.subject, next.customerName, next.customerEmail, next.description, next.status, next.priority, next.assignee, ticketId]
    );

    // Record audit trail for all changes including subject & description
    if (old.subject !== next.subject) {
      await activity(client, old.id, 'subject_changed', `Subject updated from "${old.subject}" to "${next.subject}".`, actor);
    }
    if (old.description !== next.description) {
      await activity(client, old.id, 'description_changed', 'Ticket description was updated.', actor);
    }
    if (old.status !== next.status) {
      await activity(client, old.id, 'status_changed', `Status changed from ${old.status} to ${next.status}.`, actor);
    }
    if (old.priority !== next.priority) {
      await activity(client, old.id, 'priority_changed', `Priority changed from ${old.priority} to ${next.priority}.`, actor);
    }
    if (old.assignee !== next.assignee) {
      await activity(client, old.id, 'assignment_changed', `Assignee changed from ${old.assignee} to ${next.assignee}.`, actor);
    }

    await client.query('COMMIT');
    res.json(ticketShape(rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Add public reply or internal note
app.post('/api/tickets/:id/entries', validateTicketId, asyncRoute(async (req, res) => {
  const ticketId = req.params.id;
  const content = clean(req.body.content);
  const type = req.body.type;

  if (!content) return res.status(400).json({ error: 'Reply or note content is required.' });
  if (content.length > 50000) return res.status(400).json({ error: 'Entry content cannot exceed 50,000 characters.' });
  if (!['reply', 'note'].includes(type)) return res.status(400).json({ error: 'Entry type must be reply or note.' });

  const author = clean(req.body.author) || 'Support Agent';
  if (author.length > 120) return res.status(400).json({ error: 'Author name cannot exceed 120 characters.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticket = await client.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (!ticket.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const { rows } = await client.query(
      'INSERT INTO ticket_entries(ticket_id, entry_type, content, author) VALUES($1, $2, $3, $4) RETURNING id, entry_type, content, author, created_at',
      [ticketId, type, content, author]
    );

    await client.query('UPDATE tickets SET updated_at = NOW() WHERE id = $1', [ticketId]);
    await activity(
      client,
      ticketId,
      type === 'reply' ? 'public_reply' : 'internal_note',
      `${type === 'reply' ? 'Public reply' : 'Internal note'} added by ${author}.`,
      author
    );
    await client.query('COMMIT');

    const x = rows[0];
    res.status(201).json({
      id: Number(x.id),
      type: x.entry_type,
      content: x.content,
      author: x.author,
      createdAt: x.created_at,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// 404 handler for unrecognized endpoints
app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// Central error handler
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload.' });
  }
  if (err.message && err.message.startsWith('CORS policy:')) {
    return res.status(403).json({ error: err.message });
  }
  if (err.code === '23503') return res.status(400).json({ error: 'Related record does not exist.' });
  if (err.code === '22001') return res.status(400).json({ error: 'One or more fields exceed the maximum allowed length.' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid data format provided.' });

  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error. Check the API terminal for details.' });
});

// Server startup with graceful shutdown
let server;
initializeDatabase()
  .then(() => {
    server = app.listen(PORT, () => console.log(`Support Desk API running at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Database initialization failed:', err.message);
    process.exit(1);
  });

const shutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down API gracefully...`);
  if (server) {
    server.close(async () => {
      try {
        await pool.end();
        console.log('PostgreSQL connection pool closed.');
        process.exit(0);
      } catch (err) {
        console.error('Error closing database pool:', err);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
