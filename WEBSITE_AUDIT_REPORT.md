# OrbitDesk Support Desk — Complete Website Audit & Bug Detection Report

**Date of Audit:** October 28, 2026  
**Auditor Roles:** Senior Full-Stack Developer, QA Engineer, Security Tester, and Software Architect  
**Project Name:** OrbitDesk (Support Desk / Ticket Management System)  
**Target Environment:** Node.js v24.18.0, Express.js v4.21.2, Next.js v15.1.6 / React 19, PostgreSQL 14+  
**Scope:** Full codebase audit (Frontend, Backend REST API, Database Schema, Security, Performance, Functional Workflows)

---

## A. Executive Summary

### Overall Application Health
The **OrbitDesk Support Desk** application is a functional prototype of a customer support ticketing system featuring ticket creation, property management (status, priority, assignment), public customer replies, internal team notes, chronological activity tracking, and dashboard overview metrics. 

While the application's foundational data model, database relationships (`ON DELETE CASCADE`), and basic transactional boundaries are sound, the codebase exhibits **critical architectural, functional, security, and usability defects** that prevent it from being production-ready or reliably demonstrated without immediate intervention.

### Major Findings
1. **Critical Blocker (Search Crash):** Searching for tickets (`GET /api/tickets?search=...`) immediately crashes the backend with a PostgreSQL syntax error (`42883: operator does not exist: || unknown`). This is caused by duplicate, defective clause generation in `server/src/index.js` that leaves literal `?` tokens in parameterized SQL. In the UI, typing a single letter into the search bar crashes the ticket queue view.
2. **Mobile Navigation Deadlock:** The mobile hamburger button (`☰`) toggles internal state but lacks CSS/class bindings to render the sidebar navigation drawer on screens $\le 850\text{px}$. Users on mobile devices cannot navigate between queues.
3. **Unhandled Database Crashes on Input:** Submitting fields exceeding database column limits (e.g. subject $> 200$ chars) or passing non-numeric ticket IDs (e.g. `/api/tickets/invalid-id`) bypasses application validation and triggers unhandled PostgreSQL exceptions (`22001`, `22P02`), crashing API requests with HTTP 500 instead of returning HTTP 400 or 404.
4. **Activity History Blindspots & Identity Spoofing:** Ticket subject and description modifications are completely omitted from the activity history. Furthermore, status, priority, and assignee updates are permanently logged with the generic actor `"Support Agent"` regardless of which agent performed the action.
5. **UI Validation & Feedback Masking:** Form validation errors and notifications for ticket creation and editing are rendered behind the modal backdrop ($z\text{-index } 50$), leaving users trapped inside modals with no visible error feedback when server-side validation rejects an entry.
6. **Vulnerable Dependencies & Insecure Defaults:** The Next.js client relies on vulnerable transitive packages (`postcss <= 8.5.22` with High severity XSS and path traversal advisories). The Express API exposes `X-Powered-By`, lacks basic security headers (no Helmet / CSP / X-Frame-Options), and configures database TLS with `rejectUnauthorized: false` (disabling certificate verification).
7. **Monolithic Frontend Architecture:** The entire frontend application (~28.7 KB) is compressed into a single monolithic component (`client/app/page.tsx`) with 15 unstructured `useState` hooks, zero component modularity (`client/components/` is empty), and heavy redundant network polling.

### Main Risks
- **Reliability Risk:** Any end-user attempting to search for a customer or subject will encounter an immediate application breakdown.
- **Security & Integrity Risk:** Complete absence of authentication, authorization, and rate limiting allows any network actor to read all customer PII, alter ticket statuses, flood the database, or spoof internal communications.
- **Maintainability Risk:** The lack of component decomposition, missing automated tests, and tightly coupled database queries inside route handlers severely impede feature expansion.

### Readiness for Demonstration
**Status: NOT READY FOR CLIENT DEMONSTRATION IN CURRENT STATE.**  
While the application can successfully display existing records, create tickets with valid inputs, and record replies when strictly following a "happy path", the search functionality is completely broken, mobile navigation is inoperable, and any validation edge-case results in confusing 500 error banners. Fixing the P0 blockers (specifically `ISSUE-001` and `ISSUE-002`) is required before any public demonstration.

---

## B. Project Architecture

### 1. Frontend Structure (`client/`)
- **Framework:** Next.js 15.1.6 (App Router), React 19.0.0, TypeScript 5.7.3.
- **Styling:** Tailwind CSS v4 via `@tailwindcss/postcss` and custom CSS classes in `client/app/globals.css`.
- **Pages & Components:**
  - `client/app/layout.tsx`: Root HTML shell with metadata (`OrbitDesk | Support Desk`).
  - `client/app/page.tsx`: Single-page monolithic dashboard container (89 dense lines, 28,769 bytes). Contains all UI views: sidebar navigation, overview metrics, search/filter controls, queue table, create ticket modal, ticket detail view, edit form, conversation thread, response box, and activity history.
  - `client/components/`: Directory exists but is **completely empty**.
- **State Management:** Local React state (`useState`, `useCallback`, `useMemo`, `useEffect`). No external state manager or React Context.

### 2. Backend Structure (`server/`)
- **Runtime & Framework:** Node.js v24.18.0 (ES Modules), Express.js v4.21.2.
- **Middleware:** `cors` (configured to allow `CLIENT_ORIGIN` or `http://localhost:3000`), `express.json({ limit: '1mb' })`.
- **Routing & Controllers:** Single file `server/src/index.js` containing all route definitions, parameter parsing, query construction, and response shaping.
- **Error Handling:** Centralized Express error middleware catching unhandled errors, with special handling only for foreign key violation `23503`.

### 3. API Communication
- **Protocol:** HTTP REST APIs over JSON.
- **Endpoints:**
  - `GET /api/health`: Database connection heartbeat.
  - `GET /api/dashboard`: Aggregated status, urgent, and overdue counts.
  - `GET /api/tickets`: Searchable, filterable, and sortable ticket collection (hard-limited to 250 rows).
  - `POST /api/tickets`: Ticket creation with server-side validation.
  - `GET /api/tickets/:id`: Full ticket details including nested `entries` and `activity` records.
  - `PATCH /api/tickets/:id`: Partial ticket updates (status, priority, assignee, subject, description).
  - `POST /api/tickets/:id/entries`: Creation of public replies or internal notes.

