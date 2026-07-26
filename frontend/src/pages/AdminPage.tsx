/** Admin dashboard — grouped sections with a sticky sub-nav.
 * Route is guarded client-side; the API itself 404s for non-admins. */

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Icon } from '../components/icons';
import { Sparkline } from '../components/admin/Sparkline';
import { IconButton, Segmented, Switch } from '../components/ui';
import { useSnackbar } from '../components/ui/Snackbar';
import { strings, t } from '../i18n';
import { api } from '../lib/api';
import type { SystemLimits } from '../lib/types';
import { useApp } from '../state/app';
import './admin.css';

const FORMAT = new Intl.NumberFormat('de-DE');

const SECTIONS = [
  { id: 'uebersicht', label: () => t('admin.navOverview') },
  { id: 'nutzung', label: () => t('admin.navUsage') },
  { id: 'nutzer', label: () => t('admin.navUsers') },
  { id: 'feedback', label: () => t('admin.navFeedback') },
  { id: 'system', label: () => t('admin.navSystem') },
] as const;

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="admin__kpi">
      <div className="admin__kpi-label">{label}</div>
      <div className="admin__kpi-value">{value}</div>
      {sub && <div className="admin__kpi-sub">{sub}</div>}
    </div>
  );
}

/** Editable system-limit field. Commits on blur/Enter when the value changed. */
function LimitRow({
  label, hint, value, saving, onSave,
}: { label: string; hint?: string; value: number; saving: boolean; onSave: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.trunc(Number(text));
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n);
    else setText(String(value));
  };
  return (
    <label className="admin__limit">
      <span className="admin__limit-text">
        {label}
        {hint && <span className="admin__limit-hint">{hint}</span>}
      </span>
      <input
        className="input admin__limit-input"
        type="number"
        min={0}
        inputMode="numeric"
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

export function AdminPage() {
  const { me, meLoading } = useApp();
  const { show } = useSnackbar();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const [email, setEmail] = useState('');
  const [navTop, setNavTop] = useState(56);
  const [active, setActive] = useState<string>('uebersicht');

  const stats = useQuery({ queryKey: ['admin', 'stats', days], queryFn: () => api.adminStats(days), enabled: Boolean(me?.is_admin) });
  const allowlist = useQuery({ queryKey: ['admin', 'allowlist'], queryFn: () => api.adminAllowlist(), enabled: Boolean(me?.is_admin) });
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.adminUsers(), enabled: Boolean(me?.is_admin) });

  const invalidateAllow = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'allowlist'] });
  const add = useMutation({
    mutationFn: (value: string) => api.adminAllowlistAdd(value),
    onSuccess: () => { invalidateAllow(); show(t('admin.allowlistAdded')); },
  });
  const remove = useMutation({
    mutationFn: (value: string) => api.adminAllowlistRemove(value),
    onSuccess: (_, value) => {
      invalidateAllow();
      show(t('admin.allowlistRemoved'), {
        actionLabel: t('undo'),
        onAction: async () => { await api.adminAllowlistAdd(value); invalidateAllow(); },
      });
    },
  });
  const setLimit = useMutation({
    mutationFn: ({ id, limit }: { id: number; limit: number | null }) => api.adminSetUserLimit(id, limit),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); show(t('admin.userLimitSaved')); },
  });
  const limits = useQuery({ queryKey: ['admin', 'limits'], queryFn: () => api.adminLimits(), enabled: Boolean(me?.is_admin) });
  const saveLimits = useMutation({
    mutationFn: (patch: Partial<Omit<SystemLimits, 'registrations_today'>>) =>
      api.adminSetLimits(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin', 'limits'], data);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      show(t('admin.limitsSaved'));
    },
  });

  // Keep the sticky sub-nav docked right under the app header.
  useEffect(() => {
    const header = document.querySelector('.shell__header') as HTMLElement | null;
    if (!header) return;
    const update = () => setNavTop(header.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // Highlight the section currently in view. Deterministic scroll-spy (NOT an
  // IntersectionObserver band): the active section is the LAST one whose top
  // sits above the anchor line, with a page-end override for the final tab.
  // The old IO rootMargin band skipped sections shorter than the band
  // ("Nutzer") and could never activate the last tab when the page bottom was
  // reached before its top entered the band — with real-world (short) data the
  // pill simply stopped following clicks ("tab bar doesn't work").
  useEffect(() => {
    if (!me?.is_admin) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => e != null);
      if (els.length === 0) return;
      // At (or within a couple px of) the page end, the last section wins —
      // it may be too short to ever cross the anchor line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        setActive(els[els.length - 1].id);
        return;
      }
      const line = navTop + 64;
      let current = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [me?.is_admin, navTop, stats.data]);

  if (meLoading) return null;
  if (!me?.is_admin) return <Navigate to="/" replace />;

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navTop - 52, behavior: 'smooth' });
  };
  const smt = { scrollMarginTop: navTop + 60 };

  const s = stats.data;
  const usersByEmail = new Map((users.data?.items ?? []).map((u) => [u.email, u]));
  const defaultLimit = users.data?.default_limit ?? s?.limits.per_user ?? 20;

  return (
    <div className="admin">
      <h1 className="page__title"><Icon name="shield" size={22} /> {t('admin.title')}</h1>

      <div className="admin__subnav" style={{ top: navTop }}>
        <div className="admin__nav">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              className={`admin__navbtn ${active === sec.id ? 'admin__navbtn--active' : ''}`}
              onClick={() => jump(sec.id)}
            >
              {sec.label()}
            </button>
          ))}
        </div>
        <div className="admin__days" role="group" aria-label={t('admin.navOverview')}>
          {[7, 30, 90].map((d) => (
            <button key={d} className={`admin__day ${days === d ? 'admin__day--active' : ''}`} onClick={() => setDays(d)}>
              {d}T
            </button>
          ))}
        </div>
      </div>

      {/* 1 — Übersicht */}
      <section id="uebersicht" className="admin__section" style={smt}>
        <h2>{t('admin.navOverview')}</h2>
        {s ? (
          <div className="stack">
            <div className="admin__kpis">
              <Kpi label={t('admin.generations')} value={FORMAT.format(s.generations.total)} sub={strings.admin.liveCached(s.generations.live, s.generations.cached, s.generations.errors)} />
              <Kpi label={t('admin.cost')} value={`$${s.cost_usd.toFixed(2)}`} sub={strings.admin.range(s.days)} />
              <Kpi label={t('admin.cacheRate')} value={`${s.cache_hit_rate}%`} sub={`Cache-Read ${FORMAT.format(s.tokens.cache_read)} Tok`} />
              <Kpi label={t('admin.median')} value={`${(s.median_duration_ms / 1000).toFixed(1)}s`} />
              <Kpi label={t('admin.tokens')} value={`${FORMAT.format(s.tokens.in)} / ${FORMAT.format(s.tokens.out)}`} />
            </div>

            <div className="card card--outlined">
              <div className="admin__trend">
                <div className="admin__trend-cell">
                  <div className="admin__trend-head">
                    <span className="muted" style={{ font: 'var(--type-label)' }}>{t('admin.generations')}</span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{FORMAT.format(s.generations.total)}</strong>
                  </div>
                  <div className="admin-spark"><Sparkline data={s.daily.map((d) => d.gens)} color="var(--c-primary)" /></div>
                  <div className="muted" style={{ font: 'var(--type-label-sm)', marginTop: 'var(--space-1)' }}>{strings.admin.trend(s.days)}</div>
                </div>
                <div className="admin__trend-cell">
                  <div className="admin__trend-head">
                    <span className="muted" style={{ font: 'var(--type-label)' }}>{t('admin.cost')}</span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>${s.cost_usd.toFixed(2)}</strong>
                  </div>
                  <div className="admin-spark"><Sparkline data={s.daily.map((d) => d.cost_usd)} color="var(--c-tertiary)" /></div>
                  <div className="muted" style={{ font: 'var(--type-label-sm)', marginTop: 'var(--space-1)' }}>{strings.admin.trend(s.days)}</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )}
      </section>

      {/* 2 — Nutzung */}
      <section id="nutzung" className="admin__section" style={smt}>
        <h2>{t('admin.usageTitle')}</h2>
        <div className="card card--outlined">
          {!s ? (
            <p className="muted">{t('common.loading')}</p>
          ) : s.per_user.length === 0 ? (
            <p className="muted">{t('admin.usageEmpty')}</p>
          ) : (
            s.per_user.map((u) => {
              const acct = usersByEmail.get(u.email);
              const eff = acct ? acct.daily_limit ?? defaultLimit : defaultLimit;
              return (
                <div key={u.email} className="admin__urow">
                  <span className="admin__uemail">{u.email}</span>
                  <span className="admin__uspark"><Sparkline data={u.series} color="var(--c-primary)" /></span>
                  <span className="admin__unums">
                    <span style={{ display: 'block' }}>{FORMAT.format(u.count)}</span>
                    {acct && <span className="muted" style={{ font: 'var(--type-label-sm)' }}>{strings.admin.userUsage(acct.used_today, eff)}</span>}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 3 — Nutzer & Limits */}
      <section id="nutzer" className="admin__section" style={smt}>
        <h2><Icon name="user" size={20} /> {t('admin.users')}</h2>
        <p className="muted" style={{ font: 'var(--type-body)', margin: '0 0 var(--space-4)' }}>
          {users.data ? strings.admin.usersHint(users.data.default_limit) : t('admin.usersHint0')}
        </p>
        <div className="card card--outlined">
          {users.isLoading && <p className="muted">{t('common.loading')}</p>}
          {(users.data?.items ?? []).map((u) => {
            const effective = u.daily_limit ?? defaultLimit;
            return (
              <div key={u.id} className="admin__urow">
                <span className="admin__uemail">
                  {u.email}{u.is_admin && ' ★'}
                  <span className="muted" style={{ display: 'block', font: 'var(--type-label-sm)' }}>
                    {strings.admin.userUsage(u.used_today, effective)}{u.daily_limit == null && ` · ${t('admin.userDefault')}`}
                  </span>
                </span>
                <span className="stepper" style={{ flex: 'none' }}>
                  <button className="stepper__btn" aria-label="−" onClick={() => setLimit.mutate({ id: u.id, limit: Math.max(0, effective - 1) })}>−</button>
                  <span className="stepper__value" style={{ height: 'auto', minWidth: '2.5ch' }}>{effective}</span>
                  <button className="stepper__btn" aria-label="+" onClick={() => setLimit.mutate({ id: u.id, limit: effective + 1 })}>+</button>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4 — Feedback */}
      <section id="feedback" className="admin__section" style={smt}>
        <h2>{t('admin.feedbackTitle')}</h2>
        <div className="card card--outlined">
          {!s || Object.keys(s.feedback).length === 0 ? (
            <p className="muted">{t('admin.usageEmpty')}</p>
          ) : (
            Object.entries(s.feedback).map(([version, fb]) => (
              <div key={version} className="admin__urow">
                <span className="admin__uemail">{version}</span>
                <span className="admin__unums"><Icon name="thumbUp" size={14} /> {fb.up} · <Icon name="thumbDown" size={14} /> {fb.down}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 5 — System & Konfiguration */}
      <section id="system" className="admin__section" style={smt}>
        <h2><Icon name="settings" size={20} /> {t('admin.systemTitle')}</h2>

        <h3 style={{ margin: '0 0 var(--space-2)' }}>{t('admin.systemLimits')}</h3>
        <p className="muted" style={{ font: 'var(--type-label-sm)', margin: '0 0 var(--space-3)' }}>{t('admin.systemLimitsNote')}</p>
        {limits.data && (
          <div className="admin__limits">
            <LimitRow
              label={t('admin.limitDefaultUser')} hint={t('admin.limitDefaultUserHint')}
              value={limits.data.default_user_limit} saving={saveLimits.isPending}
              onSave={(v) => saveLimits.mutate({ default_user_limit: v })}
            />
            <LimitRow
              label={t('admin.limitRegistration')} hint={strings.admin.registrationsToday(limits.data.registrations_today)}
              value={limits.data.registration_daily_limit} saving={saveLimits.isPending}
              onSave={(v) => saveLimits.mutate({ registration_daily_limit: v })}
            />
            <LimitRow
              label={t('admin.limitGlobal')} hint={t('admin.limitGlobalHint')}
              value={limits.data.global_daily_limit} saving={saveLimits.isPending}
              onSave={(v) => saveLimits.mutate({ global_daily_limit: v })}
            />
            <LimitRow
              label={t('admin.limitAnonIp')} hint={t('admin.limitAnonIpHint')}
              value={limits.data.anon_ip_limit} saving={saveLimits.isPending}
              onSave={(v) => saveLimits.mutate({ anon_ip_limit: v })}
            />
            <LimitRow
              label={t('admin.limitAnonGlobal')} hint={t('admin.limitAnonGlobalHint')}
              value={limits.data.anon_global_limit} saving={saveLimits.isPending}
              onSave={(v) => saveLimits.mutate({ anon_global_limit: v })}
            />
          </div>
        )}

        <h3 style={{ margin: 'var(--space-6) 0 var(--space-2)' }}>{t('admin.signupTitle')}</h3>
        {limits.data && (
          <div className="row row--between" style={{ minHeight: 'var(--touch-target)', marginBottom: 'var(--space-2)' }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block' }}>{t('admin.openSignup')}</span>
              <span className="muted" style={{ font: 'var(--type-label-sm)' }}>{t('admin.openSignupHint')}</span>
            </span>
            <Switch
              checked={limits.data.open_signup}
              onChange={(v) => saveLimits.mutate({ open_signup: v })}
              label={t('admin.openSignup')}
            />
          </div>
        )}

        <h3 style={{ margin: 'var(--space-6) 0 var(--space-2)' }}>{t('admin.shareIntroTitle')}</h3>
        {limits.data && (
          <>
            <p className="muted" style={{ font: 'var(--type-label-sm)', margin: '0 0 var(--space-3)' }}>
              {t('admin.shareIntroHint')}
            </p>
            <Segmented<'motif' | 'crt' | 'off'>
              options={[
                { value: 'motif', label: t('admin.shareIntroMotif') },
                { value: 'crt', label: t('admin.shareIntroCrt') },
                { value: 'off', label: t('admin.shareIntroOff') },
              ]}
              value={limits.data.share_intro}
              onChange={(v) => saveLimits.mutate({ share_intro: v })}
            />
          </>
        )}

        <h3 style={{ margin: 'var(--space-6) 0 var(--space-2)' }}>{t('admin.allowlistTitle')}</h3>
        <p className="muted" style={{ font: 'var(--type-label-sm)', margin: '0 0 var(--space-3)' }}>
          {limits.data?.open_signup === false ? t('admin.allowlistNoteClosed') : t('admin.allowlistNoteOpen')}
        </p>
        {/* The allowlist only gates when signup is closed — hide the editor while
            it's ignored (open) to declutter; the note above stays for context. */}
        {limits.data?.open_signup === false && (
          <>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email.includes('@')) { add.mutate(email.trim().toLowerCase()); setEmail(''); }
              }}
              placeholder={t('admin.allowlistAdd')}
            />
            <div style={{ marginTop: 'var(--space-2)' }}>
              {(allowlist.data?.items ?? []).map((item) => (
                <div key={item.email} className="row row--between" style={{ minHeight: 'var(--touch-target)' }}>
                  <span>
                    {item.email}{' '}
                    <span className="muted" style={{ font: 'var(--type-label-sm)' }}>
                      {item.registered ? <><Icon name="check" size={12} /> {t('admin.registered')}</> : t('admin.invited')}
                    </span>
                  </span>
                  <IconButton label={t('common.delete')} onClick={() => remove.mutate(item.email)}>
                    <Icon name="close" size={18} />
                  </IconButton>
                </div>
              ))}
              {allowlist.isLoading && <p className="muted">{t('common.loading')}</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
