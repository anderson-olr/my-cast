import React, { useEffect, useState } from 'react';
import { Check, Lock, Monitor, RefreshCw, Shield } from 'lucide-react';
import { AppConfig, DisplayInfo } from '../types/mycast';

interface SettingsViewProps {
  config: AppConfig;
  displays: DisplayInfo[];
  onUpdateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  onRegeneratePin: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  config,
  displays,
  onUpdateConfig,
  onRegeneratePin,
}) => {
  const [deviceName, setDeviceName] = useState(config.deviceName);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDeviceName(config.deviceName);
  }, [config.deviceName]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = deviceName.trim();
    if (!trimmed) return;
    await onUpdateConfig({ deviceName: trimmed });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  return (
    <div className="scroll-view">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Configure your receiver identity, optional PIN lock, target display, and system tray behavior.
          </p>
        </div>
      </div>

      {/* Device Identity */}
      <section className="section-card">
        <div className="section-title-group">
          <Monitor size={18} color="#818cf8" />
          <h2 className="section-title">Device Identity</h2>
        </div>

        <form
          onSubmit={handleSaveName}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <input
            className="input"
            style={{ width: '320px', maxWidth: '100%' }}
            value={deviceName}
            maxLength={48}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="e.g. Living Room PC"
          />
          <button className="btn btn-primary" type="submit">
            {savedNotice ? <Check size={15} /> : null}
            <span>{savedNotice ? 'Saved' : 'Save Name'}</span>
          </button>
        </form>
        <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          This name appears to other MyCast devices on your local network.
        </p>
      </section>

      {/* Security & PIN */}
      <section className="section-card">
        <div className="section-title-group">
          <Shield size={18} color="#fbbf24" />
          <h2 className="section-title">Connection Security</h2>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              Require 4-digit PIN for incoming casts
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              Instant Cast is enabled by default. Turn this on to prevent other LAN devices from casting without entering your PIN.
            </div>
          </div>
          <button
            type="button"
            className={`switch ${config.pinRequired ? 'on' : ''}`}
            onClick={() => onUpdateConfig({ pinRequired: !config.pinRequired })}
            aria-label="Require PIN"
          >
            <span className="switch-knob" />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            padding: '14px 16px',
            borderRadius: '12px',
            background: 'rgba(7, 10, 18, 0.55)',
            border: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Lock size={17} color={config.pinRequired ? '#fbbf24' : '#64748b'} />
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Current Receiver PIN</div>
              <div
                style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  letterSpacing: '0.24em',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  color: config.pinRequired ? '#fde68a' : '#64748b',
                }}
              >
                {config.pinCode}
              </div>
            </div>
          </div>

          <button className="btn" onClick={onRegeneratePin}>
            <RefreshCw size={14} />
            <span>Regenerate PIN</span>
          </button>
        </div>
      </section>

      {/* Display & Window */}
      <section className="section-card">
        <div className="section-title-group">
          <Monitor size={18} color="#38bdf8" />
          <h2 className="section-title">Receiver Display &amp; Tray</h2>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              Auto-fullscreen on incoming cast
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              Automatically restores the app from the system tray and enters fullscreen on your target monitor when another PC starts casting.
            </div>
          </div>
          <button
            type="button"
            className={`switch ${config.autoFullscreen ? 'on' : ''}`}
            onClick={() => onUpdateConfig({ autoFullscreen: !config.autoFullscreen })}
            aria-label="Auto fullscreen"
          >
            <span className="switch-knob" />
          </button>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Target Monitor</div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              Choose which monitor displays incoming fullscreen casts.
            </div>
          </div>
          <select
            className="select"
            value={config.targetDisplayId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onUpdateConfig({ targetDisplayId: val ? Number(val) : null });
            }}
          >
            <option value="">Primary Display (Default)</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              Minimize to System Tray on close
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              Keep MyCast running quietly in the background so this PC stays discoverable as a receiver.
            </div>
          </div>
          <button
            type="button"
            className={`switch ${config.minimizeToTray ? 'on' : ''}`}
            onClick={() => onUpdateConfig({ minimizeToTray: !config.minimizeToTray })}
            aria-label="Minimize to tray"
          >
            <span className="switch-knob" />
          </button>
        </div>
      </section>
    </div>
  );
};
