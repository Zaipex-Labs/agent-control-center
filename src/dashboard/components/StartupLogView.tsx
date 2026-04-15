// Shared startup/boot log — the same stepped view shown when powering
// a team up from the home cards. Used inline on the home page and as
// the body of the reconnect popup on the project page.

export interface StartupLogStep {
  text: string;
  done: boolean;
}

interface StartupLogViewProps {
  steps: StartupLogStep[];
}

export default function StartupLogView({ steps }: StartupLogViewProps) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 14, lineHeight: 1.9, color: '#1E2D40',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      {steps.map((step, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          animation: 'acc-step-in 0.35s ease both',
        }}>
          {step.done ? (
            <span style={{ color: '#3DBA7A', fontSize: 15, flexShrink: 0, marginTop: 1 }}>✓</span>
          ) : (
            <span style={{
              display: 'inline-block', width: 15, height: 15,
              border: '2px solid #DDD5C8', borderTopColor: '#E8823A',
              borderRadius: '50%', flexShrink: 0, marginTop: 3,
              animation: 'acc-spin 0.6s linear infinite',
            }} />
          )}
          <span>{step.text}</span>
        </div>
      ))}
    </div>
  );
}
