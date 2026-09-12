import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Bell, BookOpen, Check, CheckCircle2, ChevronRight,
  Copy, Download, HeartHandshake, Home, KeyRound, Link2, LockKeyhole, Package, Plus,
  QrCode, ScanLine, Search, Send, Settings, ShieldCheck, Sparkles, UserRound, Users, X,
  ExternalLink, Inbox, CircleAlert, MoreHorizontal, Printer
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

type Role = 'student' | 'teacher';
type Status = 'registered' | 'reported' | 'returned';
type Category = 'Tech' | 'Study' | 'Wearables' | 'Personal' | 'Other';
type Profile = { id: string; full_name: string; email: string; role: Role; student_id?: string; course_or_class?: string; section?: string };
type Item = { id: string; owner_id: string; item_name: string; category: Category; description: string; qr_token: string; status: Status; created_at: string };
type Report = { id: string; item_id: string; finder_name: string; finder_contact: string; found_location: string; found_date: string; message: string; status: 'new' | 'reviewed' | 'returned'; created_at: string };
type Notice = { id: string; recipient_user_id: string; item_id?: string; found_report_id?: string; title: string; message: string; notification_type: string; is_read: boolean; created_at: string };
type Db = { profiles: Profile[]; items: Item[]; reports: Report[]; notifications: Notice[] };

const queryClient = new QueryClient();
const DB_KEY = 'returnloop-db-v1';
const SESSION_KEY = 'returnloop-session';
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createQrToken() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `RL-${Array.from(bytes, (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]).join('')}`;
}

const seed: Db = {
  profiles: [
    { id: 'student-1', full_name: 'Aryan Mishra', email: 'aryan.mishra@northfield.edu', role: 'student', student_id: 'NF-24-071', course_or_class: 'Computer Science', section: 'B' },
    { id: 'student-2', full_name: 'Maya Chen', email: 'maya.chen@northfield.edu', role: 'student', student_id: 'NF-23-118', course_or_class: 'Architecture', section: 'A' },
    { id: 'teacher-1', full_name: 'Dr. Lena Ortiz', email: 'lena.ortiz@northfield.edu', role: 'teacher', course_or_class: 'Student Life' },
  ],
  items: [
    { id: 'item-1', owner_id: 'student-1', item_name: 'Midnight blue backpack', category: 'Study', description: 'Navy canvas backpack with a small stitched moon patch and a silver water bottle pocket.', qr_token: 'RL-7K2M9P4Q', status: 'registered', created_at: '2025-02-06T10:24:00.000Z' },
    { id: 'item-2', owner_id: 'student-1', item_name: 'Silver laptop', category: 'Tech', description: '13-inch silver laptop with a pale green sticker on the lid.', qr_token: 'RL-4W1D8N6C', status: 'reported', created_at: '2025-01-26T09:12:00.000Z' },
    { id: 'item-3', owner_id: 'student-2', item_name: 'Green knit scarf', category: 'Wearables', description: 'Soft sage scarf with a narrow cream stripe at each end.', qr_token: 'RL-9P3F6T2L', status: 'returned', created_at: '2025-01-18T15:42:00.000Z' },
    { id: 'item-4', owner_id: 'student-2', item_name: 'Calculus notebook', category: 'Study', description: 'Black dotted notebook marked with a small white star on the cover.', qr_token: 'RL-5H8Q2B7R', status: 'registered', created_at: '2025-02-10T12:04:00.000Z' },
  ],
  reports: [
    { id: 'report-1', item_id: 'item-2', finder_name: 'Jordan Lee', finder_contact: 'jordan.lee@northfield.edu', found_location: 'West Library, level 2', found_date: '2025-02-12', message: 'It is safe with the library desk. I left it beside the returns slot.', status: 'new', created_at: '2025-02-12T16:20:00.000Z' },
    { id: 'report-2', item_id: 'item-3', finder_name: 'Sam Rivera', finder_contact: 'sam.rivera@northfield.edu', found_location: 'Student Union café', found_date: '2025-02-04', message: 'Handed to the café team at closing.', status: 'returned', created_at: '2025-02-04T17:10:00.000Z' },
  ],
  notifications: [
    { id: 'note-1', recipient_user_id: 'student-1', item_id: 'item-2', found_report_id: 'report-1', title: 'A finder is looking out for you', message: 'Your silver laptop was found near the West Library.', notification_type: 'found_report', is_read: false, created_at: '2025-02-12T16:20:00.000Z' },
    { id: 'note-2', recipient_user_id: 'student-1', item_id: 'item-1', title: 'Your item is protected', message: 'Midnight blue backpack is now registered with ReturnLoop.', notification_type: 'registered', is_read: true, created_at: '2025-02-06T10:24:00.000Z' },
  ],
};

function loadDb(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) as Db : seed;
  } catch { return seed; }
}