### 4. Database Architecture (PostgreSQL)
- **Connection:** `pg` Pool (`server/src/db.js`), pooling connections via `DATABASE_URL`.
- **Initialization:** Dynamic `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` executed during server startup (`initializeDatabase()`).
- **Tables & Schema:**
  - `tickets`: Core ticket entity (`id BIGSERIAL`, `subject VARCHAR(200)`, `customer_name VARCHAR(120)`, `customer_email VARCHAR(254)`, `description TEXT`, `status VARCHAR(30)`, `priority VARCHAR(20)`, `assignee VARCHAR(120)`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`).
  - `ticket_entries`: Thread comments and notes (`id BIGSERIAL`, `ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE`, `entry_type VARCHAR(20) CHECK IN ('reply', 'note')`, `content TEXT`, `author VARCHAR(120)`, `created_at TIMESTAMPTZ`).
  - `ticket_activity`: Audit trail events (`id BIGSERIAL`, `ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE`, `event_type VARCHAR(60)`, `description TEXT`, `actor VARCHAR(120)`, `created_at TIMESTAMPTZ`).
- **Indexes:** `idx_tickets_updated_at`, `idx_tickets_status`, `idx_entries_ticket_id`, `idx_activity_ticket_id`.

```mermaid
erDiagram
    TICKETS ||--o{ TICKET_ENTRIES : "has (ON DELETE CASCADE)"
    TICKETS ||--o{ TICKET_ACTIVITY : "tracks (ON DELETE CASCADE)"

    TICKETS {
        bigserial id PK
        varchar_200 subject
        varchar_120 customer_name
        varchar_254 customer_email
        text description
        varchar_30 status
        varchar_20 priority
        varchar_120 assignee
        timestamptz created_at
        timestamptz updated_at
    }

    TICKET_ENTRIES {
        bigserial id PK
        bigint ticket_id FK
        varchar_20 entry_type
        text content
        varchar_120 author
        timestamptz created_at
    }

    TICKET_ACTIVITY {
        bigserial id PK
        bigint ticket_id FK
        varchar_60 event_type
        text description
        varchar_120 actor
        timestamptz created_at
    }
```

---

## C. Issues Summary

| Metric | Count | Notes |
|---|:---:|---|
| **Confirmed Bugs** | **12** | Verified via live reproduction and code inspection with exact evidence. |
| **High-Risk Security Findings** | **3** | Unauthenticated API, vulnerable dependency (`postcss`), disabled TLS validation. |
| **Performance & Maintainability Issues** | **6** | Monolithic frontend, redundant polling, missing indexes, unpaginated dataset. |
| **Usability & Accessibility Warnings** | **4** | Obscured modal errors, broken mobile drawer, missing labels, no keyboard traps. |
| **Untested Areas / Scope Limitations** | **3** | Long-term timer aging, high-load concurrency, live email integration. |
| **Total Registered Items** | **28** | Registered across all severity tiers. |

---

## D. Detailed Issue Register

### `ISSUE-001`: Unreplaced `?` Placeholders in Ticket Search SQL Causing PostgreSQL Syntax Error `42883` and HTTP 500 Crash
- **Category:** Backend / Database / Query Execution
- **Severity:** Critical
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Lines 52–57)
- **Affected Feature:** Ticket Queue Search (`GET /api/tickets?search=...`)
- **Steps to Reproduce:**
  1. Open the support dashboard at `http://localhost:3000`.
  2. Type any character or word (e.g. `login`) into the "Search tickets..." input.
  3. Observe the frontend queue immediately display: `⚠ Could not load data from the API. Is the Express server running?`.
  4. Inspect the server log or execute `GET http://localhost:5000/api/tickets?search=login`.
- **Expected Behavior:** The backend should return HTTP 200 with matching tickets whose subject, customer name, or email contains the search term.
- **Actual Behavior:** The server returns HTTP 500 (`Internal server error`). The PostgreSQL engine throws error `42883: operator does not exist: || unknown` at character position 93.
- **Evidence:**
  ```javascript
  // server/src/index.js lines 52-57:
  const clauses = []; const values = [];
  const add = (sql, val) => { values.push(val); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (search) add("(subject ILIKE '%' || ? || '%' OR customer_name ILIKE '%' || ? || '%' OR customer_email ILIKE '%' || ? || '%')", search);
  let where = '';
  if (search) { values.push(search); const n=values.length; clauses.push(`(subject ILIKE '%' || $${n} || '%' OR customer_name ILIKE '%' || $${n} || '%' OR customer_email ILIKE '%' || $${n} || '%')`); }
  ```
  `sql.replace('?', ...)` only replaces the first instance of `?`. Furthermore, `if (search)` is executed twice, appending two clauses. The resulting SQL executed against PostgreSQL is:
  `SELECT * FROM tickets WHERE (subject ILIKE '%' || $1 || '%' OR customer_name ILIKE '%' || ? || '%' OR customer_email ILIKE '%' || ? || '%') AND (subject ILIKE '%' || $2 || '%' OR customer_name ILIKE '%' || $2 || '%' OR customer_email ILIKE '%' || $2 || '%') ...`
- **Root Cause:** Incomplete manual placeholder substitution leaving literal `?` tokens in parameterized PostgreSQL queries, accompanied by duplicated code blocks.
- **Recommended Fix:** Remove the defective `add()` function and redundant block. Parameterize the search term once:
  ```javascript
  if (search) {
    values.push(search);
    const n = values.length;
    clauses.push(`(subject ILIKE '%' || $${n} || '%' OR customer_name ILIKE '%' || $${n} || '%' OR customer_email ILIKE '%' || $${n} || '%')`);
  }
  ```
- **Suggested Regression Test:** Send `GET /api/tickets?search=test` and verify HTTP 200 with an array of matching tickets.

---

### `ISSUE-002`: Mobile Navigation Drawer Inoperable Due to Missing CSS / State Binding
- **Category:** Frontend / Responsive Design
- **Severity:** High
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/app/page.tsx` (Lines 28, 50, 65) and `client/app/globals.css` (Line 2)
- **Affected Feature:** Responsive Sidebar Navigation on Tablet/Mobile ($< 850\text{px}$)
- **Steps to Reproduce:**
  1. Open the browser at viewport width $\le 850\text{px}$ (e.g. 375px mobile view).
  2. Notice the sidebar is hidden (`display: none` via `@media(max-width:850px){.sidebar{display:none}}`).
  3. Click the hamburger menu icon button `☰`.
- **Expected Behavior:** A slide-over or dropdown navigation drawer appears allowing the user to select views (Overview, Open, Urgent, Resolved).
- **Actual Behavior:** Nothing happens. The button updates React state `mobileNav`, but `mobileNav` is never applied to the `<aside className="sidebar">` element or any modal drawer.
- **Evidence:**
  `client/app/page.tsx`:
  - Line 28: `const [mobileNav,setMobileNav]=useState(false);`
  - Line 50: `<aside className="sidebar w-[238px] bg-[#201d3b] text-white min-h-screen p-4 flex flex-col shrink-0">` (no dynamic class using `mobileNav`)
  - Line 65: `<button className="btn md:hidden" onClick={()=>setMobileNav(!mobileNav)}>☰</button>`
- **Root Cause:** The `mobileNav` state variable is decoupled from the DOM. No conditional CSS class (e.g. `sidebar-open`) or backdrop drawer was implemented for mobile screens.
- **Recommended Fix:** Bind `mobileNav` to toggle a mobile sidebar overlay:
  ```tsx
  <aside className={`sidebar w-[238px] bg-[#201d3b] text-white min-h-screen p-4 flex flex-col shrink-0 ${mobileNav ? '!flex fixed inset-y-0 left-0 z-50 shadow-2xl' : ''}`}>
  ```
- **Suggested Regression Test:** Emulate viewport width 500px, click hamburger button, verify sidebar displays `position: fixed` and allows navigation.

---

### `ISSUE-003`: Missing Field Length Validation Causing PostgreSQL Error `22001` and HTTP 500 Crashes
- **Category:** Backend / Data Integrity & Validation
- **Severity:** High
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Lines 15–24, 74–75, 111)
- **Affected Feature:** Ticket Creation and Updates (`POST /api/tickets`, `PATCH /api/tickets/:id`)
- **Steps to Reproduce:**
  1. Submit a `POST /api/tickets` request with `subject` containing 250 characters (exceeding `VARCHAR(200)`).
  2. Observe the server response.
- **Expected Behavior:** Returns HTTP 400 Bad Request: `{ error: 'Subject must be 200 characters or fewer.', details: { subject: '...' } }`.
- **Actual Behavior:** Returns HTTP 500: `{ error: 'Internal server error. Check the API terminal for details.' }`. Terminal logs `error: value too long for type character varying(200)` (PostgreSQL error code `22001`).
- **Evidence:** Verified live via automated script:
  `OVERSIZED SUBJECT STATUS: 500 { error: 'Internal server error. Check the API terminal for details.' }`.
  `validateTicket` in `server/src/index.js` lines 15–24 validates presence (`!clean(body.subject)`), but omits length checks for `subject` (200), `customerName` (120), `customerEmail` (254), and `assignee` (120).
- **Root Cause:** Absence of string length boundary validation prior to passing parameters to PostgreSQL.
- **Recommended Fix:** Add length checks in `validateTicket`:
  ```javascript
  if (body.subject && clean(body.subject).length > 200) errors.subject = 'Subject cannot exceed 200 characters.';
  if (body.customerName && clean(body.customerName).length > 120) errors.customerName = 'Customer name cannot exceed 120 characters.';
  if (body.customerEmail && clean(body.customerEmail).length > 254) errors.customerEmail = 'Email cannot exceed 254 characters.';
  if (body.assignee && clean(body.assignee).length > 120) errors.assignee = 'Assignee cannot exceed 120 characters.';
  ```
- **Suggested Regression Test:** Post ticket with 201-character subject and assert HTTP 400 with validation message.

---

### `ISSUE-004`: Non-Numeric Ticket IDs in Route Parameters Trigger Unhandled PostgreSQL `22P02` Error and HTTP 500
- **Category:** Backend / API Robustness
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Lines 83, 98, 127, 137–141)
- **Affected Feature:** All `/:id` Endpoints (`GET /api/tickets/:id`, `PATCH /api/tickets/:id`, `POST /api/tickets/:id/entries`)
- **Steps to Reproduce:**
  1. Send `GET http://localhost:5000/api/tickets/invalid-id`.
  2. Send `PATCH http://localhost:5000/api/tickets/invalid-id`.
  3. Send `POST http://localhost:5000/api/tickets/invalid-id/entries`.
- **Expected Behavior:** Returns HTTP 400 Bad Request or HTTP 404 Not Found (`Ticket not found or invalid ID format`).
- **Actual Behavior:** All requests return HTTP 500 with unhandled error `22P02: invalid input syntax for type bigint: "invalid-id"`.
- **Evidence:** Verified live with test suite:
  `GET /api/tickets/invalid-id` -> HTTP 500; `PATCH /api/tickets/invalid-id` -> HTTP 500; `POST /api/tickets/invalid-id/entries` -> HTTP 500.
- **Root Cause:** Route parameters are passed directly to SQL queries expecting `BIGINT` without validating that `req.params.id` consists of digits.
- **Recommended Fix:** Add route parameter validation middleware or regex check:
  ```javascript
  const parseId = (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Ticket not found.' });
    next();
  };
  app.use('/api/tickets/:id', parseId);
  ```
- **Suggested Regression Test:** Request `/api/tickets/abc` and assert HTTP 404.

---

### `ISSUE-005`: Updating Ticket Subject or Description Does Not Record Activity History Events
- **Category:** Backend / Business Logic & Audit Trail
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Lines 111–115)
- **Affected Feature:** Ticket Activity History
- **Steps to Reproduce:**
  1. Open an existing ticket (e.g. Ticket #3).
  2. Click "✎ Edit ticket".
  3. Modify the subject from "Issue A" to "Issue B" and description from "Desc A" to "Desc B". Click "Save changes".
  4. Inspect the Activity History timeline.
- **Expected Behavior:** The activity history records events detailing that the subject or description was edited.
- **Actual Behavior:** No activity history entry is recorded. The activity log remains unchanged.
- **Evidence:**
  ```javascript
  // server/src/index.js lines 112-114:
  if (old.status !== next.status) await activity(client, old.id, 'status_changed', `Status changed from ${old.status} to ${next.status}.`);
  if (old.priority !== next.priority) await activity(client, old.id, 'priority_changed', `Priority changed from ${old.priority} to ${next.priority}.`);
  if (old.assignee !== next.assignee) await activity(client, old.id, 'assignment_changed', `Assignee changed from ${old.assignee} to ${next.assignee}.`);
  // NO check or activity recording for subject, description, customer_name, or customer_email
  ```
- **Root Cause:** Missing conditional branches in `PATCH /api/tickets/:id` for ticket content edits.
- **Recommended Fix:** Add audit log entries when core ticket content changes:
  ```javascript
  if (old.subject !== next.subject) await activity(client, old.id, 'subject_changed', `Subject updated.`);
  if (old.description !== next.description) await activity(client, old.id, 'description_changed', `Description updated.`);
  ```
- **Suggested Regression Test:** Edit subject via PATCH and verify new activity entry in `GET /api/tickets/:id`.

---

### `ISSUE-006`: Modal Validation Errors and Notifications Rendered Behind Modal Backdrop
- **Category:** Frontend / UX & Feedback
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/app/page.tsx` (Lines 42, 66, 67, 79, 81) and `client/app/globals.css` (Line 2)
- **Affected Feature:** Create Ticket Modal and Ticket Details Edit View
- **Steps to Reproduce:**
  1. Click "＋ New ticket".
  2. Fill in Subject, Customer Name, and Description, but type an invalid email (e.g. `invalid-email`).
  3. Click "Create ticket →".
- **Expected Behavior:** An inline validation error or prominent error banner appears inside the modal indicating "Enter a valid email address."
- **Actual Behavior:** The modal remains open, the button stops showing "Creating…", and no error message is visible inside the modal. The error banner (`⚠ Enter a valid email address.`) is rendered inside the `<main>` element beneath the semi-opaque `.modal-backdrop` ($z\text{-index } 50$).
- **Evidence:**
  `client/app/page.tsx` line 66: `{error&&<div className="mb-5 rounded-xl border border-red-200 ...">...</div>}` is rendered in `<main>`.
  `client/app/page.tsx` line 79: `{showCreate&&<div className="modal-backdrop" ...><div className="modal">...</div></div>}` is rendered at the bottom of the JSX tree, overlaying the screen.
- **Root Cause:** Modal dialogs lack internal error state rendering; error state is stored globally and displayed only in the underlying page header.
- **Recommended Fix:** Render error messages directly inside `<div className="modal">` above the form, or bind field-level errors to each input.
- **Suggested Regression Test:** Trigger server validation rejection inside modal and verify error text is visible above the backdrop.

---

### `ISSUE-007`: Ticket Property Updates Always Attributed to Generic `"Support Agent"` in Activity Trail
- **Category:** Backend & Frontend / Accountability & Identity
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Lines 31, 112–114) and `client/app/page.tsx` (Line 86)
- **Affected Feature:** Ticket Audit Log (`ticket_activity`)
- **Steps to Reproduce:**
  1. Open a ticket detail modal.
  2. Under "Ticket properties", change Status from "Open" to "In Progress".
  3. Look at the Activity history timeline.
- **Expected Behavior:** Activity history displays: `Alex Morgan · [Timestamp] - Status changed from Open to In Progress.`
- **Actual Behavior:** Activity history displays: `Support Agent · [Timestamp] - Status changed from Open to In Progress.`
- **Evidence:**
  `server/src/index.js` line 31: `async function activity(client, ticketId, eventType, description, actor = 'Support Agent')`.
  `server/src/index.js` lines 112–114 call `activity(client, old.id, 'status_changed', ...)` without passing an `actor`.
  `client/app/page.tsx` line 86 sends `{ status: e.target.value }` without passing an `actor` or current user.
- **Root Cause:** The `PATCH /api/tickets/:id` route neither accepts nor records the acting agent's identity.
- **Recommended Fix:** Accept an optional `actor` in the PATCH request body (or extract from authentication session) and pass it to `activity()`.
- **Suggested Regression Test:** Patch status with `{ status: "Resolved", actor: "Taylor Reed" }` and assert activity row has `actor = "Taylor Reed"`.

---

### `ISSUE-008`: Overview Navigation Link Permanently Styled with `.active` Class
- **Category:** Frontend / UI State Management
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/app/page.tsx` (Lines 53–60)
- **Affected Feature:** Left Sidebar Navigation
- **Steps to Reproduce:**
  1. In the sidebar, click "Open" tickets.
  2. Observe which sidebar link is highlighted with dark background (`#302b54`).
- **Expected Behavior:** The "Open" link receives the active styling, while "Overview" returns to normal.
- **Actual Behavior:** The "Overview" button permanently retains `className="nav-item active"`. The "Open" button never gains the active style.
- **Evidence:**
  `client/app/page.tsx` line 53: `<button className="nav-item active" ...><span>▦</span> Overview</button>`.
  Lines 54–60 all have hardcoded `className="nav-item"`.
- **Root Cause:** Active navigation state is hardcoded in JSX rather than derived from active filter state (`status`, `priority`, or `sort`).
- **Recommended Fix:** Compute the active nav item dynamically based on current filter states.
- **Suggested Regression Test:** Select "Open" filter and verify "Open" button has `.active` class while "Overview" does not.

---

### `ISSUE-009`: Overdue Filter State Has No Indicator or Clear Control in the Filter Toolbar
- **Category:** Frontend / Usability
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/app/page.tsx` (Lines 69, 72–74)
- **Affected Feature:** Ticket Queue Filtering
- **Steps to Reproduce:**
  1. Click "Review queue →" on the Overdue tickets card.
  2. The table filters down to overdue tickets only.
  3. Examine the filter toolbar (search, status, priority, assignee, sort).
- **Expected Behavior:** An active "Overdue" pill or dropdown selection indicates that the queue is filtered to overdue items, with an option to dismiss.
- **Actual Behavior:** The filter toolbar shows "All statuses", "All priorities", "All assignees", and "Recently updated". There is no visual indicator explaining why only a subset of tickets is visible, and the user cannot disable overdue filtering without clicking "↻ Reset filters" or typing in the search box.
- **Evidence:** `overdueOnly` is stored as an isolated boolean state (`useState(false)`), omitted from the filter controls on line 72.
- **Root Cause:** Incomplete filter bar integration for the overdue state.
- **Recommended Fix:** Add an "Overdue only" badge/button with a toggle in the filter toolbar.
- **Suggested Regression Test:** Click "Review queue →", verify an active filter tag appears in the filter bar, and clicking "x" clears it.

---

### `ISSUE-010`: "Waiting on Customer" Status Missing from Dashboard Aggregate Metrics
- **Category:** Frontend & Backend / Data Consistency
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Lines 40–47) and `client/app/page.tsx` (Lines 12, 46)
- **Affected Feature:** Overview Metrics Cards
- **Steps to Reproduce:**
  1. Create or set tickets to status "Waiting on Customer".
  2. View the 4 top metrics cards: "All tickets", "Open tickets", "In progress", "Resolved".
- **Expected Behavior:** Either a card exists for "Waiting on Customer" or the user is aware of how the numbers aggregate to "All tickets".
- **Actual Behavior:** If 5 tickets are "Waiting on Customer", "All tickets" reads 5, but Open = 0, In Progress = 0, Resolved = 0. The metrics appear mathematically inconsistent to an administrator.
- **Evidence:** `server/src/index.js` lines 40–46 aggregates only `open`, `in_progress`, and `resolved`.
- **Root Cause:** Metric cards design accounted for only 3 of the 4 valid database statuses defined in `STATUSES`.
- **Recommended Fix:** Add `COUNT(*) FILTER (WHERE status='Waiting on Customer')::int AS waiting` to `/api/dashboard` and display it in the metrics grid.
- **Suggested Regression Test:** Verify `/api/dashboard` returns `waiting` property and frontend renders corresponding card.

---

### `ISSUE-011`: Vulnerable Dependencies with High Severity Security Advisories (`postcss`)
- **Category:** Security / Dependencies
- **Severity:** High
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/package.json` (`next ^15.1.6`)
- **Affected Feature:** Frontend Build & Server-Side Rendering
- **Steps to Reproduce:**
  1. Run `npm audit --prefix client`.
- **Expected Behavior:** Zero known vulnerabilities in installed packages.
- **Actual Behavior:** 2 vulnerabilities reported (1 High, 1 Moderate) in `postcss <= 8.5.22` via `next`:
  - `GHSA-qx2v-qp2m-jg93`: PostCSS XSS via Unescaped `</style>` in CSS Stringify Output.
  - `GHSA-6g55-p6wh-862q`: Arbitrary file read & information disclosure via attacker-controlled `sourceMappingURL`.
  - `GHSA-fxqj-rqcc-2cmp`: Incomplete fix of GHSA-6g55-p6wh-862q.
  - `GHSA-r28c-9q8g-f849`: Path traversal in source map auto-loading.
- **Evidence:** Captured directly from `npm audit` execution outside sandbox.
- **Root Cause:** Next.js 15.1.6 bundles older PostCSS releases subject to published CVEs.
- **Recommended Fix:** Upgrade Next.js to the latest patched version once approved by project lead.
- **Suggested Regression Test:** Execute `npm audit` and assert zero high/critical advisories.

---

### `ISSUE-012`: Express API & Next.js Lack Security Headers and Expose `X-Powered-By`
- **Category:** Security / HTTP Headers
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Line 6) and `client/next.config.ts`
- **Affected Feature:** All HTTP Responses
- **Steps to Reproduce:**
  1. Inspect response headers of `GET http://localhost:5000/api/health` and `GET http://localhost:3000`.
- **Expected Behavior:** Standard hardening headers are present (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options: nosniff`); technology disclosure headers are disabled.
- **Actual Behavior:**
  - Express returns `x-powered-by: Express`.
  - Next.js returns `x-powered-by: Next.js`.
  - Both lack `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, and `X-Content-Type-Options`.
- **Evidence:** Live headers retrieved via fetch inspection:
  `EXPRESS HEADERS: { 'x-powered-by': 'Express', ... }` (no CSP/XFO/nosniff).
- **Root Cause:** Missing `helmet` middleware in Express and missing `poweredByHeader: false` / `headers()` config in Next.js.
- **Recommended Fix:** Add `helmet` to Express (`app.use(helmet())`) and configure security headers in `next.config.ts`.
- **Suggested Regression Test:** Assert `X-Powered-By` is absent and `X-Frame-Options: SAMEORIGIN` is present on all endpoints.

---

### `ISSUE-013`: Complete Absence of Authentication, Authorization, and Rate Limiting
- **Category:** Security / Access Control & Resilience
- **Severity:** High (Product Scope Informational)
- **Confidence:** Confirmed / Informational
- **Affected File & Lines:** `server/src/index.js` (Lines 1–142)
- **Affected Feature:** Entire Application
- **Analysis:**
  While the `README.md` and `ASSESSMENT_NOTES.md` state that this assessment submission intentionally omitted authentication to simplify demonstration, the security implications are significant:
  1. **PII Disclosure:** Any unauthenticated party on the local network or internet can retrieve customer names, email addresses, and full support history via `GET /api/tickets`.
  2. **Impersonation & Tampering:** Anyone can inject public replies or internal notes masquerading as any support agent (`"Alex Morgan"`, `"Jamie Lee"`).
  3. **Denial of Service:** In the absence of rate limiting (`express-rate-limit`), an automated script can saturate PostgreSQL connections or exhaust disk space via endless ticket generation.
- **Recommended Fix:** Implement session/token authentication (e.g. NextAuth or JWT middleware) and route-level rate limiting prior to production rollout.

---

### `ISSUE-014`: Insecure Database TLS Configuration (`rejectUnauthorized: false`)
- **Category:** Security / Data in Transit
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/db.js` (Line 10)
- **Affected Feature:** Database Connection Pool
- **Steps to Reproduce:**
  1. Inspect `server/src/db.js` line 10.
- **Expected Behavior:** Production database connections over TLS validate certificate authenticity against trusted root CAs.
- **Actual Behavior:** `ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined`. Setting `rejectUnauthorized: false` instructs Node.js to ignore invalid, self-signed, or expired SSL certificates.
- **Evidence:** Source code in `server/src/db.js` line 10.
- **Root Cause:** Insecure convenience setting intended for development/staging environments.
- **Recommended Fix:** Require CA certificate bundling (`ca: fs.readFileSync(...)`) or ensure `rejectUnauthorized: true` in production.
- **Suggested Regression Test:** Verify pool configuration rejects invalid SSL certificates when `NODE_ENV=production`.

---

### `ISSUE-015`: Malformed JSON in Request Bodies Returns HTTP 500 Instead of HTTP 400
- **Category:** Backend / Error Handling
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Lines 137–141)
- **Affected Feature:** All POST/PATCH Endpoints
- **Steps to Reproduce:**
  1. Send `POST /api/tickets` with a malformed JSON payload (e.g. `{badJson}`).
- **Expected Behavior:** Returns HTTP 400 Bad Request (`Invalid JSON body`).
- **Actual Behavior:** Returns HTTP 500: `{ error: 'Internal server error. Check the API terminal for details.' }`.
- **Evidence:** Verified live: `MALFORMED JSON STATUS: 500`.
- **Root Cause:** The central error handler ignores `err.status` / `err.statusCode` set by `body-parser` and defaults all unhandled errors to 500.
- **Recommended Fix:** Update error middleware:
  ```javascript
  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Malformed JSON payload.' });
    }
    // ...
  });
  ```
- **Suggested Regression Test:** Send invalid JSON string and verify HTTP 400 response.

---

### `ISSUE-016`: Accessibility (a11y) Violations: Missing `<label>` Bindings, Modal Traps, and Keyboard Navigation
- **Category:** Frontend / Accessibility (a11y)
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/app/page.tsx` (Lines 73, 79, 81, 82)
- **Affected Feature:** Form Inputs, Modals, and Queue Table
- **Findings:**
  1. **Unassociated Labels:** In `client/app/page.tsx` line 79, `<label>` elements precede inputs without `htmlFor` attributes, and inputs lack matching `id` attributes. Clicking the label does not focus the input; screen readers fail to announce input labels.
  2. **Unlabelled Edit Fields:** In line 82, inputs and textareas in the edit ticket form have zero `<label>` elements or `aria-label` attributes.
  3. **Untrapped Modals:** Modals lack `role="dialog"`, `aria-modal="true"`, focus trapping, and `Escape` key close listeners.
  4. **Unnavigable Table Rows:** `<tr onClick={()=>openDetail(t.id)}>` is not keyboard navigable (`tabIndex={0}` and `onKeyDown` are absent).
