import { useState } from 'react';
import { Bot, MessageSquareText, Bell, Send, Workflow, FileText, Mail, MessageCircle, Phone, Instagram, Brain } from 'lucide-react';
import { PageHeader } from '../../layout';
import { TelegramBotsTab } from './TelegramBotsTab';
import { TemplatesTab } from './TemplatesTab';
import { TelegramTemplatesTab } from './TelegramTemplatesTab';
import { NotificationsTab } from './NotificationsTab';
import { ChatbotFlowsTab } from './ChatbotFlowsTab';
import { WebFormsTab } from './WebFormsTab';
import { WebChatTab } from './WebChatTab';
import { EmailAccountsTab } from './EmailAccountsTab';
import { WhatsAppTab } from './WhatsAppTab';
import { InstagramAccountsTab } from './InstagramAccountsTab';
import { NovofonTab } from './NovofonTab';
import { VoximplantTab } from './VoximplantTab';
import { AIKnowledgeBaseTab } from './AIKnowledgeBaseTab';
import styles from './SettingsPage.module.css';

type SettingsTab = 'bots' | 'email' | 'whatsapp' | 'instagram' | 'novofon' | 'voximplant' | 'web-chat' | 'templates' | 'telegram-templates' | 'chatbot-flows' | 'notifications' | 'web-forms' | 'ai';

const TABS: { key: SettingsTab; label: string; icon: typeof Bot }[] = [
  { key: 'bots', label: 'Telegram Bots', icon: Bot },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: Phone },
  { key: 'instagram', label: 'Instagram', icon: Instagram },
  { key: 'novofon', label: 'Novofon VoIP', icon: Phone },
  { key: 'voximplant', label: 'Voximplant VoIP', icon: Phone },
  { key: 'web-chat', label: 'Web Chat', icon: MessageCircle },
  { key: 'templates', label: 'Quick Replies', icon: MessageSquareText },
  { key: 'telegram-templates', label: 'Telegram Templates', icon: Send },
  { key: 'chatbot-flows', label: 'Chatbot Flows', icon: Workflow },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'web-forms', label: 'Web Forms', icon: FileText },
  { key: 'ai', label: 'AI Knowledge Base', icon: Brain },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('bots');

  return (
    <div className={styles.page}>
      <PageHeader title="Settings" description="Configure your CRM integrations and preferences" />

      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={[styles.tab, activeTab === tab.key && styles.tabActive]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setActiveTab(tab.key)}
          >
            <tab.icon size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'bots' && <TelegramBotsTab />}
      {activeTab === 'email' && <EmailAccountsTab />}
      {activeTab === 'whatsapp' && <WhatsAppTab />}
      {activeTab === 'instagram' && <InstagramAccountsTab />}
      {activeTab === 'novofon' && <NovofonTab />}
      {activeTab === 'voximplant' && <VoximplantTab />}
      {activeTab === 'web-chat' && <WebChatTab />}
      {activeTab === 'templates' && <TemplatesTab />}
      {activeTab === 'telegram-templates' && <TelegramTemplatesTab />}
      {activeTab === 'chatbot-flows' && <ChatbotFlowsTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'web-forms' && <WebFormsTab />}
      {activeTab === 'ai' && <AIKnowledgeBaseTab />}
    </div>
  );
}