type Store = {
  db: Db;
  session: string | null;
  signIn: (id: string) => void;
  addItem: (item: Item) => void;
  addReport: (report: Report) => void;
  markReturned: (itemId: string) => void;
  markRead: (id: string) => void;
  profile: Profile | undefined;
};
const StoreContext = createContext<Store | null>(null);
function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('ReturnLoop store is unavailable');
  return value;
}

function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db>(() => loadDb());
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  useEffect(() => { localStorage.setItem(DB_KEY, JSON.stringify(db)); }, [db]);
  useEffect(() => { if (session) localStorage.setItem(SESSION_KEY, session); else localStorage.removeItem(SESSION_KEY); }, [session]);
  const profile = db.profiles.find((p) => p.id === session);
  const value: Store = {
    db, session, profile,
    signIn: (id) => setSession(id),
    addItem: (item) => setDb((current) => ({ ...current, items: [item, ...current.items], notifications: [{ id: `note-${Date.now()}`, recipient_user_id: item.owner_id, item_id: item.id, title: 'Your item is protected', message: `${item.item_name} is now registered with ReturnLoop.`, notification_type: 'registered', is_read: true, created_at: new Date().toISOString() }, ...current.notifications] })),
    addReport: (report) => setDb((current) => {
      const item = current.items.find((entry) => entry.id === report.item_id);
      const timestamp = new Date().toISOString();
      const ownerNotification: Notice = {
        id: `note-owner-${Date.now()}`,
        recipient_user_id: item?.owner_id ?? '',
        item_id: report.item_id,
        found_report_id: report.id,
        title: 'A finder is looking out for you',
        message: `${item?.item_name ?? 'Your item'} was found near ${report.found_location}.`,
        notification_type: 'found_report',
        is_read: false,
        created_at: timestamp,
      };
      const teacherNotifications = current.profiles.filter((profile) => profile.role === 'teacher').map((teacher) => ({
        id: `note-teacher-${teacher.id}-${Date.now()}`,
        recipient_user_id: teacher.id,
        item_id: report.item_id,
        found_report_id: report.id,
        title: 'New ReturnLoop Found Report',
        message: `${item?.item_name ?? 'An item'} was reported near ${report.found_location}.`,
        notification_type: 'found_report',
        is_read: false,
        created_at: timestamp,
      }));
      return {
        ...current,
        reports: [report, ...current.reports],
        items: current.items.map((entry) => entry.id === report.item_id ? { ...entry, status: 'reported' } : entry),
        notifications: [...teacherNotifications, ownerNotification, ...current.notifications],
      };
    }),
    markReturned: (itemId) => setDb((current) => ({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, status: 'returned' } : item), reports: current.reports.map((report) => report.item_id === itemId ? { ...report, status: 'returned' } : report) })),
    markRead: (id) => setDb((current) => ({ ...current, notifications: current.notifications.map((n) => n.id === id ? { ...n, is_read: true } : n) })),
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
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
        </div><div className="mt-9 space-y-1"><p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.46)]">Account</p><SideLink href="/profile" active={active === 'profile'} icon={UserRound}>Profile & privacy</SideLink></div>
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
  const { signIn } = useStore();
  return <div className="rl-noise min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]">
    <TopBar action={<><Link href="/auth" data-testid="link-sign-in" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] sm:block">Sign in</Link><Button onClick={() => setLocation('/auth')} data-testid="button-get-started">Get started <ArrowRight size={16} /></Button></>} />
    <section className="relative mx-auto grid max-w-[1250px] items-center gap-14 px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.08fr_.92fr] lg:px-12 lg:pb-28 lg:pt-24">
      <div className="relative z-10 animate-in-up"><Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" /> Built for Northfield campus</Pill><h1 className="mt-7 max-w-2xl font-display text-[clamp(3.4rem,8vw,7.3rem)] font-extrabold leading-[.91] tracking-[-.075em] text-[hsl(var(--primary))]">Lost it?<br /><span className="text-[hsl(var(--secondary))]">Scan it.</span><br />Return it.</h1><p className="mt-7 max-w-md text-[17px] leading-7 text-[hsl(var(--muted-foreground))]">The gentle way to bring a misplaced belonging home. Add a private ReturnLoop tag, then let the campus community do the rest.</p><div className="mt-8 flex flex-wrap gap-3"><Button onClick={() => setLocation('/auth')} data-testid="button-hero-get-started">Protect an item <ArrowRight size={16} /></Button><Button variant="outline" onClick={() => setLocation('/scan')} data-testid="button-hero-scan"><ScanLine size={16} /> Scan a QR</Button><Button variant="ghost" onClick={() => { signIn('student-1'); setLocation('/app'); }} data-testid="button-try-demo">Try the demo <ChevronRight size={16} /></Button></div><div className="mt-10 flex items-center gap-3 text-xs font-medium text-[hsl(var(--muted-foreground))]"><div className="flex -space-x-2"><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[hsl(var(--background))] bg-[#e8b98e] text-[10px] font-bold text-[#594132]">AM</span><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[hsl(var(--background))] bg-[#9ac9bb] text-[10px] font-bold text-[#214b45]">JL</span><span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[hsl(var(--background))] bg-[#d8b9dd] text-[10px] font-bold text-[#55305c]">MC</span></div><span>Already keeping an eye out</span><span className="text-[hsl(var(--accent))]">●</span></div></div>
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
  const { signIn } = useStore();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const submit = (event: React.FormEvent) => { event.preventDefault(); signIn('student-1'); setLocation('/app'); };
  return <div className="rl-noise min-h-[100dvh] bg-[hsl(var(--background))]"><TopBar action={<Link href="/" data-testid="link-auth-back" className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">Back to home</Link>} /><main className="mx-auto grid max-w-[1050px] items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[.85fr_1fr] lg:py-20"><div className="animate-in-up"><Pill tone="green"><LockKeyhole size={13} /> Made for your campus</Pill><h1 className="mt-6 max-w-md font-display text-5xl font-extrabold leading-[.95] tracking-[-.06em] text-[hsl(var(--primary))]">Keep the things that keep <span className="text-[hsl(var(--secondary))]">you</span> going.</h1><p className="mt-5 max-w-sm leading-7 text-[hsl(var(--muted-foreground))]">Sign in to register a new item, see a finder’s note, or help something else find its way home.</p><div className="mt-8 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]"><ShieldCheck size={16} className="text-[hsl(var(--secondary))]" /> Your identity stays private on every tag.</div></div><div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[0_24px_80px_hsl(var(--primary)/.08)] sm:p-8"><div className="flex rounded-xl bg-[hsl(var(--muted)/.7)] p-1"><button onClick={() => setMode('signin')} data-testid="button-auth-signin-tab" className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === 'signin' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>Sign in</button><button onClick={() => setMode('signup')} data-testid="button-auth-signup-tab" className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === 'signup' ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>Create account</button></div><form onSubmit={submit} className="mt-7 space-y-4"><div><label className="mb-1.5 block text-xs font-bold text-[hsl(var(--foreground))]">Campus email</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="you@northfield.edu" data-testid="input-auth-email" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none transition focus:border-[hsl(var(--secondary))] focus:ring-4 focus:ring-[hsl(var(--secondary)/.12)]" /></div>{mode === 'signup' && <div><label className="mb-1.5 block text-xs font-bold">Your full name</label><input required placeholder="Aryan Mishra" data-testid="input-auth-name" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div>}<div><label className="mb-1.5 block text-xs font-bold">{mode === 'signin' ? 'Password' : 'Create a password'}</label><input required type="password" placeholder="••••••••" data-testid="input-auth-password" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div><Button type="submit" className="mt-2 w-full" data-testid="button-auth-submit">{mode === 'signin' ? 'Sign in to ReturnLoop' : 'Create my account'} <ArrowRight size={16} /></Button></form><div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]"><span className="h-px flex-1 bg-[hsl(var(--border))]" /> Quick entry <span className="h-px flex-1 bg-[hsl(var(--border))]" /></div><Button variant="outline" className="w-full" onClick={() => { signIn('teacher-1'); setLocation('/admin'); }} data-testid="button-teacher-demo"><BookOpen size={16} /> Enter teacher demo</Button><button onClick={() => { signIn('student-1'); setLocation('/app'); }} data-testid="button-try-demo-auth" className="mt-4 flex w-full items-center justify-center gap-1 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">Try Aryan’s student demo <ChevronRight size={14} /></button></div></main></div>;
}

