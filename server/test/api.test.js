import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000/api';

async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), data };
}

describe('OrbitDesk API Test Suite', () => {
  let createdTicketId;

  test('GET /api/health returns database connectivity status', async () => {
    const res = await api('/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'ok');
    assert.equal(res.data.database, 'connected');
  });

  test('Security headers are enforced and X-Powered-By is omitted', async () => {
    const res = await api('/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('GET /api/dashboard returns complete metrics including waiting status', async () => {
    const res = await api('/dashboard');
    assert.equal(res.status, 200);
    assert.equal(typeof res.data.total, 'number');
    assert.equal(typeof res.data.open, 'number');
    assert.equal(typeof res.data.in_progress, 'number');
    assert.equal(typeof res.data.waiting, 'number');
    assert.equal(typeof res.data.resolved, 'number');
    assert.equal(typeof res.data.urgent, 'number');
    assert.equal(typeof res.data.overdue, 'number');
    assert.equal(res.data.total, res.data.open + res.data.in_progress + res.data.waiting + res.data.resolved);
  });

  test('GET /api/tickets list returns tickets array', async () => {
    const res = await api('/tickets');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
  });

  test('ISSUE-001 Verification: Ticket search executes safely without PostgreSQL error', async () => {
    const res = await api('/tickets?search=login');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));

    // Non-matching search
    const emptyRes = await api('/tickets?search=nonexistenttermxyz999');
    assert.equal(emptyRes.status, 200);
    assert.ok(Array.isArray(emptyRes.data));
    assert.equal(emptyRes.data.length, 0);

    // Search with special characters
    const specialRes = await api('/tickets?search=%27%22%25');
    assert.equal(specialRes.status, 200);
    assert.ok(Array.isArray(specialRes.data));
  });

  test('ISSUE-004 Verification: Non-numeric and malformed ticket IDs return HTTP 404', async () => {
    const resGet = await api('/tickets/invalid-id');
    assert.equal(resGet.status, 404);
    assert.equal(resGet.data.error, 'Ticket not found.');

    const resPatch = await api('/tickets/invalid-id', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Open' })
    });
    assert.equal(resPatch.status, 404);

    const resEntries = await api('/tickets/invalid-id/entries', {
      method: 'POST',
      body: JSON.stringify({ type: 'reply', content: 'test' })
    });
    assert.equal(resEntries.status, 404);

    const resNonexistent = await api('/tickets/999999999');
    assert.equal(resNonexistent.status, 404);
  });

  test('ISSUE-003 Verification: Input validation enforces schema boundaries with HTTP 400', async () => {
    // Missing required fields
    const emptyRes = await api('/tickets', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(emptyRes.status, 400);
    assert.ok(emptyRes.data.details.subject);
    assert.ok(emptyRes.data.details.customerName);
    assert.ok(emptyRes.data.details.description);

    // Subject exceeding 200 chars
    const longSubjectRes = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        subject: 'X'.repeat(250),
        customerName: 'Test Customer',
        description: 'Test description'
      })
    });
    assert.equal(longSubjectRes.status, 400);
    assert.match(longSubjectRes.data.details.subject, /cannot exceed 200 characters/i);

    // Customer name exceeding 120 chars
    const longNameRes = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Valid Subject',
        customerName: 'Y'.repeat(150),
        description: 'Test description'
      })
    });
    assert.equal(longNameRes.status, 400);
    assert.match(longNameRes.data.details.customerName, /cannot exceed 120 characters/i);

    // Invalid email format
    const badEmailRes = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Valid Subject',
        customerName: 'Valid Name',
        customerEmail: 'notanemail',
        description: 'Test description'
      })
    });
    assert.equal(badEmailRes.status, 400);
    assert.match(badEmailRes.data.details.customerEmail, /valid email/i);
  });

  test('ISSUE-015 Verification: Malformed JSON returns HTTP 400 instead of HTTP 500', async () => {
    const res = await api('/tickets', {
      method: 'POST',
      body: '{malformedJsonPayload:'
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /Malformed JSON payload/i);
  });

  test('Create ticket happy path', async () => {
    const res = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Automated Test Ticket Verification',
        customerName: 'QA Bot',
        customerEmail: 'qabot@example.com',
        description: 'Verifying automated testing flow and activity tracking.',
        priority: 'High',
        status: 'Open',
        assignee: 'Alex Morgan',
        actor: 'Alex Morgan'
      })
    });
    assert.equal(res.status, 201);
    assert.ok(res.data.id > 0);
    assert.equal(res.data.subject, 'Automated Test Ticket Verification');
    assert.equal(res.data.status, 'Open');
    assert.equal(res.data.priority, 'High');
    createdTicketId = res.data.id;
  });

  test('ISSUE-005 & ISSUE-007 Verification: Ticket update records activity for subject and actor', async () => {
    assert.ok(createdTicketId);

    // Update subject, description, status, priority, assignee with actor
    const updateRes = await api(`/tickets/${createdTicketId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subject: 'Updated Ticket Subject Title',
        description: 'Updated ticket description content.',
        status: 'In Progress',
        priority: 'Urgent',
        assignee: 'Jamie Lee',
        actor: 'Jamie Lee'
      })
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.subject, 'Updated Ticket Subject Title');
    assert.equal(updateRes.data.status, 'In Progress');
    assert.equal(updateRes.data.priority, 'Urgent');
    assert.equal(updateRes.data.assignee, 'Jamie Lee');

    // Retrieve details and inspect activity history
    const detailRes = await api(`/tickets/${createdTicketId}`);
    assert.equal(detailRes.status, 200);
    const activityTypes = detailRes.data.activity.map((a) => a.type);
    assert.ok(activityTypes.includes('created'));
    assert.ok(activityTypes.includes('status_changed'));
    assert.ok(activityTypes.includes('priority_changed'));
    assert.ok(activityTypes.includes('assignment_changed'));
    assert.ok(activityTypes.includes('subject_changed'));
    assert.ok(activityTypes.includes('description_changed'));

    // Verify actor attribution
    const subjectActivity = detailRes.data.activity.find((a) => a.type === 'subject_changed');
    assert.equal(subjectActivity.actor, 'Jamie Lee');
  });

  test('Add public reply and internal note', async () => {
    assert.ok(createdTicketId);

    // Public reply
    const replyRes = await api(`/tickets/${createdTicketId}/entries`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'reply',
        content: 'This is a customer-facing public reply.',
        author: 'Alex Morgan'
      })
    });
    assert.equal(replyRes.status, 201);
    assert.equal(replyRes.data.type, 'reply');

    // Internal note
    const noteRes = await api(`/tickets/${createdTicketId}/entries`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        content: 'This is an internal note visible only to support agents.',
        author: 'Taylor Reed'
      })
    });
    assert.equal(noteRes.status, 201);
    assert.equal(noteRes.data.type, 'note');

    // Invalid entry type
    const invalidTypeRes = await api(`/tickets/${createdTicketId}/entries`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'email',
        content: 'Should be rejected',
        author: 'Alex Morgan'
      })
    });
    assert.equal(invalidTypeRes.status, 400);

    // Verify conversation thread count
    const detailRes = await api(`/tickets/${createdTicketId}`);
    assert.equal(detailRes.data.entries.length, 2);
  });
});
