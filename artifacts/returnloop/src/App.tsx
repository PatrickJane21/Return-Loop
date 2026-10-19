import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Bell, BookOpen, Check, CheckCircle2, ChevronRight,
  Copy, Download, Eye, EyeOff, HeartHandshake, Home, KeyRound, Link2, LockKeyhole, Package, Plus,
  QrCode, ScanLine, Search, Send, Settings, ShieldCheck, Sparkles, UserRound, Users, X,
  ExternalLink, Inbox, CircleAlert, MoreHorizontal, Printer, LogOut, RefreshCw
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase, supabaseConfigured } from '@/lib/supabase';

type Role = 'student' | 'teacher';
type Status = 'lost' | 'found' | 'returned';
type Category = 'Tech' | 'Study' | 'Wearables' | 'Personal' | 'Other';
type Profile = { id: string; full_name: string; email: string; role: Role; student_id?: string | null; course_or_class?: string | null; section?: string | null; created_at: string };
type Item = { id: string; owner_id: string; item_name: string; category: Category; description: string; qr_token: string; status: Status; created_at: string };
type ReportStatus = 'new' | 'reviewed' | 'returned' | 'dismissed';
type Report = { id: string; item_id: string; finder_name: string; finder_contact: string; found_location: string; found_date: string; message: string; status: ReportStatus; created_at: string };
type Notice = { id: string; recipient_user_id: string; item_id?: string | null; found_report_id?: string | null; title: string; message: string; notification_type: string; is_read: boolean; created_at: string };
type Db = { profiles: Profile[]; items: Item[]; reports: Report[]; notifications: Notice[] };
type PublicItem = { item_name: string; category: string; description: string; status: string };
type AuthResult = { ok: boolean; error?: string; needsConfirm?: boolean };

const queryClient = new QueryClient();
const emptyDb: Db = { profiles: [], items: [], reports: [], notifications: [] };

type Store = {
  db: Db;
  profile: Profile | undefined;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  createAccount: (profile: { full_name: string; email: string; student_id: string; course_or_class: string; section: string }, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  addItem: (input: { item_name: string; category: Category; description: string }) => Promise<{ item?: Item; error?: string }>;
  updateItemStatus: (itemId: string, status: Status) => Promise<string | null>;
  markReturned: (itemId: string) => Promise<string | null>;
  dismissReport: (reportId: string) => Promise<string | null>;
  markRead: (id: string) => Promise<void>;
};
const StoreContext = createContext<Store | null>(null);
function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('ReturnLoop store is unavailable');
  return value;
}

// All data now lives in Supabase. The database decides what each person may see (Row Level Security);
// this code only asks for it and shows what comes back.
function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db>(emptyDb);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (uid: string | null) => {
    if (!uid) { setDb(emptyDb); return; }
    const [p, i, r, n] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('items').select('*').order('created_at', { ascending: false }),
      supabase.from('found_reports').select('*').order('created_at', { ascending: false }),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }),
    ]);
    setDb({
      profiles: (p.data ?? []) as Profile[],
      items: (i.data ?? []) as Item[],
      reports: (r.data ?? []) as Report[],
      notifications: (n.data ?? []) as Notice[],
    });
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null;
      if (!active) return;
      setUserId(uid);
      await load(uid);
      if (active) setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null;
      setUserId(uid);
      // do not call Supabase directly inside this callback; schedule it instead
      setTimeout(() => { void load(uid); }, 0);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [load]);

  // Keep every view in sync with rows visible to the current user under RLS.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`returnloop-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void load(userId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => { void load(userId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'found_reports' }, () => { void load(userId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}` }, () => { void load(userId); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, load]);

  const profile = db.profiles.find((p) => p.id === userId);

  const value: Store = {
    db, profile, loading,
    signInWithEmail: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { ok: false, error: error.message === 'Invalid login credentials' ? 'That email and password do not match.' : error.message };
      return { ok: true };
    },
    createAccount: async (newProfile, password) => {
      const { data, error } = await supabase.auth.signUp({
        email: newProfile.email.trim(),
        password,
        options: { data: { full_name: newProfile.full_name, student_id: newProfile.student_id, course_or_class: newProfile.course_or_class, section: newProfile.section } },
      });
      if (error) return { ok: false, error: error.message };
      if (!data.session) return { ok: true, needsConfirm: true };
      return { ok: true };
    },
    signOut: async () => { await supabase.auth.signOut(); },
    addItem: async (input) => {
      if (!userId) return { error: 'Please sign in again before registering an item.' };
      const { data, error } = await supabase.from('items')
        .insert({ item_name: input.item_name.trim(), category: input.category, description: input.description.trim() })
        .select()
        .single();
      if (error || !data) return { error: error?.message ?? 'Could not save the item. Please try again.' };
      await load(userId);
      return { item: data as Item };
    },
    updateItemStatus: async (itemId, status) => {
      if (status === 'returned') return 'Only teachers can mark items as returned.';
      const { error } = await supabase.from('items').update({ status }).eq('id', itemId);
      await load(userId);
      return error ? error.message : null;
    },
    markReturned: async (itemId) => {
      const { error } = await supabase.from('items').update({ status: 'returned' }).eq('id', itemId);
      await load(userId);
      return error ? error.message : null;
    },
    dismissReport: async (reportId) => {
      const report = db.reports.find((entry) => entry.id === reportId);
      const { error } = await supabase.from('found_reports').update({ status: 'dismissed' }).eq('id', reportId);
      if (error) return error.message;
      if (report) await supabase.from('items').update({ status: 'lost' }).eq('id', report.item_id).eq('status', 'found');
      await load(userId);
      return null;
    },
    markRead: async (id) => {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
      await load(userId);
    },
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function Splash() {
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))]"><p className="text-sm text-[hsl(var(--muted-foreground))]">Loading ReturnLoop…</p></div>;
}

function ConfigMissing() {
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5"><div className="max-w-md text-center"><CircleAlert className="mx-auto text-[hsl(var(--accent))]" size={38} /><h1 className="mt-5 font-display text-3xl font-bold">Setup is not finished.</h1><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">This copy of ReturnLoop is missing its database settings (VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY). Add them where the app is built, then reload.</p></div></div>;
}

function Logo({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`flex items-center gap-2.5 w-fit ${inverse ? 'text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--foreground))]'}`} data-testid="link-brand">
    <span className={`grid h-9 w-9 place-items-center rounded-xl ${inverse ? 'bg-[hsl(var(--secondary))]' : 'bg-[hsl(var(--primary))]'} text-[hsl(var(--primary-foreground))]`}>
      <Link2 size={18} strokeWidth={2.7} />
    </span>
    <span className="font-display text-[17px] font-extrabold tracking-[-.04em]">RETURN<span className={inverse ? 'text-[hsl(var(--secondary))]' : 'text-[hsl(var(--primary))]'}>LOOP</span></span>
  </Link>;
}

function Button({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'outline' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_8px_20px_hsl(var(--primary)/.16)] hover:-translate-y-0.5',
    soft: 'bg-[hsl(var(--secondary)/.22)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/.35)]',
    outline: 'border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] text-[hsl(var(--foreground))] hover:border-[hsl(var(--secondary))] hover:bg-[hsl(var(--secondary)/.09)]',
    ghost: 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/.55)] hover:text-[hsl(var(--foreground))]',
    danger: 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:brightness-95',
  };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'blue' }) {
  const styles = { neutral: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]', green: 'bg-[hsl(var(--secondary)/.22)] text-[hsl(161_38%_29%)]', amber: 'bg-[hsl(var(--accent)/.23)] text-[hsl(29_54%_29%)]', blue: 'bg-[hsl(193_39%_17%/.09)] text-[hsl(var(--primary))]' };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${styles[tone]}`}>{children}</span>;
}

