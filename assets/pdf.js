export const openPrintWindow = (payload) => {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  const { summary, breakdowns, questions, meta } = payload;
  const rows = (items) => items.map((item) => `<tr><td>${item.label}</td><td>${item.value}</td></tr>`).join("");
  const questionRows = questions.map((q, idx) => `
    <div class="question">
      <h4>Q${idx + 1}. ${q.prompt}</h4>
      <p><strong>Your answer:</strong> ${q.userAnswer}</p>
      <p><strong>Correct answer:</strong> ${q.correctAnswer}</p>
      <p><strong>Result:</strong> ${q.correct ? "Correct" : "Incorrect"}</p>
    </div>
  `).join("");
  win.document.write(`
    <html>
      <head>
        <title>Payroll Technician Practice Exam - Results</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
          h1 { margin-bottom: 0; }
          h2 { margin-top: 24px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          td, th { border: 1px solid #ddd; padding: 8px; }
          .meta { margin-top: 8px; font-size: 0.9rem; }
          .question { margin-top: 16px; padding-bottom: 12px; border-bottom: 1px solid #ccc; }
        </style>
      </head>
      <body>
        <h1>Payroll Technician Practice Exam Results</h1>
        <div class="meta">Mode: ${meta.mode} | Seed: ${meta.seed} | Attempt: ${meta.attemptId}</div>
        <h2>Summary</h2>
        <table>${rows(summary)}</table>
        <h2>Breakdowns</h2>
        <table>${rows(breakdowns)}</table>
        <h2>Question Review</h2>
        ${questionRows}
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
};
