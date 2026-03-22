export type ExamSessionReport = {
  student: {
    first_name: string
    last_name: string
    student_id: string
    institution: string
    program: string
    email: string
  }
  exam: {
    started_at: string
    ended_at: string
    duration_ms: number
  }
  verification: {
    checks_total: number
    checks_passed: number
    warnings: number
    suspended: boolean
  }
  behavioral: {
    score: number
    level: 'normal' | 'suspicious'
  }
  post_quantum: {
    algorithm: string
    public_key?: string
    signature?: string
  }
  notes?: string[]
}

function escapeHtml(s: string): string {
  // Avoid String.prototype.replaceAll for older TS lib targets
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function openPrintableReport(report: ExamSessionReport) {
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000')
  if (!w) throw new Error('Popup blocked')

  const durMin = Math.round(report.exam.duration_ms / 60000)

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>EDGUARD Session Report</title>
      <style>
        :root { --ink:#0b1220; --muted:#475569; --blue:#3b82f6; --border:#e2e8f0; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: var(--ink); margin: 0; padding: 32px; }
        h1 { margin: 0 0 6px; font-size: 22px; }
        .sub { color: var(--muted); margin-bottom: 18px; }
        .card { border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
        .row { display:flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
        .row:last-child { border-bottom: none; }
        .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
        .v { font-weight: 700; }
        .badge { display:inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid rgba(59,130,246,0.25); background: rgba(59,130,246,0.08); color: var(--blue); }
        .footer { margin-top: 18px; color: var(--muted); font-size: 12px; }
        @media print { body { padding: 18px; } }
      </style>
    </head>
    <body>
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 16px;">
        <div>
          <h1>EDGUARD — Academic Identity Shield</h1>
          <div class="sub">Exam Session Report (print / save as PDF)</div>
        </div>
        <div class="badge">Biometrically certified</div>
      </div>

      <div class="card">
        <div class="row"><div class="k">Student</div><div class="v">${escapeHtml(report.student.first_name)} ${escapeHtml(report.student.last_name)}</div></div>
        <div class="row"><div class="k">Student ID</div><div class="v">${escapeHtml(report.student.student_id)}</div></div>
        <div class="row"><div class="k">Institution</div><div class="v">${escapeHtml(report.student.institution)}</div></div>
        <div class="row"><div class="k">Program / Course</div><div class="v">${escapeHtml(report.student.program)}</div></div>
        <div class="row"><div class="k">Email</div><div class="v">${escapeHtml(report.student.email)}</div></div>
      </div>

      <div class="card">
        <div class="row"><div class="k">Started</div><div class="v">${escapeHtml(report.exam.started_at)}</div></div>
        <div class="row"><div class="k">Ended</div><div class="v">${escapeHtml(report.exam.ended_at)}</div></div>
        <div class="row"><div class="k">Duration</div><div class="v">${durMin} min</div></div>
      </div>

      <div class="card">
        <div class="row"><div class="k">Verification results</div><div class="v">${report.verification.checks_passed}/${report.verification.checks_total} checks passed</div></div>
        <div class="row"><div class="k">Warnings</div><div class="v">${report.verification.warnings}</div></div>
        <div class="row"><div class="k">Session suspended</div><div class="v">${report.verification.suspended ? 'YES' : 'NO'}</div></div>
      </div>

      <div class="card">
        <div class="row"><div class="k">Behavioral score</div><div class="v">${Math.round(report.behavioral.score * 100)}% (${escapeHtml(report.behavioral.level)})</div></div>
        <div class="row"><div class="k">Post-quantum</div><div class="v">${escapeHtml(report.post_quantum.algorithm)}</div></div>
      </div>

      <div class="footer">
        This session was biometrically certified by EDGUARD.
      </div>
      <script>window.print()</script>
    </body>
  </html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
}
