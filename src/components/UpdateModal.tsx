import React from 'react'
import type { UpdateStatus } from '../shared/ipc-types'

interface Props {
  status: UpdateStatus
  onClose: () => void
  onCheckAgain: () => void
  onDownload: () => void
  onRestart: () => void
}

export function UpdateModal({ status, onClose, onCheckAgain, onDownload, onRestart }: Props): React.ReactElement {
  const dismissable =
    status.state === 'idle' ||
    status.state === 'not-available' ||
    status.state === 'error' ||
    status.state === 'available' ||
    status.state === 'downloaded'

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={dismissable ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '28px 32px',
          maxWidth: 440,
          width: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="update-modal-title"
          style={{ marginTop: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}
        >
          App Updates
        </h2>

        <Body status={status} />

        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          {status.state === 'downloaded' && (
            <button
              onClick={onRestart}
              style={{
                padding: '8px 18px', fontWeight: 600, cursor: 'pointer',
                background: 'var(--accent)', border: 'none', color: '#000',
                borderRadius: 'var(--radius)', fontSize: 13,
              }}
            >
              Restart and install
            </button>
          )}

          {status.state === 'available' && (
            <button
              onClick={onDownload}
              style={{
                padding: '8px 18px', fontWeight: 600, cursor: 'pointer',
                background: 'var(--accent)', border: 'none', color: '#000',
                borderRadius: 'var(--radius)', fontSize: 13,
              }}
            >
              Download update
            </button>
          )}

          {(status.state === 'idle' ||
            status.state === 'not-available' ||
            status.state === 'error') && (
            <button
              onClick={onCheckAgain}
              style={{
                padding: '8px 18px', fontWeight: 600, cursor: 'pointer',
                background: 'var(--accent)', border: 'none', color: '#000',
                borderRadius: 'var(--radius)', fontSize: 13,
              }}
            >
              Check now
            </button>
          )}

          {dismissable && (
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px', cursor: 'pointer', fontSize: 13,
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', color: 'var(--text)',
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Body({ status }: { status: UpdateStatus }): React.ReactElement {
  const base: React.CSSProperties = { fontSize: 13, lineHeight: 1.6, color: 'var(--text)', margin: 0 }
  switch (status.state) {
    case 'idle':
      return <p style={base}>Click &quot;Check now&quot; to look for a new version.</p>
    case 'checking':
      return <p style={{ ...base, color: 'var(--text-dim)' }}>Checking for updates…</p>
    case 'available':
      return (
        <p style={base}>
          Version <strong>{status.version}</strong> is available. The installer is ~100 MB
          and won&apos;t be downloaded until you click below.
        </p>
      )
    case 'not-available':
      return (
        <p style={{ ...base, color: 'var(--success)' }}>
          You&apos;re on the latest version ({status.version}).
        </p>
      )
    case 'downloading':
      return (
        <p style={{ ...base, color: 'var(--text-dim)' }}>
          Downloading update… {status.percent}%
        </p>
      )
    case 'downloaded':
      return (
        <p style={base}>
          Version <strong>{status.version}</strong> downloaded. Restart to install.
        </p>
      )
    case 'error':
      if (status.disabledInDev) {
        return (
          <p style={{ ...base, color: 'var(--text-dim)' }}>
            Update checks are disabled in development builds.
          </p>
        )
      }
      return (
        <p style={{ ...base, color: 'var(--danger)' }}>
          Update check failed: {status.message}
        </p>
      )
  }
}