function AccessGate() {
  const [, setLocation] = useLocation();
  const { signIn } = useStore();
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5"><div className="max-w-sm text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--secondary)/.2)] text-[hsl(var(--primary))]"><KeyRound /></span><h1 className="mt-5 font-display text-3xl font-bold">Your loop is waiting.</h1><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Sign in to see your protected belongings and finder notes.</p><Button className="mt-7" onClick={() => { signIn('student-1'); setLocation('/app'); }} data-testid="button-access-demo">Enter student demo <ArrowRight size={16} /></Button></div></div>;
}

function StudentDashboard() {
  const { db, profile, markRead } = useStore();
  if (!profile) return <AccessGate />;
  const items = db.items.filter((i) => i.owner_id === profile.id);
  const notes = db.notifications.filter((n) => n.recipient_user_id === profile.id);
  const found = items.filter((i) => i.status === 'reported').length;
  return <DashboardShell active="home"><div className="mx-auto max-w-[1180px] px-5 py-6 sm:px-8 md:py-9 lg:px-12"><div className="flex items-start justify-between gap-4"><div><Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" /> Campus loop is active</Pill><h1 className="mt-4 font-display text-3xl font-bold tracking-[-.04em] sm:text-4xl">Good to see you, <span className="text-[hsl(var(--secondary))]">{profile.full_name.split(' ')[0]}.</span></h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Here’s the quiet status of your things.</p></div><div className="flex items-center gap-2"><Link href="/profile" data-testid="link-dashboard-profile" className="grid h-10 w-10 place-items-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-sm font-bold text-[hsl(var(--primary))]">{profile.full_name.split(' ').map((n) => n[0]).join('')}</Link><Link href="/profile" data-testid="link-dashboard-settings" className="hidden rounded-xl p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] sm:block"><Settings size={19} /></Link></div></div><div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Protected items" value={items.length.toString()} icon={Package} /><Stat label="Needs your eye" value={found.toString()} icon={Bell} accent={found > 0} /><Stat label="Returned home" value={items.filter((i) => i.status === 'returned').toString()} icon={HeartHandshake} /><Stat label="Campus kindness" value="24" icon={Users} suffix=" this week" /></div><div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_.8fr]"><section><div className="flex items-end justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Your belongings</p><h2 className="mt-2 font-display text-2xl font-bold">Protected, not tracked.</h2></div><Link href="/app/new" data-testid="link-dashboard-add" className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))] hover:text-[hsl(var(--secondary))]">Add item <Plus size={15} /></Link></div><div className="mt-5 space-y-3">{items.map((item) => <ItemRow key={item.id} item={item} />)}</div></section><section><div className="flex items-end justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Recent notes</p><h2 className="mt-2 font-display text-2xl font-bold">From your loop</h2></div><span className="grid h-7 min-w-7 place-items-center rounded-full bg-[hsl(var(--accent)/.24)] px-2 text-xs font-bold">{notes.filter((n) => !n.is_read).length}</span></div><div className="mt-5 space-y-3">{notes.length === 0 ? <EmptyState text="No notes yet. That’s a good sign." /> : notes.slice(0, 4).map((note) => <button key={note.id} onClick={() => markRead(note.id)} data-testid={`button-notification-${note.id}`} className={`w-full rounded-2xl border p-4 text-left transition hover:border-[hsl(var(--secondary))] ${note.is_read ? 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.4)]' : 'border-[hsl(var(--accent)/.6)] bg-[hsl(var(--accent)/.08)]'}`}><div className="flex gap-3"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${note.is_read ? 'bg-[hsl(var(--muted))]' : 'bg-[hsl(var(--accent)/.25)]'}`}><Bell size={15} /></span><div className="min-w-0"><div className="flex items-start justify-between gap-2"><p className="text-sm font-bold">{note.title}</p>{!note.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--accent))]" />}</div><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{note.message}</p><p className="mt-2 font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div></div></button>)}</div></section></div></div></DashboardShell>;
}
function Stat({ label, value, icon: Icon, accent = false, suffix = '' }: { label: string; value: string; icon: typeof Package; accent?: boolean; suffix?: string }) {
  return <div className={`rounded-2xl border p-4 sm:p-5 ${accent ? 'border-[hsl(var(--accent)/.52)] bg-[hsl(var(--accent)/.1)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)]'}`} data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}><div className="flex items-start justify-between"><span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</span><Icon size={16} className={accent ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--secondary))]'} /></div><p className="mt-4 font-display text-3xl font-bold">{value}<span className="ml-1 text-xs font-sans font-medium text-[hsl(var(--muted-foreground))]">{suffix}</span></p></div>;
}
function ItemRow({ item }: { item: Item }) {
  const status = item.status === 'reported' ? { label: 'Finder note', tone: 'amber' as const, icon: Bell } : item.status === 'returned' ? { label: 'Returned', tone: 'green' as const, icon: CheckCircle2 } : { label: 'Protected', tone: 'blue' as const, icon: ShieldCheck };
  const Icon = status.icon;
  return <div className="group flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-3.5 transition hover:-translate-y-0.5 hover:border-[hsl(var(--secondary)/.7)] hover:shadow-md" data-testid={`card-item-${item.id}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]"><Package size={19} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.item_name}</p><p className="mt-1 font-mono-app text-[10px] tracking-wide text-[hsl(var(--muted-foreground))]">{item.qr_token}</p></div><Pill tone={status.tone}><Icon size={12} /> <span className="hidden sm:inline">{status.label}</span></Pill><Link href={`/found/${item.qr_token}`} data-testid={`link-item-token-${item.id}`} className="hidden rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--primary))] sm:block"><ExternalLink size={15} /></Link></div>;
}
function EmptyState({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-7 text-center"><Inbox size={22} className="mx-auto text-[hsl(var(--muted-foreground))]" /><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{text}</p></div>; }

function NewItemPage() {
  const { profile, addItem } = useStore();
  const [, setLocation] = useLocation();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('Tech');
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<Item | null>(null);
  if (!profile) return <AccessGate />;
  const create = (event: React.FormEvent) => { event.preventDefault(); const token = createQrToken(); const item: Item = { id: `item-${Date.now()}`, owner_id: profile.id, item_name: name, category, description, qr_token: token, status: 'registered', created_at: new Date().toISOString() }; addItem(item); setCreated(item); };
  return <DashboardShell active="new"><div className="mx-auto max-w-[980px] px-5 py-7 sm:px-8 md:py-10 lg:px-12"><Link href="/app" data-testid="link-new-back" className="inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"><ArrowLeft size={15} /> Back to overview</Link><div className="mt-8 max-w-xl"><Pill tone="green"><Sparkles size={13} /> Two minutes to peace of mind</Pill><h1 className="mt-5 font-display text-4xl font-bold tracking-[-.05em] sm:text-5xl">Register something<br /><span className="text-[hsl(var(--secondary))]">worth finding.</span></h1><p className="mt-4 leading-7 text-[hsl(var(--muted-foreground))]">We’ll make a private code for it. Add the code to the item, and your campus can help it travel back to you.</p></div><form onSubmit={create} className="mt-10 grid gap-8 lg:grid-cols-[1fr_300px]"><div className="space-y-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div><label className="mb-2 block text-xs font-bold">What are you registering?</label><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Silver laptop" data-testid="input-item-name" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))] focus:ring-4 focus:ring-[hsl(var(--secondary)/.12)]" /></div><div><label className="mb-2 block text-xs font-bold">A few identifying details <span className="font-normal text-[hsl(var(--muted-foreground))]">optional</span></label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Color, stickers, case, initials..." data-testid="input-item-description" className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))] focus:ring-4 focus:ring-[hsl(var(--secondary)/.12)]" /></div><div><label className="mb-2 block text-xs font-bold">Category</label><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{(['Tech', 'Study', 'Wearables', 'Personal', 'Other'] as Category[]).map((entry) => <button type="button" key={entry} onClick={() => setCategory(entry)} data-testid={`button-category-${entry.toLowerCase()}`} className={`rounded-xl border px-2 py-3 text-xs font-bold transition ${category === entry ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary)/.18)] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>{entry}</button>)}</div></div><div className="flex gap-3 rounded-xl bg-[hsl(var(--secondary)/.11)] p-3.5 text-xs leading-5 text-[hsl(161_38%_29%)]"><ShieldCheck size={17} className="mt-0.5 shrink-0" /> Your ReturnLoop code contains no name, email, or student details.</div><Button type="submit" className="w-full sm:w-auto" data-testid="button-create-item">Create private code <ArrowRight size={16} /></Button></div><aside className="h-fit rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))]"><QrCode className="text-[hsl(var(--secondary))]" size={27} /><h2 className="mt-7 font-display text-2xl font-bold">A small code.<br />A big handoff.</h2><p className="mt-3 text-sm leading-6 text-[hsl(var(--primary-foreground)/.61)]">When someone finds your item, they can scan this code to send a note without seeing who you are.</p><div className="mt-8 border-t border-[hsl(var(--primary-foreground)/.16)] pt-4 text-xs text-[hsl(var(--primary-foreground)/.56)]">You’ll be able to download or print it after creating.</div></aside></form></div>{created && <QrModal item={created} onClose={() => setLocation('/app')} />}</DashboardShell>;
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
  const { db, addReport } = useStore();
  const item = db.items.find((entry) => entry.qr_token.toUpperCase() === (token || '').toUpperCase());
  const [sent, setSent] = useState(false);
  const [finder, setFinder] = useState(''); const [contact, setContact] = useState(''); const [location, setFoundLocation] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [message, setMessage] = useState('');
  if (!item) return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5"><div className="max-w-md text-center"><CircleAlert className="mx-auto text-[hsl(var(--accent))]" size={38} /><h1 className="mt-5 font-display text-3xl font-bold">That code took a wrong turn.</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">We couldn’t find a registered item for {token}.</p><Link href="/scan" data-testid="link-found-scan-again" className="mt-7 inline-flex items-center gap-2 font-bold text-[hsl(var(--primary))]">Try another code <ArrowRight size={16} /></Link></div></div>;
  const submit = (e: React.FormEvent) => { e.preventDefault(); const report: Report = { id: `report-${Date.now()}`, item_id: item.id, finder_name: finder, finder_contact: contact, found_location: location, found_date: date, message, status: 'new', created_at: new Date().toISOString() }; addReport(report); setSent(true); };
  return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><TopBar action={<Link href="/scan" data-testid="link-found-scan" className="flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ScanLine size={16} /> Scan another</Link>} /><main className="mx-auto grid max-w-[1050px] gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[.8fr_1fr] lg:py-16"><div className="animate-in-up"><Pill tone="green"><ShieldCheck size={13} /> Safe return page</Pill><h1 className="mt-6 font-display text-5xl font-extrabold leading-[.92] tracking-[-.06em] text-[hsl(var(--primary))]">You found<br /><span className="text-[hsl(var(--secondary))]">something.</span></h1><p className="mt-5 max-w-sm leading-7 text-[hsl(var(--muted-foreground))]">Thank you for stopping long enough to scan. A short note is all it takes to start the journey home.</p><div className="mt-9 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Registered item</p><div className="mt-4 flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]"><Package size={21} /></span><div><h2 className="font-display text-xl font-bold">{item.item_name}</h2><p className="text-xs text-[hsl(var(--muted-foreground))]">{item.category} · {item.description || 'Details kept intentionally brief.'}</p></div></div><div className="mt-5 flex items-center gap-2 border-t border-[hsl(var(--border))] pt-4 text-xs text-[hsl(var(--muted-foreground))]"><LockKeyhole size={14} className="text-[hsl(var(--secondary))]" /> Owner details stay private.</div></div></div>{sent ? <div className="self-center rounded-[1.75rem] border border-[hsl(var(--secondary)/.6)] bg-[hsl(var(--secondary)/.12)] p-7 text-center sm:p-10"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Check size={27} /></span><h2 className="mt-5 font-display text-3xl font-bold">Note sent with care.</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[hsl(161_38%_29%)]">The owner has been notified. If they need to reach you, they’ll use the contact you left here.</p><Link href="/scan" data-testid="link-found-done" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--primary))]">Scan another item <ArrowRight size={16} /></Link></div> : <form onSubmit={submit} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[0_18px_50px_hsl(var(--primary)/.06)] sm:p-8"><h2 className="font-display text-2xl font-bold">Send a safe found note</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Your contact is only shared with the item owner through ReturnLoop.</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Your name" value={finder} setValue={setFinder} placeholder="Jordan Lee" test="input-finder-name" required /><Field label="Email or phone" value={contact} setValue={setContact} placeholder="How can they reach you?" test="input-finder-contact" required /><Field label="Where did you find it?" value={location} setValue={setFoundLocation} placeholder="West Library, level 2" test="input-found-location" required /><div><label className="mb-1.5 block text-xs font-bold">Date found</label><input value={date} onChange={(e) => setDate(e.target.value)} type="date" required data-testid="input-found-date" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div></div><div className="mt-4"><label className="mb-1.5 block text-xs font-bold">A note for the owner <span className="font-normal text-[hsl(var(--muted-foreground))]">optional</span></label><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="It’s safe with me. I left it at..." data-testid="input-found-message" className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div><Button type="submit" className="mt-5 w-full" data-testid="button-send-found-report"><Send size={16} /> Send note to the owner</Button></form>}</main></div>;
}
function Field({ label, value, setValue, placeholder, test, required }: { label: string; value: string; setValue: (value: string) => void; placeholder: string; test: string; required?: boolean }) { return <div><label className="mb-1.5 block text-xs font-bold">{label}</label><input value={value} onChange={(e) => setValue(e.target.value)} required={required} placeholder={placeholder} data-testid={test} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--secondary))]" /></div>; }

