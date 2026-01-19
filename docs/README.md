# Payroll Technician Practice Exam (Client-Side)

A fully client-side practice exam experience built for GitHub Pages. All data is stored locally in the browser via `localStorage` and question packs are loaded from static JSON.

## Features
- Deterministic, seeded randomization for reproducible attempts.
- Multiple modes: Timed Exam, Untimed Study, Math Drills, Domain Focus, Weakness Mode.
- Expanded payroll math templates and scenario-based questions.
- Review tools with filters, retake flows, and printable PDF export.
- Accessibility, keyboard shortcuts, and responsive layout.

> Disclaimer: Practice only; not official payroll/tax advice. All tax rates in questions are hypothetical.

## Running Locally
Use any static server (GitHub Pages expects the same). One option is VS Code Live Server:

1. Open the repo in VS Code.
2. Install the Live Server extension.
3. Right-click `index.html` and choose **Open with Live Server**.

Alternatively:
```bash
python -m http.server 8080
```
Then open `http://localhost:8080`.

## Deploying to GitHub Pages
1. Push to a GitHub repo.
2. In **Settings → Pages**, set the branch to `main` (or your default branch) and root folder.
3. Open the generated URL. The app uses relative fetch paths like `./data/packs.json`.

## Data Model
Runtime `Question` object used after generation:
```json
{
  "id": "string",
  "packId": "string",
  "domain": 1,
  "domainName": "string",
  "difficulty": "easy|medium|hard",
  "type": "mcq|msq|numeric|fill|order|match|multi_numeric",
  "prompt": "string",
  "choices": ["string"],
  "answer": "varies",
  "tolerance": 0.05,
  "unitHint": "$",
  "acceptable": [["string"]],
  "items": ["string"],
  "left": ["string"],
  "right": ["string"],
  "correctOrder": [0],
  "correct": [0],
  "explanation": "string",
  "steps": ["string"],
  "tags": ["string"],
  "funOnly": false
}
```

Template entries in pack JSON:
```json
{
  "templateId": "overtime_gross_v1",
  "type": "numeric",
  "domain": 2,
  "difficulty": "easy",
  "tags": ["overtime", "gross"],
  "generator": {
    "params": {"rateMin": 15, "rateMax": 40},
    "rules": {}
  }
}
```
Template IDs map to generator functions in `assets/app.js`.

## Adding New Questions or Templates
1. Add entries to any `data/packs/*.json` pack.
2. For templates, add a generator in `assets/app.js` with the same `templateId`.
3. Update `data/packs.json` if adding new pack files.

## Keyboard Shortcuts
- **Arrow Left/Right**: Previous/Next question
- **Shift + F**: Toggle flag
- **Ctrl + Enter**: Submit attempt
- **1-6**: Select MCQ option
- **M**: Toggle calculator

## Manual QA Checklist
- Load the app and verify packs load without console errors.
- Start each mode (Timed, Study, Drills, Domain Focus, Weakness).
- Answer questions, flag a question, and submit.
- Verify results breakdowns, filters, and retake actions.
- Resume an in-progress attempt after refresh.
- Confirm PDF export launches print dialog.
- Check mobile layout and keyboard shortcuts.