function TopBar({ action }: { action?: ReactNode }) {
  return <header className="flex items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
    <Logo />
    <div className="flex items-center gap-2">{action}</div>
  </header>;
}

function BottomNav({ active = 'home' }: { active?: string }) {
  const links = [{ id: 'home', label: 'Home', href: '/app', icon: Home }, { id: 'scan', label: 'Scan', href: '/scan', icon: ScanLine }, { id: 'new', label: 'Register', href: '/app/new', icon: Plus }, { id: 'profile', label: 'Profile', href: '/profile', icon: UserRound }];
  return <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-lg items-center justify-around border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.94)] px-3 py-2 backdrop-blur-lg md:hidden" data-testid="nav-mobile">
    {links.map(({ id, label, href, icon: Icon }) => <Link key={id} href={href} data-testid={`link-nav-${id}`} className={`flex min-w-[62px] flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-semibold transition ${active === id ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}><Icon size={19} strokeWidth={active === id ? 2.5 : 1.8} /><span>{label}</span></Link>)}
  </nav>;
}

function DashboardShell({ children, active = 'home' }: { children: ReactNode; active?: string }) {
  const { profile } = useStore();
  return <div className="min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
    <div className="mx-auto flex min-h-[100dvh] max-w-[1440px]">
      <aside className="hidden w-[238px] shrink-0 flex-col justify-between bg-[hsl(var(--sidebar))] p-5 text-[hsl(var(--sidebar-foreground))] md:flex">
        <div><Logo inverse /><div className="mt-12 space-y-1">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.46)]">Your space</p>
          <SideLink href="/app" active={active === 'home'} icon={Home}>Overview</SideLink>
          <SideLink href="/app/new" active={active === 'new'} icon={Plus}>Register an item</SideLink>
          <SideLink href="/scan" active={active === 'scan'} icon={ScanLine}>Scan a code</SideLink>
         </div><div className="mt-9 space-y-1"><p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.46)]">Account</p><SideLink href="/notifications" active={active === 'notifications'} icon={Bell}>Notifications</SideLink><SideLink href="/profile" active={active === 'profile'} icon={UserRound}>Profile & privacy</SideLink></div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.65)] p-3"><div className="mb-2 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--primary))]">{profile?.full_name.split(' ').map((n) => n[0]).join('')}</span><span className="truncate text-xs font-semibold">{profile?.full_name}</span></div><p className="text-[11px] leading-4 text-[hsl(var(--sidebar-foreground)/.56)]">A quiet safety net for campus life.</p></div>
      </aside>
      <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
    </div>
    <BottomNav active={active} />
  </div>;
}
function SideLink({ href, active, icon: Icon, children }: { href: string; active: boolean; icon: typeof Home; children: ReactNode }) {
  return <Link href={href} data-testid={`link-side-${href.replace(/\//g, '').replace('app', 'home') || 'home'}`} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? 'bg-[hsl(var(--sidebar-accent))] font-semibold text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.62)] hover:bg-[hsl(var(--sidebar-accent)/.7)] hover:text-[hsl(var(--sidebar-foreground))]'}`}><Icon size={17} /><span>{children}</span></Link>;
}

function HomePage() {
  const [, setLocation] = useLocation();
  return <div className="rl-noise min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]">
    <TopBar action={<><Link href="/auth" data-testid="link-sign-in" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] sm:block">Sign in</Link><Button onClick={() => setLocation('/auth')} data-testid="button-get-started">Get started <ArrowRight size={16} /></Button></>} />
    <section className="relative mx-auto grid max-w-[1250px] items-center gap-14 px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.08fr_.92fr] lg:px-12 lg:pb-28 lg:pt-24">
      <div className="relative z-10 animate-in-up"><Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" /> Built for Northfield campus</Pill><h1 className="mt-7 max-w-2xl font-display text-[clamp(3.4rem,8vw,7.3rem)] font-extrabold leading-[.91] tracking-[-.075em] text-[hsl(var(--primary))]">Lost it?<br /><span className="text-[hsl(var(--secondary))]">Scan it.</span><br />Return it.</h1><p className="mt-7 max-w-md text-[17px] leading-7 text-[hsl(var(--muted-foreground))]">The gentle way to bring a misplaced belonging home. Add a private ReturnLoop tag, then let the campus community do the rest.</p><div className="mt-8 flex flex-wrap gap-3"><Button onClick={() => setLocation('/auth')} data-testid="button-hero-get-started">Protect an item <ArrowRight size={16} /></Button><Button variant="outline" onClick={() => setLocation('/scan')} data-testid="button-hero-scan"><ScanLine size={16} /> Scan a QR</Button></div><div className="mt-10 flex items-center gap-3 text-xs font-medium text-[hsl(var(--muted-foreground))]"><div className="flex -space-x-2"><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[hsl(var(--background))] bg-[#e8b98e] text-[10px] font-bold text-[#594132]">AM</span><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[hsl(var(--background))] bg-[#9ac9bb] text-[10px] font-bold text-[#214b45]">JL</span><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[hsl(var(--background))] bg-[#d8b9dd] text-[10px] font-bold text-[#55305c]">MC</span></div><span>Already keeping an eye out</span><span className="text-[hsl(var(--accent))]">●</span></div></div>
      <div className="relative mx-auto w-full max-w-[470px] animate-in-fade delay-2"><div className="absolute -right-5 -top-8 h-32 w-32 rounded-full bg-[hsl(var(--accent)/.22)] blur-2xl" /><div className="absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-[hsl(var(--secondary)/.2)] blur-2xl" /><div className="relative rotate-[2deg] rounded-[2rem] border border-[hsl(var(--primary)/.1)] bg-[hsl(var(--card))] p-4 shadow-[0_28px_70px_hsl(var(--primary)/.13)]"><div className="rounded-[1.35rem] bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))]"><div className="flex items-center justify-between"><span className="font-mono-app text-[10px] tracking-[.16em] text-[hsl(var(--primary-foreground)/.6)]">RL / YOUR TAG</span><QrCode size={21} className="text-[hsl(var(--secondary))]" /></div><div className="mt-12 font-mono-app text-2xl tracking-[.12em]">RL-7K2M9P4Q</div><div className="mt-2 text-xs text-[hsl(var(--primary-foreground)/.55)]">Scan to help this item find its way home</div><div className="mt-8 grid grid-cols-7 gap-1.5 opacity-90">{Array.from({ length: 49 }, (_, i) => <span key={i} className={`aspect-square rounded-[2px] ${((i * 13 + 7) % 5 < 2 || [0,1,2,7,14,42,43,44,35,41,48].includes(i)) ? 'bg-[hsl(var(--secondary))]' : 'bg-[hsl(var(--primary-foreground)/.16)]'}`} />)}</div></div><div className="flex items-center justify-between px-2 pb-1 pt-4"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Protected item</p><p className="mt-1 font-display text-lg font-bold">Midnight blue backpack</p></div><BadgeCheck className="text-[hsl(var(--secondary))]" /></div></div><div className="absolute -bottom-5 -right-5 flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 shadow-lg"><span className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--accent)/.28)] text-[hsl(var(--primary))]"><HeartHandshake size={16} /></span><div><p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Campus promise</p><p className="text-xs font-bold text-[hsl(var(--foreground))]">No personal details on tags</p></div></div></div>
    </section>
    <section className="border-y border-[hsl(var(--border))] bg-[hsl(var(--card)/.48)]"><div className="mx-auto grid max-w-[1250px] grid-cols-1 divide-y divide-[hsl(var(--border))] px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8 lg:px-12">{[['01', 'Register', 'Tell us what you want to keep close.'], ['02', 'Tag it', 'Print or save your private ReturnLoop code.'], ['03', 'Bring it back', 'A finder scans. You get a quiet heads-up.']].map(([n, t, d]) => <div key={n} className="flex items-center gap-4 py-5 sm:block sm:px-7 sm:py-7 first:pl-0 last:pr-0"><span className="font-mono-app text-xs text-[hsl(var(--secondary))]">{n}</span><div><h2 className="font-display text-xl font-bold">{t}</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{d}</p></div></div>)}</div></section>
    <section className="mx-auto max-w-[1250px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28"><div className="max-w-xl"><Pill tone="amber">Designed for the in-between moments</Pill><h2 className="mt-5 font-display text-4xl font-bold leading-tight tracking-[-.04em] sm:text-5xl">The little system that makes campus feel more <span className="text-[hsl(var(--secondary))]">human.</span></h2></div><div className="mt-12 grid gap-5 md:grid-cols-3"><Feature icon={ShieldCheck} title="Private by design" text="Your name, email, and student ID never live on the tag. Only a random code does." tone="green" /><Feature icon={ScanLine} title="One scan, less searching" text="A finder sees just enough to identify the item and send a safe, structured note." tone="amber" /><Feature icon={Bell} title="The right person hears" text="You get a notification. Teachers get a clear handoff trail. Nobody gets your details." tone="blue" /></div></section>
    <section className="mx-5 overflow-hidden rounded-[2rem] bg-[hsl(var(--primary))] px-6 py-12 text-[hsl(var(--primary-foreground))] sm:mx-8 sm:px-12 lg:mx-auto lg:max-w-[1250px] lg:px-20 lg:py-16"><div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center"><div><p className="font-mono-app text-xs uppercase tracking-[.16em] text-[hsl(var(--secondary))]">The privacy promise</p><h2 className="mt-4 max-w-2xl font-display text-3xl font-bold leading-tight tracking-[-.04em] sm:text-4xl">A code can bring your belonging back. It never needs to reveal who you are.</h2><p className="mt-4 max-w-xl text-sm leading-6 text-[hsl(var(--primary-foreground)/.64)]">ReturnLoop shows a finder the item's safe description and a secure way to report it. Personal details stay behind the loop.</p></div><Button variant="soft" className="w-fit bg-[hsl(var(--primary-foreground)/.1)] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-foreground)/.18)]" onClick={() => setLocation('/auth')} data-testid="button-privacy-start">Start with a tag <ArrowRight size={16} /></Button></div></section>
    <footer className="mx-auto flex max-w-[1250px] flex-col gap-3 px-5 py-12 text-xs text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12"><Logo /><span>Quietly looking out for one another, Northfield campus.</span></footer>
  </div>;
}
function Feature({ icon: Icon, title, text, tone }: { icon: typeof ShieldCheck; title: string; text: string; tone: 'green' | 'amber' | 'blue' }) {
  const color = tone === 'green' ? 'bg-[hsl(var(--secondary)/.2)] text-[hsl(161_38%_29%)]' : tone === 'amber' ? 'bg-[hsl(var(--accent)/.2)] text-[hsl(29_54%_29%)]' : 'bg-[hsl(193_39%_17%/.08)] text-[hsl(var(--primary))]';
  return <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.66)] p-6 transition duration-300 hover:-translate-y-1 hover:shadow-lg"><span className={`grid h-11 w-11 place-items-center rounded-xl ${color}`}><Icon size={21} /></span><h3 className="mt-6 font-display text-xl font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{text}</p></article>;
}

