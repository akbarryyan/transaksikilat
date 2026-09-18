"use client";

import { useState, useEffect } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface RevenueData {
  label: string;
  walletRaw: number;
  gatewayRaw: number;
}

/**
 * Categorical slots 1 and 2, assigned in fixed order and validated for
 * colour-vision separation against a white surface. Marks carry these; every
 * piece of text stays on a slate token.
 */
const SERIES = [
  { key: "walletRaw" as const, name: "Wallet", color: "#2a78d6" },
  { key: "gatewayRaw" as const, name: "Gateway", color: "#eb6834" },
];

const AXIS_INK = "#94a3b8";
const GRID_INK = "#f1f5f9";

function formatRpShort(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}rb`;
  return String(n);
}

function formatRpFull(n: number) {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg bg-slate-800 px-3 py-2 text-[11px] text-white shadow-lg">
      <p className="mb-1 font-semibold text-slate-200">{label}</p>
      {SERIES.map((series) => {
        const entry = payload.find((p) => p.dataKey === series.key);
        return (
          <p key={series.key} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            <span className="text-slate-300">{series.name}</span>
            <span className="ml-auto pl-3 font-semibold">
              {formatRpFull(entry?.value ?? 0)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export default function RevenueChart() {
  const [data, setData] = useState<RevenueData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/dashboard");
        const json = await res.json();
        if (json.success) setData(json.data.revenue);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const hasRevenue = data.some((d) => d.walletRaw > 0 || d.gatewayRaw > 0);

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Analitik Pendapatan</p>
          <p className="text-xs text-slate-400">
            Pembayaran Wallet vs Payment Gateway, 5 bulan terakhir
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {SERIES.map((series) => (
            <span key={series.key} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: series.color }}
              />
              {series.name}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 h-64 sm:mt-8">
        {loading ? (
          <div className="h-full w-full animate-pulse rounded-xl bg-slate-100" />
        ) : !hasRevenue ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-slate-500">Belum ada pendapatan</p>
            <p className="mt-1 text-xs text-slate-400">
              Grafik muncul setelah ada transaksi sukses.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barGap={2}>
              <CartesianGrid stroke={GRID_INK} vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: AXIS_INK, fontSize: 11 }}
                dy={6}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: AXIS_INK, fontSize: 11 }}
                tickFormatter={formatRpShort}
                width={48}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "#0f172a", fillOpacity: 0.04 }}
              />
              {SERIES.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.name}
                  fill={series.color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
