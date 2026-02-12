'use client';

import { useRouter } from 'next/navigation';
import {
  Settings, Activity, Phone, Instagram, MessageCircle,
  FileText, TestTube, BarChart3, Users, MessageSquare, Clock
} from 'lucide-react';

export default function ConfigIndexPage() {
  const router = useRouter();

  const configSections = [
    {
      title: 'Configuração Meta',
      description: 'Wizard de conexão WhatsApp, Messenger e Instagram',
      icon: Settings,
      href: '/dash/config/meta',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-600'
    },
    {
      title: 'Status de Conexão',
      description: 'Verificar status das conexões Meta',
      icon: Activity,
      href: '/dash/config/status',
      bgColor: 'bg-green-100',
      textColor: 'text-green-600'
    },
    {
      title: 'Follow-up',
      description: 'Templates e regras de follow-up automatico',
      icon: Clock,
      href: '/dash/config/followup',
      bgColor: 'bg-amber-100',
      textColor: 'text-amber-600'
    }
  ];

  const quickLinks = [
    {
      title: 'Analytics',
      description: 'Dashboard e métricas',
      icon: BarChart3,
      href: '/dash',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-600'
    },
    {
      title: 'Conversas',
      description: 'Visualizar conversas',
      icon: MessageSquare,
      href: '/dash/conversations',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-600'
    },
    {
      title: 'Agents ElevenLabs',
      description: 'Gerenciar agents de voz',
      icon: Users,
      href: '/dash/agents',
      bgColor: 'bg-pink-100',
      textColor: 'text-pink-600'
    }
  ];

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configuracoes</h1>
        <p className="text-sm text-gray-500 mt-1">Gerencie conexoes e configuracoes do SuperBot</p>
      </div>

      <div>
        {/* Config Sections */}
        <div className="mb-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Configuracoes do Bot
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {configSections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.href}
                  onClick={() => router.push(section.href)}
                  className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition text-left"
                >
                  <div className={`w-12 h-12 rounded-lg ${section.bgColor} flex items-center justify-center mb-4`}>
                    <Icon className={`w-6 h-6 ${section.textColor}`} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {section.title}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {section.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Acesso Rápido
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <button
                  key={link.href}
                  onClick={() => router.push(link.href)}
                  className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition text-left"
                >
                  <div className={`w-10 h-10 rounded-lg ${link.bgColor} flex items-center justify-center mb-3`}>
                    <Icon className={`w-5 h-5 ${link.textColor}`} />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">
                    {link.title}
                  </h3>
                  <p className="text-xs text-gray-600">
                    {link.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-12 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">
            📚 Documentação
          </h3>
          <p className="text-sm text-blue-800 mb-3">
            Para mais informações sobre configuração, consulte os guias em:
          </p>
          <code className="text-xs text-blue-900 bg-blue-100 px-2 py-1 rounded">
            superbot_configuracoes/GUIA_CONEXAO_NOVOS_CLIENTES.md
          </code>
        </div>
      </div>
    </div>
  );
}
