// app/admin/emails/page.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mail, Send, Users, Upload, Trash2, Loader2, AlertTriangle, CheckCircle2, Eye, Smartphone, Monitor,
  RefreshCw, X, ShieldCheck, Ticket, Crown, UserPlus, History, Link2, Database, Plus
} from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { parseRecipients } from '@/lib/bulk-mail/recipients';
import { CAMPAIGN_TEMPLATES, CampaignContent, EMPTY_CAMPAIGN, MERGE_TAGS } from '@/lib/bulk-mail/templates';

const DRAFT_KEY = 'pm-email-studio-draft';

type Status = { ready: boolean; migrationMissing: boolean; secretMissing: boolean; resendKeyMissing: boolean; max: number };
type Source = { table: string; columns: string[]; count: number; error?: string };
type Campaign = {
  id: string; subject: string; status: string; recipients_total: number; sent: number; failed: number;
  skipped_unsubscribed: number; failures: { email: string; error: string }[]; created_by: string; created_at: string;
};

const input = "w-full bg-zinc-900 border border-white/10 focus:border-brandRed outline-none rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 transition-colors";
const label = "text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block";
const card = "bg-zinc-950 border border-white/10 rounded-3xl p-6 md:p-8";

export default function EmailStudio() {
  const { showAlert } = useAlert();

  const [status, setStatus] = useState<Status | null>(null);
  const [recipientsText, setRecipientsText] = useState('');
  const [content, setContent] = useState<CampaignContent>(EMPTY_CAMPAIGN);
  const [templateId, setTemplateId] = useState('blank');

  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [eventId, setEventId] = useState('');
  const [loadingAudience, setLoadingAudience] = useState<string | null>(null);

  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [lastResult, setLastResult] = useState<{ sent: number; failed: { email: string; error: string }[]; skippedUnsubscribed: number } | null>(null);

  const [quickAdd, setQuickAdd] = useState('');
  const [sources, setSources] = useState<Source[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [history, setHistory] = useState<Campaign[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseRecipients(recipientsText), [recipientsText]);
  const set = (k: keyof CampaignContent, v: string) => setContent((c) => ({ ...c, [k]: v }));

  // ---- load draft, status, events, history ---------------------------------------------------
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (saved?.content) setContent({ ...EMPTY_CAMPAIGN, ...saved.content });
      if (typeof saved?.recipientsText === 'string') setRecipientsText(saved.recipientsText);
    } catch { /* a draft is a convenience only */ }
    loadStatus();
    loadHistory();
    fetch('/api/events').then((r) => r.json()).then((list) => {
      if (Array.isArray(list)) setEvents(list.map((e: any) => ({ id: String(e._id || e.id), title: String(e.title || e.name || 'Event') })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ content, recipientsText })); } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [content, recipientsText]);

  const loadStatus = async () => {
    try { setStatus(await (await fetch('/api/admin/emails?view=status')).json()); } catch { /* banner just stays hidden */ }
  };
  const loadHistory = async () => {
    try {
      const res = await fetch('/api/admin/emails?view=history');
      const data = await res.json();
      if (Array.isArray(data)) setHistory(data);
    } catch { /* ignore */ }
  };

  // ---- live preview (server-rendered so it matches what is sent) ------------------------------
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'preview', content, recipients: parsed.valid.slice(0, 1) }),
        });
        const data = await res.json();
        if (res.ok) { setPreviewHtml(data.html); setPreviewSubject(data.subject); }
      } catch { /* keep the last preview */ }
    }, 450);
    return () => clearTimeout(t);
  }, [content, parsed.valid]);

  // ---- recipients -----------------------------------------------------------------------------
  const appendRecipients = (list: { email: string; name?: string }[]) => {
    const lines = list.map((r) => (r.name ? `${r.email}, ${r.name}` : r.email)).join('\n');
    setRecipientsText((t) => (t.trim() ? `${t.trim()}\n${lines}` : lines));
  };

  const scanTables = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/admin/emails?view=sources');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not scan');
      setSources(data);
    } catch (e: any) {
      showAlert(e.message || 'Could not scan', 'error');
    } finally {
      setScanning(false);
    }
  };

  // Quick add: type or paste one or many addresses. Only addresses not already in the list are added.
  const addManual = (text: string) => {
    const p = parseRecipients(text);
    if (p.valid.length === 0 && p.invalid.length === 0) return;
    const have = new Set(parsed.valid.map((r) => r.email));
    const fresh = p.valid.filter((r) => !have.has(r.email));
    if (fresh.length) appendRecipients(fresh);
    const parts = [`Added ${fresh.length} email${fresh.length === 1 ? '' : 's'}`];
    const already = p.valid.length - fresh.length + p.duplicates;
    if (already > 0) parts.push(`${already} already in the list`);
    if (p.invalid.length) parts.push(`${p.invalid.length} not valid: ${p.invalid.slice(0, 3).join(', ')}`);
    showAlert(parts.join(' · '), fresh.length ? (p.invalid.length ? 'info' : 'success') : 'error');
    if (p.invalid.length === 0) setQuickAdd('');
  };

  const removeRecipient = (email: string) => {
    const keep = parsed.valid.filter((r) => r.email !== email);
    const lines = [...keep.map((r) => (r.name ? `${r.email}, ${r.name}` : r.email)), ...parsed.invalid];
    setRecipientsText(lines.join('\n'));
  };

  const addAudience = async (type: 'users' | 'members' | 'buyers' | 'table' | 'others', tableName?: string) => {
    const key = type === 'table' ? `table:${tableName}` : type;
    setLoadingAudience(key);
    try {
      const qs = `view=audience&type=${type}${type === 'buyers' && eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}${tableName ? `&name=${encodeURIComponent(tableName)}` : ''}`;
      const res = await fetch(`/api/admin/emails?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load audience');
      appendRecipients(data.recipients);
      showAlert(`Added ${data.recipients.length} people${data.removedUnsubscribed ? ` (${data.removedUnsubscribed} unsubscribed were left out)` : ''}`, 'success');
    } catch (e: any) {
      showAlert(e.message || 'Could not load audience', 'error');
    } finally {
      setLoadingAudience(null);
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return showAlert('File is too large (2 MB max).', 'error');
    appendRecipients([]);
    const text = await file.text();
    setRecipientsText((t) => (t.trim() ? `${t.trim()}\n${text.trim()}` : text.trim()));
    if (fileRef.current) fileRef.current.value = '';
  };

  // ---- compose helpers ------------------------------------------------------------------------
  const applyTemplate = (id: string) => {
    const tpl = CAMPAIGN_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    const dirty = content.subject || content.heading || content.body;
    if (dirty && id !== templateId && !confirm('Replace what you have written with this template?')) return;
    setTemplateId(id);
    setContent(tpl.content);
  };

  const insertTag = (tag: string) => {
    const el = bodyRef.current;
    if (!el) return set('body', content.body + tag);
    const { selectionStart: s, selectionEnd: e } = el;
    const next = content.body.slice(0, s) + tag + content.body.slice(e);
    set('body', next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + tag.length, s + tag.length); });
  };

  // ---- actions --------------------------------------------------------------------------------
  const post = async (payload: object) => {
    const res = await fetch('/api/admin/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const data = await post({ action: 'test', content, recipients: parsed.valid.slice(0, 1) });
      showAlert(`Test sent to ${data.to}. Check the inbox and spam folder.`, 'success');
    } catch (e: any) {
      showAlert(e.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const sendCampaign = async () => {
    setSending(true);
    try {
      const data = await post({ action: 'send', content, recipients: parsed.valid, confirmed: true, expectedCount: parsed.valid.length });
      setLastResult({ sent: data.sent, failed: data.failed, skippedUnsubscribed: data.skippedUnsubscribed });
      setConfirmOpen(false);
      setChecked(false);
      showAlert(`Sent ${data.sent} email${data.sent === 1 ? '' : 's'}${data.failed.length ? `, ${data.failed.length} failed` : ''}`, data.failed.length ? 'info' : 'success');
      loadHistory();
    } catch (e: any) {
      showAlert(e.message, 'error');
      loadHistory();
    } finally {
      setSending(false);
    }
  };

  const loadFailed = (failures: { email: string }[]) => {
    setRecipientsText(failures.map((f) => f.email).join('\n'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showAlert(`Loaded ${failures.length} failed address${failures.length === 1 ? '' : 'es'} into the recipient list`, 'info');
  };

  const clearAll = () => {
    if (!confirm('Clear the recipient list and the message?')) return;
    setRecipientsText(''); setContent(EMPTY_CAMPAIGN); setTemplateId('blank'); setLastResult(null);
  };

  const canSend = status?.ready && parsed.valid.length > 0 && content.subject.trim() && content.heading.trim() && content.body.trim();
  const tooMany = status ? parsed.valid.length > status.max : false;

  return (
    <div className="min-h-screen bg-black text-white pt-32 pb-24 px-4 md:px-6 selection:bg-brandRed/30">
      <div className="max-w-7xl mx-auto">

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <div className="inline-flex items-center gap-3 px-5 py-2 bg-zinc-900 border border-white/5 rounded-full mb-5">
              <Mail size={14} className="text-brandRed" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Admin <span className="text-white">Email Studio</span></span>
            </div>
            <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none">
              Send <span className="text-brandRed">Emails.</span>
            </h1>
            <p className="text-zinc-500 text-sm mt-4 max-w-xl">Write once, send to any list in the same look as your tickets and receipts. Every email carries an unsubscribe link and unsubscribed people are skipped automatically.</p>
          </div>
          <button onClick={clearAll} className="flex items-center gap-2 px-5 py-3 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-white/5 self-start md:self-auto">
            <Trash2 size={14} /> Start over
          </button>
        </div>

        {status && !status.ready && (
          <div className="mb-8 p-5 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 flex gap-4">
            <AlertTriangle className="text-yellow-500 shrink-0" size={20} />
            <div className="text-sm text-yellow-100/90 space-y-1">
              <p className="font-bold">Setup needed before you can send</p>
              {status.migrationMissing && <p>Run <code className="text-yellow-300">supabase/migrations/20261001_bulk_email.sql</code> in the Supabase SQL editor.</p>}
              {status.secretMissing && <p>Add <code className="text-yellow-300">EMAIL_UNSUBSCRIBE_SECRET</code> in Vercel (any long random string), then redeploy.</p>}
              {status.resendKeyMissing && <p>Add <code className="text-yellow-300">RESEND_API_KEY</code> in Vercel.</p>}
              <button onClick={loadStatus} className="mt-2 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-yellow-300 hover:text-white"><RefreshCw size={12} /> Check again</button>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-8 items-start">

          {/* LEFT: recipients + compose */}
          <div className="space-y-8">

            <section className={card}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest"><Users size={16} className="text-brandRed" /> Recipients</h2>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span className={tooMany ? 'text-red-400' : 'text-white'}>{parsed.valid.length}</span>{status ? ` / ${status.max}` : ''} valid
                </span>
              </div>

              <textarea
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                rows={7}
                placeholder={"Paste email addresses, one per line.\nAdd a name to personalise:\nasha@example.com, Asha\nRahul <rahul@example.com>"}
                className={`${input} font-mono text-xs leading-relaxed`}
              />

              <div className="mt-4">
                <span className={label}>Add more emails</span>
                <div className="flex gap-2">
                  <input
                    value={quickAdd}
                    onChange={(e) => setQuickAdd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(quickAdd); } }}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text');
                      if (/[\n,;\t]/.test(text.trim()) || text.includes('@')) { e.preventDefault(); addManual(text); }
                    }}
                    placeholder="Type or paste one or many emails, then press Enter"
                    className={input}
                  />
                  <button onClick={() => addManual(quickAdd)} disabled={!quickAdd.trim()} className="flex items-center gap-2 px-5 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 disabled:opacity-30 shrink-0">
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>

              {parsed.valid.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                  {parsed.valid.slice(0, 60).map((r) => (
                    <span key={r.email} className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-zinc-900 border border-white/10 text-[11px] text-zinc-300 max-w-full">
                      <span className="truncate">{r.name ? `${r.name} · ${r.email}` : r.email}</span>
                      <button onClick={() => removeRecipient(r.email)} title="Remove" className="text-zinc-500 hover:text-white shrink-0"><X size={12} /></button>
                    </span>
                  ))}
                  {parsed.valid.length > 60 && <span className="px-3 py-1.5 text-[11px] text-zinc-500">+{parsed.valid.length - 60} more in the list above</span>}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2.5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-white/5">
                  <Upload size={13} /> Upload CSV
                </button>
                <button onClick={() => setRecipientsText('')} disabled={!recipientsText} className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white disabled:opacity-30">Clear list</button>
              </div>

              <div className="mt-5 pt-5 border-t border-white/5">
                <span className={label}>Or add a group from your site</span>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => addAudience('users')} disabled={!!loadingAudience} className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-brandRed disabled:opacity-50">
                    {loadingAudience === 'users' ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} All users
                  </button>
                  <button onClick={() => addAudience('members')} disabled={!!loadingAudience} className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-brandRed disabled:opacity-50">
                    {loadingAudience === 'members' ? <Loader2 size={13} className="animate-spin" /> : <Crown size={13} />} Members
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => addAudience('buyers')} disabled={!!loadingAudience} className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-brandRed disabled:opacity-50">
                      {loadingAudience === 'buyers' ? <Loader2 size={13} className="animate-spin" /> : <Ticket size={13} />} Ticket buyers
                    </button>
                    <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 text-[11px] text-zinc-300 max-w-[180px]">
                      <option value="">All events</option>
                      {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-600 mt-3">Phone-only accounts have no real email and are left out. Unsubscribed people are skipped when you send.</p>
              </div>

              <div className="mt-5 pt-5 border-t border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <span className={`${label} !mb-0`}>Emails found in other tables</span>
                  <button onClick={scanTables} disabled={scanning} className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-brandRed disabled:opacity-50">
                    {scanning ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />} {sources ? 'Scan again' : 'Scan database'}
                  </button>
                </div>
                {sources && sources.length === 0 && <p className="text-xs text-zinc-600">No other tables with email columns were found.</p>}
                {sources && sources.length > 0 && (
                  <div className="rounded-xl border border-white/5 divide-y divide-white/5 overflow-hidden">
                    {sources.map((src) => (
                      <div key={src.table} className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-900/50">
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{src.table}</p>
                          <p className="text-[10px] text-zinc-600 font-mono truncate">{src.columns.join(', ')}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`text-[11px] ${src.error ? 'text-red-400' : 'text-zinc-400'}`}>{src.error ? 'unreadable' : `${src.count} emails`}</span>
                          <button onClick={() => addAudience('table', src.table)} disabled={!!loadingAudience || src.count === 0} className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-widest hover:border-brandRed disabled:opacity-30">
                            {loadingAudience === `table:${src.table}` ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
                          </button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => addAudience('others')} disabled={!!loadingAudience} className="w-full px-4 py-3 bg-zinc-900 text-[10px] font-black uppercase tracking-widest text-brandRed hover:bg-zinc-800 disabled:opacity-40">
                      {loadingAudience === 'others' ? 'Adding…' : 'Add all of these (duplicates removed)'}
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-zinc-600 mt-3">Scans every table except profiles. Review the list before adding: some tables hold admins or payers rather than your audience.</p>
              </div>

              {(parsed.invalid.length > 0 || parsed.duplicates > 0) && (
                <div className="mt-5 p-4 rounded-xl bg-zinc-900 border border-white/5 text-xs space-y-2">
                  {parsed.duplicates > 0 && <p className="text-zinc-400">{parsed.duplicates} duplicate{parsed.duplicates === 1 ? '' : 's'} ignored.</p>}
                  {parsed.invalid.length > 0 && (
                    <div>
                      <p className="text-red-400 font-bold mb-1">{parsed.invalid.length} line{parsed.invalid.length === 1 ? '' : 's'} can't be used:</p>
                      <p className="text-zinc-500 font-mono break-all">{parsed.invalid.slice(0, 8).join('  ·  ')}{parsed.invalid.length > 8 ? `  · +${parsed.invalid.length - 8} more` : ''}</p>
                    </div>
                  )}
                </div>
              )}
              {tooMany && <p className="mt-4 text-xs text-red-400">Over the limit of {status?.max} per campaign. Split the list into smaller sends.</p>}
            </section>

            <section className={card}>
              <div className="flex items-center justify-between mb-5 gap-4">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest"><Mail size={16} className="text-brandRed" /> Message</h2>
                <select value={templateId} onChange={(e) => applyTemplate(e.target.value)} className="bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-zinc-300">
                  {CAMPAIGN_TEMPLATES.map((t) => <option key={t.id} value={t.id}>Template: {t.label}</option>)}
                </select>
              </div>

              <div className="space-y-5">
                <div>
                  <span className={label}>Subject</span>
                  <input value={content.subject} onChange={(e) => set('subject', e.target.value)} maxLength={150} placeholder="What the inbox shows" className={input} />
                </div>
                <div>
                  <span className={label}>Preview text <span className="normal-case tracking-normal text-zinc-600">(optional, the grey line next to the subject)</span></span>
                  <input value={content.preheader} onChange={(e) => set('preheader', e.target.value)} maxLength={120} className={input} />
                </div>
                <div>
                  <span className={label}>Heading inside the email</span>
                  <input value={content.heading} onChange={(e) => set('heading', e.target.value)} maxLength={120} className={input} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`${label} !mb-0`}>Message</span>
                    <div className="flex gap-2">
                      {MERGE_TAGS.map((m) => (
                        <button key={m.tag} title={m.hint} onClick={() => insertTag(m.tag)} className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/10 text-[10px] font-mono text-zinc-300 hover:border-brandRed">{m.tag}</button>
                      ))}
                    </div>
                  </div>
                  <textarea ref={bodyRef} value={content.body} onChange={(e) => set('body', e.target.value)} rows={10} className={`${input} leading-relaxed`} placeholder={"Hi {{name}},\n\nWrite your message. A blank line starts a new paragraph.\n\nUse **double stars** for bold. Links starting with https:// become clickable."} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <span className={label}>Button text <span className="normal-case tracking-normal text-zinc-600">(optional)</span></span>
                    <input value={content.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} maxLength={40} className={input} />
                  </div>
                  <div>
                    <span className={label}>Button link</span>
                    <input value={content.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} placeholder="https://" className={input} />
                  </div>
                </div>
                <div>
                  <span className={label}>Extra note above the footer <span className="normal-case tracking-normal text-zinc-600">(optional)</span></span>
                  <input value={content.footerNote} onChange={(e) => set('footerNote', e.target.value)} maxLength={200} className={input} />
                </div>
              </div>
            </section>
          </div>

          {/* RIGHT: preview + send */}
          <div className="space-y-8 lg:sticky lg:top-28">
            <section className={card}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest"><Eye size={16} className="text-brandRed" /> Live preview</h2>
                <div className="flex gap-1 bg-zinc-900 rounded-xl p-1 border border-white/5">
                  <button onClick={() => setDevice('desktop')} className={`p-2 rounded-lg ${device === 'desktop' ? 'bg-white text-black' : 'text-zinc-500'}`}><Monitor size={14} /></button>
                  <button onClick={() => setDevice('mobile')} className={`p-2 rounded-lg ${device === 'mobile' ? 'bg-white text-black' : 'text-zinc-500'}`}><Smartphone size={14} /></button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 mb-3 truncate">Subject: <span className="text-zinc-300">{previewSubject || '(empty)'}</span>{parsed.valid[0] ? <> · shown for <span className="text-zinc-300">{parsed.valid[0].email}</span></> : null}</p>
              <div className="bg-zinc-900 rounded-2xl p-3 flex justify-center">
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={previewHtml || '<p style="font-family:sans-serif;color:#888;padding:24px">Start writing to see the preview.</p>'}
                  className="bg-white rounded-xl border-0 transition-all"
                  style={{ width: device === 'mobile' ? 375 : '100%', height: 620, maxWidth: '100%' }}
                />
              </div>
            </section>

            <section className={card}>
              <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest mb-5"><ShieldCheck size={16} className="text-brandRed" /> Send</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={sendTest} disabled={testing || !status?.ready || !content.subject.trim() || !content.body.trim()} className="flex-1 flex items-center justify-center gap-2 px-5 py-4 border border-white/10 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-white/5 disabled:opacity-40">
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send test to me
                </button>
                <button onClick={() => { setChecked(false); setConfirmOpen(true); }} disabled={!canSend || tooMany} className="flex-1 flex items-center justify-center gap-2 px-5 py-4 bg-brandRed rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-red-600 disabled:opacity-40">
                  <Send size={14} /> Send to {parsed.valid.length || 0}
                </button>
              </div>
              <p className="text-[11px] text-zinc-600 mt-4">Always send a test to yourself first and check it in your inbox and spam folder.</p>

              {lastResult && (
                <div className="mt-5 p-4 rounded-xl bg-zinc-900 border border-white/5 text-xs space-y-1">
                  <p className="flex items-center gap-2 text-emerald-400 font-bold"><CheckCircle2 size={14} /> {lastResult.sent} sent</p>
                  {lastResult.skippedUnsubscribed > 0 && <p className="text-zinc-400">{lastResult.skippedUnsubscribed} skipped (unsubscribed)</p>}
                  {lastResult.failed.length > 0 && (
                    <p className="text-red-400">{lastResult.failed.length} failed. <button onClick={() => loadFailed(lastResult.failed)} className="underline font-bold">Load them to retry</button></p>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* HISTORY */}
        <section className={`${card} mt-8`}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest"><History size={16} className="text-brandRed" /> Recent campaigns</h2>
            <button onClick={loadHistory} className="text-zinc-500 hover:text-white"><RefreshCw size={14} /></button>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-zinc-600">Nothing sent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-widest text-zinc-500">
                  <tr><th className="pb-3 pr-4">When</th><th className="pb-3 pr-4">Subject</th><th className="pb-3 pr-4">Status</th><th className="pb-3 pr-4">Sent</th><th className="pb-3 pr-4">Failed</th><th className="pb-3 pr-4">Skipped</th><th className="pb-3">By</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {history.map((c) => (
                    <tr key={c.id} className="align-top">
                      <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">{new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                      <td className="py-3 pr-4 max-w-[260px] truncate">{c.subject}</td>
                      <td className="py-3 pr-4">
                        <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${c.status === 'DONE' ? 'bg-emerald-500/10 text-emerald-400' : c.status === 'SENDING' ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'}`}>{c.status}</span>
                      </td>
                      <td className="py-3 pr-4">{c.sent}</td>
                      <td className="py-3 pr-4">
                        {c.failed > 0 ? <button onClick={() => loadFailed(c.failures)} className="text-red-400 underline font-bold" title="Load failed addresses into the recipient list">{c.failed}</button> : 0}
                      </td>
                      <td className="py-3 pr-4 text-zinc-500">{c.skipped_unsubscribed}</td>
                      <td className="py-3 text-zinc-500">{c.created_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="flex items-center gap-2 text-[11px] text-zinc-600 mt-5"><Link2 size={12} /> Unsubscribes are recorded automatically from the link in each email.</p>
        </section>
      </div>

      {/* CONFIRM MODAL */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-white/10 rounded-3xl p-8 w-full max-w-md relative">
            <button onClick={() => !sending && setConfirmOpen(false)} className="absolute top-5 right-5 text-zinc-500 hover:text-white"><X size={18} /></button>
            <h3 className="text-xl font-black uppercase tracking-tight mb-1">Send this campaign?</h3>
            <p className="text-sm text-zinc-500 mb-6">This cannot be undone once it starts.</p>
            <div className="space-y-3 text-sm mb-6">
              <div className="flex justify-between gap-4"><span className="text-zinc-500">Subject</span><span className="text-right truncate">{previewSubject || content.subject}</span></div>
              <div className="flex justify-between gap-4"><span className="text-zinc-500">Recipients</span><span className="font-bold">{parsed.valid.length}</span></div>
              <div className="flex justify-between gap-4"><span className="text-zinc-500">Sent from</span><span>hello@punerimallus.com</span></div>
            </div>
            <label className="flex items-start gap-3 text-xs text-zinc-300 mb-6 cursor-pointer">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 accent-red-600" />
              I sent a test to myself, checked the preview and recipient list, and want to send this now.
            </label>
            <div className="flex gap-3">
              <button onClick={() => setConfirmOpen(false)} disabled={sending} className="flex-1 px-5 py-4 border border-white/10 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-white/5 disabled:opacity-40">Cancel</button>
              <button onClick={sendCampaign} disabled={!checked || sending} className="flex-1 flex items-center justify-center gap-2 px-5 py-4 bg-brandRed rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-red-600 disabled:opacity-40">
                {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send now</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
