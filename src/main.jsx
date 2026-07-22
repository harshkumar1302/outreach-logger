import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  FileText,
  Grid2X2,
  LayoutDashboard,
  Mail,
  Menu,
  Paperclip,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  LogOut,
  Pencil,
  Trash2,
  Download,
  RefreshCw,
  FileJson
} from 'lucide-react';
import { supabase, supabaseConfigured } from './lib/supabase';
import './styles.css';

const today = () => new Date().toISOString().slice(0, 10);
const blank = (user) => ({
  name: '',
  platform: 'Instagram',
  handle: '',
  niche: '',
  audience: '',
  website: '',
  industry: '',
  poc: '',
  designation: '',
  stage: 'New',
  country: { name: 'India', flag: '🇮🇳', code: '+91' },
  phone: '',
  email: '',
  connected: 'Cold DM (Instagram)',
  reachedBy: user?.name || '',
  date: today(),
  response: 'Not Contacted',
  responseNotes: '',
  follow: 'No',
  followDate: '',
  followNotes: '',
  nextAction: '',
  remarks: ''
});

const opts = {
  platform: ['Instagram', 'YouTube', 'LinkedIn', 'Twitter/X', 'Other'],
  connected: [
    'Cold DM (Instagram)',
    'Cold DM (LinkedIn)',
    'Cold Email',
    'Cold Call',
    'WhatsApp',
    'Referral',
    'Event / Meetup',
    'Inbound Lead',
    'Other'
  ],
  response: [
    'Not Contacted',
    'No Response',
    'Interested',
    'Not Interested',
    'Follow-up Needed',
    'Converted',
    'On Hold'
  ],
  stage: ['New', 'Contacted', 'In Discussion', 'Negotiation', 'Onboarded', 'Rejected', 'Dropped']
};

const countries = [
  ['India', '🇮🇳', '+91'],
  ['United States', '🇺🇸', '+1'],
  ['United Kingdom', '🇬🇧', '+44'],
  ['Australia', '🇦🇺', '+61'],
  ['Singapore', '🇸🇬', '+65'],
  ['Canada', '🇨🇦', '+1'],
  ['United Arab Emirates', '🇦🇪', '+971'],
  ['Germany', '🇩🇪', '+49'],
  ['France', '🇫🇷', '+33'],
  ['Other', '🌐', '+']
].map(([name, flag, code]) => ({ name, flag, code }));

const nav = [
  ['Dashboard', LayoutDashboard],
  ['Outreach', Paperclip],
  ['Analytics', BarChart3],
  ['Settings', Settings]
];

function Field({ label, children, wide, required }) {
  return (
    <label className={'field ' + (wide ? 'wide' : '')}>
      <span>
        {label}
        {required && <b className="required"> *</b>}
      </span>
      {children}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = 'text', required = false }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <div className="select">
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(x => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <ChevronDown size={16} />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Notice({ message, error }) {
  return message ? (
    <div className={'notice ' + (error ? 'error' : '')}>
      <div className="notice-content">
        {error ? '!' : '✓'}&nbsp; {message}
      </div>
      <div className="notice-timer" />
    </div>
  ) : null;
}

function toAppUser(user) {
  return user
    ? {
        id: user.id,
        name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        email: user.email || ''
      }
    : null;
}

function initials(name) {
  return (
    (name || '')
      .split(' ')
      .filter(Boolean)
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'U'
  );
}

function downloadCsv(entries) {
  const header =
    'Type,Name,Platform/Website,Handle/Industry,Niche/POC,Audience/Designation,Phone,Email,Connected Via,Reached Out By,Date,Response Status,Response Notes,Follow Needed,Follow Date,Follow Notes,Next Action,Remarks\n';
  const rows = entries
    .map(e =>
      [
        e.type,
        e.name,
        e.platform || e.website,
        e.handle || e.industry,
        e.niche || e.poc,
        e.audience || e.designation,
        `${e.country?.code || ''} ${e.phone || ''}`.trim(),
        e.email,
        e.connected,
        e.reachedBy,
        e.date,
        e.response,
        e.responseNotes,
        e.follow,
        e.followDate,
        e.followNotes,
        e.nextAction,
        e.remarks
      ]
        .map(value => `"${String(value || '').replaceAll('"', '""')}"`)
        .join(',')
    )
    .join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([header + rows], { type: 'text/csv;charset=utf-8;' }));
  link.download = 'creonnect_outreach_clients.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadJson(entries) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json;charset=utf-8;' }));
  link.download = 'creonnect_outreach_clients.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function entryPayload(entry) {
  const {
    id,
    userId,
    createdAt,
    updatedAt,
    sheetSynced,
    supabaseSynced,
    sheetRow,
    ...payload
  } = entry;
  return payload;
}

function sameDayKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return today();
  return date.toISOString().slice(0, 10);
}

