'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface StatusData {
  name: string;
  count: number;
}

interface StatusBarChartProps {
  data: StatusData[];
}

const STATUS_COLORS: Record<string, string> = {
  open: '#22c55e',
  waiting_customer: '#eab308',
  handoff: '#f59e0b',
  closed: '#6b7280',
  resolved: '#3b82f6',
  do_not_contact: '#ef4444',
  abandoned: '#ef4444',
  default: '#6b7280'
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Abertas',
  waiting_customer: 'Aguardando Cliente',
  handoff: 'Atendimento Humano',
  closed: 'Fechadas',
  resolved: 'Resolvidas',
  do_not_contact: 'Não Contactar',
  abandoned: 'Abandonadas'
};

export function StatusBarChart({ data }: StatusBarChartProps) {
  const formattedData = data.map(item => ({
    ...item,
    displayName: STATUS_LABELS[item.name] || item.name,
    fill: STATUS_COLORS[item.name] || STATUS_COLORS.default
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={formattedData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="displayName" 
          tick={{ fontSize: 12 }}
        />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#fff', 
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
        />
        <Bar 
          dataKey="count" 
          fill="#8884d8"
          radius={[8, 8, 0, 0]}
        >
          {formattedData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
