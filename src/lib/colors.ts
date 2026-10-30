import type { CategoryColor } from '@/types';

interface ColorSet {
  bg: string;
  bgSoft: string;
  text: string;
  textStrong: string;
  border: string;
  ring: string;
  gradient: string;
  chipBg: string;
  chipText: string;
}

export const CATEGORY_COLORS: Record<CategoryColor, ColorSet> = {
  orange: {
    bg: 'bg-orange-500', bgSoft: 'bg-orange-50', text: 'text-orange-700',
    textStrong: 'text-orange-800', border: 'border-orange-200', ring: 'ring-orange-300',
    gradient: 'from-orange-400 to-orange-600',
    chipBg: 'bg-orange-100', chipText: 'text-orange-700',
  },
  blue: {
    bg: 'bg-blue-500', bgSoft: 'bg-blue-50', text: 'text-blue-700',
    textStrong: 'text-blue-800', border: 'border-blue-200', ring: 'ring-blue-300',
    gradient: 'from-blue-400 to-blue-600',
    chipBg: 'bg-blue-100', chipText: 'text-blue-700',
  },
  yellow: {
    bg: 'bg-yellow-400', bgSoft: 'bg-yellow-50', text: 'text-yellow-700',
    textStrong: 'text-yellow-800', border: 'border-yellow-200', ring: 'ring-yellow-300',
    gradient: 'from-yellow-400 to-amber-500',
    chipBg: 'bg-yellow-100', chipText: 'text-yellow-800',
  },
  violet: {
    bg: 'bg-violet-500', bgSoft: 'bg-violet-50', text: 'text-violet-700',
    textStrong: 'text-violet-800', border: 'border-violet-200', ring: 'ring-violet-300',
    gradient: 'from-violet-400 to-violet-600',
    chipBg: 'bg-violet-100', chipText: 'text-violet-700',
  },
  turquoise: {
    bg: 'bg-teal-500', bgSoft: 'bg-teal-50', text: 'text-teal-700',
    textStrong: 'text-teal-800', border: 'border-teal-200', ring: 'ring-teal-300',
    gradient: 'from-teal-400 to-teal-600',
    chipBg: 'bg-teal-100', chipText: 'text-teal-700',
  },
  red: {
    bg: 'bg-red-500', bgSoft: 'bg-red-50', text: 'text-red-700',
    textStrong: 'text-red-800', border: 'border-red-200', ring: 'ring-red-300',
    gradient: 'from-red-400 to-red-600',
    chipBg: 'bg-red-100', chipText: 'text-red-700',
  },
  slate: {
    bg: 'bg-slate-600', bgSoft: 'bg-slate-50', text: 'text-slate-700',
    textStrong: 'text-slate-800', border: 'border-slate-200', ring: 'ring-slate-300',
    gradient: 'from-slate-500 to-slate-700',
    chipBg: 'bg-slate-100', chipText: 'text-slate-700',
  },
  cyan: {
    bg: 'bg-cyan-500', bgSoft: 'bg-cyan-50', text: 'text-cyan-700',
    textStrong: 'text-cyan-800', border: 'border-cyan-200', ring: 'ring-cyan-300',
    gradient: 'from-cyan-400 to-cyan-600',
    chipBg: 'bg-cyan-100', chipText: 'text-cyan-700',
  },
  amber: {
    bg: 'bg-amber-500', bgSoft: 'bg-amber-50', text: 'text-amber-700',
    textStrong: 'text-amber-800', border: 'border-amber-200', ring: 'ring-amber-300',
    gradient: 'from-amber-400 to-amber-600',
    chipBg: 'bg-amber-100', chipText: 'text-amber-700',
  },
  green: {
    bg: 'bg-green-500', bgSoft: 'bg-green-50', text: 'text-green-700',
    textStrong: 'text-green-800', border: 'border-green-200', ring: 'ring-green-300',
    gradient: 'from-green-400 to-green-600',
    chipBg: 'bg-green-100', chipText: 'text-green-700',
  },
};

export function colorOf(c: CategoryColor | string | undefined): ColorSet {
  return CATEGORY_COLORS[(c as CategoryColor) ?? 'blue'] ?? CATEGORY_COLORS.blue;
}