function AuthPage() {
  const [, setLocation] = useLocation();
  const { profile, signInWithEmail, createAccount } = useStore();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [course, setCourse] = useState('');
  const [section, setSection] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (profile) setLocation(profile.role === 'teacher' ? '/admin' : '/app'); }, [profile, setLocation]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (mode === 'signup' && password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    const result = mode === 'signin'
      ? await signInWithEmail(email, password)
      : await createAccount({ full_name: name.trim(), email: email.trim(), student_id: studentId.trim(), course_or_class: course.trim(), section: section.trim() }, password);
    setLoading(false);
    if (!result.ok) { setError(result.error ?? 'We could not complete that request.'); return; }
    if (result.needsConfirm) { setNotice('Account created. Check your email, click the confirmation link, then sign in.'); setMode('signin'); }
  };
  return <div className="rl-noise min-h-[100dvh] bg-[hsl(var(--background))]"><TopBar action={<Link href="/" data-testid="link-auth-back" className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">Back to home</Link>} /><main className="mx-auto grid max-w-[1050px] items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[.85fr_1fr] lg:py-20"><div className="animate-in-up"><Pill tone="green"><LockKeyhole size={13} /> Made for your campus</Pill><h1 className="mt-6 max-w-md font-display text-5xl font-extrabold leading-[.95] tracking-[-.06em] text-[hsl(var(--primary))]">Keep the things that keep <span className="text-[hsl(var(--secondary))]">you</span> going.</h1><p className="mt-5 max-w-sm leading-7 text-[hsl(var(--muted-foreground))]">Sign in to register a new item, see a finder’s note, or help something else find its way home.</p><div className="mt-8 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]"><ShieldCheck size={16} className="text-[hsl(var(--secondary))]" /> Your identity stays private on every tag.</div></div><div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[0_24px_80px_hsl(var(--primary)/.08)] sm:p-8"><div className="flex rounded-xl bg-[hsl(var(--muted)/.7)] p-1"><button type="button" onClick={() => { setMode('signin'); setError(''); }} data-testid="button-auth-signin-tab" className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === 'signin' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>Sign in</button><button type="button" onClick={() => { setMode('signup'); setError(''); }} data-testid="button-auth-signup-tab" className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === 'signup' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>Create account</button></div><form onSubmit={submit} className="mt-7 space-y-4"><div><label className="mb-1.5 block text-xs font-bold text-[hsl(var(--foreground))]">Campus email</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="you@northfield.edu" data-testid="input-auth-email" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none transition focus:border-[hsl(var(--secondary))] focus:ring-4 focus:ring-[hsl(var(--secondary)/.12)]" /></div>{mode === 'signup' && <><div><label className="mb-1.5 block text-xs font-bold">Your full name</label><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Aryan Mishra" data-testid="input-auth-name" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-bold">Student ID</label><input value={studentId} onChange={(e) => setStudentId(e.target.value)} required placeholder="NF-25-204" data-testid="input-auth-student-id" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div><div><label className="mb-1.5 block text-xs font-bold">Section</label><input value={section} onChange={(e) => setSection(e.target.value)} required placeholder="A" data-testid="input-auth-section" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div></div><div><label className="mb-1.5 block text-xs font-bold">Course / class</label><input value={course} onChange={(e) => setCourse(e.target.value)} required placeholder="Computer Science" data-testid="input-auth-course" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div></>}<div><label className="mb-1.5 block text-xs font-bold">{mode === 'signin' ? 'Password' : 'Create a password'}</label><div className="relative"><input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} type={showPassword ? 'text' : 'password'} placeholder="At least 6 characters" data-testid="input-auth-password" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 pr-12 text-sm outline-none focus:border-[hsl(var(--secondary))]" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>{mode === 'signup' && <div><label className="mb-1.5 block text-xs font-bold">Confirm password</label><input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} type={showPassword ? 'text' : 'password'} placeholder="Repeat your password" data-testid="input-auth-confirm-password" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div>}{notice && <div role="status" className="flex items-start gap-2 rounded-xl bg-[hsl(var(--secondary)/.15)] p-3 text-xs leading-5 text-[hsl(161_38%_29%)]"><Check size={16} className="mt-0.5 shrink-0" />{notice}</div>}{error && <div role="alert" className="flex items-start gap-2 rounded-xl bg-[hsl(var(--destructive)/.1)] p-3 text-xs leading-5 text-[hsl(var(--destructive))]"><CircleAlert size={16} className="mt-0.5 shrink-0" />{error}</div>}<Button type="submit" disabled={loading} className="mt-2 w-full" data-testid="button-auth-submit">{loading ? <><RefreshCw size={16} className="animate-spin" /> Working…</> : <>{mode === 'signin' ? 'Sign in to ReturnLoop' : 'Create my account'} <ArrowRight size={16} /></>}</Button></form></div></main></div>;
}