function AdminPage() {
  const { db, markReturned } = useStore();
  const [tab, setTab] = useState<'overview' | 'items' | 'students'>('overview');
  const reports = db.reports.filter((r) => r.status !== 'returned');
  const returned = db.items.filter((i) => i.status === 'returned').length;
  return <div className="min-h-[100dvh] bg-[hsl(var(--background))]"><header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.82)] px-5 py-4 backdrop-blur sm:px-8 lg:px-12"><div className="mx-auto flex max-w-[1280px] items-center justify-between"><div className="flex items-center gap-5"><Logo /><span className="hidden h-5 w-px bg-[hsl(var(--border))] sm:block" /><span className="hidden text-xs font-bold text-[hsl(var(--muted-foreground))] sm:block">Teacher console</span></div><div className="flex items-center gap-2"><Link href="/app" data-testid="link-admin-student-view" className="hidden rounded-lg px-3 py-2 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] sm:block">Student view</Link><span className="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--primary))] text-xs font-bold text-[hsl(var(--secondary))]">LO</span></div></div></header><main className="mx-auto max-w-[1280px] px-5 py-7 sm:px-8 md:py-10 lg:px-12"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><Pill tone="blue"><BookOpen size={13} /> Staff space</Pill><h1 className="mt-4 font-display text-4xl font-bold tracking-[-.05em]">Good morning, Lena.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">A clear view of the belongings moving through campus.</p></div><div className="flex rounded-xl bg-[hsl(var(--muted)/.7)] p-1">{(['overview', 'items', 'students'] as const).map((entry) => <button key={entry} onClick={() => setTab(entry)} data-testid={`button-admin-tab-${entry}`} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${tab === entry ? 'bg-[hsl(var(--card))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>{entry}</button>)}</div></div><div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4"><AdminStat label="Registered items" value={db.items.length.toString()} icon={Package} /><AdminStat label="Open found notes" value={reports.length.toString()} icon={Inbox} accent={reports.length > 0} /><AdminStat label="Returned this term" value={returned.toString()} icon={CheckCircle2} /><AdminStat label="Students protected" value={new Set(db.items.map((i) => i.owner_id)).size.toString()} icon={Users} /></div>{tab === 'overview' && <div className="mt-8 grid gap-7 lg:grid-cols-[1.35fr_.8fr]"><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Needs a handoff</p><h2 className="mt-2 font-display text-2xl font-bold">Open finder notes</h2></div><Pill tone="amber">{reports.length} open</Pill></div><div className="mt-5 space-y-3">{reports.length ? reports.map((report) => <ReportRow key={report.id} report={report} item={db.items.find((i) => i.id === report.item_id)} onReturn={() => markReturned(report.item_id)} />) : <EmptyState text="Every found item is back where it belongs." />}</div></section><section className="rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))]"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--secondary)/.18)] text-[hsl(var(--secondary))]"><HeartHandshake size={19} /></span><MoreHorizontal size={18} className="text-[hsl(var(--primary-foreground)/.45)]" /></div><h2 className="mt-10 font-display text-2xl font-bold">The return rate is a community metric.</h2><p className="mt-3 text-sm leading-6 text-[hsl(var(--primary-foreground)/.58)]">Each clear handoff makes the next one feel more natural.</p><div className="mt-8 flex items-end gap-3"><span className="font-display text-5xl font-bold text-[hsl(var(--secondary))]">86</span><span className="mb-2 text-xs text-[hsl(var(--primary-foreground)/.55)]">items returned<br />this semester</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[hsl(var(--primary-foreground)/.12)]"><div className="h-full w-[72%] rounded-full bg-[hsl(var(--secondary))]" /></div></section></div>}{tab === 'items' && <AdminItems items={db.items} profiles={db.profiles} onReturn={markReturned} />}{tab === 'students' && <AdminStudents profiles={db.profiles} items={db.items} />}</main></div>;
}
function AdminStat({ label, value, icon: Icon, accent = false }: { label: string; value: string; icon: typeof Package; accent?: boolean }) { return <div className={`rounded-2xl border p-4 ${accent ? 'border-[hsl(var(--accent)/.52)] bg-[hsl(var(--accent)/.1)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)]'}`}><div className="flex justify-between"><span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span><Icon size={16} className={accent ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--secondary))]'} /></div><p className="mt-3 font-display text-3xl font-bold">{value}</p></div>; }
function ReportRow({ report, item, onReturn }: { report: Report; item?: Item; onReturn: () => void }) { return <div className="rounded-xl border border-[hsl(var(--border))] p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--accent)/.2)] text-[hsl(var(--accent))]"><Inbox size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">{item?.item_name}</p><Pill tone="amber">New note</Pill></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Found by <span className="font-semibold text-[hsl(var(--foreground))]">{report.finder_name}</span> at {report.found_location}</p><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">“{report.message || 'No message left.'}”</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="soft" className="px-3 py-2 text-xs" onClick={onReturn} data-testid={`button-mark-returned-${report.id}`}><Check size={14} /> Mark returned</Button><Button variant="ghost" className="px-3 py-2 text-xs" onClick={() => navigator.clipboard?.writeText(report.finder_contact)} data-testid={`button-copy-contact-${report.id}`}><Copy size={14} /> Copy finder contact</Button></div></div></div></div>; }
function AdminItems({ items, profiles, onReturn }: { items: Item[]; profiles: Profile[]; onReturn: (id: string) => void }) { return <section className="mt-8 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div className="flex justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Campus inventory</p><h2 className="mt-2 font-display text-2xl font-bold">Every protected item</h2></div><Search size={18} className="text-[hsl(var(--muted-foreground))]" /></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-[hsl(var(--border))] text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]"><tr><th className="pb-3 font-bold">Item</th><th className="pb-3 font-bold">Owner</th><th className="pb-3 font-bold">Code</th><th className="pb-3 font-bold">Status</th><th className="pb-3 text-right font-bold">Action</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-[hsl(var(--border)/.65)] last:border-0" data-testid={`row-admin-item-${item.id}`}><td className="py-4 font-semibold">{item.item_name}<span className="mt-1 block text-xs font-normal text-[hsl(var(--muted-foreground))]">{item.category}</span></td><td className="py-4 text-xs">{profiles.find((p) => p.id === item.owner_id)?.full_name}</td><td className="py-4 font-mono-app text-xs text-[hsl(var(--muted-foreground))]">{item.qr_token}</td><td className="py-4"><Pill tone={item.status === 'returned' ? 'green' : item.status === 'reported' ? 'amber' : 'blue'}>{item.status}</Pill></td><td className="py-4 text-right">{item.status !== 'returned' && <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => onReturn(item.id)} data-testid={`button-admin-return-${item.id}`}><Check size={14} /> Return</Button>}</td></tr>)}</tbody></table></div></section>; }
function AdminStudents({ profiles, items }: { profiles: Profile[]; items: Item[] }) { return <section className="mt-8 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">People in the loop</p><h2 className="mt-2 font-display text-2xl font-bold">Students</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{profiles.filter((p) => p.role === 'student').map((profile) => <div key={profile.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] p-4" data-testid={`card-admin-student-${profile.id}`}><span className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--secondary)/.2)] text-xs font-bold text-[hsl(var(--primary))]">{profile.full_name.split(' ').map((n) => n[0]).join('')}</span><div className="flex-1"><p className="text-sm font-bold">{profile.full_name}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{profile.course_or_class} · {items.filter((i) => i.owner_id === profile.id).length} protected</p></div><BadgeCheck size={17} className="text-[hsl(var(--secondary))]" /></div>)}</div></section>; }