- **Recommended Fix:** Implement semantic `<label htmlFor="...">`, add `id` to all inputs, attach `onKeyDown` listeners for `Escape` and `Enter`, and incorporate `role="dialog"`.

---

### `ISSUE-017`: Schema Discrepancy: Indexes Omitted from `schema.sql` and Missing Composite Indexes
- **Category:** Database / Performance & Configuration
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/schema.sql` vs `server/src/db.js` (Lines 43–46)
- **Affected Feature:** Database Performance & Manual Deployment
- **Findings:**
  - `server/src/db.js` creates 4 indexes (`idx_tickets_updated_at`, `idx_tickets_status`, `idx_entries_ticket_id`, `idx_activity_ticket_id`).
  - `server/schema.sql` contains **zero index creation statements**. A database administrator deploying via `psql < schema.sql` as documented in `README.md` will have an unindexed database.
  - Furthermore, filtering by `priority` and `assignee` is performed frequently in `GET /api/tickets`, yet neither column has an index.
- **Recommended Fix:** Synchronize `schema.sql` with `src/db.js` and add indexes for `assignee` and `priority`.

---

### `ISSUE-018`: Monolithic Single-File Frontend Architecture Without Modular Components
- **Category:** Frontend / Code Quality & Maintainability
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/app/page.tsx` (Lines 1–89) and `client/components/` (empty)
- **Affected Feature:** Frontend Maintainability
- **Findings:**
  The entire application is written inside a single 89-line, 28.7 KB component. There is no separation into `<Sidebar>`, `<MetricsGrid>`, `<TicketTable>`, `<CreateModal>`, `<DetailModal>`, or `<ActivityHistory>`.
  - 15 separate `useState` hooks are declared in the root component.
  - Any keystroke in the search bar or reply textarea triggers a full re-render of the entire DOM tree.
  - Type safety is bypassed using `any` (e.g. line 27: `const [editForm,setEditForm]=useState<any>({})`).
