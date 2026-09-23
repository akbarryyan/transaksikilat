"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/components/admin/Sidebar";
import Header from "@/components/admin/Header";
import { ToastContainer } from "@/components/ui/Toast";
import { useToast } from "@/hooks/useToast";

interface WithdrawalRequest {
  id: string;
  amount: number;
  status: string;
  bankCode: string | null;
  accountName: string;
  accountNumber: string;
  bankName: string;
  note: string | null;
  payoutGateway: string | null;
  payoutRefId: string | null;
  processedNote: string | null;
  processedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    sellerProfile: { slug: string; displayName: string } | null;
  } | null;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Menunggu Persetujuan", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED: { label: "Payout Diproses", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  PAID: { label: "Dibayar", cls: "bg-green-50 text-green-700 border-green-200" },
  REJECTED: { label: "Ditolak", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

const FILTERS = [
  { key: "PENDING", label: "Menunggu" },
  { key: "APPROVED", label: "Diproses" },
  { key: "PAID", label: "Dibayar" },
  { key: "REJECTED", label: "Ditolak" },
  { key: "ALL", label: "Semua" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function rupiah(value: number) {
  return `Rp ${new Intl.NumberFormat("id-ID").format(value)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function merchantLabel(item: WithdrawalRequest) {
  return (
    item.user?.sellerProfile?.displayName ||
    item.user?.name ||
    item.user?.email ||
    item.user?.phone ||
    "Merchant"
  );
}

export default function AdminSellerWithdrawalsPage() {
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [items, setItems] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("PENDING");

  /** Which request is showing its confirm step, and for which action. */
  const [confirming, setConfirming] = useState<{ id: string; action: "APPROVE" | "REJECT" } | null>(null);
  const [bankCodeOverride, setBankCodeOverride] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/seller-withdrawals", { cache: "no-store" });
      const data = await res.json();
      if (data.success) setItems(data.data);
      else toast.error(data.error ?? "Gagal memuat daftar withdraw.");
    } catch {
      toast.error("Gagal memuat daftar withdraw.");
    } finally {
      setLoading(false);
    }
    // toast helpers are stable callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function closeConfirm() {
    setConfirming(null);
    setBankCodeOverride("");
    setRejectNote("");
  }

  async function submitDecision(item: WithdrawalRequest, status: "APPROVED" | "REJECTED") {
    setSubmitting(item.id);
    try {
      const res = await fetch(`/api/admin/seller-withdrawals/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(status === "APPROVED" && bankCodeOverride.trim()
            ? { bankCode: bankCodeOverride.trim() }
            : {}),
          ...(status === "REJECTED" && rejectNote.trim()
            ? { processedNote: rejectNote.trim() }
            : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error ?? "Gagal memproses withdraw.");
        return;
      }
      toast.success(
        status === "APPROVED"
          ? `Payout ${rupiah(item.amount)} dikirim ke ${item.bankName} ${item.accountNumber}.`
          : `Withdraw ditolak. ${rupiah(item.amount)} dikembalikan ke saldo merchant.`
      );
      closeConfirm();
      await load();
    } catch {
      toast.error("Gagal memproses withdraw.");
    } finally {
      setSubmitting(null);
    }
  }

  const filtered =
    filter === "ALL"
      ? items
      : filter === "REJECTED"
      ? items.filter((i) => i.status === "REJECTED" || i.status === "CANCELLED")
      : items.filter((i) => i.status === filter);

  const pendingCount = items.filter((i) => i.status === "PENDING").length;

  function counts(key: FilterKey) {
    if (key === "ALL") return items.length;
    if (key === "REJECTED") {
      return items.filter((i) => i.status === "REJECTED" || i.status === "CANCELLED").length;
    }
    return items.filter((i) => i.status === key).length;
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:gap-6">
          <Header onMenuClick={() => setSidebarOpen(true)} />

          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-slate-800">💸 Withdraw Merchant</h1>
              <p className="mt-0.5 text-xs text-slate-400">
                Payout pertama setiap merchant ditahan di sini sampai kamu menyetujuinya.
                Sesudah satu payout disetujui, request berikutnya dari merchant itu berjalan otomatis.
              </p>
            </div>
            <button
              onClick={load}
              className="flex-shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100"
            >
              Muat ulang
            </button>
          </div>

          {pendingCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <span className="text-base">⏳</span>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Ada <strong>{pendingCount}</strong> request menunggu persetujuan. Saldo merchant
                sudah ditahan, jadi menyetujui akan langsung mengirim uang ke rekening tujuan —
                periksa nomor rekening dan nama penerimanya dulu.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  setFilter(key);
                  closeConfirm();
                }}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  filter === key
                    ? "bg-[#003D99] text-white"
                    : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
                }`}
              >
                {label} ({counts(key)})
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse rounded-2xl bg-white p-4">
                  <div className="mb-2 h-4 w-48 rounded bg-slate-200" />
                  <div className="mb-2 h-3 w-64 rounded bg-slate-100" />
                  <div className="h-3 w-32 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm text-slate-400">Tidak ada request withdraw di kategori ini.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((item) => {
                const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.PENDING;
                const isConfirming = confirming?.id === item.id;
                const busy = submitting === item.id;

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-slate-800">
                          {merchantLabel(item)}
                        </h3>
                        <p className="truncate text-[11px] text-slate-400">
                          {item.user?.email ?? item.user?.phone ?? "—"}
                        </p>
                      </div>
                      <span
                        className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <p className="mb-2 text-lg font-black text-slate-800">{rupiah(item.amount)}</p>

                    <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Rekening tujuan
                      </p>
                      <p className="text-xs font-semibold text-slate-700">
                        {item.bankName}
                        {item.bankCode ? ` (${item.bankCode})` : ""}
                      </p>
                      <p className="font-mono text-sm font-bold text-slate-800">
                        {item.accountNumber}
                      </p>
                      <p className="text-xs text-slate-600">a.n. {item.accountName}</p>
                    </div>

                    {item.note && (
                      <p className="mb-2 text-[11px] text-slate-500">
                        Catatan merchant: {item.note}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                      <span>Diajukan {formatDate(item.createdAt)}</span>
                      {item.payoutRefId && (
                        <>
                          <span>·</span>
                          <span className="font-mono">ref {item.payoutRefId}</span>
                        </>
                      )}
                      {item.processedAt && (
                        <>
                          <span>·</span>
                          <span>Diproses {formatDate(item.processedAt)}</span>
                        </>
                      )}
                    </div>

                    {item.processedNote && (
                      <p className="mt-1.5 text-[11px] text-slate-500">{item.processedNote}</p>
                    )}

                    {item.status === "PENDING" && !isConfirming && (
                      <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                        <button
                          onClick={() => {
                            closeConfirm();
                            setConfirming({ id: item.id, action: "APPROVE" });
                          }}
                          className="rounded-xl bg-[#003D99] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#002d73]"
                        >
                          Setujui &amp; kirim payout
                        </button>
                        <button
                          onClick={() => {
                            closeConfirm();
                            setConfirming({ id: item.id, action: "REJECT" });
                          }}
                          className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-100"
                        >
                          Tolak
                        </button>
                      </div>
                    )}

                    {/* Approving moves real money, so the destination is repeated
                        here and the action needs a second, deliberate click. */}
                    {isConfirming && confirming.action === "APPROVE" && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="mb-2 text-xs font-bold text-amber-900">
                          Kirim {rupiah(item.amount)} ke {item.bankName} {item.accountNumber} a.n.{" "}
                          {item.accountName}?
                        </p>
                        <p className="mb-2.5 text-[11px] leading-relaxed text-amber-800">
                          Uang langsung dikirim ke gateway dan tidak bisa ditarik kembali dari sini.
                        </p>
                        <input
                          value={bankCodeOverride}
                          onChange={(e) => setBankCodeOverride(e.target.value)}
                          placeholder="Kode bank (opsional — isi kalau resolusi otomatis gagal)"
                          className="mb-2.5 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-amber-400"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={busy}
                            onClick={() => submitDecision(item, "APPROVED")}
                            className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-50"
                          >
                            {busy ? "Mengirim…" : "Ya, kirim payout"}
                          </button>
                          <button
                            disabled={busy}
                            onClick={closeConfirm}
                            className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}

                    {isConfirming && confirming.action === "REJECT" && (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="mb-2 text-xs font-bold text-slate-700">
                          Tolak withdraw ini? {rupiah(item.amount)} dikembalikan ke saldo merchant.
                        </p>
                        <input
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          placeholder="Alasan penolakan (opsional, terlihat oleh merchant)"
                          className="mb-2.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-slate-400"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={busy}
                            onClick={() => submitDecision(item, "REJECTED")}
                            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
                          >
                            {busy ? "Memproses…" : "Ya, tolak"}
                          </button>
                          <button
                            disabled={busy}
                            onClick={closeConfirm}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