function ProfilePage() {
  const { profile, db } = useStore();
  const [privacy, setPrivacy] = useState(true);
  const [finderUpdates, setFinderUpdates] = useState(true);
  if (!profile) return <AccessGate />;
  return <DashboardShell active="profile"><div className="mx-auto max-w-[900px] px-5 py-7 sm:px-8 md:py-10 lg:px-12"><Pill tone="blue"><UserRound size={13} /> Your account</Pill><h1 className="mt-5 font-display text-4xl font-bold tracking-[-.05em]">Profile & privacy</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">You’re in control of what the loop keeps.</p><div className="mt-8 grid gap-6 lg:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><div className="flex items-center gap-4 border-b border-[hsl(var(--border))] pb-6"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-[hsl(var(--primary))] font-display text-xl font-bold text-[hsl(var(--secondary))]">{profile.full_name.split(' ').map((n) => n[0]).join('')}</span><div><h2 className="font-display text-2xl font-bold">{profile.full_name}</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{profile.student_id} · {profile.course_or_class}, section {profile.section}</p></div></div><div className="space-y-4 pt-6"><ProfileLine label="Campus email" value={profile.email} /><ProfileLine label="Items in your loop" value={db.items.filter((i) => i.owner_id === profile.id).length.toString()} /><ProfileLine label="Member since" value="September 2024" /></div></section><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5 sm:p-7"><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">Privacy controls</p><h2 className="mt-2 font-display text-2xl font-bold">Quiet by default.</h2><div className="mt-6 space-y-5"><Toggle label="Hide personal details" detail="Never show your identity on a public found page." value={privacy} setValue={setPrivacy} test="toggle-hide-details" /><Toggle label="Finder updates" detail="Let ReturnLoop notify you when a finder sends a note." value={finderUpdates} setValue={setFinderUpdates} test="toggle-finder-updates" /></div><div className="mt-7 flex gap-2 rounded-xl bg-[hsl(var(--secondary)/.1)] p-3 text-xs leading-5 text-[hsl(161_38%_29%)]"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> ReturnLoop codes only carry a random token. No profile data travels with a scan.</div></section></div></div></DashboardShell>;
}
function ProfileLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-4"><span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span><span className="text-right text-sm font-semibold">{value}</span></div>; }
function Toggle({ label, detail, value, setValue, test }: { label: string; detail: string; value: boolean; setValue: (value: boolean) => void; test: string }) { return <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{detail}</p></div><button onClick={() => setValue(!value)} aria-pressed={value} data-testid={test} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full p-1 transition ${value ? 'bg-[hsl(var(--secondary))]' : 'bg-[hsl(var(--muted))]'}`}><span className={`block h-4 w-4 rounded-full bg-[hsl(var(--card))] shadow-sm transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>; }

function NotFound() { return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] px-5 text-center"><div><span className="font-mono-app text-xs text-[hsl(var(--secondary))]">RETURNLOOP / 404</span><h1 className="mt-4 font-display text-5xl font-bold">This loop is empty.</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">There’s nothing here yet, but the campus is still looking out.</p><Link href="/" data-testid="link-404-home" className="mt-7 inline-flex items-center gap-2 font-bold text-[hsl(var(--primary))]">Return home <ArrowRight size={16} /></Link></div></div>; }

function Router() {
  return <ErrorBoundary><Switch><Route path="/" component={HomePage} /><Route path="/auth" component={AuthPage} /><Route path="/app/new" component={NewItemPage} /><Route path="/app" component={StudentDashboard} /><Route path="/scan" component={ScanPage} /><Route path="/found/:token" component={FoundPage} /><Route path="/admin" component={AdminPage} /><Route path="/profile" component={ProfilePage} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><StoreProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></StoreProvider></TooltipProvider></QueryClientProvider>;
}
export default App;