- **Recommended Fix:** Refactor into modular components under `client/components/` and introduce typed form models.

---

### `ISSUE-019`: Redundant `/api/dashboard` Network Polling on Queue Search and Filter Changes
- **Category:** Frontend & Backend / Performance
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `client/app/page.tsx` (Lines 30–38)
- **Affected Feature:** Data Fetching
- **Findings:**
  `refresh()` executes:
  `const [t,d] = await Promise.all([fetch(`${API}/tickets?${params}`), fetch(`${API}/dashboard`)]);`
  The `dashboard` aggregate metrics (total, open, resolved, etc.) are independent of search terms and filters. Fetching the dashboard on every keystroke in the search bar doubles backend database queries unnecessarily.
- **Recommended Fix:** Separate ticket queue fetching from dashboard metric fetching. Fetch `/api/dashboard` only on initial mount, ticket creation, ticket update, or explicit refresh.

---

### `ISSUE-020`: Total Absence of Automated Test Suites
- **Category:** Architecture / Quality Assurance
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected File & Lines:** `package.json`, `client/package.json`, `server/package.json`
- **Affected Feature:** CI/CD & Regression Prevention
- **Findings:**
  There are zero unit, integration, or end-to-end test files in the codebase. Neither `client/package.json` nor `server/package.json` defines a `test` script.
