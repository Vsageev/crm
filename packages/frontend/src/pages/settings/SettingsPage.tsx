import { useState } from 'react';
import { Key, HardDrive } from 'lucide-react';
import { PageHeader } from '../../layout';
import { ApiKeysTab } from './ApiKeysTab';
import { BackupsTab } from './BackupsTab';
import styles from './SettingsPage.module.css';

type SettingsTab = 'api-keys' | 'backups';

const TABS: { key: SettingsTab; label: string; icon: typeof Key }[] = [
  { key: 'api-keys', label: 'API Keys', icon: Key },
  { key: 'backups', label: 'Backups', icon: HardDrive },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('api-keys');

  return (
    <div className={styles.page}>
      <PageHeader title="Settings" description="Configure your integrations and preferences" />

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

      {activeTab === 'api-keys' && <ApiKeysTab />}
      {activeTab === 'backups' && <BackupsTab />}
    </div>
  );
}
