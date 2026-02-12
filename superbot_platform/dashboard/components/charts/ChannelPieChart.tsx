'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ChannelData {
  name: string;
  count: number;
  percentage: number;
}

interface ChannelPieChartProps {
  data: ChannelData[];
}

const COLORS: Record<string, string> = {
  whatsapp: '#10b981',
  instagram: '#ec4899',
  messenger: '#3b82f6',
  default: '#6b7280'
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger'
};

export function ChannelPieChart({ data }: ChannelPieChartProps) {
  const formattedData = data.map(item => ({
    ...item,
    displayName: CHANNEL_LABELS[item.name] || item.name
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={formattedData}
          dataKey="count"
          nameKey="displayName"
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, percent }) => `${name}: ${Math.round((percent || 0) * 100)}%`}
          labelLine={false}
        >
          {formattedData.map((entry, index) => (
            <Cell 
              key={`cell-${index}`} 
              fill={COLORS[entry.name] || COLORS.default} 
            />
          ))}
        </Pie>
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#fff', 
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