- **Recommended Fix:** Add Vitest/Jest and Supertest for backend API testing, and Playwright for frontend workflow testing.

---

### `ISSUE-021`: Missing Graceful Shutdown Handlers for Express and Connection Pool
- **Category:** Backend / Reliability
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Line 142)
- **Affected Feature:** Process Lifecycle
- **Findings:**
  The server calls `app.listen()` without registering listeners for `SIGTERM` or `SIGINT`. Terminating or restarting the container/process abruptly severs active client connections and database pool transactions.
- **Recommended Fix:** Handle process termination signals and invoke `server.close()` and `pool.end()`.

---

### `ISSUE-022`: Hardcoded 250-Row Query Limit Without Pagination
- **Category:** Backend / Scalability
- **Severity:** Low
- **Confidence:** Confirmed
- **Affected File & Lines:** `server/src/index.js` (Line 63) and `client/app/page.tsx` (Line 74)
- **Affected Feature:** Ticket Queue Scalability
- **Findings:**
  `SELECT * FROM tickets ... LIMIT 250` restricts results to 250 rows. Once a support organization exceeds 250 tickets, tickets older than the 250th most recent become inaccessible via the UI.
- **Recommended Fix:** Implement `page` and `limit` query parameters with standard offset or keyset pagination.

---

