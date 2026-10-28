# OrbitDesk — Support Desk System

A full-stack support ticket management app built for the Comhard Technologies practical assessment.

## Stack
- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS v4
- **Backend:** Node.js + Express REST API
- **Database:** PostgreSQL (`pg` connection pool)
- **API testing:** Postman or Thunder Client

## Features
- Create and view tickets; edit ticket details
- Four statuses: Open, In Progress, Waiting on Customer, Resolved
- Four priorities: Low, Medium, High, Urgent
- Assign tickets to agents
- Public replies and clearly distinguished internal notes
- Chronological conversation and activity history
- Search by subject/customer name/email
- Combined status, priority and assignee filters
- Sort by most recently updated or priority
- Live dashboard counts: total, open, in progress, resolved, urgent and overdue
- Overdue rule: unresolved ticket created more than 24 hours ago
- Server-side required-field validation and friendly API errors
- PostgreSQL persistence; deleting a ticket is intentionally not exposed, and foreign keys use `ON DELETE CASCADE` to prevent orphaned records if deletion is added later

## Requirements
- Node.js 20+
- PostgreSQL 14+ (local or hosted)

## Setup

### 1. Create a PostgreSQL database

Using `psql` or pgAdmin, run:

```sql
CREATE DATABASE support_desk;
```

### 2. Configure the API

```bash
cd server
```
Copy `.env.example` to `.env`, then set `DATABASE_URL` to your PostgreSQL connection string. Example:

```env
PORT=5000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/support_desk
CLIENT_ORIGIN=http://localhost:3000
```

If your hosted PostgreSQL provider requires TLS, set `PGSSL=true`. Keep `.env` private and never commit credentials.

The API creates the tables and indexes on startup. `schema.sql` is also included for review or manual setup.

### 3. Install dependencies

From the project root:

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 4. Run both applications

From the project root:

```bash
npm run dev
```

Open **http://localhost:3000**. The Express API runs on **http://localhost:5000**.

To run independently, use two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Optional frontend environment override: copy `client/.env.local.example` to `client/.env.local` and set `NEXT_PUBLIC_API_URL=http://localhost:5000/api`.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API and database health check |
| GET | `/api/dashboard` | Current dashboard metrics |
| GET | `/api/tickets?search=&status=&priority=&assignee=&sort=updated` | List/filter/search/sort tickets |
| POST | `/api/tickets` | Create ticket |
| GET | `/api/tickets/:id` | Ticket details, entries and activity |
| PATCH | `/api/tickets/:id` | Update ticket fields |
| POST | `/api/tickets/:id/entries` | Add public reply or internal note |

### Example create request

```json
{
  "subject": "Unable to reset password",
  "customerName": "Jordan Smith",
  "customerEmail": "jordan@example.com",
  "description": "Password reset link expires immediately.",
  "priority": "High",
  "status": "Open",
  "assignee": "Alex Morgan"
}
```

### Example entry request

```json
{
  "type": "note",
  "content": "Checked the authentication logs; investigating token expiry.",
  "author": "Alex Morgan"
}
```

`type` must be `reply` or `note`. The UI distinguishes internal notes from public replies. This demo app has no authentication; do not use it with real customer data.

## Quick API checks

After starting the API, check `GET http://localhost:5000/api/health`. Then create a ticket with `POST /api/tickets` using the JSON above. Use `GET /api/tickets` and `GET /api/dashboard` to verify persistence and counts. Change status/priority/assignee with `PATCH /api/tickets/1` (replace `1` with your ticket ID) and confirm the event appears in the ticket activity list.

## Architecture

Next.js renders the client-facing support workspace. The browser calls the Express REST API. Express validates requests and uses a PostgreSQL connection pool. Ticket creation, field changes and replies/notes write activity records. Ticket entries and activity rows reference their ticket with foreign keys and `ON DELETE CASCADE`.

## Known limitations / assumptions
- The app is a demo and intentionally has no login, permissions, email delivery, or real customer data.
- Assignee choices are a fixed demo list; a separate agent-management table is not required by the brief.
- Ticket deletion is not exposed, preserving activity and conversation history.
- The API limits list responses to 250 tickets; pagination is an optional stretch goal.
- Overdue is computed from `created_at` and excludes resolved tickets.
- API and frontend dependencies must be installed before running; PostgreSQL must be reachable through `DATABASE_URL`.

## AI usage note
AI assistance was used to scaffold and review parts of the implementation. The candidate should run the app, verify the critical flows, understand the schema and endpoints, and be ready to explain all submitted code and decisions.
