import React from 'react';
import { Cast, Globe, Lock, Settings, Tv } from 'lucide-react';
import { SelfInfo } from '../types/mycast';

export type NavTab = 'cast' | 'receiver' | 'web' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  selfInfo: SelfInfo | null;
  peerCount: number;
  webReceiverCount: number;
  isCasting: boolean;
  isReceiving: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  selfInfo,
  peerCount,
  webReceiverCount,
  isCasting,
  isReceiving,
}) => {
  const statusLabel = isReceiving
    ? 'Receiving Cast'
    : isCasting
      ? 'Casting Screen'
      : 'Receiver Ready';

  return (
    <aside className="sidebar">
      <div className="brand-header">
        <div className="brand-icon">
          <Cast size={20} />
        </div>
        <div>
          <div className="brand-title">MyCast</div>
          <div className="brand-subtitle">LAN Screen &amp; Audio</div>
        </div>
      </div>

      <nav className="nav-list">
        <button
          className={`nav-item ${activeTab === 'cast' ? 'active' : ''}`}
          onClick={() => onSelectTab('cast')}
        >
          <Cast size={17} />
          <span>Cast Screen</span>
          {peerCount > 0 && <span className="nav-badge">{peerCount}</span>}
        </button>

        <button
          className={`nav-item ${activeTab === 'receiver' ? 'active' : ''}`}
          onClick={() => onSelectTab('receiver')}
        >
          <Tv size={17} />
          <span>Ambient Receiver</span>
          {isReceiving && <span className="nav-badge">LIVE</span>}
        </button>

        <button
          className={`nav-item ${activeTab === 'web' ? 'active' : ''}`}
          onClick={() => onSelectTab('web')}
        >
          <Globe size={17} />
          <span>Web Fallback</span>
          {webReceiverCount > 0 && <span className="nav-badge">{webReceiverCount}</span>}
        </button>

        <button
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectTab('settings')}
        >
          <Settings size={17} />
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="status-row">
          <span className={`status-dot ${isCasting || isReceiving ? 'busy' : ''}`} />
          <span>{statusLabel}</span>
        </div>
        {selfInfo && (
          <>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#e2e8f0' }}>
              {selfInfo.name}
            </div>
            <div className="meta-line">
              {selfInfo.ip}:{selfInfo.port}
            </div>
            {selfInfo.pinRequired && (
              <div className="pin-pill">
                <Lock size={11} />
                <span>PIN: {selfInfo.pinCode}</span>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