## E. Functional Test Results

The 20 functional workflows required by the audit brief were evaluated against the live system using automated test scripts and read-only inspection:

| # | Test Workflow | Result | Evidence / Notes | Status |
|:---:|---|:---:|---|:---:|
| 1 | Open dashboard & verify metrics | **PASS** | `GET /api/dashboard` returned `{total: 3, open: 0, in_progress: 2, resolved: 1, urgent: 1, overdue: 0}`. Counts accurately match Postgres records. | **Pass** |
| 2 | Create ticket with valid data | **PASS** | `POST /api/tickets` returned 201 Created with generated ID #3 and matching schema shape. | **Pass** |
| 3 | Create ticket with invalid data | **FAIL** | Empty body returned 400 (Pass). Invalid email returned 400 (Pass). Oversized subject (>200 chars) caused HTTP 500 database crash (Fail). In UI, errors render behind modal backdrop (Fail). | **Fail** |
| 4 | Open ticket & verify details | **PASS** | `GET /api/tickets/1` returned 200 with ticket properties, 2 entries, and 4 activity history items. | **Pass** |
| 5 | Update subject & description | **FAIL** | `PATCH /api/tickets/3` successfully updated fields, but **failed to record any activity history event**. | **Fail** |
| 6 | Change status and priority | **PASS** | `PATCH /api/tickets/3` updated status to "In Progress" and priority to "High". Activity recorded `status_changed` and `priority_changed`. | **Pass** |
| 7 | Change assignee | **PASS** | Assignee updated to "Taylor Reed". Activity recorded `assignment_changed`. (Note: Actor recorded as generic "Support Agent"). | **Pass** |
| 8 | Add public reply | **PASS** | `POST /api/tickets/3/entries` with `type: 'reply'` returned 201. Activity recorded `public_reply`. `updated_at` refreshed. | **Pass** |
| 9 | Add internal note | **PASS** | `POST /api/tickets/3/entries` with `type: 'note'` returned 201. Activity recorded `internal_note`. `updated_at` refreshed. | **Pass** |
| 10 | Public reply vs Note distinction | **PASS** | Distinguishable in API (`entry_type`), database check constraint, and UI styling (`entry-public` blue vs `entry-note` amber). | **Pass** |
| 11 | Activity history completeness | **FAIL** | Complete for creation, status, priority, assignment, replies, notes. **Incomplete for subject/description edits**. Actor attribution hardcoded to "Support Agent". | **Fail** |
| 12 | Search tickets | **FAIL** | `GET /api/tickets?search=login` **crashes with HTTP 500** (`PostgreSQL error 42883`). Completely broken. | **Fail** |
| 13 | Status, priority, assignee filters | **PASS** | `?status=In Progress`, `?priority=Urgent`, `?assignee=Alex Morgan` all return accurately filtered row sets. | **Pass** |
| 14 | Ticket sorting | **PASS** | `?sort=updated` sorts by `updated_at DESC`. `?sort=priority` sorts Urgent $\rightarrow$ High $\rightarrow$ Medium $\rightarrow$ Low $\rightarrow$ `updated_at DESC`. | **Pass** |
| 15 | Data persistence across refresh | **PASS** | All created tickets, entries, and activity rows persist in PostgreSQL across server and browser restarts. | **Pass** |
| 16 | Nonexistent & invalid tickets | **FAIL** | `GET /api/tickets/999999` correctly returns 404. However, `GET /api/tickets/invalid-id` **crashes with HTTP 500** (`PostgreSQL error 22P02`). | **Fail** |
| 17 | Dashboard metrics update | **PASS** | Creating test ticket #3 incremented `total` from 2 to 3; updating status updated `in_progress` from 1 to 2. | **Pass** |
| 18 | Unresolved vs Resolved rules | **PASS** | Resolved tickets are correctly excluded from `urgent` and `overdue` counts via SQL `FILTER (WHERE status <> 'Resolved')`. | **Pass** |
| 19 | Overdue ticket calculations | **PASS** | Calculated in SQL (`created_at < NOW() - INTERVAL '24 hours'`) and frontend `ticketShape` (`Date.now() - created_at > 24h`). (UI filter toggle missing). | **Pass** |
| 20 | Rapid submissions & invalid values | **FAIL** | Buttons disable during modal submission (Pass). Malformed JSON and string IDs crash server with HTTP 500 (Fail). Quick property dropdowns lack debounce (Fail). | **Fail** |

