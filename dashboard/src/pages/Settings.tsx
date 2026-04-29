import { useState } from 'react';
import { Settings as SettingsIcon, Save, RefreshCw } from 'lucide-react';
import { useHealth } from '../hooks/useApi';
import { classNames, formatDuration } from '../utils/format';

export default function Settings() {
  const { data: health } = useHealth();
  const [serverUrl, setServerUrl] = useState('http://localhost:7070');
  const [apiKey, setApiKey] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // Store non-sensitive settings in localStorage
    localStorage.setItem('probe-settings', JSON.stringify({ serverUrl, refreshInterval }));
    // API key goes to sessionStorage only (cleared on tab close)
    if (apiKey) {
      sessionStorage.setItem('probe-api-key', apiKey);
    } else {
      sessionStorage.removeItem('probe-api-key');
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Configure your Probe instance</p>
      </div>

      {/* Server status */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-probe-accent" />
          Server Status
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Status</p>
            <p className={health ? 'text-emerald-400' : 'text-red-400'}>
              {health ? 'Connected' : 'Disconnected'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Uptime</p>
            <p className="text-slate-200">{health ? formatDuration(health.uptime) : '—'}</p>
          </div>
        </div>
      </div>

      {/* Connection settings */}
      <div className="glass-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-200">Connection</h2>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Server URL</label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="w-full bg-probe-bg border border-probe-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-probe-accent/50"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">API Key (optional)</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="probe_..."
            className="w-full bg-probe-bg border border-probe-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-probe-accent/50"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Auto-refresh interval (seconds)</label>
          <input
            type="number"
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            min={1}
            max={60}
            className="w-32 bg-probe-bg border border-probe-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-probe-accent/50"
          />
        </div>
      </div>

      {/* SDK configuration reference */}
      <div className="glass-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">SDK Quick Start</h2>
        <p className="text-xs text-slate-400">Install the SDK in your application to start sending events:</p>
        <pre className="bg-probe-bg rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto">
{`// Node.js Express app
import { createProbeMiddleware } from '@nuptechs-sentinel-probe/sdk/node';

app.use(createProbeMiddleware({
  serverUrl: '${serverUrl}',
  apiKey: '${apiKey || 'your-api-key'}',
}));

// Browser app
import { installFetchInterceptor } from '@nuptechs-sentinel-probe/sdk/browser';

installFetchInterceptor({
  serverUrl: '${serverUrl}',
  apiKey: '${apiKey || 'your-api-key'}',
});`}
        </pre>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className={classNames(
            'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
            saved
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-probe-accent hover:bg-probe-accent/80 text-white',
          )}
        >
          {saved ? <RefreshCw className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