function App() {
  const [auth, setAuth] = useState({ loading: true, user: null });
  const [page, setPage] = useState(() => localStorage.getItem('creonnect_page') || 'Dashboard');

  useEffect(() => {
    localStorage.setItem('creonnect_page', page);
  }, [page]);
  const [type, setType] = useState('Creator');
  const [form, setForm] = useState(() => blank(auth.user));
  const [editingId, setEditingId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(() => JSON.parse(localStorage.getItem('creonnect_settings') || '{"theme":"Light","language":"English (US)"}'));
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (auth.user && !form.reachedBy) {
      setForm(f => ({ ...f, reachedBy: auth.user.name }));
    }
  }, [auth.user]);

  const notify = (message, error = false) => {
    setNotice(message);
    setNoticeError(error);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const api = async (path, options = {}) => {
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    if (supabaseConfigured && supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) headers.authorization = `Bearer ${data.session.access_token}`;
      } catch {}
    }
    try {
      const response = await fetch(path, { credentials: 'include', headers, ...options });
      let data = {};
      try {
        data = await response.json();
      } catch {}
      if (!response.ok) throw new Error(data.error || 'Server request failed');
      return data;
    } catch (err) {
      if (path === '/api/entries' && options.method === 'POST') {
        const entry = JSON.parse(options.body || '{}');
        const saved = {
          ...entry,
          id: 'local_' + Date.now(),
          userId: auth.user?.id || 'local',
          createdAt: new Date().toISOString()
        };
        const localList = JSON.parse(localStorage.getItem('creonnect_local_entries') || '[]');
        localList.unshift(saved);
        localStorage.setItem('creonnect_local_entries', JSON.stringify(localList));
        return { ok: true, entry: saved };
      }
      if (path.startsWith('/api/entries/') && options.method === 'PUT') {
        const id = path.split('/').pop();
        const entry = JSON.parse(options.body || '{}');
        const localList = JSON.parse(localStorage.getItem('creonnect_local_entries') || '[]');
        const next = localList.map(item =>
          item.id === id ? { ...item, ...entry, id, updatedAt: new Date().toISOString() } : item
        );
        localStorage.setItem('creonnect_local_entries', JSON.stringify(next));
        return { ok: true, entry: next.find(item => item.id === id) };
      }
      if (path.startsWith('/api/entries/') && options.method === 'DELETE') {
        const id = path.split('/').pop();
        const localList = JSON.parse(localStorage.getItem('creonnect_local_entries') || '[]');
        localStorage.setItem(
          'creonnect_local_entries',
          JSON.stringify(localList.filter(item => item.id !== id))
        );
        return { ok: true };
      }
      if (path === '/api/entries' && (!options.method || options.method === 'GET')) {
        const localList = JSON.parse(localStorage.getItem('creonnect_local_entries') || '[]');
        return { ok: true, entries: localList };
      }
      if (path === '/api/settings') {
        return { ok: true, settings: { theme: 'Light', language: 'English (US)' } };
      }
      throw err;
    }
  };

  useEffect(() => {
    let active = true;
    const initAuth = async () => {
      if (supabaseConfigured && supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          if (active && data.session?.user) {
            setAuth({ loading: false, user: toAppUser(data.session.user) });
            return;
          }
        } catch {}
      }
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        const data = await res.json();
        if (active && data.authenticated && data.user) {
          setAuth({ loading: false, user: data.user });
          return;
        }
      } catch {}
      try {
        const local = localStorage.getItem('creonnect_local_user');
        if (local && active) {
          const parsed = JSON.parse(local);
          if (parsed?.email) {
            setAuth({ loading: false, user: parsed });
            return;
          }
        }
      } catch {}
      if (active) setAuth({ loading: false, user: null });
    };
    initAuth();

    let subscription;
    if (supabaseConfigured && supabase) {
      try {
        const res = supabase.auth.onAuthStateChange((_event, session) => {
          if (active) setAuth({ loading: false, user: toAppUser(session?.user) });
        });
        subscription = res.data?.subscription;
      } catch {}
    }
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!auth.user) return;
    Promise.all([api('/api/settings'), api('/api/entries')])
      .then(([prefs, rows]) => {
        setSettings(prefs.settings || { theme: 'Light', language: 'English (US)' });
        setEntries(rows.entries || []);
      })
      .catch(() => {
        const localList = JSON.parse(localStorage.getItem('creonnect_local_entries') || '[]');
        setEntries(localList);
      });
  }, [auth.user]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme.toLowerCase();
    localStorage.setItem('creonnect_settings', JSON.stringify(settings));
  }, [settings]);

  if (auth.loading) return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <div>Loading Creonnect…</div>
    </div>
  );
  if (!auth.user) return <Auth onAuthenticated={user => { setAuth({ loading: false, user }); setPage('Dashboard'); }} />;

  const updateSettings = async next => {
    setSettings(next);
    try {
      const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify(next) });
      setSettings(data.settings);
      notify('Preferences saved');
    } catch {
      notify('Saved locally', false);
    }
  };

  const updateProfile = async next => {
    try {
      const data = await api('/api/profile', { method: 'PUT', body: JSON.stringify(next) });
      setAuth(current => ({ ...current, user: data.user }));
      notify('Profile changes saved');
    } catch (error) {
      notify(error.message, true);
    }
  };

  const submit = async next => {
    try {
      const endpoint = editingId ? `/api/entries/${editingId}` : '/api/entries';
      const method = editingId ? 'PUT' : 'POST';
      const data = await api(endpoint, { method, body: JSON.stringify(next) });
      if (data.warnings) notify(data.warnings[0], true);
      else notify(editingId ? 'Log updated successfully' : 'Log added successfully');
      
      setEntries(current => {
        if (editingId) return current.map(item => (item.id === editingId ? data.entry : item));
        return [data.entry, ...current];
      });
      setForm(blank(auth.user));
      setEditingId(null);
      setPage('Dashboard');
    } catch (error) {
      notify(error.message, true);
    }
  };

  const editEntry = entry => {
    setType(entry.type || 'Creator');
    setForm({ ...blank(auth.user), ...entryPayload(entry) });
    setEditingId(entry.id);
    go('Outreach');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(blank());
  };

  const deleteEntry = async entry => {
    if (!window.confirm(`Delete ${entry.name || 'this outreach log'}?`)) return;
    try {
      await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
      setEntries(current => current.filter(item => item.id !== entry.id));
      notify('Log deleted successfully');
    } catch (error) {
      notify(error.message, true);
    }
  };

  const syncSheets = async () => {
    notify('Syncing with Google Sheets...');
    try {
      await api('/api/sync-sheets', { method: 'POST' });
      notify('Sheets synced successfully!');
    } catch (error) {
      notify(error.message, true);
    }
  };

  const logout = async () => {
    if (supabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch {}
    }
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    localStorage.removeItem('creonnect_local_user');
    setAuth({ loading: false, user: null });
  };

  const go = name => {
    setPage(name);
    setNavOpen(false);
  };

  return (
    <div className={'shell theme-' + settings.theme.toLowerCase()}>
      <aside className={'sidebar ' + (navOpen ? 'open' : '')}>
        <div className="brand">
          <div className="mark" style={{ background: 'transparent', boxShadow: 'none' }}>
            <img src="/favicon.svg" alt="Creonnect" style={{ width: '42px', height: '42px', borderRadius: '12px', boxShadow: '0 4px 16px var(--accent-glow)' }} />
          </div>
          <div>
            <b>Creonnect</b>
            <small>Outreach Logger</small>
          </div>
          <button className="close" onClick={() => setNavOpen(false)}>
            <X />
          </button>
        </div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button key={name} className={page === name ? 'active' : ''} onClick={() => go(name)}>
              <Icon size={20} />
              {name}
            </button>
          ))}
        </nav>
        <div className="profile">
          <div className="avatar">{initials(auth.user.name)}</div>
          <div>
            <b>{auth.user.name}</b>
            <small>{auth.user.email}</small>
          </div>
          <button className="logout" title="Sign out" onClick={logout}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header>
          <button className="menu" onClick={() => setNavOpen(true)}>
            <Menu />
          </button>
          <div className="header-text">
            <p className="eyebrow">{page.toUpperCase()}</p>
            <h1>{page === 'Outreach' ? 'Log new outreach' : page}</h1>
            <p className="sub">
              {page === 'Outreach'
                ? 'Capture your next conversation while it’s fresh.'
                : page === 'Dashboard'
                ? 'Overview of your outreach performance'
                : page === 'Analytics'
                ? 'Track your outreach performance and engagement metrics.'
                : 'Manage your account preferences and integrations.'}
            </p>
          </div>

          <div className="header-actions">
            {page === 'Dashboard' && (
              <button className="primary top-add" onClick={() => go('Outreach')}>
                <Plus size={17} /> <span className="hide-mobile">New Log</span>
              </button>
            )}
          </div>
        </header>
        <section className="content">
          {page === 'Outreach' ? (
            <Outreach
              type={type}
              form={form}
              setForm={setForm}
              editing={Boolean(editingId)}
              cancelEdit={cancelEdit}
              switchType={next => {
                setType(next);
                setForm(blank(auth.user));
                setEditingId(null);
              }}
              submit={e => { e.preventDefault(); submit({ ...form, type }); }}
            />
          ) : page === 'Dashboard' ? (
            <div style={{ overflowX: 'auto' }}>
              <Dashboard entries={entries} onAdd={() => go('Outreach')} onEdit={editEntry} onDelete={deleteEntry} onSync={syncSheets} />
            </div>
          ) : page === 'Analytics' ? (
            <Analytics entries={entries} />
          ) : (
            <SettingsPage
              user={auth.user}
              settings={settings}
              updateSettings={updateSettings}
              updateProfile={updateProfile}
              notify={notify}
              logout={logout}
            />
          )}
        </section>
      </main>
      <nav className="bottom-nav">
        {nav.map(([name, Icon]) => (
          <button key={name} className={page === name ? 'active' : ''} onClick={() => go(name)}>
            <Icon size={20} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      <Notice message={notice} error={noticeError} />
    </div>
  );
}

function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const update = key => value => setForm(current => ({ ...current, [key]: value }));

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    if (!form.email || !form.email.includes('@')) {
      setMessage('Please enter a valid email address.');
      setBusy(false);
      return;
    }
    if (!form.password || form.password.length < 6) {
      setMessage('Password must be at least 6 characters.');
      setBusy(false);
      return;
    }

    try {
      let appUser = null;
      let errorDetail = null;

      // 1. Try Supabase Auth if configured
      if (supabaseConfigured && supabase) {
        try {
          const result =
            mode === 'login'
              ? await supabase.auth.signInWithPassword({
                  email: form.email,
                  password: form.password
                })
              : await supabase.auth.signUp({
                  email: form.email,
                  password: form.password,
                  options: { data: { full_name: form.name } }
                });

          if (result.error) {
            errorDetail = result.error.message;
          } else if (result.data?.session?.user) {
            appUser = toAppUser(result.data.session.user);
          } else if (mode === 'signup' && result.data?.user && !result.data?.session) {
            setMessage('Account created! Please sign in with your email and password.');
            setMode('login');
            setBusy(false);
            return;
          }
        } catch (err) {
          errorDetail = err.message;
        }
      }

      // 2. Try Server Auth (/api/auth/login or /api/auth/signup)
      if (!appUser) {
        try {
          const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(form)
          });
          let data = null;
          try {
            data = await res.json();
          } catch {}

          if (res.ok && data && data.ok && data.user) {
            appUser = data.user;
          } else if (data && data.error) {
            throw new Error(data.error);
          } else if (!res.ok && !data) {
            throw new Error('BACKEND_OFFLINE');
          } else {
            throw new Error(
              errorDetail ||
                (mode === 'signup'
                  ? 'Account creation failed. Check your email and password.'
                  : 'Incorrect email or password.')
            );
          }
        } catch (serverErr) {
          // 3. Fallback: If backend server is unreachable, create local user session seamlessly
          if (
            serverErr.message === 'BACKEND_OFFLINE' ||
            serverErr.message.includes('Failed to fetch') ||
            serverErr.message.includes('NetworkError') ||
            serverErr.message.includes('Backend server')
          ) {
            const localUser = {
              id: 'local_' + Date.now(),
              name: form.name || form.email.split('@')[0],
              email: form.email
            };
            localStorage.setItem('creonnect_local_user', JSON.stringify(localUser));
            appUser = localUser;
          } else {
            throw serverErr;
          }
        }
      }

      if (appUser) {
        onAuthenticated(appUser);
      }
    } catch (error) {
      setMessage(error.message || 'Authentication error. Please check your credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-tabs">
          <button
            className={mode === 'login' ? 'selected' : ''}
            onClick={() => {
              setMode('login');
              setMessage('');
            }}
          >
            Login
          </button>
          <button
            className={mode === 'signup' ? 'selected' : ''}
            onClick={() => {
              setMode('signup');
              setMessage('');
            }}
          >
            Create Account
          </button>
        </div>
        <div className="auth-logo">
          <div className="mark" style={{ background: 'transparent', boxShadow: 'none' }}>
            <img src="/favicon.svg" alt="Creonnect" style={{ width: '100%', height: '100%', borderRadius: '12px', boxShadow: '0 4px 16px var(--accent-glow)' }} />
          </div>
          <h1>Creonnect</h1>
          <p>Outreach Logger</p>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <Field label="Full name" required>
              <Input value={form.name} onChange={update('name')} placeholder="Your name" required />
            </Field>
          )}
          <Field label="Email" required>
            <Input
              value={form.email}
              onChange={update('email')}
              placeholder="name@company.com"
              type="email"
              required
            />
          </Field>
          <Field label="Password" required>
            <Input
              value={form.password}
              onChange={update('password')}
              placeholder="At least 6 characters"
              type="password"
              required
            />
          </Field>
          {mode === 'login' && (
            <button
              type="button"
              className="forgot"
              onClick={async () => {
                if (supabaseConfigured && supabase && form.email) {
                  const result = await supabase.auth.resetPasswordForEmail(form.email);
                  setMessage(result.error?.message || 'Password reset email sent.');
                } else setMessage('Enter your email first.');
              }}
            >
              Forgot Password?
            </button>
          )}
          {message && <div className="auth-error">{message}</div>}
          <button className="primary auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign In →' : 'Create Account'}
          </button>
        </form>
        <p className="auth-footer">
          {mode === 'login' ? (
            <>
              Don't have an account? <button onClick={() => setMode('signup')}>Sign Up</button>
            </>
          ) : (
            <>
              Already have an account? <button onClick={() => setMode('login')}>Log In</button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Outreach({ type, form, setForm, switchType, submit, editing, cancelEdit }) {
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  const setCountry = value =>
    set('country')(countries.find(item => item.code === value) || countries[0]);

  const setResponse = value => {
    setForm(current => {
      const next = { ...current, response: value };
      if (value === 'Follow-up Needed' || value === 'Interested' || value === 'On Hold') {
        next.follow = 'Yes';
        if (!next.nextAction) next.nextAction = 'Follow up with ' + (current.name || 'contact');
        if (!next.followDate) {
          const dt = new Date();
          dt.setDate(dt.getDate() + (value === 'On Hold' ? 14 : 3));
          next.followDate = dt.toISOString().slice(0, 10);
        }
      } else if (['Converted', 'Not Interested', 'Dropped', 'Rejected'].includes(value)) {
        next.follow = 'No';
      }
      return next;
    });
  };
  return (
    <>
      <div className="toggle">
        <button
          type="button"
          className={type === 'Creator' ? 'chosen' : ''}
          onClick={() => switchType('Creator')}
        >
          <Users size={18} /> Creator
        </button>
        <button
          type="button"
          className={type === 'Brand' ? 'chosen' : ''}
          onClick={() => switchType('Brand')}
        >
          <Grid2X2 size={18} /> Brand
        </button>
      </div>
      <form className="card" onSubmit={submit}>
        <div className="intro">
          <div>
            <p className="eyebrow">{type} OUTREACH</p>
            <h2>{type === 'Creator' ? 'Creator details' : 'Brand details'}</h2>
            <p>
              {editing
                ? 'Update this record and the connected export will refresh.'
                : type === 'Creator'
                ? 'Creator name and Instagram ID are required.'
                : 'All fields are optional. Add what you know.'}
            </p>
          </div>
          <span className="saved">● {editing ? 'Editing log' : 'Secure form'}</span>
        </div>
        <Section title="Profile information">
          <div className="grid">
            <Field
              label={type === 'Creator' ? 'Creator name' : 'Brand / company name'}
              required={type === 'Creator'}
            >
              <Input
                value={form.name}
                onChange={set('name')}
                placeholder={type === 'Creator' ? 'Enter name' : 'Enter company name'}
                required={type === 'Creator'}
              />
            </Field>
            <Field label={type === 'Creator' ? 'Platform' : 'Website'}>
              {type === 'Creator' ? (
                <Select value={form.platform} onChange={set('platform')} options={opts.platform} />
              ) : (
                <Input
                  value={form.website}
                  onChange={set('website')}
                  placeholder="https://example.com"
                />
              )}
            </Field>
            <Field
              label={type === 'Creator' ? 'Instagram ID' : 'Industry / category'}
              required={type === 'Creator'}
            >
              <Input
                value={type === 'Creator' ? form.handle : form.industry}
                onChange={set(type === 'Creator' ? 'handle' : 'industry')}
                placeholder={type === 'Creator' ? '@username' : 'e.g. Technology, Fashion'}
                required={type === 'Creator'}
              />
            </Field>
            <Field label={type === 'Creator' ? 'Niche / category' : 'POC name'}>
              <Input
                value={type === 'Creator' ? form.niche : form.poc}
                onChange={set(type === 'Creator' ? 'niche' : 'poc')}
                placeholder={type === 'Creator' ? 'e.g. Tech, Beauty' : 'Enter name'}
              />
            </Field>
            <Field label={type === 'Creator' ? 'Follower count' : 'POC designation'}>
              <Input
                value={type === 'Creator' ? form.audience : form.designation}
                onChange={set(type === 'Creator' ? 'audience' : 'designation')}
                placeholder={type === 'Creator' ? 'e.g. 10K' : 'e.g. Marketing Manager'}
              />
            </Field>
            {type === 'Brand' && (
              <Field label="Deal stage">
                <Select value={form.stage} onChange={set('stage')} options={opts.stage} />
              </Field>
            )}
          </div>
        </Section>
        <Section title="Contact information">
          <div className="grid">
            <Field label="Phone number">
              <div className="phone">
                <div className="select country-select">
                  <select
                    value={form.country.code}
                    onChange={e => setCountry(e.target.value)}
                  >
                    {countries.map(country => (
                      <option value={country.code} key={country.name}>
                        {country.flag} {country.name} ({country.code})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
                <Input
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="Phone number"
                  type="tel"
                />
              </div>
            </Field>
            <Field label="Email address">
              <div className="with-icon">
                <Mail size={15} />
                <Input
                  value={form.email}
                  onChange={set('email')}
                  placeholder="email@example.com"
                  type="email"
                />
              </div>
            </Field>
          </div>
        </Section>
        <Section title="Outreach details">
          <div className="grid">
            <Field label="How we connected">
              <Select
                value={form.connected}
                onChange={set('connected')}
                options={opts.connected}
              />
            </Field>
            <Field label="Reached out by">
              <Input
                value={form.reachedBy}
                onChange={set('reachedBy')}
                placeholder="Your name"
              />
            </Field>
            <Field label="Date of outreach">
              <div className="with-icon">
                <CalendarDays size={15} />
                <Input value={form.date} onChange={set('date')} type="date" />
              </div>
            </Field>
            <Field label="Response status">
              <Select value={form.response} onChange={setResponse} options={opts.response} />
            </Field>
            <Field label="Response notes" wide>
              <textarea
                value={form.responseNotes}
                onChange={e => set('responseNotes')(e.target.value)}
                placeholder="Details of the interaction..."
              />
            </Field>
          </div>
        </Section>
        <Section title="Follow-up & next steps">
          <div className="grid">
            <Field label="Follow-up needed">
              <Select value={form.follow} onChange={set('follow')} options={['Yes', 'No']} />
            </Field>
            {form.follow === 'Yes' && (
              <>
                <Field label="Follow-up date">
                  <div className="with-icon">
                    <CalendarDays size={15} />
                    <Input value={form.followDate} onChange={set('followDate')} type="date" />
                  </div>
                </Field>
                <Field label="Follow-up notes" wide>
                  <textarea
                    value={form.followNotes}
                    onChange={e => set('followNotes')(e.target.value)}
                    placeholder="What should you remember?"
                  />
                </Field>
                <Field label="Next action" wide>
                  <Input
                    value={form.nextAction}
                    onChange={set('nextAction')}
                    placeholder="e.g. Send proposal"
                  />
                </Field>
              </>
            )}
            <Field label="Remarks" wide>
              <textarea
                value={form.remarks}
                onChange={e => set('remarks')(e.target.value)}
                placeholder="Additional context..."
              />
            </Field>
          </div>
        </Section>
        <div className="footer">
          <span>Entries auto-sync with Supabase & Excel.</span>
          <div className="form-actions">
            {editing && (
              <button type="button" className="secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
            <button className="submit">
              {editing ? <Pencil size={18} /> : <Plus size={18} />}
              {editing ? 'Save changes' : `Add ${type} log`}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function Dashboard({ entries, onAdd, onEdit, onDelete, onSync }) {
  const [page, setPage] = useState(() => Number(localStorage.getItem('dashboardPage')) || 1);
  const itemsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(entries.length / itemsPerPage));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
      localStorage.setItem('dashboardPage', totalPages);
    }
  }, [page, totalPages]);

  const handlePrev = () => {
    const p = Math.max(1, page - 1);
    setPage(p);
    localStorage.setItem('dashboardPage', p);
  };
  
  const handleNext = () => {
    const p = Math.min(totalPages, page + 1);
    setPage(p);
    localStorage.setItem('dashboardPage', p);
  };

  const paginated = entries.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const response = entries.length
    ? Math.round((entries.filter(e => e.response !== 'Not Contacted').length / entries.length) * 100)
    : 0;
  return (
    <>
      <div className="stats">
        <Stat label="Total Outreach" value={entries.length} note="All logged entries" />
        <Stat label="Response Rate" value={`${response}%`} note="Based on logged responses" />
        <Stat
          label="Converted Leads"
          value={entries.filter(e => e.response === 'Converted').length}
          note="Converted entries"
        />
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Outreach List</h2>
          <div className="panel-actions">
            <button className="secondary icon-btn" title="Sync Sheets" onClick={onSync}>
              <RefreshCw size={16} /> <span className="hide-mobile">Sync</span>
            </button>
            <button className="secondary icon-btn" title="Download CSV" onClick={() => downloadCsv(entries)}>
              <Download size={16} /> <span className="hide-mobile">CSV</span>
            </button>
            <button className="secondary icon-btn" title="Download JSON" onClick={() => downloadJson(entries)}>
              <FileJson size={16} /> <span className="hide-mobile">JSON</span>
            </button>
          </div>
        </div>
        {entries.length ? (
          <>
            <div className="table manage-table">
              <div className="row table-header">
                <b>#</b>
                <b>Reached By</b>
                <b>Name</b>
                <b>Date</b>
                <b>Response</b>
                <b>Follow Up</b>
                <b>Connected Via</b>
                <b style={{ textAlign: 'right' }}>Actions</b>
              </div>
              {paginated.map((entry, index) => (
                <div className="row" key={entry.id || index}>
                  <span data-label="#">{(page - 1) * itemsPerPage + index + 1}</span>
                  <b data-label="Reached By">{entry.reachedBy || '—'}</b>
                  <b data-label="Name" style={{ color: 'var(--text-accent)' }}>{entry.name || 'Unnamed'}</b>
                  <span data-label="Date">{new Date(entry.date || entry.createdAt).toLocaleDateString()}</span>
                  <em data-label="Response" className={
                    entry.response === 'Converted' || entry.response === 'Interested' ? 'badge-success' :
                    entry.response === 'Follow-up Needed' || entry.response === 'On Hold' ? 'badge-warning' :
                    entry.response === 'No Response' || entry.response === 'Not Contacted' ? 'badge-neutral' :
                    'badge-danger'
                  }>{entry.response}</em>
                  <span data-label="Follow Up" className={entry.follow === 'Yes' ? 'text-highlight' : ''}>{entry.follow}</span>
                  <span data-label="Connected Via">{entry.connected || '—'}</span>
                  <div className="row-actions">
                    <button title="Edit log" onClick={() => onEdit(entry)}>
                      <Pencil size={15} />
                    </button>
                    <button title="Delete log" className="danger-icon" onClick={() => onDelete(entry)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="pagination">
                <button className="secondary" disabled={page === 1} onClick={handlePrev}>
                  &larr; Previous
                </button>
                <span>Page {page} of {totalPages}</span>
                <button className="secondary" disabled={page === totalPages} onClick={handleNext}>
                  Next &rarr;
                </button>
              </div>
            )}
          </>
        ) : (
          <Empty onAdd={onAdd} />
        )}
      </div>
    </>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Analytics({ entries }) {
  const [daysFilter, setDaysFilter] = useState(30);

  const filteredEntries = daysFilter === 'all' 
    ? entries 
    : entries.filter(e => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysFilter);
        return new Date(e.date || e.createdAt) >= cutoff;
      });

  const count = filteredEntries.length,
    response = count
      ? Math.round((filteredEntries.filter(e => e.response !== 'Not Contacted').length / count) * 100)
      : 0,
    meetings = filteredEntries.filter(e => e.response === 'Converted').length;
  const platforms = ['LinkedIn', 'Email', 'Twitter/X', 'Instagram', 'Other'];
  const platformCounts = platforms.map(
    label =>
      filteredEntries.filter(e =>
        `${e.platform || ''} ${e.connected || ''}`.includes(label)
      ).length
  );
  const statusCounts = {
    positive: filteredEntries.filter(e => ['Interested', 'Converted', 'Follow-up Needed'].includes(e.response)).length,
    neutral: filteredEntries.filter(e => ['Not Interested', 'On Hold'].includes(e.response)).length,
    noResponse: filteredEntries.filter(e => ['No Response', 'Not Contacted'].includes(e.response)).length,
    bounced: filteredEntries.filter(e => e.response === 'Dropped' || e.response === 'Rejected').length
  };
  const rawTotal = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
  const donutTotal = Math.max(1, rawTotal);
  const p1 = (statusCounts.positive / donutTotal) * 100;
  const p2 = p1 + (statusCounts.neutral / donutTotal) * 100;
  const p3 = p2 + (statusCounts.noResponse / donutTotal) * 100;
  // Positive: green, Neutral: yellow, No Response: grey, Bounced: red
  const donutStyle = {
    background: rawTotal === 0 
      ? `var(--border-strong)` 
      : `conic-gradient(#10b981 0 ${p1}%, #f59e0b ${p1}% ${p2}%, #475569 ${p2}% ${p3}%, #ef4444 ${p3}% 100%)`
  };
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    return date.toISOString().slice(0, 10);
  });
  const dailyCounts = days.map(day => filteredEntries.filter(entry => sameDayKey(entry.date || entry.createdAt) === day).length);
  const maxDaily = Math.max(1, ...dailyCounts);
  const points = dailyCounts.map((value, index) => {
    const x = 20 + index * (640 / Math.max(1, dailyCounts.length - 1));
    const y = 235 - (value / maxDaily) * 190;
    return [x, y];
  });
  const linePath = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L660 235 L20 235Z`;
  return (
    <div className="analytics-page">
      <div className="analytics-toolbar">
        <div style={{ flex: 1 }} />
        <div className="range-select-wrapper">
          <CalendarDays size={16} />
          <select value={daysFilter} onChange={e => setDaysFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>
      <div className="stats analytics-stats">
        <Stat label="Total Outreach" value={count} note="All time" />
        <Stat label="Response Rate" value={`${response}%`} note="Based on responses" />
        <Stat label="Meetings Booked" value={meetings} note="Converted entries" />
        <Stat
          label="Conversion Rate"
          value={count ? `${Math.round((meetings / count) * 1000) / 10}%` : '0%'}
          note="Converted / outreach"
        />
      </div>
      <div className="analytics-grid">
        <div className="panel chart-panel">
          <div className="panel-title">
            <h2>Outreach Volume</h2>
          <div className="flex gap-2">
            <button className="export-button" onClick={() => downloadCsv(entries)}>
              CSV &darr;
            </button>
            <button className="export-button" onClick={() => downloadJson(entries)}>
              JSON &darr;
            </button>
          </div>
          </div>
          <svg className="line-chart" viewBox="0 0 680 280" role="img" aria-label="Outreach volume chart">
            <defs>
              <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="grid-line" d="M20 35H660M20 85H660M20 135H660M20 185H660M20 235H660" />
            <path className="area-line" d={areaPath} />
            <path className="main-line" d={linePath} />
            <g className="chart-labels">
              <text x="20" y="258">{days[0].slice(5)}</text>
              <text x="215" y="258">{days[4].slice(5)}</text>
              <text x="410" y="258">{days[8].slice(5)}</text>
              <text x="610" y="258">{days[13].slice(5)}</text>
            </g>
          </svg>
        </div>
        <div className="panel response-panel">
          <h2>Response Status</h2>
          <p>Current pipeline health</p>
          <div className="donut" style={donutStyle}>
            <span>
              {response}%<small>response</small>
            </span>
          </div>
          <div className="legend">
            <span>
              <i className="positive" />Positive ({statusCounts.positive})
            </span>
            <span>
              <i className="neutral" />Neutral ({statusCounts.neutral})
            </span>
            <span>
              <i className="no-response" />No Response ({statusCounts.noResponse})
            </span>
            <span>
              <i className="bounced" />Dropped ({statusCounts.bounced})
            </span>
          </div>
        </div>
      </div>
      <div className="panel platform-panel">
        <h2>Outreach by Platform</h2>
        <div className="platform-bars">
          {platforms.map((label, index) => (
            <div key={label}>
              <span>{label}</span>
              <i style={{ height: `${Math.max(8, platformCounts[index] * 22)}px` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Empty({ onAdd }) {
  return (
    <div className="empty">
      <FileText size={30} />
      <p>No outreach logged yet.</p>
      <button className="primary" onClick={onAdd}>
        <Plus size={16} /> Add your first log
      </button>
    </div>
  );
}

function SettingsPage({ user, settings, updateSettings, updateProfile, notify, logout }) {
  const [tab, setTab] = useState('Profile Settings'),
    [draft, setDraft] = useState(user),
    [status, setStatus] = useState({
      googleSheets: { configured: false },
      supabase: { configured: false },
      excel: { configured: true, exportPath: '/api/export/excel' },
      json: { configured: true, exportPath: '/api/export/json' }
    });

  useEffect(() => {
    fetch('/api/integrations/status')
      .then(res => res.json())
      .then(data => {
        if (data.ok) setStatus(data);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-tabs">
          <button
            className={tab === 'Profile Settings' ? 'selected' : ''}
            onClick={() => setTab('Profile Settings')}
          >
            Profile Settings
          </button>
          <button
            className={tab === 'App Preferences' ? 'selected' : ''}
            onClick={() => setTab('App Preferences')}
          >
            App Preferences
          </button>
          <button
            className={tab === 'Integrations' ? 'selected' : ''}
            onClick={() => setTab('Integrations')}
          >
            Integrations
          </button>
        </aside>
        <div className="settings-main">
          {tab === 'Profile Settings' && (
            <SettingsSection title="Profile Settings">
              <div className="profile-form">
                <div>
                  <div className="profile-photo">{initials(draft.name)}</div>
                  <button
                    className="text-button"
                    onClick={() => notify('Profile pictures are not enabled yet')}
                  >
                    Change Picture
                  </button>
                </div>
                <div className="grid">
                  <Field label="Full name">
                    <Input
                      value={draft.name}
                      onChange={value => setDraft({ ...draft, name: value })}
                    />
                  </Field>
                  <Field label="Email address">
                    <Input
                      value={draft.email}
                      onChange={value => setDraft({ ...draft, email: value })}
                      type="email"
                    />
                  </Field>
                </div>
              </div>
              <div className="settings-actions">
                <button className="primary" onClick={() => updateProfile(draft)}>
                  Save Changes
                </button>
              </div>
            </SettingsSection>
          )}
          {tab === 'App Preferences' && (
            <SettingsSection title="App Preferences">
              <div className="preference-row">
                <div>
                  <strong>Theme</strong>
                  <small>Select your preferred interface color mode.</small>
                </div>
                <div className="segmented">
                  <button
                    className={settings.theme === 'Light' ? 'selected' : ''}
                    onClick={() => updateSettings({ ...settings, theme: 'Light' })}
                  >
                    ☼&nbsp; Light
                  </button>
                  <button
                    className={settings.theme === 'Dark' ? 'selected' : ''}
                    onClick={() => updateSettings({ ...settings, theme: 'Dark' })}
                  >
                    ☾&nbsp; Dark
                  </button>
                </div>
              </div>
              <div className="preference-row">
                <div>
                  <strong>Language</strong>
                  <small>Choose the primary language for the interface.</small>
                </div>
                <select
                  value={settings.language}
                  onChange={e => updateSettings({ ...settings, language: e.target.value })}
                >
                  <option>English (US)</option>
                  <option>English (UK)</option>
                </select>
              </div>
            </SettingsSection>
          )}
          {tab === 'Integrations' && (
            <SettingsSection title="Integrations">
              <div className="integration-grid">
                <IntegrationCard
                  name="Google Sheets"
                  color="green"
                  configured={status.googleSheets?.configured}
                  details={
                    status.googleSheets?.sheetId ? (
                      <>Syncing to spreadsheet.</>
                    ) : (
                      <>
                        Set GOOGLE_SHEET_ID &<br />
                        GOOGLE_SERVICE_ACCOUNT_JSON in .env
                      </>
                    )
                  }
                  action="Setup Guide"
                  onClick={() => notify('Google Sheets sync is operational')}
                />
                <IntegrationCard
                  name="Supabase DB"
                  color="blue"
                  configured={status.supabase?.configured}
                  details={
                    status.supabase?.url ? (
                      <>Connected to project.</>
                    ) : (
                      <>
                        Set VITE_SUPABASE_URL and<br />
                        SUPABASE_SECRET_KEY in .env
                      </>
                    )
                  }
                  action="Setup Guide"
                  onClick={() => notify('Supabase is configured in your .env file')}
                />
                <IntegrationCard
                  name="Export Options"
                  color="green"
                  configured={status.excel?.configured}
                  details={<>Downloads live CSV or JSON generated from your saved logs</>}
                  action="Status Info"
                  onClick={() => notify('Exports are always available on dashboards')}
                />
              </div>
              <div className="privacy-callout">
                <strong>Private server-side connection</strong>
                <span>
                  All integrations run securely through your backend server. Local storage keeps your
                  logs safe even if third-party APIs are offline.
                </span>
              </div>
            </SettingsSection>
          )}
          <div className="settings-logout">
            <button onClick={logout}>
              <LogOut size={16} /> Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({ title, children }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function IntegrationCard({ name, color, configured, details, onAction }) {
  return (
    <div className={'integration-card ' + (configured ? color : 'gray')}>
      <div className="integration-card-top">
        <span className="sheet-icon">▦</span>
        <strong>{name}</strong>
        <em>{configured ? '● Connected' : '○ Not configured'}</em>
      </div>
      <p>{details}</p>
      <button className="secondary" onClick={onAction}>
        {configured ? 'Status Info' : 'Setup Guide'}
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