---

## F. Security Findings

```mermaid
flowchart TD
    subgraph "External Surface"
        Attacker["Untrusted Client / Attacker"]
    end

    subgraph "OrbitDesk Application"
        API["Express REST API (Port 5000)"]
        DB[("PostgreSQL Database")]
        Client["Next.js Web Client (Port 3000)"]
    end

    Attacker -->|"Unauthenticated Access (No Auth / No Rate Limit)"| API
    Attacker -->|"Malformed / Oversized Requests (HTTP 500)"| API
    Attacker -->|"Broken Search Parameter (? SQL Crash)"| API
    API -->|"Plaintext / Unverified TLS (rejectUnauthorized: false)"| DB
    Client -->|"Vulnerable Bundled Deps (PostCSS GHSA)"| Attacker
```

### 1. Confirmed Vulnerabilities
- **Vulnerable Transitive Dependencies:** `postcss <= 8.5.22` packaged in `client/node_modules/next` contains High severity vulnerabilities: GHSA-qx2v-qp2m-jg93 (CSS unescaped `</style>` XSS), GHSA-6g55-p6wh-862q (arbitrary file read via sourceMappingURL), GHSA-fxqj-rqcc-2cmp, and GHSA-r28c-9q8g-f849.
- **Insecure TLS Verification:** `server/src/db.js` line 10 configures `rejectUnauthorized: false` for database SSL connections, exposing remote PostgreSQL connections to Man-in-the-Middle (MitM) eavesdropping.
- **Information Disclosure via HTTP Headers:** `X-Powered-By: Express` and `X-Powered-By: Next.js` headers disclose underlying framework versions to scanners.

