export function formatFCFA(n: number): string {
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const intPart = Math.trunc(rounded);
  const dec = rounded - intPart;
  const grouped = intPart.toLocaleString('fr-FR');
  if (dec > 0) {
    const decStr = dec.toFixed(2).slice(2);
    return `${grouped},${decStr} F`;
  }
  return `${grouped} F`;
}

export function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function normalizeCIphone(input: string): string | null {
  if (!input) return null;
  let digits = input.replace(/\D+/g, '');
  if (digits.length === 0) return null;
  if (digits.startsWith('225')) digits = digits.slice(3);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return '225' + digits;
}

export function vibrate(pattern: number | number[] = 30): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch { /* ignore */ }
}

let audioCtx: AudioContext | null = null;
export function playBeep(ok = true): void {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctx();
    }
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch { /* ignore */ }
}

export function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}
