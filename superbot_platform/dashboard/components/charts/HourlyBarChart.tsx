'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface HourlyData {
  hour: number;
  count: number;
}

interface HourlyBarChartProps {
  data: HourlyData[];
}

export function HourlyBarChart({ data }: HourlyBarChartProps) {
  const formattedData = data.map(item => ({
    ...item,
    hourLabel: `${item.hour}h`
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={formattedData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="hourLabel" 
          tick={{ fontSize: 11 }}
        />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#fff', 
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
          labelFormatter={(value) => `Hora: ${value}`}
        />
        <Bar 
          dataKey="count" 
          fill="#3b82f6"
          radius={[8, 8, 0, 0]}
          name="Conversas"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
