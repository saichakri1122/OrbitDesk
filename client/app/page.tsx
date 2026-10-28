'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const STATUSES = ['Open', 'In Progress', 'Waiting on Customer', 'Resolved'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const AGENTS = ['Unassigned', 'Alex Morgan', 'Jamie Lee', 'Taylor Reed', 'Sam Patel'];

type Ticket = {
  id: number;
  subject: string;
  customerName: string;
  customerEmail: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
};

type Entry = {
  id: number;
  type: string;
  content: string;
  author: string;
  createdAt: string;
};

type Activity = {
  id: number;
  type: string;
  description: string;
  actor: string;
  createdAt: string;
};

type Detail = Ticket & {
  entries: Entry[];
  activity: Activity[];
};

type Dashboard = {
  total: number;
  open: number;
  in_progress: number;
  waiting: number;
  resolved: number;
  urgent: number;
  overdue: number;
};

type EditFormState = {
  subject: string;
  customerName: string;
  customerEmail: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
};

const emptyForm = {
  subject: '',
  customerName: '',
  customerEmail: '',
  description: '',
  status: 'Open',
  priority: 'Medium',
  assignee: 'Unassigned',
};

function dateLabel(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ageLabel(value: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function statusClass(s: string) {
  if (s === 'Open') return 'status-open';
  if (s === 'In Progress') return 'status-progress';
  if (s === 'Waiting on Customer') return 'status-waiting';
  return 'status-resolved';
}

function priorityClass(p: string) {
  return `priority-${p.toLowerCase()}`;
}

function initials(name: string) {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return parts.map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

export default function Home() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({
    total: 0,
    open: 0,
    in_progress: 0,
    waiting: 0,
    resolved: 0,
    urgent: 0,
    overdue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Filters & Search
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [sort, setSort] = useState('updated');

  // Modals & Forms
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalFieldErrors, setModalFieldErrors] = useState<Record<string, string>>({});

  // Detail view
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Conversation entries
  const [entryType, setEntryType] = useState<'reply' | 'note'>('reply');
  const [entryContent, setEntryContent] = useState('');
  const [author, setAuthor] = useState('Alex Morgan');
  const [entrySaving, setEntrySaving] = useState(false);

  // Edit ticket
  const [edit, setEdit] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>({ ...emptyForm });

  // Responsive navigation
  const [mobileNav, setMobileNav] = useState(false);

  // Request tracking to prevent out-of-order search responses
  const reqIdRef = useRef(0);

  // Fetch Dashboard metrics independently
  const refreshDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${API}/dashboard`);
      if (res.ok) {
        setDashboard(await res.json());
      }
    } catch {
      // Background metric fetch error handled gracefully
    }
  }, []);

  // Fetch Tickets based on active filters (race-condition protected)
  const refreshTickets = useCallback(async (signal?: AbortSignal) => {
    const currentReqId = ++reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const query = search.trim();
      if (query) params.set('search', query);
      if (status) params.set('status', status);
      if (priority) params.set('priority', priority);
      if (assignee) params.set('assignee', assignee);
      params.set('sort', sort);

      const res = await fetch(`${API}/tickets?${params}`, { signal });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Could not load tickets from the API. Is the server running?');
      }
      const data = await res.json();
      // Prevent older responses from overwriting newer search results
      if (currentReqId === reqIdRef.current) {
        setTickets(data);
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return; // Request was aborted due to newer input; do not set error
      }
      if (currentReqId === reqIdRef.current) {
        setError(e instanceof Error ? e.message : 'Unable to connect to the API.');
      }
    } finally {
      if (currentReqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  }, [search, status, priority, assignee, sort]);

  // Initial load & debounced search/filter refresh with cancellation
  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    const controller = new AbortController();
    const id = setTimeout(() => {
      refreshTickets(controller.signal);
    }, 180);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [refreshTickets]);

  // Escape key listener for accessible modal closing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCreate) setShowCreate(false);
        else if (selected !== null) {
          setSelected(null);
          setDetail(null);
          setEdit(false);
        } else if (mobileNav) {
          setMobileNav(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCreate, selected, mobileNav]);

  const openDetail = async (id: number) => {
    setSelected(id);
    setDetail(null);
    setDetailLoading(true);
    setEdit(false);
    setModalError('');
    setModalFieldErrors({});
    try {
      const r = await fetch(`${API}/tickets/${id}`);
      if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        throw new Error(errData.error || 'Unable to open ticket.');
      }
      setDetail(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load ticket.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id = selected) => {
    if (!id) return;
    try {
      const r = await fetch(`${API}/tickets/${id}`);
      if (r.ok) setDetail(await r.json());
    } catch {
      // Ignored
    }
  };

  const createTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    setModalFieldErrors({});
    try {
      const r = await fetch(`${API}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, actor: author }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.details) setModalFieldErrors(data.details);
        throw new Error(data.error || 'Could not create ticket.');
      }
      setShowCreate(false);
      setForm({ ...emptyForm });
      setNotice(`Ticket #${data.id} created successfully.`);
      await refreshTickets();
      await refreshDashboard();
      await openDetail(data.id);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Failed to create ticket.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    if (!detail) return;
    setEditForm({
      subject: detail.subject,
      customerName: detail.customerName,
      customerEmail: detail.customerEmail,
      description: detail.description,
      status: detail.status,
      priority: detail.priority,
      assignee: detail.assignee,
    });
    setModalError('');
    setModalFieldErrors({});
    setEdit(true);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setModalError('');
    setModalFieldErrors({});
    try {
      const r = await fetch(`${API}/tickets/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, actor: author }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.details) setModalFieldErrors(data.details);
        throw new Error(data.error || 'Could not update ticket.');
      }
      setEdit(false);
      setNotice('Ticket updated successfully.');
      await refreshTickets();
      await refreshDashboard();
      await openDetail(detail.id);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Failed to update ticket.');
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !entryContent.trim()) return;
    setEntrySaving(true);
    setModalError('');
    try {
      const r = await fetch(`${API}/tickets/${detail.id}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: entryType, content: entryContent, author }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not add entry.');
      setEntryContent('');
      setNotice(entryType === 'reply' ? 'Public reply added.' : 'Internal note added.');
      await refreshTickets();
      await refreshDetail(detail.id);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Failed to post entry.');
    } finally {
      setEntrySaving(false);
    }
  };

  const quickUpdateProperty = async (field: 'status' | 'priority' | 'assignee', value: string) => {
    if (!detail) return;
    try {
      const r = await fetch(`${API}/tickets/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value, actor: author }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `Could not update ${field}.`);
      }
      await refreshTickets();
      await refreshDashboard();
      await refreshDetail(detail.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to update ${field}.`);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setOverdueOnly(false);
    setStatus('');
    setPriority('');
    setAssignee('');
    setSort('updated');
  };

  const counts = useMemo(
    () => [
      { label: 'All tickets', value: dashboard.total, icon: '▤', tone: '#eeecff', ink: '#6658e8', filter: '' },
      { label: 'Open', value: dashboard.open, icon: '◷', tone: '#fff1d8', ink: '#b9790d', filter: 'Open' },
      { label: 'In progress', value: dashboard.in_progress, icon: '↗', tone: '#e8edff', ink: '#5266d5', filter: 'In Progress' },
      { label: 'Waiting on customer', value: dashboard.waiting || 0, icon: '⏳', tone: '#f3e8ff', ink: '#8746ad', filter: 'Waiting on Customer' },
      { label: 'Resolved', value: dashboard.resolved, icon: '✓', tone: '#dcf7e8', ink: '#16804a', filter: 'Resolved' },
    ],
    [dashboard]
  );

  const displayedTickets = useMemo(() => {
    if (overdueOnly) {
      return tickets.filter((t) => t.overdue);
    }
    return tickets;
  }, [tickets, overdueOnly]);

  return (
    <div className="min-h-screen flex">
      {/* Mobile Drawer Overlay */}
      {mobileNav && (
        <div
          className="sidebar-overlay"
          onClick={() => setMobileNav(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`sidebar w-[240px] bg-[#201d3b] text-white min-h-screen p-4 flex flex-col shrink-0 transition-transform ${
          mobileNav ? 'mobile-open' : ''
        }`}
        aria-label="Main Navigation"
      >
        <div className="flex items-center justify-between px-2 py-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#7768f1] flex items-center justify-center text-xl font-black">
              o
            </div>
            <div>
              <div className="font-bold text-lg tracking-tight">orbitdesk</div>
              <div className="text-[11px] text-[#aaa8c3]">SUPPORT WORKSPACE</div>
            </div>
          </div>
          {mobileNav && (
            <button
              onClick={() => setMobileNav(false)}
              className="text-[#aaa8c3] hover:text-white p-1 text-lg md:hidden"
              aria-label="Close navigation"
            >
              ✕
            </button>
          )}
        </div>

        <div className="px-3 mb-2 text-[10px] tracking-[.18em] text-[#8986a8] font-bold">
          WORKSPACE
        </div>

        <button
          className={`nav-item ${!selected && !status && !priority && !overdueOnly && sort === 'updated' && !search ? 'active' : ''}`}
          onClick={() => {
            clearFilters();
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <span>▦</span> Overview
        </button>

        <button
          className={`nav-item ${status === 'Open' ? 'active' : ''}`}
          onClick={() => {
            clearFilters();
            setStatus('Open');
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <span>◷</span> Open{' '}
          <span className="ml-auto text-xs bg-[#302b54] rounded-md px-2 py-0.5">{dashboard.open}</span>
        </button>

        <button
          className={`nav-item ${priority === 'Urgent' ? 'active' : ''}`}
          onClick={() => {
            clearFilters();
            setPriority('Urgent');
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <span>⚑</span> Urgent{' '}
          <span className="ml-auto text-xs bg-[#302b54] rounded-md px-2 py-0.5">{dashboard.urgent}</span>
        </button>

        <button
          className={`nav-item ${status === 'Waiting on Customer' ? 'active' : ''}`}
          onClick={() => {
            clearFilters();
            setStatus('Waiting on Customer');
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <span>⏳</span> Waiting{' '}
          <span className="ml-auto text-xs bg-[#302b54] rounded-md px-2 py-0.5">{dashboard.waiting || 0}</span>
        </button>

        <button
          className={`nav-item ${status === 'Resolved' ? 'active' : ''}`}
          onClick={() => {
            clearFilters();
            setStatus('Resolved');
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <span>✓</span> Resolved{' '}
          <span className="ml-auto text-xs bg-[#302b54] rounded-md px-2 py-0.5">{dashboard.resolved}</span>
        </button>

        <div className="px-3 mt-8 mb-2 text-[10px] tracking-[.18em] text-[#8986a8] font-bold">
          INSIGHTS
        </div>

        <button
          className={`nav-item ${sort === 'priority' ? 'active' : ''}`}
          onClick={() => {
            clearFilters();
            setSort('priority');
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <span>▥</span> Priority queue
        </button>

        <button
          className={`nav-item ${sort === 'updated' && !status && !priority ? 'active' : ''}`}
          onClick={() => {
            clearFilters();
            setSort('updated');
            setSelected(null);
            setMobileNav(false);
          }}
        >
          <span>◷</span> Recent activity
        </button>

        <div className="mt-auto rounded-xl bg-[#302c50] p-4">
          <div className="text-sm font-semibold mb-1">Need a hand?</div>
          <p className="text-xs text-[#b9b6d0] leading-5">Keep every customer conversation moving forward.</p>
          <div className="mt-3 text-xs text-[#a9a2ff]">Support team workspace ↗</div>
        </div>

        <div className="flex items-center gap-3 mt-5 px-2">
          <div className="w-9 h-9 rounded-full bg-[#e1dfff] text-[#4f46a5] font-bold flex items-center justify-center">
            {initials(author)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{author}</div>
            <div className="text-xs text-[#aaa8c3]">Active agent</div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content flex-1 min-w-0 p-8 max-w-[1800px] mx-auto">
        <header className="flex items-center gap-4 justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              className="btn md:hidden"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="Toggle navigation menu"
            >
              ☰
            </button>
            <div>
              <div className="text-xs muted mb-1">Workspace / Overview</div>
              <h1 className="text-2xl font-bold tracking-tight">
                Support overview <span className="text-xl">✦</span>
              </h1>
              <p className="muted mt-1">Here&apos;s what&apos;s happening with your support queue today.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 rounded-xl border border-[#e5e9f0] bg-white px-3 py-2 text-xs muted">
              <span className="text-green-500">●</span> System operational
            </div>
            <button
              className="btn"
              title="Refresh data"
              onClick={() => {
                refreshTickets();
                refreshDashboard();
              }}
              aria-label="Refresh data"
            >
              ↻ <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setError('');
                setModalError('');
                setModalFieldErrors({});
                setShowCreate(true);
              }}
            >
              <span className="text-lg leading-none">＋</span> New ticket
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex justify-between gap-3 items-center">
            <span>⚠ {error}</span>
            <button onClick={() => setError('')} className="font-bold text-lg p-1" aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        {notice && (
          <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex justify-between gap-3 items-center">
            <span>✓ {notice}</span>
            <button onClick={() => setNotice('')} className="font-bold text-lg p-1" aria-label="Dismiss notification">
              ×
            </button>
          </div>
        )}

        {/* Top Aggregate Metric Cards */}
        <section className="stats-grid grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {counts.map((c) => (
            <button
              key={c.label}
              onClick={() => {
                clearFilters();
                if (c.filter) setStatus(c.filter);
                setSelected(null);
              }}
              className="panel p-5 text-left hover:shadow-sm transition-shadow"
            >
              <div className="flex justify-between items-start">
                <span className="text-sm muted">{c.label}</span>
                <span className="stat-icon" style={{ background: c.tone, color: c.ink }}>
                  {c.icon}
                </span>
              </div>
              <div className="text-3xl font-bold mt-4 tracking-tight">{c.value}</div>
              <div className="text-xs muted mt-2">
                {c.label === 'All tickets'
                  ? 'Across all queues'
                  : c.label === 'Resolved'
                  ? 'Successfully closed'
                  : 'Currently tracked'}{' '}
                <span style={{ color: c.ink }}>↗</span>
              </div>
            </button>
          ))}
        </section>

        {/* Urgent & Overdue Action Panels */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="panel p-4 flex items-center gap-4">
            <div className="stat-icon bg-red-50 text-red-600">⚑</div>
            <div className="flex-1">
              <div className="text-sm muted">Urgent tickets</div>
              <div className="text-xl font-bold mt-1">
                {dashboard.urgent}
                <span className="text-xs font-normal muted ml-2">unresolved</span>
              </div>
            </div>
            <button
              className="btn text-xs"
              onClick={() => {
                clearFilters();
                setPriority('Urgent');
              }}
            >
              View urgent →
            </button>
          </div>

          <div className="panel p-4 flex items-center gap-4">
            <div className="stat-icon bg-amber-50 text-amber-700">◷</div>
            <div className="flex-1">
              <div className="text-sm muted">Overdue tickets</div>
              <div className="text-xl font-bold mt-1">
                {dashboard.overdue}
                <span className="text-xs font-normal muted ml-2">older than 24 hours</span>
              </div>
            </div>
            <button
              className="btn text-xs"
              onClick={() => {
                clearFilters();
                setOverdueOnly(true);
              }}
            >
              Review overdue →
            </button>
          </div>
        </section>

        {/* Ticket Queue Panel */}
        <section className="panel overflow-hidden">
          <div className="p-5 border-b border-[#e7ebf1] flex flex-wrap items-center gap-3 justify-between">
            <div>
              <h2 className="font-bold text-lg">Ticket queue</h2>
              <p className="text-xs muted mt-1">Manage, prioritise, and resolve customer requests.</p>
            </div>
            <button className="btn" onClick={clearFilters}>
              ↻ Reset filters
            </button>
          </div>

          {/* Filter Bar */}
          <div className="p-4 border-b border-[#e7ebf1] grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
            <div className="relative xl:col-span-1">
              <span className="absolute left-3 top-[10px] muted" aria-hidden="true">
                ⌕
              </span>
              <input
                id="search-input"
                className="field pl-9 pr-8"
                placeholder="Search by ID, subject, name, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search tickets"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-[9px] text-[#8e98a8] hover:text-[#202a3d] font-bold p-1 text-xs"
                  aria-label="Clear search text"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <select
              className="field"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              className="field"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              aria-label="Filter by priority"
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <select
              className="field"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              aria-label="Filter by assignee"
            >
              <option value="">All assignees</option>
              {AGENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <select
              className="field"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort tickets by"
            >
              <option value="updated">Recently updated</option>
              <option value="priority">Priority: urgent first</option>
            </select>
          </div>

          {/* Active Filter & Search Chips */}
          {(search.trim() || overdueOnly || status || priority || assignee) && (
            <div className="px-5 py-2.5 bg-[#f8f9fc] border-b border-[#e7ebf1] flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#556277] font-semibold">Active filters:</span>
              {search.trim() && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#eeecff] text-[#5547d6] font-medium border border-[#ddd9fc]">
                  Search: &ldquo;{search.trim()}&rdquo;
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="hover:text-red-700 font-bold ml-1"
                    aria-label="Clear search filter"
                  >
                    ✕
                  </button>
                </span>
              )}
              {overdueOnly && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-100 text-amber-900 font-medium border border-amber-200">
                  Overdue tickets only
                  <button
                    type="button"
                    onClick={() => setOverdueOnly(false)}
                    className="hover:text-red-700 font-bold ml-1"
                    aria-label="Remove overdue filter"
                  >
                    ✕
                  </button>
                </span>
              )}
              {status && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#f1f3f7] text-[#2c384e] font-medium border border-[#dfe4ed]">
                  Status: {status}
                  <button
                    type="button"
                    onClick={() => setStatus('')}
                    className="hover:text-red-700 font-bold ml-1"
                    aria-label="Clear status filter"
                  >
                    ✕
                  </button>
                </span>
              )}
              {priority && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#f1f3f7] text-[#2c384e] font-medium border border-[#dfe4ed]">
                  Priority: {priority}
                  <button
                    type="button"
                    onClick={() => setPriority('')}
                    className="hover:text-red-700 font-bold ml-1"
                    aria-label="Clear priority filter"
                  >
                    ✕
                  </button>
                </span>
              )}
              {assignee && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#f1f3f7] text-[#2c384e] font-medium border border-[#dfe4ed]">
                  Assignee: {assignee}
                  <button
                    type="button"
                    onClick={() => setAssignee('')}
                    className="hover:text-red-700 font-bold ml-1"
                    aria-label="Clear assignee filter"
                  >
                    ✕
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-[#6658e8] hover:underline font-semibold ml-auto"
              >
                Clear all filters
              </button>
            </div>
          )}

          {/* Tickets Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[850px]">
              <thead className="bg-[#fafbfe] text-[11px] uppercase tracking-wider muted">
                <tr>
                  <th className="font-semibold px-5 py-3">Ticket</th>
                  <th className="font-semibold px-4 py-3">Customer</th>
                  <th className="font-semibold px-4 py-3">Status</th>
                  <th className="font-semibold px-4 py-3">Priority</th>
                  <th className="font-semibold px-4 py-3">Assignee</th>
                  <th className="font-semibold px-4 py-3">Last updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f5]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="loading">
                      <span className="animate-pulse">Loading tickets…</span>
                    </td>
                  </tr>
                ) : displayedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-12">
                      <div className="text-3xl mb-3">▤</div>
                      {search.trim() ? (
                        <>
                          <div className="font-semibold text-base">
                            No tickets match &ldquo;{search.trim()}&rdquo;
                          </div>
                          <p className="muted text-sm mt-1 max-w-md mx-auto">
                            We couldn&apos;t find any tickets matching your search across ticket ID, subject, customer name, or email.
                          </p>
                          <div className="flex justify-center gap-3 mt-4">
                            <button className="btn btn-primary" onClick={() => setSearch('')}>
                              ✕ Clear search
                            </button>
                            {(status || priority || assignee || overdueOnly) && (
                              <button className="btn" onClick={clearFilters}>
                                ↻ Reset all filters
                              </button>
                            )}
                          </div>
                        </>
                      ) : status || priority || assignee || overdueOnly ? (
                        <>
                          <div className="font-semibold text-base">No tickets match the selected filters</div>
                          <p className="muted text-sm mt-1 max-w-md mx-auto">
                            Try adjusting or resetting your status, priority, or assignee filters to view more tickets.
                          </p>
                          <button className="btn btn-primary mt-4" onClick={clearFilters}>
                            ↻ Reset all filters
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold text-base">No tickets in this workspace</div>
                          <p className="muted text-sm mt-1">Get started by creating your first support ticket.</p>
                          <button
                            className="btn btn-primary mt-4"
                            onClick={() => {
                              setModalError('');
                              setModalFieldErrors({});
                              setShowCreate(true);
                            }}
                          >
                            ＋ Create ticket
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  displayedTickets.map((t) => (
                    <tr
                      key={t.id}
                      tabIndex={0}
                      className="table-row cursor-pointer focus:outline-none"
                      onClick={() => openDetail(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openDetail(t.id);
                        }
                      }}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#f0efff] text-[#6558d9] flex items-center justify-center font-bold text-xs shrink-0">
                            #{t.id}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-sm max-w-[280px] truncate">{t.subject}</div>
                            <div className="text-xs muted mt-1">Updated {ageLabel(t.updatedAt)}</div>
                            {t.overdue && <span className="text-[10px] text-red-600 font-bold">● OVERDUE</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium">{t.customerName}</div>
                        <div className="text-xs muted mt-1">{t.customerEmail || 'No email provided'}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`badge ${statusClass(t.status)}`}>{t.status}</span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`badge ${priorityClass(t.priority)}`}>
                          {t.priority === 'Urgent' ? '⚑ ' : ''}
                          {t.priority}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#e9e7ff] text-[#6156c8] flex items-center justify-center text-[10px] font-bold">
                            {t.assignee === 'Unassigned' ? '—' : initials(t.assignee)}
                          </div>
                          <span className="text-sm">{t.assignee}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm">{dateLabel(t.updatedAt)}</div>
                        <div className="text-xs muted mt-1">{ageLabel(t.updatedAt)}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-[#e7ebf1] flex justify-between items-center text-xs muted">
            <span>
              Showing {displayedTickets.length} tickets {tickets.length >= 250 ? '· (maximum limit 250)' : ''}
            </span>
            <span>Sorted by {sort === 'priority' ? 'priority' : 'last updated'}</span>
          </div>
        </section>

        <footer className="py-6 text-center text-xs muted">
          OrbitDesk Support Workspace · Built with Next.js, Express, and PostgreSQL
        </footer>
      </main>

      {/* CREATE TICKET MODAL */}
      {showCreate && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-ticket-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <div className="modal">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 id="create-ticket-title" className="text-xl font-bold">
                  Create a ticket
                </h2>
                <p className="muted mt-1 text-sm">Capture the customer issue and route it to the right person.</p>
              </div>
              <button
                type="button"
                className="btn p-2 text-lg"
                onClick={() => setShowCreate(false)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex justify-between items-center">
                <span>⚠ {modalError}</span>
                <button
                  type="button"
                  onClick={() => setModalError('')}
                  className="font-bold text-lg p-1"
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            )}

            <form onSubmit={createTicket} className="space-y-4">
              <div>
                <label htmlFor="create-subject" className="block text-sm font-semibold mb-1.5">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  id="create-subject"
                  className={`field ${modalFieldErrors.subject ? 'border-red-400 bg-red-50' : ''}`}
                  required
                  maxLength={200}
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Brief summary of the issue (max 200 chars)"
                />
                {modalFieldErrors.subject && (
                  <p className="text-xs text-red-600 mt-1">{modalFieldErrors.subject}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="create-name" className="block text-sm font-semibold mb-1.5">
                    Customer name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="create-name"
                    className={`field ${modalFieldErrors.customerName ? 'border-red-400 bg-red-50' : ''}`}
                    required
                    maxLength={120}
                    value={form.customerName}
                    onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                    placeholder="Jordan Smith (max 120 chars)"
                  />
                  {modalFieldErrors.customerName && (
                    <p className="text-xs text-red-600 mt-1">{modalFieldErrors.customerName}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="create-email" className="block text-sm font-semibold mb-1.5">
                    Customer email
                  </label>
                  <input
                    id="create-email"
                    type="email"
                    maxLength={254}
                    className={`field ${modalFieldErrors.customerEmail ? 'border-red-400 bg-red-50' : ''}`}
                    value={form.customerEmail}
                    onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                    placeholder="jordan@example.com"
                  />
                  {modalFieldErrors.customerEmail && (
                    <p className="text-xs text-red-600 mt-1">{modalFieldErrors.customerEmail}</p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="create-description" className="block text-sm font-semibold mb-1.5">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="create-description"
                  className={`field min-h-28 resize-y ${modalFieldErrors.description ? 'border-red-400 bg-red-50' : ''}`}
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Describe the issue and all relevant details…"
                />
                {modalFieldErrors.description && (
                  <p className="text-xs text-red-600 mt-1">{modalFieldErrors.description}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="create-priority" className="block text-sm font-semibold mb-1.5">
                    Priority
                  </label>
                  <select
                    id="create-priority"
                    className="field"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="create-status" className="block text-sm font-semibold mb-1.5">
                    Status
                  </label>
                  <select
                    id="create-status"
                    className="field"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="create-assignee" className="block text-sm font-semibold mb-1.5">
                    Assign to
                  </label>
                  <select
                    id="create-assignee"
                    className="field"
                    value={form.assignee}
                    onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                  >
                    {AGENTS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button disabled={saving} className="btn btn-primary" type="submit">
                  {saving ? 'Creating…' : 'Create ticket →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TICKET DETAIL & EDIT MODAL */}
      {selected !== null && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ticket-detail-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelected(null);
              setDetail(null);
            }
          }}
        >
          <div className="modal" style={{ width: 'min(1080px, 100%)' }}>
            {detailLoading || !detail ? (
              <div className="loading">Loading ticket details…</div>
            ) : (
              <>
                <div className="flex flex-wrap justify-between gap-3 items-start mb-5">
                  <div className="flex gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#f0efff] text-[#6558d9] flex items-center justify-center font-bold">
                      #{detail.id}
                    </div>
                    <div>
                      <div className="text-xs muted mb-1">Ticket / #{detail.id}</div>
                      <h2 id="ticket-detail-title" className="text-xl font-bold">
                        {detail.subject}
                      </h2>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`badge ${statusClass(detail.status)}`}>{detail.status}</span>
                        <span className={`badge ${priorityClass(detail.priority)}`}>
                          {detail.priority} priority
                        </span>
                        {detail.overdue && <span className="badge bg-red-100 text-red-700">Overdue</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn" onClick={startEdit}>
                      ✎ Edit ticket
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setSelected(null);
                        setDetail(null);
                      }}
                      aria-label="Close details"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {modalError && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex justify-between items-center">
                    <span>⚠ {modalError}</span>
                    <button
                      type="button"
                      onClick={() => setModalError('')}
                      className="font-bold text-lg p-1"
                      aria-label="Dismiss error"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* EDIT FORM INLINE */}
                {edit ? (
                  <form onSubmit={saveEdit} className="space-y-3 mb-5 border rounded-xl p-4 bg-[#fbfcfe]">
                    <h3 className="font-bold">Edit ticket details</h3>
                    <div>
                      <label htmlFor="edit-subject" className="block text-xs font-semibold muted mb-1">
                        Subject
                      </label>
                      <input
                        id="edit-subject"
                        className="field"
                        required
                        maxLength={200}
                        value={editForm.subject}
                        onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                        placeholder="Subject"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="edit-name" className="block text-xs font-semibold muted mb-1">
                          Customer name
                        </label>
                        <input
                          id="edit-name"
                          className="field"
                          required
                          maxLength={120}
                          value={editForm.customerName}
                          onChange={(e) => setEditForm({ ...editForm, customerName: e.target.value })}
                          placeholder="Customer name"
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-email" className="block text-xs font-semibold muted mb-1">
                          Customer email
                        </label>
                        <input
                          id="edit-email"
                          className="field"
                          type="email"
                          maxLength={254}
                          value={editForm.customerEmail}
                          onChange={(e) => setEditForm({ ...editForm, customerEmail: e.target.value })}
                          placeholder="Email"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="edit-description" className="block text-xs font-semibold muted mb-1">
                        Description
                      </label>
                      <textarea
                        id="edit-description"
                        className="field min-h-20"
                        required
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="edit-status" className="block text-xs font-semibold muted mb-1">
                          Status
                        </label>
                        <select
                          id="edit-status"
                          className="field"
                          value={editForm.status}
                          onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="edit-priority" className="block text-xs font-semibold muted mb-1">
                          Priority
                        </label>
                        <select
                          id="edit-priority"
                          className="field"
                          value={editForm.priority}
                          onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="edit-assignee" className="block text-xs font-semibold muted mb-1">
                          Assignee
                        </label>
                        <select
                          id="edit-assignee"
                          className="field"
                          value={editForm.assignee}
                          onChange={(e) => setEditForm({ ...editForm, assignee: e.target.value })}
                        >
                          {AGENTS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" className="btn" onClick={() => setEdit(false)}>
                        Cancel
                      </button>
                      <button className="btn btn-primary" disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </form>
                ) : null}

                <div className="ticket-layout grid grid-cols-[1.4fr_.9fr] gap-5">
                  <div className="space-y-4">
                    {/* Customer Issue Details */}
                    <section className="rounded-xl border border-[#e7ebf1] p-4">
                      <div className="text-xs uppercase tracking-wider muted font-bold mb-3">
                        Customer issue
                      </div>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 rounded-full bg-[#e9e7ff] text-[#6156c8] flex items-center justify-center font-bold">
                          {initials(detail.customerName)}
                        </div>
                        <div>
                          <div className="font-semibold">{detail.customerName}</div>
                          <div className="text-xs muted">{detail.customerEmail || 'No email provided'}</div>
                        </div>
                        <div className="ml-auto text-xs muted">Created {dateLabel(detail.createdAt)}</div>
                      </div>
                      <p className="text-sm leading-6 whitespace-pre-wrap">{detail.description}</p>
                    </section>

                    {/* Conversation Entries */}
                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold">Conversation</h3>
                        <span className="text-xs muted">{detail.entries.length} entries</span>
                      </div>
                      <div className="space-y-3 max-h-[310px] overflow-y-auto pr-1">
                        {detail.entries.length === 0 ? (
                          <div className="text-sm muted text-center py-7 border border-dashed rounded-xl">
                            No replies or notes yet. Start the conversation below.
                          </div>
                        ) : (
                          detail.entries.map((entry) => (
                            <div
                              key={entry.id}
                              className={`rounded-xl p-3 ${
                                entry.type === 'note' ? 'entry-note' : 'entry-public'
                              }`}
                            >
                              <div className="flex justify-between items-center gap-2 mb-2">
                                <div className="font-semibold text-sm">
                                  {entry.author}
                                  <span
                                    className={`ml-2 text-[10px] uppercase tracking-wider ${
                                      entry.type === 'note' ? 'text-amber-700' : 'text-indigo-700'
                                    }`}
                                  >
                                    {entry.type === 'note' ? '🔒 Internal note' : '↗ Public reply'}
                                  </span>
                                </div>
                                <span className="text-[10px] muted">{dateLabel(entry.createdAt)}</span>
                              </div>
                              <p className="text-sm leading-6 whitespace-pre-wrap">{entry.content}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </section>

                    {/* Add Public Reply / Internal Note */}
                    <form onSubmit={addEntry} className="border border-[#e7ebf1] rounded-xl p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h3 className="font-bold">Add a response</h3>
                        <div className="flex bg-[#f2f4f8] rounded-lg p-1">
                          <button
                            type="button"
                            onClick={() => setEntryType('reply')}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                              entryType === 'reply' ? 'bg-white shadow-sm text-indigo-700' : ''
                            }`}
                          >
                            ↗ Public reply
                          </button>
                          <button
                            type="button"
                            onClick={() => setEntryType('note')}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                              entryType === 'note' ? 'bg-white shadow-sm text-amber-700' : ''
                            }`}
                          >
                            🔒 Internal note
                          </button>
                        </div>
                      </div>

                      {entryType === 'note' && (
                        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2 mb-3">
                          Internal notes are for your support team and are visually distinguished from customer replies.
                        </div>
                      )}

                      <textarea
                        className="field min-h-24 resize-y"
                        required
                        maxLength={50000}
                        value={entryContent}
                        onChange={(e) => setEntryContent(e.target.value)}
                        placeholder={
                          entryType === 'reply'
                            ? 'Write a customer-facing response…'
                            : 'Write an internal note for your team…'
                        }
                        aria-label={entryType === 'reply' ? 'Customer reply' : 'Internal note'}
                      />

                      <div className="flex items-center justify-between gap-3 mt-3">
                        <select
                          className="field max-w-[190px]"
                          value={author}
                          onChange={(e) => setAuthor(e.target.value)}
                          aria-label="Author identity"
                        >
                          {AGENTS.filter((a) => a !== 'Unassigned').map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-primary"
                          disabled={entrySaving || !entryContent.trim()}
                        >
                          {entrySaving
                            ? 'Saving…'
                            : entryType === 'reply'
                            ? 'Send reply →'
                            : 'Add internal note →'}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Properties Sidebar & Activity History */}
                  <div className="space-y-4">
                    <section className="border border-[#e7ebf1] rounded-xl p-4">
                      <h3 className="font-bold mb-4">Ticket properties</h3>
                      <div className="space-y-4">
                        <div>
                          <label htmlFor="quick-status" className="block text-xs muted mb-2">
                            Status
                          </label>
                          <select
                            id="quick-status"
                            className="field"
                            value={detail.status}
                            onChange={(e) => quickUpdateProperty('status', e.target.value)}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor="quick-priority" className="block text-xs muted mb-2">
                            Priority
                          </label>
                          <select
                            id="quick-priority"
                            className="field"
                            value={detail.priority}
                            onChange={(e) => quickUpdateProperty('priority', e.target.value)}
                          >
                            {PRIORITIES.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor="quick-assignee" className="block text-xs muted mb-2">
                            Assignee
                          </label>
                          <select
                            id="quick-assignee"
                            className="field"
                            value={detail.assignee}
                            onChange={(e) => quickUpdateProperty('assignee', e.target.value)}
                          >
                            {AGENTS.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="pt-3 border-t border-[#edf0f4]">
                          <div className="text-xs muted mb-1">Last updated</div>
                          <div className="font-medium">{dateLabel(detail.updatedAt)}</div>
                        </div>
                      </div>
                    </section>

                    {/* Activity History Timeline */}
                    <section className="border border-[#e7ebf1] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold">Activity history</h3>
                        <span className="text-xs muted">{detail.activity.length} events</span>
                      </div>
                      {detail.activity.length === 0 ? (
                        <div className="text-sm muted">No activity recorded yet.</div>
                      ) : (
                        <div className="space-y-4 max-h-[420px] overflow-y-auto">
                          {detail.activity.map((a, i) => (
                            <div key={a.id} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <span
                                  className="timeline-dot"
                                  style={{
                                    background:
                                      a.type === 'status_changed'
                                        ? '#4f72d8'
                                        : a.type === 'priority_changed'
                                        ? '#e09b38'
                                        : a.type === 'assignment_changed'
                                        ? '#8d61d4'
                                        : a.type === 'subject_changed' || a.type === 'description_changed'
                                        ? '#16804a'
                                        : '#8b80ef',
                                  }}
                                />
                                {i < detail.activity.length - 1 && (
                                  <span className="w-px bg-[#e5e8ef] flex-1 mt-1" />
                                )}
                              </div>
                              <div className="pb-1">
                                <div className="text-sm leading-5">{a.description}</div>
                                <div className="text-[11px] muted mt-1">
                                  {a.actor} · {dateLabel(a.createdAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