### 2. Missing Product Safeguards
- **Authentication & Authorization:** Any caller can invoke any API endpoint to view customer tickets, post arbitrary notes, or change ticket states.
- **Rate Limiting & DoS Protection:** No rate limiting or request throttling is present. The database connection pool (default max 10) can be exhausted with minimal request volume.
- **Security Hardening Headers:** Absence of Helmet, Content-Security-Policy (CSP), X-Frame-Options (clickjacking protection), and X-Content-Type-Options.

---

## G. Performance and Maintainability Findings

1. **Monolithic Page Component (`client/app/page.tsx`):**
   - 28.7 KB in a single file with 15 `useState` hooks.
   - Missing sub-component boundaries leads to wasteful full-page re-renders on minor input changes.
2. **Redundant Metric Fetching:**
   - Every keystroke in the search bar triggers parallel calls to both `/api/tickets` and `/api/dashboard`. The dashboard query executes 6 SQL count aggregates that are completely unrelated to queue search.
3. **Database Indexing Gaps:**
   - `tickets(assignee)` and `tickets(priority)` lack indexes despite being used in query `WHERE` clauses.
   - `schema.sql` completely omits the indexes present in `src/db.js`.
4. **Hardcoded Unpaginated Results (`LIMIT 250`):**
   - Scalability bottleneck where tickets past the 250 limit are unreachable.
5. **Absence of Graceful Shutdown:**
   - Process termination abruptly severs PostgreSQL pool connections without draining in-flight transactions.

---

## H. Recommended Fix Priority

### Priority P0: Critical Blockers (Must Fix Immediately)
1. **`ISSUE-001` (Fix Search Query Crash):** Remove the duplicate search code and unreplaced `?` placeholders in `server/src/index.js` (Lines 52–57). This restores ticket search functionality and prevents HTTP 500 errors.
2. **`ISSUE-002` (Restore Mobile Navigation):** Connect `mobileNav` state in `client/app/page.tsx` and `client/app/globals.css` so mobile and tablet users can access sidebar navigation.

### Priority P1: High-Impact Correctness & Security Issues
3. **`ISSUE-003` (Field Length Validation):** Add string length checks (`subject` $\le 200$, `customerName` $\le 120$, `customerEmail` $\le 254$, `assignee` $\le 120$) in `validateTicket` to eliminate PostgreSQL `22001` 500 crashes.
4. **`ISSUE-004` (Validate Route Parameters):** Restrict `/:id` route parameters to positive integers (`/^\d+$/`) to return HTTP 404 instead of PostgreSQL `22P02` 500 crashes.
5. **`ISSUE-006` (Display Modal Validation Errors):** Render validation errors directly inside the create and edit ticket modals so users receive visible feedback when inputs fail validation.
6. **`ISSUE-011` (Upgrade Vulnerable Dependencies):** Update Next.js to remediate High severity `postcss` advisories.

### Priority P2: Important Usability, Reliability, & Audit Integrity
7. **`ISSUE-005` (Track Subject & Description Edits):** Add activity history logging for subject and description modifications.
8. **`ISSUE-007` (Audit Actor Attribution):** Pass and record the acting agent's name during status, priority, and assignment updates.
9. **`ISSUE-012` (Add Security Headers):** Add `helmet` middleware in Express and disable `X-Powered-By` in Next.js and Express.
10. **`ISSUE-014` (Enforce Database SSL Verification):** Require valid certificates (`rejectUnauthorized: true`) in production environments.
11. **`ISSUE-015` (Handle Malformed JSON):** Handle `SyntaxError` in Express error middleware to return HTTP 400 instead of HTTP 500.
12. **`ISSUE-016` (Fix Form Accessibility & Labels):** Add `htmlFor` and `id` bindings to all form fields, add ARIA attributes, and attach `Escape` key handlers to modals.
13. **`ISSUE-017` (Synchronize Schema Indexes):** Add missing indexes (`assignee`, `priority`) to `schema.sql` and `src/db.js`.

### Priority P3: Minor Improvements & Architectural Hygiene
14. **`ISSUE-008` (Dynamic Active Nav Item):** Dynamically apply `.active` class to the currently active navigation button.
15. **`ISSUE-009` (Overdue Filter Indicator):** Add a visible toggle/clear badge for overdue filtering in the filter toolbar.
16. **`ISSUE-010` (Waiting on Customer Metric):** Include "Waiting on Customer" count in `/api/dashboard` and metrics cards.
17. **`ISSUE-018` (Decompose Monolithic Frontend):** Extract reusable components (`TicketTable`, `CreateModal`, `DetailModal`, `Sidebar`) into `client/components/`.
18. **`ISSUE-019` (Decouple Dashboard Polling):** Stop querying `/api/dashboard` during search/filter operations.
19. **`ISSUE-020` (Implement Automated Tests):** Add unit tests for `validateTicket` and integration tests for all REST endpoints.
20. **`ISSUE-021` (Graceful Shutdown):** Register `SIGINT` / `SIGTERM` handlers to cleanly close the PostgreSQL pool.
21. **`ISSUE-022` (Pagination):** Add `page` and `limit` support to `GET /api/tickets`.

---

## I. Untested Areas and Limitations

1. **Real Email & External Notification Delivery:** The application currently stores customer emails as strings; no SMTP or email dispatch services are integrated. Testing actual notification delivery is blocked by absence of feature implementation.
2. **Long-Term Timer Aging (Overdue Thresholds):** The 24-hour overdue calculation was verified through mock timestamps and SQL interval evaluation. Real wall-clock elapsed testing was not performed over a 24-hour duration.
3. **High-Concurrency Race Conditions:** While row-level locking (`SELECT ... FOR UPDATE`) is correctly implemented for `PATCH /api/tickets/:id` and `POST /api/tickets/:id/entries`, high-concurrency load testing (e.g. 500 concurrent agents) was not executed to prevent strain on the local development environment.

---

## J. Final Recommendation

The OrbitDesk codebase possesses a clean database schema and effective core data flows, but requires targeted bug fixes before demonstration or production deployment:

1. **First Step:** Apply the P0 fixes to `server/src/index.js` (Lines 52–57) to restore the ticket search endpoint, and update `client/app/page.tsx` and `client/app/globals.css` to fix mobile navigation.
2. **Second Step:** Address the P1 input validation issues (field length limits and route parameter validation) and ensure modal forms render error messages visibly inside the dialogs.
3. **Third Step:** Enhance the audit log trail to capture subject/description edits and proper agent attribution, followed by adding standard HTTP security headers and refactoring `client/app/page.tsx` into modular components.
