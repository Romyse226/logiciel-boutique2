import { useCallback, useEffect, useState } from 'react';
import type { Employee, EmployeeStatus } from '@/types';
import { listEmployees, createEmployee, updateEmployee, regenerateInvite, type Actor } from '@/lib/supabase';
import { userMessage } from '@/lib/errors';
import { classNames, normalizeCIphone } from '@/lib/format';
import { usePullToRefresh, PullToRefreshBar } from '@/lib/usePullToRefresh';
import { SkeletonRow } from '@/components/Skeleton';
import {
  ChevronLeft, Plus, X, Loader2, MessageCircle, Check,
  ShieldCheck, ShieldOff, Ban, RotateCcw, Phone, UserPlus,
} from 'lucide-react';

const STATUS_META: Record<EmployeeStatus, { label: string; className: string }> = {
  invited: { label: 'Invitation en attente', className: 'bg-yellow-100 text-yellow-800' },
  active: { label: 'Actif', className: 'bg-green-100 text-green-800' },
  suspended: { label: 'Accès suspendu', className: 'bg-red-100 text-red-800' },
};

function inviteLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}?invite=${token}`;
}

function whatsappUrl(employee: Pick<Employee, 'name' | 'phone' | 'access_token'>): string {
  const text = encodeURIComponent(
    `Bonjour ${employee.name} ! Voici ton accès à la quincaillerie. Ouvre ce lien pour commencer : ${inviteLink(employee.access_token)}`,
  );
  const phone = employee.phone ? normalizeCIphone(employee.phone) : null;
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
}

interface Props {
  actor: Actor;
  onBack: () => void;
  onNotify: (message: string) => void;
}

export function EmployeesPage({ actor, onBack, onNotify }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [canAdd, setCanAdd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await listEmployees(actor);
      if (!res.ok) { setError(userMessage(res.error)); setEmployees([]); return; }
      setEmployees(res.employees);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [actor]);

  useEffect(() => { load(); }, [load]);

  // Actualisation par glissement du haut vers le bas (plus de bouton « Actualiser »).
  const pull = usePullToRefresh(load);

  async function patch(id: string, changes: { status?: EmployeeStatus; canEditCatalog?: boolean; canAddProducts?: boolean }) {
    setBusyId(id);
    const res = await updateEmployee(actor, id, changes);
    setBusyId(null);
    if (!res.ok) { onNotify(userMessage(res.error)); return; }
    setEmployees((prev) => prev.map((e) => (e.id === id && res.employee ? res.employee : e)));
  }

  async function reinvite(id: string) {
    setBusyId(id);
    const res = await regenerateInvite(actor, id);
    setBusyId(null);
    if (!res.ok || !res.employee) { onNotify(userMessage(res.error)); return; }
    setEmployees((prev) => prev.map((e) => (e.id === id ? res.employee! : e)));
    onNotify('Nouveau lien d’invitation prêt.');
  }

  async function handleCreate() {
    if (creating) return;
    if (!name.trim()) { setAddError('Le nom de l’employé est requis.'); return; }
    setCreating(true); setAddError(null);
    const res = await createEmployee(actor, {
      name: name.trim(),
      phone: phone.trim() || null,
      canEditCatalog: canEdit,
      canAddProducts: canAdd,
    });
    setCreating(false);
    if (!res.ok || !res.employee) { setAddError(userMessage(res.error)); return; }
    setJustCreated(res.employee);
    setEmployees((prev) => [...prev, res.employee!]);
  }

  function closeAdd() {
    setAddOpen(false);
    setJustCreated(null);
    setName(''); setPhone(''); setCanEdit(false); setCanAdd(false); setAddError(null);
  }

  return (
    <div className="space-y-4 pb-16">
      <PullToRefreshBar distance={pull.distance} refreshing={pull.refreshing} />

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-white px-2.5 py-2 text-sm font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          <ChevronLeft size={20} /> Retour
        </button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold text-slate-800">Employés</h1>
      </div>

      <button
        type="button"
        onClick={() => { setAddOpen(true); setJustCreated(null); }}
        className="fixed bottom-24 left-4 right-4 z-20 mx-auto flex max-w-md items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3.5 text-base font-extrabold text-white shadow-xl shadow-orange-500/30 transition hover:bg-orange-600 active:scale-[0.99]"
      >
        <Plus size={20} /> Ajouter un employé
      </button>

      {error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}

      {loading ? (
        <ul className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <li key={i}><SkeletonRow /></li>)}
        </ul>
      ) : employees.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-slate-500 ring-1 ring-slate-100">
          <UserPlus className="mx-auto mb-2 text-slate-300" size={32} />
          Aucun employé pour le moment.
        </div>
      ) : (
        <ul className="space-y-3">
          {employees.map((e) => {
            const badge = STATUS_META[e.status];
            const busy = busyId === e.id;
            return (
              <li key={e.id} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    <UserPlus size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-extrabold text-slate-800">{e.name}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                      <Phone size={12} /> {e.phone ?? 'Numéro non renseigné'}
                    </p>
                    <span className={classNames('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold', badge.className)}>
                      {badge.label}
                    </span>
                  </div>
                  {busy && <Loader2 className="animate-spin text-slate-400" size={18} />}
                </div>

                {/* Toggles de permission */}
                <div className="space-y-2">
                  <Toggle
                    checked={e.can_edit_catalog}
                    disabled={busy}
                    onChange={(v) => patch(e.id, { canEditCatalog: v })}
                    label="Autoriser à modifier les informations du stock"
                    icon={ShieldCheck}
                    color="text-blue-600"
                  />
                  <Toggle
                    checked={e.can_add_products}
                    disabled={busy}
                    onChange={(v) => patch(e.id, { canAddProducts: v })}
                    label="Autoriser à ajouter de nouveaux produits"
                    icon={ShieldCheck}
                    color="text-orange-600"
                  />
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={whatsappUrl(e)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-[#1e9e4f] px-3 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
                  >
                    <MessageCircle size={16} /> Inviter WhatsApp
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => reinvite(e.id)}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
                  >
                    <RotateCcw size={16} /> Renvoyer l’invitation
                  </button>
                  {e.status === 'suspended' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patch(e.id, { status: 'active' })}
                      className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-green-50 px-3 py-2.5 text-sm font-bold text-green-700 ring-1 ring-green-200 disabled:opacity-50"
                    >
                      <Check size={16} /> Réactiver l’accès
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patch(e.id, { status: 'suspended' })}
                      className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700 ring-1 ring-red-200 disabled:opacity-50"
                    >
                      <Ban size={16} /> Suspendre l’accès
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Suspendre révoque l’accès sans supprimer l’historique des opérations.
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Formulaire d'ajout / invitation */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={creating ? undefined : closeAdd} aria-hidden />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-base font-extrabold text-slate-800">
                {justCreated ? 'Invitation prête' : 'Nouvel employé'}
              </h2>
              <button type="button" onClick={closeAdd} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fermer">
                <X size={20} />
              </button>
            </div>

            {justCreated ? (
              <div className="space-y-4 px-4 py-4">
                <p className="text-sm text-slate-600">
                  Envoie le lien d’accès à <span className="font-bold">{justCreated.name}</span> sur WhatsApp.
                  Le lien reste valable jusqu’à ce que tu le renouvelles.
                </p>
                <a
                  href={whatsappUrl(justCreated)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1e9e4f] px-4 py-3.5 text-base font-bold text-white active:scale-[0.99]"
                >
                  <MessageCircle size={20} /> Inviter sur WhatsApp
                </a>
                <button type="button" onClick={closeAdd} className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-base font-bold text-slate-700">
                  Terminer
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom</span>
                    <input
                      value={name}
                      onChange={(ev) => setName(ev.target.value)}
                      placeholder="Ex : Ali"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Numéro de téléphone</span>
                    <input
                      value={phone}
                      onChange={(ev) => setPhone(ev.target.value)}
                      inputMode="tel"
                      placeholder="Ex : 07 00 00 00 00"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                    />
                  </label>
                  <div className="space-y-2">
                    <Toggle checked={canEdit} onChange={setCanEdit} label="Autoriser à modifier les informations du stock" icon={ShieldCheck} color="text-blue-600" />
                    <Toggle checked={canAdd} onChange={setCanAdd} label="Autoriser à ajouter de nouveaux produits" icon={ShieldCheck} color="text-orange-600" />
                  </div>
                  {addError && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{addError}</p>}
                </div>
                <div className="border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                  <button
                    type="button"
                    disabled={creating}
                    onClick={handleCreate}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow disabled:opacity-50"
                  >
                    {creating ? <><Loader2 size={20} className="animate-spin" /> Création…</> : <><Plus size={20} /> Créer l’employé</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled, icon: Icon, color }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
  icon: typeof ShieldCheck; color: string;
}) {
  if (disabled) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-400">
        {checked ? <Icon size={16} className={color} /> : <ShieldOff size={16} />}
        {label}
      </div>
    );
  }
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} onChange={(ev) => onChange(ev.target.checked)} className="h-4 w-4" />
      {checked ? <Icon size={16} className={color} /> : <ShieldOff size={16} className="text-slate-400" />}
      {label}
    </label>
  );
}
