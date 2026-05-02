import { useState } from 'react';
import styles from './Sidebar.module.css';
import AboutTab from './tabs/AboutTab';
import PastRecsTab from './tabs/PastRecsTab';
import ConstitutionTab from './tabs/ConstitutionTab';

type TabId = 'about' | 'pastrecs' | 'constitution';

const TABS: { id: TabId; label: string }[] = [
  { id: 'about', label: 'אודות' },
  { id: 'pastrecs', label: 'המלצות עבר' },
  { id: 'constitution', label: 'תקנון' },
];

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<TabId>('about');

  return (
    <aside className={styles.sidebar}>
      <div className={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeTab === 'about' && <AboutTab />}
        {activeTab === 'pastrecs' && <PastRecsTab />}
        {activeTab === 'constitution' && <ConstitutionTab />}
      </div>
    </aside>
  );
}