function AccessGate() {
  const [, setLocation] = useLocation();
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5"><div className="max-w-sm text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.2)] text-[hsl(var(--primary))]"><KeyRound /></span><h1 className="mt-5 font-display text-3xl font-bold">Your loop is waiting.</h1><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Sign in to see your protected belongings and finder notes.</p><Button className="mt-7" onClick={() => setLocation('/auth')} data-testid="button-access-signin">Sign in <ArrowRight size={16} /></Button></div></div>;
}

function StudentDashboard() {
  const { db, profile, dismissReport } = useStore();
  const [itemSearch, setItemSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category>('all');
  if (!profile) return <AccessGate />;
  const items = db.items.filter((item) => item.owner_id === profile.id);
  const visibleItems = items.filter((item) => {
    const query = itemSearch.trim().toLowerCase();
    const matchesSearch = [item.item_name, item.description, item.qr_token]
      .some((value) => value.toLowerCase().includes(query));
    return matchesSearch
      && (statusFilter === 'all' || item.status === statusFilter)
      && (categoryFilter === 'all' || item.category === categoryFilter);
  });
  const openReports = (itemId: string) => db.reports.filter((report) => report.item_id === itemId && !['returned', 'dismissed'].includes(report.status));
  const notes = db.notifications.filter((note) => note.recipient_user_id === profile.id);
  const count = (status: Status) => items.filter((item) => item.status === status).length;
  return <DashboardShell active="home">
    <div className="mx-auto max-w-[1180px] px-5 py-6 sm:px-8 md:py-9 lg:px-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" /> Campus loop is active</Pill>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-[-.04em] sm:text-4xl">Good to see you, <span className="text-[hsl(var(--secondary))]">{profile.full_name.split(' ')[0]}.</span></h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Here’s the quiet status of your things.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/notifications" className="grid h-10 w-10 place-items-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--primary))]"><Bell size={17} /></Link>
          <Link href="/profile" data-testid="link-dashboard-profile" className="grid h-10 w-10 place-items-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-sm font-bold text-[hsl(var(--primary))]">{profile.full_name.split(' ').map((part) => part[0]).join('')}</Link>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total items" value={items.length.toString()} icon={Package} />
        <Stat label="Lost / active" value={count('lost').toString()} icon={Search} accent={count('lost') > 0} />
        <Stat label="Found" value={count('found').toString()} icon={Bell} accent={count('found') > 0} />
        <Stat label="Returned" value={count('returned').toString()} icon={HeartHandshake} />
      </div>
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_.8fr]">
        <section>
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Your belongings</p>
              <h2 className="mt-2 font-display text-2xl font-bold">Protected, not tracked.</h2>
            </div>
            <Link href="/app/new" className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))]">Add item <Plus size={15} /></Link>
          </div>
          {items.length > 0 && <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
            <label className="flex min-w-0 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-3 focus-within:border-[hsl(var(--secondary))]">
              <Search size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
              <input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} type="search" aria-label="Search your items" placeholder="Search name, details, or QR code" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | Status)} aria-label="Filter items by status" className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]">
              <option value="all">All statuses</option>
              <option value="lost">Lost / active</option>
              <option value="found">Found</option>
              <option value="returned">Returned</option>
            </select>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'all' | Category)} aria-label="Filter items by category" className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]">
              <option value="all">All categories</option>
              <option value="Tech">Tech</option>
              <option value="Study">Study</option>
              <option value="Wearables">Wearables</option>
              <option value="Personal">Personal</option>
              <option value="Other">Other</option>
            </select>
          </div>}
          <div className="mt-5 space-y-3">
            {items.length === 0
              ? <EmptyState text="No items yet. Register your first item to create a private QR code." />
              : visibleItems.length > 0
                ? visibleItems.map((item) => <div key={item.id}><ItemRow item={item} />{openReports(item.id).map((report) => <OwnerReportCard key={report.id} report={report} onDismiss={() => { void dismissReport(report.id); }} />)}</div>)
                : <EmptyState text="No items match this search and status filter." />}
          </div>
        </section>
        <section>
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Recent notes</p>
              <h2 className="mt-2 font-display text-2xl font-bold">From your loop</h2>
            </div>
            <Link href="/notifications" className="text-xs font-bold text-[hsl(var(--primary))]">View all</Link>
          </div>
          <div className="mt-5 space-y-3">{notes.length ? notes.slice(0, 4).map((note) => <NotificationCard key={note.id} note={note} />) : <EmptyState text="No notes yet. That’s a good sign." />}</div>
        </section>
      </div>
    </div>
  </DashboardShell>;
}
function NotificationCard({ note }: { note: Notice }) {
  const { markRead } = useStore();
  return <button onClick={() => markRead(note.id)} data-testid={`button-notification-${note.id}`} className={`w-full rounded-2xl border p-4 text-left transition hover:border-[hsl(var(--secondary))] ${note.is_read ? 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.4)]' : 'border-[hsl(var(--accent)/.6)] bg-[hsl(var(--accent)/.08)]'}`}><div className="flex gap-3"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${note.is_read ? 'bg-[hsl(var(--muted))]' : 'bg-[hsl(var(--accent)/.25)]'}`}><Bell size={15} /></span><div className="min-w-0"><div className="flex items-start justify-between gap-2"><p className="text-sm font-bold">{note.title}</p>{!note.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--accent))]" />}</div><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{note.message}</p><p className="mt-2 font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div></div></button>;
}
function Stat({ label, value, icon: Icon, accent = false, suffix = '' }: { label: string; value: string; icon: typeof Package; accent?: boolean; suffix?: string }) {
  return <div className={`rounded-2xl border p-4 sm:p-5 ${accent ? 'border-[hsl(var(--accent)/.52)] bg-[hsl(var(--accent)/.1)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)]'}`} data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}><div className="flex items-start justify-between"><span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</span><Icon size={16} className={accent ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--secondary))]'} /></div><p className="mt-4 font-display text-3xl font-bold">{value}<span className="ml-1 text-xs font-sans font-medium text-[hsl(var(--muted-foreground))]">{suffix}</span></p></div>;
}
function ItemRow({ item }: { item: Item }) {
  const status = item.status === 'found' ? { label: 'Found', tone: 'amber' as const, icon: Bell } : item.status === 'returned' ? { label: 'Returned', tone: 'green' as const, icon: CheckCircle2 } : { label: 'Lost / active', tone: 'blue' as const, icon: ShieldCheck };
  const Icon = status.icon;
  return <div className="group flex flex-wrap items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-3.5 transition hover:-translate-y-0.5 hover:border-[hsl(var(--secondary)/.7)] hover:shadow-md" data-testid={`card-item-${item.id}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]"><Package size={19} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.item_name}</p><p className="mt-1 font-mono-app text-[10px] tracking-wide text-[hsl(var(--muted-foreground))]">{item.qr_token}</p></div><Pill tone={status.tone}><Icon size={12} /> <span className="hidden sm:inline">{status.label}</span></Pill><ItemActions item={item} /><Link href={`/found/${item.qr_token}`} data-testid={`link-item-token-${item.id}`} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--primary))]"><ExternalLink size={15} /></Link></div>;
}
function ItemActions({ item }: { item: Item }) {
  const { updateItemStatus } = useStore();
  const change = async (status: Status, label: string) => { if (window.confirm(`${label} “${item.item_name}”?`)) { const problem = await updateItemStatus(item.id, status); if (problem) window.alert(problem); } };
  return <div className="flex gap-1.5"><select aria-label={`Update status for ${item.item_name}`} value={item.status} onChange={(event) => { const status = event.target.value as Status; if (status !== item.status) change(status, status === 'found' ? 'Mark found' : 'Mark lost / not found'); }} className="max-w-[116px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-[11px] font-semibold outline-none focus:border-[hsl(var(--secondary))]" data-testid={`select-item-status-${item.id}`}><option value="lost">Lost / active</option><option value="found">Found</option></select></div>;
}
function EmptyState({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-7 text-center"><Inbox size={22} className="mx-auto text-[hsl(var(--muted-foreground))]" /><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{text}</p></div>; }

function NewItemPage() {
  const { profile, addItem } = useStore();
  const [, setLocation] = useLocation();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('Tech');
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  if (!profile) return <AccessGate />;
  const create = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setSaveError(''); const result = await addItem({ item_name: name, category, description }); setSaving(false); if (result.item) setCreated(result.item); else setSaveError(result.error ?? 'Could not save the item.'); };
  return <DashboardShell active="new"><div className="mx-auto max-w-[980px] px-5 py-7 sm:px-8 md:py-10 lg:px-12"><Link href="/app" data-testid="link-new-back" className="inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"><ArrowLeft size={15} /> Back to overview</Link><div className="mt-8 max-w-xl"><Pill tone="green"><Sparkles size={13} /> Two minutes to peace of mind</Pill><h1 className="mt-5 font-display text-4xl font-bold tracking-[-.05em] sm:text-5xl">Register something<br /><span className="text-[hsl(var(--secondary))]">worth finding.</span></h1><p className="mt-4 leading-7 text-[hsl(var(--muted-foreground))]">We’ll make a private code for it. Add the code to the item, and your campus can help it travel back to you.</p></div><form onSubmit={create} className="mt-10 grid gap-8 lg:grid-cols-[1fr_300px]"><div className="space-y-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div><label className="mb-2 block text-xs font-bold">What are you registering?</label><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Silver laptop" data-testid="input-item-name" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))] focus:ring-4 focus:ring-[hsl(var(--secondary)/.12)]" /></div><div><label className="mb-2 block text-xs font-bold">A few identifying details <span className="font-normal text-[hsl(var(--muted-foreground))]">optional</span></label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Color, stickers, case, initials..." data-testid="input-item-description" className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))] focus:ring-4 focus:ring-[hsl(var(--secondary)/.12)]" /></div><div><label className="mb-2 block text-xs font-bold">Category</label><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{(['Tech', 'Study', 'Wearables', 'Personal', 'Other'] as Category[]).map((entry) => <button type="button" key={entry} onClick={() => setCategory(entry)} data-testid={`button-category-${entry.toLowerCase()}`} className={`rounded-xl border px-2 py-3 text-xs font-bold transition ${category === entry ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary)/.18)] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>{entry}</button>)}</div></div><div className="flex gap-3 rounded-xl bg-[hsl(var(--secondary)/.11)] p-3.5 text-xs leading-5 text-[hsl(161_38%_29%)]"><ShieldCheck size={17} className="mt-0.5 shrink-0" /> Your ReturnLoop code contains no name, email, or student details.</div>{saveError && <div role="alert" className="flex items-start gap-2 rounded-xl bg-[hsl(var(--destructive)/.1)] p-3 text-xs leading-5 text-[hsl(var(--destructive))]"><CircleAlert size={16} className="mt-0.5 shrink-0" />{saveError}</div>}<Button type="submit" disabled={saving} className="w-full sm:w-auto" data-testid="button-create-item">{saving ? <><RefreshCw size={16} className="animate-spin" /> Saving…</> : <>Create private code <ArrowRight size={16} /></>}</Button></div><aside className="h-fit rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))]"><QrCode className="text-[hsl(var(--secondary))]" size={27} /><h2 className="mt-7 font-display text-2xl font-bold">A small code.<br />A big handoff.</h2><p className="mt-3 text-sm leading-6 text-[hsl(var(--primary-foreground)/.61)]">When someone finds your item, they can scan this code to send a note without seeing who you are.</p><div className="mt-8 border-t border-[hsl(var(--primary-foreground)/.16)] pt-4 text-xs text-[hsl(var(--primary-foreground)/.56)]">You’ll be able to download or print it after creating.</div></aside></form></div>{created && <QrModal item={created} onClose={() => setLocation('/app')} />}</DashboardShell>;
}
function QrModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}found/${item.qr_token}`;
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(publicUrl, { width: 800, margin: 2, color: { dark: '#86d3b2', light: '#18363b' } }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setQrDataUrl('');
    });
    return () => { active = false; };
  }, [publicUrl]);
  const copy = () => navigator.clipboard?.writeText(publicUrl);
  const download = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${item.qr_token}.png`;
    link.click();
  };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[hsl(var(--primary)/.58)] p-5 backdrop-blur-sm"><div className="relative max-h-[90dvh] w-full max-w-md overflow-auto rounded-[1.75rem] bg-[hsl(var(--card))] p-6 shadow-2xl sm:p-8"><button onClick={onClose} data-testid="button-qr-close" className="absolute right-5 top-5 rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={18} /></button><Pill tone="green"><Check size={13} /> Item protected</Pill><h2 className="mt-5 font-display text-3xl font-bold tracking-[-.04em]">Your code is ready.</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Save this code with your {item.item_name}. Anyone who scans it can send a safe found note.</p><div className="mx-auto mt-6 max-w-[250px] rounded-2xl bg-[hsl(var(--primary))] p-5"><div className="grid min-h-[210px] place-items-center rounded-xl bg-[hsl(var(--primary))]">{qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${item.item_name}`} className="h-full w-full rounded-lg" data-testid="img-item-qr" /> : <span className="text-xs text-[hsl(var(--primary-foreground)/.6)]">Generating secure QR…</span>}</div><p className="mt-4 text-center font-mono-app text-sm tracking-[.13em] text-[hsl(var(--secondary))]">{item.qr_token}</p></div><p className="mt-3 break-all text-center font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{publicUrl}</p><div className="mt-6 grid grid-cols-3 gap-2"><Button variant="outline" onClick={download} disabled={!qrDataUrl} data-testid="button-qr-download"><Download size={15} /> Save</Button><Button variant="outline" onClick={() => window.print()} data-testid="button-qr-print"><Printer size={15} /> Print</Button><Button variant="outline" onClick={copy} data-testid="button-qr-copy"><Copy size={15} /> Copy link</Button></div><Button className="mt-3 w-full" onClick={onClose} data-testid="button-qr-done">See my items <ArrowRight size={16} /></Button></div></div>;
}

function ScanPage() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  useEffect(() => {
    if (!cameraActive) return;
    const scanner = new Html5Qrcode('returnloop-qr-reader');
    scannerRef.current = scanner;
    const openFoundPage = (decodedText: string) => {
      const match = decodedText.match(/(RL-[A-Z0-9]{8})/i);
      const clean = (match?.[1] ?? decodedText).trim().toUpperCase();
      if (!clean.startsWith('RL-')) {
        setCameraError('That code is not a ReturnLoop tag. You can enter the ID manually below.');
        return;
      }
      void scanner.stop().catch(() => undefined);
      setLocation(`/found/${clean}`);
    };
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, openFoundPage, () => undefined)
      .catch(() => {
        setCameraError('Camera access was unavailable. Enter the ReturnLoop ID manually below.');
        setCameraActive(false);
      });
    return () => {
      void scanner.stop().catch(() => undefined);
      scannerRef.current = null;
    };
  }, [cameraActive, setLocation]);
  const submit = (e: React.FormEvent) => { e.preventDefault(); const clean = token.trim().toUpperCase(); if (clean) setLocation(`/found/${clean}`); };
  return <div className="returnloop-scanner min-h-[100dvh] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"><div className="mx-auto max-w-[620px] px-5 py-6 sm:px-8"><div className="flex items-center justify-between"><Link href="/app" data-testid="link-scan-back" className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--primary-foreground)/.1)]"><ArrowLeft size={18} /></Link><Logo inverse /><span className="w-10" /></div><div className="pt-12 text-center"><Pill tone="green"><ScanLine size={13} /> Finder mode</Pill><h1 className="mt-6 font-display text-4xl font-bold tracking-[-.05em]">A small scan<br /><span className="text-[hsl(var(--secondary))]">can change a day.</span></h1><p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[hsl(var(--primary-foreground)/.6)]">Point your camera at a ReturnLoop code to safely tell its owner you found something.</p><Button type="button" onClick={() => { setCameraError(''); setCameraActive(true); }} className="mt-7 bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]" data-testid="button-start-camera"><ScanLine size={16} /> {cameraActive ? 'Scanning for a code' : 'Scan QR code'}</Button><div className="relative mx-auto mt-8 aspect-square max-w-[330px] overflow-hidden rounded-[2rem] border border-[hsl(var(--primary-foreground)/.18)] bg-[hsl(var(--primary-foreground)/.05)]"><div id="returnloop-qr-reader" className="absolute inset-0 overflow-hidden rounded-[2rem]" data-testid="camera-preview" /><div className="pointer-events-none absolute inset-8 rounded-[1.3rem] border-2 border-[hsl(var(--secondary))] shadow-[0_0_0_999px_hsl(var(--primary)/.22)]"><span className="absolute -left-1 -top-1 h-8 w-8 border-l-4 border-t-4 border-[hsl(var(--secondary))]" /><span className="absolute -right-1 -top-1 h-8 w-8 border-r-4 border-t-4 border-[hsl(var(--secondary))]" /><span className="absolute -bottom-1 -left-1 h-8 w-8 border-b-4 border-l-4 border-[hsl(var(--secondary))]" /><span className="absolute -bottom-1 -right-1 h-8 w-8 border-b-4 border-r-4 border-[hsl(var(--secondary))]" /><span className="absolute inset-x-4 top-1/2 h-px bg-[hsl(var(--secondary)/.8)] shadow-[0_0_18px_hsl(var(--secondary))]" /></div>{!cameraActive && <div className="absolute inset-0 grid place-items-center"><div className="text-center"><ScanLine size={31} className="mx-auto text-[hsl(var(--primary-foreground)/.28)]" /><p className="mt-3 text-xs text-[hsl(var(--primary-foreground)/.48)]">Tap scan to use your camera</p></div></div>}</div><p className="mt-6 min-h-5 text-xs text-[hsl(var(--primary-foreground)/.55)]">{cameraError || (cameraActive ? 'Camera is looking for a ReturnLoop code.' : 'Camera stays off until you choose to scan.')}</p><div className="my-7 flex items-center gap-3 text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary-foreground)/.4)]"><span className="h-px flex-1 bg-[hsl(var(--primary-foreground)/.15)]" /> Or enter a code <span className="h-px flex-1 bg-[hsl(var(--primary-foreground)/.15)]\" /></div><form onSubmit={submit} className="flex gap-2"><input value={token} onChange={(e) => setToken(e.target.value)} placeholder="RL-XXXXXXXX" data-testid="input-manual-token" className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--primary-foreground)/.18)] bg-[hsl(var(--primary-foreground)/.08)] px-4 py-3 font-mono-app text-sm uppercase tracking-[.1em] text-[hsl(var(--primary-foreground))] outline-none placeholder:text-[hsl(var(--primary-foreground)/.35)] focus:border-[hsl(var(--secondary))]" /><Button type="submit" className="shrink-0 bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]" data-testid="button-manual-scan">Open <ArrowRight size={16} /></Button></form><p className="mt-4 text-center text-[11px] text-[hsl(var(--primary-foreground)/.38)]">Try <button onClick={() => setToken('RL-4W1D8N6C')} data-testid="button-scan-example" className="font-mono-app underline decoration-[hsl(var(--secondary)/.5)] underline-offset-2">RL-4W1D8N6C</button> in the demo.</p></div></div></div>;
}

function FoundPage() {
  const { token } = useParams<{ token: string }>();
  const [item, setItem] = useState<PublicItem | null>(null);
  const [lookup, setLookup] = useState<'loading' | 'done'>('loading');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    let active = true;
    setLookup('loading');
    supabase.rpc('public_item_by_token', { t: token ?? '' }).then(({ data, error }) => {
      if (!active) return;
      const row = Array.isArray(data) ? data[0] : null;
      setItem(error || !row ? null : (row as PublicItem));
      setLookup('done');
    });
    return () => { active = false; };
  }, [token]);
  const [sent, setSent] = useState(false);
  const [finder, setFinder] = useState(''); const [contact, setContact] = useState(''); const [location, setFoundLocation] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [message, setMessage] = useState('');
  if (lookup === 'loading') return <Splash />;
  if (!item) return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5"><div className="max-w-md text-center"><CircleAlert className="mx-auto text-[hsl(var(--accent))]" size={38} /><h1 className="mt-5 font-display text-3xl font-bold">That code took a wrong turn.</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">We couldn’t find a registered item for {token}.</p><Link href="/scan" data-testid="link-found-scan-again" className="mt-7 inline-flex items-center gap-2 font-bold text-[hsl(var(--primary))]">Try another code <ArrowRight size={16} /></Link></div></div>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const { data, error } = await supabase.rpc('submit_found_report', { p_token: token ?? '', p_finder_name: finder, p_finder_contact: contact, p_found_location: location, p_found_date: date, p_message: message });
    setBusy(false);
    if (error) { setFormError('Something went wrong sending your note. Please try again.'); return; }
    const messages: Record<string, string> = {
      invalid: 'Please check the details you entered and try again.',
      not_found: 'This code is not a ReturnLoop tag.',
      closed: 'This item has already been returned to its owner. Thank you!',
      already_reported: 'Someone has already told the owner about this item. Thank you for helping!',
      rate_limited: 'Too many notes were sent for this item today. Please try again tomorrow.',
    };
    if (data === 'ok') setSent(true); else setFormError(messages[String(data)] ?? 'We could not send your note. Please try again.');
  };
  return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><TopBar action={<Link href="/scan" data-testid="link-found-scan" className="flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ScanLine size={16} /> Scan another</Link>} /><main className="mx-auto grid max-w-[1050px] gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[.8fr_1fr] lg:py-16"><div className="animate-in-up"><Pill tone="green"><ShieldCheck size={13} /> Safe return page</Pill><h1 className="mt-6 font-display text-5xl font-extrabold leading-[.92] tracking-[-.06em] text-[hsl(var(--primary))]">You found<br /><span className="text-[hsl(var(--secondary))]">something.</span></h1><p className="mt-5 max-w-sm leading-7 text-[hsl(var(--muted-foreground))]">Thank you for stopping long enough to scan. A short note is all it takes to start the journey home.</p><div className="mt-9 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Registered item</p><div className="mt-4 flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]"><Package size={21} /></span><div><h2 className="font-display text-xl font-bold">{item.item_name}</h2><p className="text-xs text-[hsl(var(--muted-foreground))]">{item.category} · {item.description || 'Details kept intentionally brief.'}</p></div></div><div className="mt-5 flex items-center gap-2 border-t border-[hsl(var(--border))] pt-4 text-xs text-[hsl(var(--muted-foreground))]"><LockKeyhole size={14} className="text-[hsl(var(--secondary))]" /> Owner details stay private.</div></div></div>{sent ? <div className="self-center rounded-[1.75rem] border border-[hsl(var(--secondary)/.6)] bg-[hsl(var(--secondary)/.12)] p-7 text-center sm:p-10"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Check size={27} /></span><h2 className="mt-5 font-display text-3xl font-bold">Note sent with care.</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[hsl(161_38%_29%)]">The owner has been notified. If they need to reach you, they’ll use the contact you left here.</p><Link href="/scan" data-testid="link-found-done" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--primary))]">Scan another item <ArrowRight size={16} /></Link></div> : <form onSubmit={submit} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[0_18px_50px_hsl(var(--primary)/.06)] sm:p-8"><h2 className="font-display text-2xl font-bold">Send a safe found note</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Your contact is only shared with the item owner through ReturnLoop.</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Your name" value={finder} setValue={setFinder} placeholder="Jordan Lee" test="input-finder-name" required /><Field label="Email or phone" value={contact} setValue={setContact} placeholder="How can they reach you?" test="input-finder-contact" required /><Field label="Where did you find it?" value={location} setValue={setFoundLocation} placeholder="West Library, level 2" test="input-found-location" required /><div><label className="mb-1.5 block text-xs font-bold">Date found</label><input value={date} onChange={(e) => setDate(e.target.value)} type="date" required data-testid="input-found-date" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div></div><div className="mt-4"><label className="mb-1.5 block text-xs font-bold">A note for the owner <span className="font-normal text-[hsl(var(--muted-foreground))]">optional</span></label><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="It’s safe with me. I left it at..." data-testid="input-found-message" className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div>{formError && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-[hsl(var(--destructive)/.1)] p-3 text-xs leading-5 text-[hsl(var(--destructive))]"><CircleAlert size={16} className="mt-0.5 shrink-0" />{formError}</div>}<Button type="submit" disabled={busy} className="mt-5 w-full" data-testid="button-send-found-report"><Send size={16} /> {busy ? 'Sending…' : 'Send note to the owner'}</Button></form>}</main></div>;
}
function Field({ label, value, setValue, placeholder, test, required }: { label: string; value: string; setValue: (value: string) => void; placeholder: string; test: string; required?: boolean }) { return <div><label className="mb-1.5 block text-xs font-bold">{label}</label><input value={value} onChange={(e) => setValue(e.target.value)} required={required} placeholder={placeholder} data-testid={test} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div>; }

function AdminPage() {
  const { db, profile, markReturned, dismissReport } = useStore();
  const [tab, setTab] = useState<'overview' | 'items' | 'students'>('overview');
  if (!profile) return <AccessGate />;
  if (profile.role !== 'teacher') return <TeachersOnly />;
  const reports = db.reports.filter((r) => !['returned', 'dismissed'].includes(r.status));
  const returned = db.items.filter((i) => i.status === 'returned').length;
  return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.82)] px-5 py-4 backdrop-blur sm:px-8 lg:px-12"><div className="mx-auto flex max-w-[1280px] items-center justify-between"><div className="flex items-center gap-5"><Logo /><span className="hidden h-5 w-px bg-[hsl(var(--border))] sm:block" /><span className="hidden text-xs font-bold text-[hsl(var(--muted-foreground))] sm:block">Teacher console</span></div><div className="flex items-center gap-2"><Link href="/app" data-testid="link-admin-student-view" className="hidden rounded-lg px-3 py-2 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] sm:block">Student view</Link><span className="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--primary))] text-xs font-bold text-[hsl(var(--secondary))]">{profile.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</span></div></div></header><main className="mx-auto max-w-[1280px] px-5 py-7 sm:px-8 md:py-10 lg:px-12"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><Pill tone="blue"><BookOpen size={13} /> Staff space</Pill><h1 className="mt-4 font-display text-4xl font-bold tracking-[-.05em]">Good morning, {profile.full_name.split(' ')[0] || 'there'}.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">A clear view of the belongings moving through campus.</p></div><div className="flex rounded-xl bg-[hsl(var(--muted)/.7)] p-1">{(['overview', 'items', 'students'] as const).map((entry) => <button key={entry} onClick={() => setTab(entry)} data-testid={`button-admin-tab-${entry}`} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${tab === entry ? 'bg-[hsl(var(--card))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>{entry}</button>)}</div></div><div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4"><AdminStat label="Registered items" value={db.items.length.toString()} icon={Package} /><AdminStat label="Open found notes" value={reports.length.toString()} icon={Inbox} accent={reports.length > 0} /><AdminStat label="Returned this term" value={returned.toString()} icon={CheckCircle2} /><AdminStat label="Students protected" value={new Set(db.items.map((i) => i.owner_id)).size.toString()} icon={Users} /></div>{tab === 'overview' && <div className="mt-8 grid gap-7 lg:grid-cols-[1.35fr_.8fr]"><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Needs a handoff</p><h2 className="mt-2 font-display text-2xl font-bold">Open finder notes</h2></div><Pill tone="amber">{reports.length} open</Pill></div><div className="mt-5 space-y-3">{reports.length ? reports.map((report) => <ReportRow key={report.id} report={report} item={db.items.find((i) => i.id === report.item_id)} onReturn={() => { void markReturned(report.item_id); }} onDismiss={() => { void dismissReport(report.id); }} />) : <EmptyState text="Every found item is back where it belongs." />}</div></section><section className="rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))]"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--secondary)/.18)] text-[hsl(var(--secondary))]"><HeartHandshake size={19} /></span><MoreHorizontal size={18} className="text-[hsl(var(--primary-foreground)/.45)]" /></div><h2 className="mt-10 font-display text-2xl font-bold">The return rate is a community metric.</h2><p className="mt-3 text-sm leading-6 text-[hsl(var(--primary-foreground)/.58)]">Each clear handoff makes the next one feel more natural.</p><div className="mt-8 flex items-end gap-3"><span className="font-display text-5xl font-bold text-[hsl(var(--secondary))]">{returned}</span><span className="mb-2 text-xs text-[hsl(var(--primary-foreground)/.55)]">items returned<br />so far</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[hsl(var(--primary-foreground)/.12)]"><div className="h-full rounded-full bg-[hsl(var(--secondary))]" style={{ width: `${db.items.length ? Math.round((returned / db.items.length) * 100) : 0}%` }} /></div></section></div>}{tab === 'items' && <AdminItems items={db.items} profiles={db.profiles} onReturn={markReturned} />}{tab === 'students' && <AdminStudents profiles={db.profiles} items={db.items} />}</main></div>;
}
function TeachersOnly() {
  const [, setLocation] = useLocation();
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5"><div className="max-w-sm text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--accent)/.2)] text-[hsl(var(--primary))]"><LockKeyhole /></span><h1 className="mt-5 font-display text-3xl font-bold">Teachers only.</h1><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">This page is for teacher accounts. Your own items are on your dashboard.</p><Button className="mt-7" onClick={() => setLocation('/app')} data-testid="button-teachers-only-back">Back to my items <ArrowRight size={16} /></Button></div></div>;
}
function AdminStat({ label, value, icon: Icon, accent = false }: { label: string; value: string; icon: typeof Package; accent?: boolean }) { return <div className={`rounded-2xl border p-4 ${accent ? 'border-[hsl(var(--accent)/.52)] bg-[hsl(var(--accent)/.1)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)]'}`}><div className="flex justify-between"><span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span><Icon size={16} className={accent ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--secondary))]'} /></div><p className="mt-3 font-display text-3xl font-bold">{value}</p></div>; }
function ReportRow({ report, item, onReturn, onDismiss }: { report: Report; item?: Item; onReturn: () => void; onDismiss: () => void }) { return <div className="rounded-xl border border-[hsl(var(--border))] p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--accent)/.2)] text-[hsl(var(--accent))]"><Inbox size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">{item?.item_name}</p><Pill tone="amber">New note</Pill></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Found by <span className="font-semibold text-[hsl(var(--foreground))]">{report.finder_name}</span> at {report.found_location}</p><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">“{report.message || 'No message left.'}”</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="soft" className="px-3 py-2 text-xs" onClick={onReturn} data-testid={`button-mark-returned-${report.id}`}><Check size={14} /> Mark returned</Button><Button variant="ghost" className="px-3 py-2 text-xs" onClick={() => navigator.clipboard?.writeText(report.finder_contact)} data-testid={`button-copy-contact-${report.id}`}><Copy size={14} /> Copy finder contact</Button><Button variant="ghost" className="px-3 py-2 text-xs" onClick={onDismiss} data-testid={`button-dismiss-${report.id}`}><X size={14} /> Dismiss</Button></div></div></div></div>; }
function AdminItems({ items, profiles, onReturn }: { items: Item[]; profiles: Profile[]; onReturn: (id: string) => void }) { return <section className="mt-8 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div className="flex justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Campus inventory</p><h2 className="mt-2 font-display text-2xl font-bold">Every protected item</h2></div><Search size={18} className="text-[hsl(var(--muted-foreground))]" /></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-[hsl(var(--border))] text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]"><tr><th className="pb-3 font-bold">Item</th><th className="pb-3 font-bold">Owner</th><th className="pb-3 font-bold">Code</th><th className="pb-3 font-bold">Status</th><th className="pb-3 text-right font-bold">Action</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-[hsl(var(--border)/.65)] last:border-0" data-testid={`row-admin-item-${item.id}`}><td className="py-4 font-semibold">{item.item_name}<span className="mt-1 block text-xs font-normal text-[hsl(var(--muted-foreground))]">{item.category}</span></td><td className="py-4 text-xs">{profiles.find((p) => p.id === item.owner_id)?.full_name}</td><td className="py-4 font-mono-app text-xs text-[hsl(var(--muted-foreground))]">{item.qr_token}</td><td className="py-4"><Pill tone={item.status === 'returned' ? 'green' : item.status === 'found' ? 'amber' : 'blue'}>{item.status}</Pill></td><td className="py-4 text-right">{item.status !== 'returned' && <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => onReturn(item.id)} data-testid={`button-admin-return-${item.id}`}><Check size={14} /> Return</Button>}</td></tr>)}</tbody></table></div></section>; }
function AdminStudents({ profiles, items }: { profiles: Profile[]; items: Item[] }) { return <section className="mt-8 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">People in the loop</p><h2 className="mt-2 font-display text-2xl font-bold">Students</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{profiles.filter((p) => p.role === 'student').map((profile) => <div key={profile.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] p-4" data-testid={`card-admin-student-${profile.id}`}><span className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--secondary)/.2)] text-xs font-bold text-[hsl(var(--primary))]">{profile.full_name.split(' ').map((n) => n[0]).join('')}</span><div className="flex-1"><p className="text-sm font-bold">{profile.full_name}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{profile.course_or_class} · {items.filter((i) => i.owner_id === profile.id).length} protected</p></div><BadgeCheck size={17} className="text-[hsl(var(--secondary))]" /></div>)}</div></section>; }

function ProfilePage() {
  const { profile, db, signOut } = useStore();
  const [, setLocation] = useLocation();
  if (!profile) return <AccessGate />;
  return <DashboardShell active="profile"><div className="mx-auto max-w-[900px] px-5 py-7 sm:px-8 md:py-10 lg:px-12"><Pill tone="blue"><UserRound size={13} /> Your account</Pill><h1 className="mt-5 font-display text-4xl font-bold tracking-[-.05em]">Profile & privacy</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">You’re in control of what the loop keeps.</p><div className="mt-8 grid gap-6 lg:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div className="flex items-center gap-4 border-b border-[hsl(var(--border))] pb-6"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-[hsl(var(--primary))] font-display text-xl font-bold text-[hsl(var(--secondary))]">{profile.full_name.split(' ').map((n) => n[0]).join('')}</span><div><h2 className="font-display text-2xl font-bold">{profile.full_name}</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{profile.student_id} · {profile.course_or_class}, section {profile.section}</p></div></div><div className="space-y-4 pt-6"><ProfileLine label="Campus email" value={profile.email} /><ProfileLine label="Items in your loop" value={db.items.filter((i) => i.owner_id === profile.id).length.toString()} /><ProfileLine label="Member since" value={new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} /></div></section><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Your privacy</p><h2 className="mt-2 font-display text-2xl font-bold">Quiet by default.</h2><p className="mt-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Your name, email and student ID are never shown on a public found page. Only you and the teachers can see your account details.</p><Button variant="outline" className="mt-6 w-full" onClick={async () => { await signOut(); setLocation('/'); }} data-testid="button-sign-out"><LogOut size={16} /> Sign out</Button><div className="mt-7 flex gap-2 rounded-xl bg-[hsl(var(--secondary)/.1)] p-3 text-xs leading-5 text-[hsl(161_38%_29%)]"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> ReturnLoop codes only carry a random token. No profile data travels with a scan.</div></section></div></div></DashboardShell>;
}
function ProfileLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-4"><span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span><span className="text-right text-sm font-semibold">{value}</span></div>; }

function OwnerReportCard({ report, onDismiss }: { report: Report; onDismiss: () => void }) {
  return <div className="ml-3 mt-2 rounded-xl border border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.08)] p-3.5 text-xs leading-5" data-testid={`card-report-${report.id}`}>
    <p className="font-bold">Found by {report.finder_name} · {report.found_location}</p>
    <p className="mt-1 text-[hsl(var(--muted-foreground))]">Contact: <span className="font-semibold text-[hsl(var(--foreground))]">{report.finder_contact}</span></p>
    {report.message && <p className="mt-1 text-[hsl(var(--muted-foreground))]">“{report.message}”</p>}
    <div className="mt-3"><Button variant="ghost" className="px-3 py-2 text-xs" onClick={() => { if (window.confirm('Dismiss this report? Use this if it looks fake or a mistake.')) onDismiss(); }} data-testid={`button-dismiss-owner-${report.id}`}><X size={14} /> Not my item / dismiss</Button></div>
  </div>;
}

function NotificationsPage() {
  const { db, profile } = useStore();
  if (!profile) return <AccessGate />;
  const notes = db.notifications.filter((note) => note.recipient_user_id === profile.id);
  return <DashboardShell active="notifications"><div className="mx-auto max-w-[760px] px-5 py-7 sm:px-8 md:py-10 lg:px-12"><Pill tone="amber"><Bell size={13} /> Notifications</Pill><h1 className="mt-5 font-display text-4xl font-bold tracking-[-.05em]">From your loop</h1><div className="mt-8 space-y-3">{notes.length ? notes.map((note) => <NotificationCard key={note.id} note={note} />) : <EmptyState text="No notes yet. That’s a good sign." />}</div></div></DashboardShell>;
}

function NotFound() { return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5 text-center"><div><span className="font-mono-app text-xs text-[hsl(var(--secondary))]">RETURNLOOP / 404</span><h1 className="mt-4 font-display text-5xl font-bold">This loop is empty.</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">There’s nothing here yet, but the campus is still looking out.</p><Link href="/" data-testid="link-404-home" className="mt-7 inline-flex items-center gap-2 font-bold text-[hsl(var(--primary))]">Return home <ArrowRight size={16} /></Link></div></div>; }

function Router() {
  const { loading } = useStore();
  if (loading) return <Splash />;
  return <ErrorBoundary><Switch><Route path="/" component={HomePage} /><Route path="/auth" component={AuthPage} /><Route path="/app/new" component={NewItemPage} /><Route path="/app" component={StudentDashboard} /><Route path="/scan" component={ScanPage} /><Route path="/found/:token" component={FoundPage} /><Route path="/admin" component={AdminPage} /><Route path="/profile" component={ProfilePage} /><Route path="/notifications" component={NotificationsPage} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}
function App() {
  if (!supabaseConfigured) return <ConfigMissing />;
  return <QueryClientProvider client={queryClient}><TooltipProvider><StoreProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></StoreProvider></TooltipProvider></QueryClientProvider>;
}
export default App;