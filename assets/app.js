import { createRng, seedFromInputs } from "./rng.js";
import { storage, defaultSettings } from "./storage.js";
import { scoreQuestion, normalizeAnswerForDisplay } from "./scoring.js";
import { $, $$, show, hide, setText, sanitizeHtml, formatTime, createModal, initCalculator } from "./ui.js";
import { openPrintWindow } from "./pdf.js";

const DOMAIN_NAMES = {
  1: "Payroll Fundamentals",
  2: "Calculations",
  3: "Compliance",
  4: "Systems & Controls",
  5: "Reporting & Ethics",
};

const MODE_CONFIG = {
  timed: { label: "Timed Exam", feedback: false, timeLimited: true },
  study: { label: "Untimed Study", feedback: true, timeLimited: false },
  drills: { label: "Math Drills", feedback: true, timeLimited: false },
  domain: { label: "Domain Focus", feedback: true, timeLimited: true },
  weakness: { label: "Weakness Mode", feedback: true, timeLimited: true },
};

const state = {
  settings: null,
  packsIndex: [],
  packs: {},
  attempt: null,
  view: "start",
  autosaveTimer: null,
  calculator: null,
  modals: {},
};

const loadSettings = () => {
  storage.migrateIfNeeded();
  const saved = storage.loadSettings();
  state.settings = saved ? { ...defaultSettings, ...saved } : { ...defaultSettings };
  if (!state.settings.blueprint) state.settings.blueprint = { ...defaultSettings.blueprint };
};

const persistSettings = () => storage.saveSettings(state.settings);

const fetchPacks = async () => {
  const response = await fetch("./data/packs.json");
  const index = await response.json();
  state.packsIndex = index;
  const packs = await Promise.all(index.map((pack) => fetch(pack.file).then((res) => res.json())));
  packs.forEach((pack) => {
    state.packs[pack.id] = pack;
  });
};

const createAttemptId = () => `attempt_${Date.now()}`;

const buildSeed = () => {
  const now = new Date();
  return seedFromInputs(state.settings.mode, now.toISOString(), Math.random().toString(36).slice(2));
};

const createDefaultAttemptState = (config) => ({
  attemptId: createAttemptId(),
  seed: buildSeed(),
  mode: config.mode,
  status: "in-progress",
  startedAt: Date.now(),
  timeLimitSeconds: config.timeLimitSeconds,
  elapsedSeconds: 0,
  questions: [],
  responses: {},
  flags: {},
  answerChanges: {},
  hintUsage: {},
  timeSpent: {},
  streak: 0,
  bestStreak: 0,
  currentIndex: 0,
  blueprint: config.blueprint,
  domainSelection: config.domainSelection || [],
});

const gatherEnabledPacks = () => {
  const enabled = new Set(state.settings.enabledPacks);
  return Object.values(state.packs).filter((pack) => enabled.has(pack.id));
};

const allowedQuestion = (question) => {
  if (question.funOnly && !state.settings.funMode) return false;
  return true;
};

const generatorMap = {
  overtime_gross_v1: (template, rng) => {
    const rate = rng.intBetween(template.generator.params.rateMin, template.generator.params.rateMax);
    const hours = rng.intBetween(template.generator.params.hoursMin, template.generator.params.hoursMax);
    const otMultiplier = template.generator.params.otMultiplier || 1.5;
    const overtimeHours = Math.max(hours - 40, 0);
    const regularHours = hours - overtimeHours;
    const gross = regularHours * rate + overtimeHours * rate * otMultiplier;
    return {
      prompt: `An employee earns $${rate}/hour and worked ${hours} hours. Overtime is paid at ${otMultiplier}x. What is gross pay?`,
      answer: Number(gross.toFixed(2)),
      tolerance: 0.02,
      unitHint: "$",
      steps: [
        `Regular hours: ${regularHours} x $${rate} = $${(regularHours * rate).toFixed(2)}`,
        `OT hours: ${overtimeHours} x $${rate} x ${otMultiplier} = $${(overtimeHours * rate * otMultiplier).toFixed(2)}`,
        `Gross = regular + OT = $${gross.toFixed(2)}`,
      ],
      variant: { rate, hours, otMultiplier },
    };
  },
  blended_rate_v1: (template, rng) => {
    const rate = rng.intBetween(template.generator.params.rateMin, template.generator.params.rateMax);
    const hours = rng.intBetween(template.generator.params.hoursMin, template.generator.params.hoursMax);
    const bonus = rng.intBetween(template.generator.params.bonusMin, template.generator.params.bonusMax);
    const regularRate = ((rate * hours) + bonus) / hours;
    const overtimeHours = Math.max(hours - 40, 0);
    const otPremium = overtimeHours * (regularRate * 0.5);
    const gross = rate * hours + bonus + otPremium;
    return {
      prompt: `An employee earns $${rate}/hour and worked ${hours} hours with a nondiscretionary bonus of $${bonus}. Using a blended regular rate, what is the total gross pay?`,
      answer: Number(gross.toFixed(2)),
      tolerance: 0.05,
      unitHint: "$",
      steps: [
        `Regular rate = (base earnings + bonus) / hours = $${regularRate.toFixed(2)}`,
        `OT premium = OT hours x (regular rate x 0.5) = $${otPremium.toFixed(2)}`,
        `Gross = base earnings + bonus + OT premium = $${gross.toFixed(2)}`,
      ],
      variant: { rate, hours, bonus },
    };
  },
  earnings_mix_v1: (template, rng) => {
    const rate = rng.intBetween(template.generator.params.rateMin, template.generator.params.rateMax);
    const regHours = rng.intBetween(template.generator.params.regHoursMin, template.generator.params.regHoursMax);
    const otHours = rng.intBetween(template.generator.params.otHoursMin, template.generator.params.otHoursMax);
    const shiftDiff = rng.intBetween(template.generator.params.shiftDiffMin, template.generator.params.shiftDiffMax);
    const stipend = rng.intBetween(template.generator.params.stipendMin, template.generator.params.stipendMax);
    const regular = regHours * rate;
    const overtime = otHours * rate * 1.5;
    const shiftPay = regHours * shiftDiff;
    const gross = regular + overtime + shiftPay + stipend;
    return {
      prompt: `Calculate gross pay: rate $${rate}/hr, ${regHours} regular hours, ${otHours} OT hours at 1.5x, shift diff $${shiftDiff}/hr for regular hours, stipend $${stipend}.`,
      answer: Number(gross.toFixed(2)),
      tolerance: 0.05,
      unitHint: "$",
      steps: [
        `Regular: $${regular.toFixed(2)}`,
        `OT: $${overtime.toFixed(2)}`,
        `Shift diff: $${shiftPay.toFixed(2)}`,
        `Stipend: $${stipend.toFixed(2)}`,
        `Gross: $${gross.toFixed(2)}`,
      ],
      variant: { rate, regHours, otHours, shiftDiff, stipend },
    };
  },
  pretax_posttax_v1: (template, rng) => {
    const gross = rng.intBetween(template.generator.params.grossMin, template.generator.params.grossMax);
    const pretaxPerc = rng.intBetween(template.generator.params.pretaxPercMin, template.generator.params.pretaxPercMax);
    const pretaxFlat = rng.intBetween(template.generator.params.pretaxFlatMin, template.generator.params.pretaxFlatMax);
    const posttaxPerc = rng.intBetween(template.generator.params.posttaxPercMin, template.generator.params.posttaxPercMax);
    const pretax = gross * (pretaxPerc / 100) + pretaxFlat;
    const taxable = gross - pretax;
    const posttax = taxable * (posttaxPerc / 100);
    const net = gross - pretax - posttax;
    return {
      prompt: `Gross pay is $${gross}. Pre-tax deductions: ${pretaxPerc}% plus $${pretaxFlat}. Post-tax deduction: ${posttaxPerc}% of taxable wages. What is net pay?`,
      answer: Number(net.toFixed(2)),
      tolerance: 0.05,
      unitHint: "$",
      steps: [
        `Pre-tax: $${pretax.toFixed(2)}`,
        `Taxable wages: $${taxable.toFixed(2)}`,
        `Post-tax: $${posttax.toFixed(2)}`,
        `Net: $${net.toFixed(2)}`,
      ],
      variant: { gross, pretaxPerc, pretaxFlat, posttaxPerc },
    };
  },
  percent_deduction_cap_v1: (template, rng) => {
    const gross = rng.intBetween(template.generator.params.grossMin, template.generator.params.grossMax);
    const rate = rng.intBetween(template.generator.params.rateMin, template.generator.params.rateMax);
    const cap = rng.intBetween(template.generator.params.capMin, template.generator.params.capMax);
    const deduction = Math.min(gross * (rate / 100), cap);
    return {
      prompt: `A voluntary deduction is ${rate}% of gross pay, not to exceed $${cap}. Gross pay is $${gross}. What is the deduction amount?`,
      answer: Number(deduction.toFixed(2)),
      tolerance: 0.02,
      unitHint: "$",
      steps: [
        `Calculated deduction: $${(gross * (rate / 100)).toFixed(2)}`,
        `Apply cap: $${deduction.toFixed(2)}`,
      ],
      variant: { gross, rate, cap },
    };
  },
  pay_period_convert_v1: (template, rng) => {
    const annual = rng.intBetween(template.generator.params.annualMin, template.generator.params.annualMax);
    const period = rng.pick(template.generator.params.periods);
    const perPeriod = annual / period;
    return {
      prompt: `An employee earns $${annual} annually. What is the equivalent per-pay-period amount for ${period} pay periods?`,
      answer: Number(perPeriod.toFixed(2)),
      tolerance: 0.05,
      unitHint: "$",
      steps: ["Annual salary ÷ pay periods."],
      variant: { annual, period },
    };
  },
  rounding_rule_v1: (template, rng) => {
    const rate = Number(rng.floatBetween(template.generator.params.rateMin, template.generator.params.rateMax).toFixed(2));
    const hours = Number(rng.floatBetween(template.generator.params.hoursMin, template.generator.params.hoursMax).toFixed(2));
    const roundedRate = Number(rate.toFixed(2));
    const roundedHours = Number(hours.toFixed(2));
    const roundedComponent = roundedRate * roundedHours;
    const roundAtEnd = Number((rate * hours).toFixed(2));
    return {
      prompt: `An employee worked ${hours} hours at $${rate}/hr. If you round each component to 2 decimals before multiplying, what gross pay results?`,
      answer: Number(roundedComponent.toFixed(2)),
      tolerance: 0.02,
      unitHint: "$",
      steps: [
        `Rounded rate: $${roundedRate}, rounded hours: ${roundedHours}`,
        `Multiply = $${roundedComponent.toFixed(2)} (round at end would be $${roundAtEnd}).`,
      ],
      variant: { rate, hours },
    };
  },
  reconciliation_v1: (template, rng) => {
    const itemCount = rng.intBetween(template.generator.params.itemMin, template.generator.params.itemMax);
    const amounts = Array.from({ length: itemCount }, () => rng.intBetween(template.generator.params.amountMin, template.generator.params.amountMax));
    const total = amounts.reduce((sum, val) => sum + val, 0);
    return {
      prompt: `Reconcile the payroll register by summing: ${amounts.map((val) => `$${val}`).join(", ")}. What is the total?`,
      answer: Number(total.toFixed(2)),
      tolerance: 0.01,
      unitHint: "$",
      steps: ["Sum all line items."],
      variant: { amounts },
    };
  },
  variance_detective_v1: (template, rng) => {
    const variance = rng.intBetween(template.generator.params.varianceMin, template.generator.params.varianceMax);
    return {
      prompt: `Payroll expense increased by $${variance} this period. Which action is the best first step?`,
      choices: ["Validate variance with reports and approvals", "Ignore it", "Delete prior period data", "Delay payroll"],
      answer: 0,
      explanation: "Validating the variance with source reports is the first audit step.",
      variant: { variance },
    };
  },
  net_pay_v1: (template, rng) => {
    const gross = rng.intBetween(template.generator.params.grossMin, template.generator.params.grossMax);
    const taxRate = rng.intBetween(template.generator.params.taxRateMin, template.generator.params.taxRateMax);
    const deduction = rng.intBetween(template.generator.params.deductionMin, template.generator.params.deductionMax);
    const tax = gross * (taxRate / 100);
    const net = gross - tax - deduction;
    return {
      prompt: `Gross pay is $${gross}. Taxes are ${taxRate}% and deductions total $${deduction}. What is net pay?`,
      answer: Number(net.toFixed(2)),
      tolerance: 0.05,
      unitHint: "$",
      steps: [
        `Tax: $${tax.toFixed(2)}`,
        `Net: $${net.toFixed(2)}`,
      ],
      variant: { gross, taxRate, deduction },
    };
  },
  order_pay_stub_v1: () => ({
    prompt: "Order the pay stub sections from top to bottom.",
    items: ["Employee info", "Earnings", "Taxes", "Deductions", "Net pay"],
    correctOrder: [0, 1, 2, 3, 4],
  }),
  match_tax_terms_v1: () => ({
    prompt: "Match the tax term to its description.",
    left: ["Withholding", "Taxable wages", "Exemption"],
    right: ["Amount subject to tax", "Reduction allowed by policy", "Amount held from pay"],
    answer: [2, 0, 1],
  }),
  multi_numeric_breakdown_v1: (template, rng) => {
    const rate = rng.intBetween(template.generator.params.rateMin, template.generator.params.rateMax);
    const hours = rng.intBetween(template.generator.params.hoursMin, template.generator.params.hoursMax);
    const taxRate = rng.intBetween(template.generator.params.taxRateMin, template.generator.params.taxRateMax);
    const gross = rate * hours;
    const tax = gross * (taxRate / 100);
    const net = gross - tax;
    return {
      prompt: `Compute the following: (1) Gross pay for ${hours} hours at $${rate}/hr, (2) Tax at ${taxRate}%, (3) Net pay.`,
      answer: [Number(gross.toFixed(2)), Number(tax.toFixed(2)), Number(net.toFixed(2))],
      tolerance: 0.05,
      unitHint: "$",
      steps: [
        `Gross = hours x rate = $${gross.toFixed(2)}`,
        `Tax = gross x rate = $${tax.toFixed(2)}`,
        `Net = gross - tax = $${net.toFixed(2)}`,
      ],
      variant: { rate, hours, taxRate },
    };
  },
};

const hydrateQuestion = (entry, packId, rng, index) => {
  if (entry.templateId) {
    const generator = generatorMap[entry.templateId];
    if (!generator) {
      return {
        id: `${entry.templateId}:${index}`,
        packId,
        domain: entry.domain,
        domainName: DOMAIN_NAMES[entry.domain],
        difficulty: entry.difficulty,
        type: entry.type,
        prompt: "Template generator missing.",
        explanation: "No generator available.",
        tags: entry.tags || [],
      };
    }
    const generated = generator(entry, rng);
    return {
      id: `${entry.templateId}:${index}:${Math.floor(rng.next() * 1e6)}`,
      packId,
      domain: entry.domain,
      domainName: DOMAIN_NAMES[entry.domain],
      difficulty: entry.difficulty,
      type: entry.type,
      prompt: generated.prompt,
      choices: generated.choices || entry.choices,
      answer: generated.answer,
      tolerance: generated.tolerance ?? entry.tolerance,
      relativeTolerance: entry.relativeTolerance,
      unitHint: generated.unitHint || entry.unitHint,
      acceptable: entry.acceptable,
      items: generated.items || entry.items,
      left: generated.left || entry.left,
      right: generated.right || entry.right,
      correctOrder: generated.correctOrder || entry.correctOrder,
      correct: entry.correct,
      explanation: generated.explanation || entry.explanation || "",
      steps: generated.steps || entry.steps,
      tags: entry.tags || [],
      funOnly: entry.funOnly || false,
      variant: generated.variant || null,
    };
  }
  return {
    ...entry,
    packId,
    domainName: DOMAIN_NAMES[entry.domain],
  };
};

const buildWeightedTargets = (weights, total) => {
  const entries = Object.entries(weights);
  const counts = {};
  let assigned = 0;
  entries.forEach(([key, weight]) => {
    const count = Math.floor(weight * total);
    counts[key] = count;
    assigned += count;
  });
  while (assigned < total) {
    const [key] = entries[Math.floor(Math.random() * entries.length)];
    counts[key] += 1;
    assigned += 1;
  }
  return counts;
};

const selectQuestions = (pool, rng, blueprint, mode, domainSelection = [], weaknessProfile = null) => {
  const total = blueprint.questionCount[mode] || 20;
  const domainWeights = { ...blueprint.domainWeights };
  const difficultyMix = { ...blueprint.difficultyMix };
  const typeMix = { ...blueprint.typeMix };
  if (mode === "domain" && domainSelection.length) {
    Object.keys(domainWeights).forEach((key) => {
      domainWeights[key] = domainSelection.includes(Number(key)) ? 1 : 0;
    });
  }
  if (mode === "weakness" && weaknessProfile) {
    (weaknessProfile.domains || []).forEach((domain) => {
      domainWeights[domain.id] = Math.max(domainWeights[domain.id] || 0, domain.weight);
    });
    (weaknessProfile.types || []).forEach((type) => {
      typeMix[type.id] = Math.max(typeMix[type.id] || 0, type.weight);
    });
    (weaknessProfile.difficulties || []).forEach((difficulty) => {
      difficultyMix[difficulty.id] = Math.max(difficultyMix[difficulty.id] || 0, difficulty.weight);
    });
  }
  const domainTargets = buildWeightedTargets(domainWeights, total);
  const difficultyTargets = buildWeightedTargets(difficultyMix, total);
  const typeTargets = buildWeightedTargets(typeMix, total);

  const picked = [];
  const usedIds = new Set();

  const pickWithTargets = (targetKey, targetValue, list, predicate) => {
    if (targetValue <= 0) return null;
    const candidates = list.filter(predicate);
    if (!candidates.length) return null;
    return rng.pick(candidates);
  };

  const flattened = [];
  pool.forEach(({ packId, entry }) => {
    flattened.push({ packId, entry });
  });

  for (let i = 0; i < total; i += 1) {
    const domainKey = Object.keys(domainTargets).find((key) => domainTargets[key] > 0) || "2";
    const difficultyKey = Object.keys(difficultyTargets).find((key) => difficultyTargets[key] > 0) || "medium";
    const typeKey = Object.keys(typeTargets).find((key) => typeTargets[key] > 0) || "mcq";

    let candidate = pickWithTargets(domainKey, domainTargets[domainKey], flattened, (item) => item.entry.domain === Number(domainKey) && item.entry.type === typeKey && item.entry.difficulty === difficultyKey);
    if (!candidate) {
      candidate = pickWithTargets(domainKey, domainTargets[domainKey], flattened, (item) => item.entry.domain === Number(domainKey));
    }
    if (!candidate) {
      candidate = rng.pick(flattened);
    }

    const question = hydrateQuestion(candidate.entry, candidate.packId, rng, i);
    if (!usedIds.has(question.id)) {
      picked.push(question);
      usedIds.add(question.id);
    }
    if (domainTargets[domainKey] > 0) domainTargets[domainKey] -= 1;
    if (difficultyTargets[difficultyKey] > 0) difficultyTargets[difficultyKey] -= 1;
    if (typeTargets[typeKey] > 0) typeTargets[typeKey] -= 1;
  }

  return picked;
};

const buildPool = () => {
  const packs = gatherEnabledPacks();
  const pool = [];
  packs.forEach((pack) => {
    pack.questions.forEach((entry) => {
      if (!allowedQuestion(entry)) return;
      pool.push({ packId: pack.id, entry });
    });
  });
  return pool;
};

const buildAttempt = (mode) => {
  const blueprint = JSON.parse(JSON.stringify(state.settings.blueprint));
  if (mode === "drills") {
    blueprint.typeMix = {
      numeric: 0.6,
      multi_numeric: 0.2,
      mcq: 0.1,
      msq: 0.05,
      fill: 0.05,
      order: 0,
      match: 0,
    };
  }
  const config = {
    mode,
    timeLimitSeconds: blueprint.timeLimitMinutes * 60,
    blueprint,
    domainSelection: getSelectedDomains(),
  };
  const attempt = createDefaultAttemptState(config);
  const rng = createRng(attempt.seed);
  const pool = buildPool();
  const weaknessProfile = storage.loadWeakness();
  attempt.questions = selectQuestions(pool, rng, blueprint, mode, attempt.domainSelection, weaknessProfile);
  state.attempt = attempt;
  storage.saveAttempt(attempt);
  return attempt;
};

const updateAttemptResponse = (questionId, response) => {
  if (!state.attempt) return;
  const previous = state.attempt.responses[questionId];
  state.attempt.responses[questionId] = response;
  if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(response)) {
    state.attempt.answerChanges[questionId] = (state.attempt.answerChanges[questionId] || 0) + 1;
  }
  storage.saveAttempt(state.attempt);
};

const updateTimeSpent = (questionId, seconds) => {
  if (!state.attempt) return;
  state.attempt.timeSpent[questionId] = seconds;
};

const toggleFlag = (questionId) => {
  if (!state.attempt) return;
  state.attempt.flags[questionId] = !state.attempt.flags[questionId];
  storage.saveAttempt(state.attempt);
};

const getSelectedDomains = () => {
  const selected = $$(".domain-pill input:checked").map((el) => Number(el.value));
  return selected;
};

const updateTimer = () => {
  if (!state.attempt) return;
  state.attempt.elapsedSeconds += 1;
  const currentQuestion = state.attempt.questions[state.attempt.currentIndex];
  if (currentQuestion) {
    state.attempt.timeSpent[currentQuestion.id] = (state.attempt.timeSpent[currentQuestion.id] || 0) + 1;
  }
  const isTimed = MODE_CONFIG[state.attempt.mode].timeLimited;
  if (isTimed) {
    const remaining = Math.max(state.attempt.timeLimitSeconds - state.attempt.elapsedSeconds, 0);
    setText($("#timer"), formatTime(remaining));
    if (remaining <= 0 && state.attempt.status === "in-progress") {
      submitAttempt();
    }
  } else {
    setText($("#timer"), formatTime(state.attempt.elapsedSeconds));
  }
  $("#timer")?.setAttribute("aria-live", "polite");
};

const startAutosave = () => {
  if (state.autosaveTimer) clearInterval(state.autosaveTimer);
  state.autosaveTimer = setInterval(() => {
    if (state.attempt && state.attempt.status === "in-progress") {
      storage.saveAttempt(state.attempt);
    }
  }, 5000);
};

const stopAutosave = () => {
  if (state.autosaveTimer) {
    clearInterval(state.autosaveTimer);
  }
};

const renderQuestion = () => {
  const container = $("#question-area");
  if (!container || !state.attempt) return;
  const question = state.attempt.questions[state.attempt.currentIndex];
  if (!question) return;
  container.innerHTML = "";
  const prompt = document.createElement("div");
  prompt.className = "question-prompt";
  prompt.innerHTML = sanitizeHtml(question.prompt);
  container.appendChild(prompt);

  const response = state.attempt.responses[question.id];
  const inputArea = document.createElement("div");
  inputArea.className = "question-input";

  if (question.type === "mcq") {
    question.choices.forEach((choice, idx) => {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "mcq";
      input.value = idx;
      input.checked = response === idx;
      input.addEventListener("change", () => updateAttemptResponse(question.id, idx));
      const span = document.createElement("span");
      span.textContent = choice;
      label.appendChild(input);
      label.appendChild(span);
      inputArea.appendChild(label);
    });
  }

  if (question.type === "msq") {
    question.choices.forEach((choice, idx) => {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = idx;
      input.checked = (response || []).includes(idx);
      input.addEventListener("change", () => {
        const current = new Set(response || []);
        if (input.checked) current.add(idx);
        else current.delete(idx);
        updateAttemptResponse(question.id, Array.from(current));
      });
      const span = document.createElement("span");
      span.textContent = choice;
      label.appendChild(input);
      label.appendChild(span);
      inputArea.appendChild(label);
    });
  }

  if (question.type === "numeric") {
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.placeholder = question.unitHint ? `${question.unitHint}0.00` : "0.00";
    input.value = response ?? "";
    input.addEventListener("input", () => updateAttemptResponse(question.id, input.value));
    inputArea.appendChild(input);
    if (question.unitHint) {
      const hint = document.createElement("div");
      hint.className = "unit-hint";
      hint.textContent = `Answer format: ${question.unitHint}`;
      inputArea.appendChild(hint);
    }
  }

  if (question.type === "fill") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = response ?? "";
    input.addEventListener("input", () => updateAttemptResponse(question.id, input.value));
    inputArea.appendChild(input);
  }

  if (question.type === "order") {
    const selects = question.items.map((item, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "order-row";
      const label = document.createElement("span");
      label.textContent = `Position ${idx + 1}`;
      const select = document.createElement("select");
      question.items.forEach((option, optionIdx) => {
        const opt = document.createElement("option");
        opt.value = optionIdx;
        opt.textContent = option;
        select.appendChild(opt);
      });
      select.value = response?.[idx] ?? idx;
      select.addEventListener("change", () => {
        const updated = [...(response || [])];
        updated[idx] = Number(select.value);
        updateAttemptResponse(question.id, updated);
      });
      wrapper.appendChild(label);
      wrapper.appendChild(select);
      inputArea.appendChild(wrapper);
      return select;
    });
    if (!response) {
      updateAttemptResponse(question.id, selects.map((select) => Number(select.value)));
    }
  }

  if (question.type === "match") {
    question.left.forEach((leftItem, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "match-row";
      const label = document.createElement("span");
      label.textContent = leftItem;
      const select = document.createElement("select");
      question.right.forEach((option, optionIdx) => {
        const opt = document.createElement("option");
        opt.value = optionIdx;
        opt.textContent = option;
        select.appendChild(opt);
      });
      select.value = response?.[idx] ?? 0;
      select.addEventListener("change", () => {
        const updated = [...(response || [])];
        updated[idx] = Number(select.value);
        updateAttemptResponse(question.id, updated);
      });
      wrapper.appendChild(label);
      wrapper.appendChild(select);
      inputArea.appendChild(wrapper);
    });
  }

  if (question.type === "multi_numeric") {
    const labels = ["Part 1", "Part 2", "Part 3"];
    question.answer.forEach((_, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "multi-row";
      const label = document.createElement("span");
      label.textContent = labels[idx] || `Part ${idx + 1}`;
      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "decimal";
      input.value = response?.[idx] ?? "";
      input.addEventListener("input", () => {
        const updated = [...(response || [])];
        updated[idx] = input.value;
        updateAttemptResponse(question.id, updated);
      });
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      inputArea.appendChild(wrapper);
    });
  }

  container.appendChild(inputArea);
  if (question.steps && MODE_CONFIG[state.attempt.mode].feedback) {
    const hintButton = document.createElement("button");
    hintButton.className = "ghost";
    hintButton.textContent = "Show Hint";
    hintButton.addEventListener("click", () => {
      const current = state.attempt.hintUsage[question.id] || 0;
      state.attempt.hintUsage[question.id] = current + 1;
      const hint = container.querySelector(".hint-content");
      if (hint) {
        hint.remove();
        hintButton.textContent = "Show Hint";
        return;
      }
      const hintPanel = document.createElement("div");
      hintPanel.className = "hint-content";
      hintPanel.innerHTML = `<ul>${question.steps.map((step) => `<li>${step}</li>`).join("")}</ul>`;
      container.appendChild(hintPanel);
      hintButton.textContent = "Hide Hint";
    });
    container.appendChild(hintButton);
  }
  renderQuestionMeta(question);
  renderFeedback(question);
};

const renderQuestionMeta = (question) => {
  setText($("#question-domain"), question.domainName || DOMAIN_NAMES[question.domain]);
  setText($("#question-difficulty"), question.difficulty);
  setText($("#question-type"), question.type);
  setText($("#question-counter"), `Q${state.attempt.currentIndex + 1} of ${state.attempt.questions.length}`);
  const flagButton = $("#flag-button");
  flagButton?.classList.toggle("active", Boolean(state.attempt.flags[question.id]));
  const drillStats = $("#drill-stats");
  if (state.attempt.mode === "drills") {
    const times = Object.values(state.attempt.timeSpent || {});
    const avg = times.length ? Math.round(times.reduce((sum, val) => sum + val, 0) / times.length) : 0;
    setText(drillStats, `Streak: ${state.attempt.streak} · Best: ${state.attempt.bestStreak} · Avg time: ${avg}s`);
  } else {
    setText(drillStats, "");
  }
};

const renderFeedback = (question) => {
  const feedback = $("#question-feedback");
  if (!feedback) return;
  const modeConfig = MODE_CONFIG[state.attempt.mode];
  if (!modeConfig.feedback) {
    feedback.innerHTML = "";
    return;
  }
  const response = state.attempt.responses[question.id];
  const { correct } = scoreQuestion(question, response, { partialCredit: state.settings.partialCredit });
  feedback.innerHTML = `
    <div class="feedback ${correct ? "correct" : "incorrect"}">
      <strong>${correct ? "Correct" : "Not quite"}</strong>
      <p>${sanitizeHtml(question.explanation || "")}</p>
      ${question.steps ? `<ul>${question.steps.map((step) => `<li>${step}</li>`).join("")}</ul>` : ""}
    </div>
  `;
};

const goToQuestion = (index) => {
  if (!state.attempt) return;
  const question = state.attempt.questions[state.attempt.currentIndex];
  if (question) {
    updateTimeSpent(question.id, state.attempt.timeSpent[question.id] || 0);
  }
  state.attempt.currentIndex = Math.max(0, Math.min(index, state.attempt.questions.length - 1));
  storage.saveAttempt(state.attempt);
  renderQuestion();
};

const advanceFromDrill = () => {
  if (!state.attempt) return;
  const question = state.attempt.questions[state.attempt.currentIndex];
  if (!question) return;
  const response = state.attempt.responses[question.id];
  const { correct } = scoreQuestion(question, response, { partialCredit: state.settings.partialCredit });
  if (correct) {
    state.attempt.streak += 1;
    state.attempt.bestStreak = Math.max(state.attempt.bestStreak, state.attempt.streak);
  } else {
    state.attempt.streak = 0;
  }
};

const nextQuestion = () => {
  if (state.attempt?.mode === "drills") {
    advanceFromDrill();
  }
  goToQuestion(state.attempt.currentIndex + 1);
};
const prevQuestion = () => goToQuestion(state.attempt.currentIndex - 1);

const submitAttempt = () => {
  if (!state.attempt) return;
  state.attempt.status = "complete";
  const scored = scoreAttempt(state.attempt);
  state.attempt.scored = scored;
  storage.clearAttempt();
  saveHistory(scored.summary);
  computeWeaknessProfile();
  stopAutosave();
  renderResults(scored);
  switchView("results");
};

const scoreAttempt = (attempt) => {
  const detail = attempt.questions.map((question) => {
    const response = attempt.responses[question.id];
    const score = scoreQuestion(question, response, { partialCredit: state.settings.partialCredit });
    return {
      question,
      response,
      correct: score.correct,
      earned: score.earned,
      timeSpent: attempt.timeSpent[question.id] || 0,
      flags: Boolean(attempt.flags[question.id]),
    };
  });

  const totalEarned = detail.reduce((sum, d) => sum + d.earned, 0);
  const scorePercent = Math.round((totalEarned / attempt.questions.length) * 100);
  const passed = scorePercent >= 70;

  const breakdown = (key) => {
    const map = {};
    detail.forEach((d) => {
      const value = d.question[key];
      if (!map[value]) map[value] = { total: 0, correct: 0 };
      map[value].total += 1;
      map[value].correct += d.correct ? 1 : 0;
    });
    return Object.entries(map).map(([label, stats]) => ({
      label: label === "undefined" ? "Unknown" : label,
      total: stats.total,
      correct: stats.correct,
      percent: Math.round((stats.correct / stats.total) * 100),
    }));
  };

  const timeBands = {
    "<20s": detail.filter((d) => d.timeSpent < 20),
    "20-60s": detail.filter((d) => d.timeSpent >= 20 && d.timeSpent <= 60),
    ">60s": detail.filter((d) => d.timeSpent > 60),
  };

  const timeBreakdown = Object.entries(timeBands).map(([label, items]) => ({
    label,
    total: items.length,
    correct: items.filter((item) => item.correct).length,
    percent: items.length ? Math.round((items.filter((item) => item.correct).length / items.length) * 100) : 0,
  }));

  return {
    summary: {
      scorePercent,
      passed,
      totalEarned,
      questionCount: attempt.questions.length,
      mode: attempt.mode,
      seed: attempt.seed,
      attemptId: attempt.attemptId,
      timeUsed: attempt.elapsedSeconds,
    },
    detail,
    breakdowns: {
      domain: breakdown("domainName"),
      type: breakdown("type"),
      difficulty: breakdown("difficulty"),
      time: timeBreakdown,
    },
  };
};

const saveHistory = (summary) => {
  const history = storage.loadHistory();
  const next = [{ ...summary, date: new Date().toISOString() }, ...history].slice(0, 10);
  storage.saveHistory(next);
};

const computeWeaknessProfile = () => {
  const history = storage.loadHistory();
  if (!history.length) return;
  const domainScores = {};
  const typeScores = {};
  const difficultyScores = {};
  history.forEach((attempt) => {
    attempt.domainBreakdown?.forEach((entry) => {
      if (!domainScores[entry.label]) domainScores[entry.label] = [];
      domainScores[entry.label].push(entry.percent);
    });
    attempt.typeBreakdown?.forEach((entry) => {
      if (!typeScores[entry.label]) typeScores[entry.label] = [];
      typeScores[entry.label].push(entry.percent);
    });
    attempt.difficultyBreakdown?.forEach((entry) => {
      if (!difficultyScores[entry.label]) difficultyScores[entry.label] = [];
      difficultyScores[entry.label].push(entry.percent);
    });
  });
  const domains = Object.entries(domainScores).map(([label, scores]) => ({
    label,
    average: scores.reduce((sum, val) => sum + val, 0) / scores.length,
  })).sort((a, b) => a.average - b.average).slice(0, 3).map((item) => ({
    id: Number(Object.keys(DOMAIN_NAMES).find((key) => DOMAIN_NAMES[key] === item.label)) || 2,
    weight: 0.5,
  }));
  const types = Object.entries(typeScores).map(([label, scores]) => ({
    id: label,
    average: scores.reduce((sum, val) => sum + val, 0) / scores.length,
  })).sort((a, b) => a.average - b.average).slice(0, 3).map((item) => ({ id: item.id, weight: 0.4 }));
  const difficulties = Object.entries(difficultyScores).map(([label, scores]) => ({
    id: label,
    average: scores.reduce((sum, val) => sum + val, 0) / scores.length,
  })).sort((a, b) => a.average - b.average).slice(0, 2).map((item) => ({ id: item.id, weight: 0.3 }));
  const profile = { domains, types, difficulties };
  storage.saveWeakness(profile);
};

const renderHistory = () => {
  const history = storage.loadHistory();
  const container = $("#history-list");
  if (!container) return;
  container.innerHTML = "";
  if (!history.length) {
    container.innerHTML = "<p>No attempts yet.</p>";
    return;
  }
  history.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = `
      <div>
        <strong>${MODE_CONFIG[item.mode]?.label || item.mode}</strong>
        <div class="muted">${new Date(item.date).toLocaleString()}</div>
      </div>
      <div class="pill ${item.passed ? "pill-pass" : "pill-fail"}">${item.scorePercent}%</div>
    `;
    container.appendChild(row);
  });
};

const renderHistoryChart = () => {
  const history = storage.loadHistory();
  const chart = $("#history-chart");
  if (!chart) return;
  chart.innerHTML = "";
  history.slice().reverse().forEach((item) => {
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${item.scorePercent}%`;
    bar.title = `${item.scorePercent}%`;
    chart.appendChild(bar);
  });
};

const renderResults = (scored) => {
  const { summary, breakdowns, detail } = scored;
  setText($("#results-score"), `${summary.scorePercent}%`);
  $("#results-score")?.classList.toggle("pass", summary.passed);
  $("#results-score")?.classList.toggle("fail", !summary.passed);
  setText($("#results-status"), summary.passed ? "Pass" : "Needs more practice");
  setText($("#results-mode"), MODE_CONFIG[summary.mode]?.label || summary.mode);
  setText($("#results-seed"), summary.seed);
  setText($("#results-time"), formatTime(summary.timeUsed));

  const summaryTable = $("#results-summary");
  summaryTable.innerHTML = `
    <div>Questions: ${summary.questionCount}</div>
    <div>Score: ${summary.scorePercent}%</div>
    <div>Time Used: ${formatTime(summary.timeUsed)}</div>
  `;

  renderBreakdownTable($("#breakdown-domain"), breakdowns.domain);
  renderBreakdownTable($("#breakdown-type"), breakdowns.type);
  renderBreakdownTable($("#breakdown-difficulty"), breakdowns.difficulty);
  renderBreakdownTable($("#breakdown-time"), breakdowns.time);

  renderReviewList(detail);
  renderHistoryChart();

  const history = storage.loadHistory();
  const summaryItem = history[0];
  if (summaryItem) {
    summaryItem.domainBreakdown = breakdowns.domain;
    storage.saveHistory(history);
  }
};

const renderBreakdownTable = (container, entries) => {
  if (!container) return;
  container.innerHTML = entries.map((entry) => `
    <div class="breakdown-row">
      <span>${entry.label}</span>
      <span>${entry.correct}/${entry.total} (${entry.percent}%)</span>
    </div>
  `).join("");
};

const renderReviewList = (detail) => {
  const list = $("#review-list");
  list.innerHTML = "";
  const filters = getActiveFilters();
  detail.filter((item) => applyReviewFilters(item, filters)).forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "review-row";
    row.innerHTML = `
      <div>
        <strong>Q${index + 1}</strong> ${sanitizeHtml(item.question.prompt)}
        <div class="muted">Domain: ${item.question.domainName} · Type: ${item.question.type} · Time: ${item.timeSpent}s · Changes: ${state.attempt.answerChanges[item.question.id] || 0} · Hints: ${state.attempt.hintUsage[item.question.id] || 0}</div>
      </div>
      <div class="pill ${item.correct ? "pill-pass" : "pill-fail"}">${item.correct ? "Correct" : "Incorrect"}</div>
    `;
    row.addEventListener("click", () => toggleAnswerKey(row, item));
    list.appendChild(row);
  });
};

const toggleAnswerKey = (row, item) => {
  const existing = row.querySelector(".answer-key");
  if (existing) {
    existing.remove();
    return;
  }
  const key = document.createElement("div");
  key.className = "answer-key";
  key.innerHTML = `
    <div><strong>Your answer:</strong> ${normalizeAnswerForDisplay(item.question, item.response)}</div>
    <div><strong>Correct answer:</strong> ${normalizeAnswerForDisplay(item.question, item.question.answer)}</div>
    ${item.question.steps ? `<ul>${item.question.steps.map((step) => `<li>${step}</li>`).join("")}</ul>` : ""}
  `;
  row.appendChild(key);
};

const getActiveFilters = () => {
  const filters = {
    status: $("#filter-status")?.value || "all",
    domain: $("#filter-domain")?.value || "all",
    type: $("#filter-type")?.value || "all",
    flagged: $("#filter-flagged")?.checked || false,
  };
  return filters;
};

const applyReviewFilters = (item, filters) => {
  if (filters.status === "incorrect" && item.correct) return false;
  if (filters.status === "correct" && !item.correct) return false;
  if (filters.domain !== "all" && item.question.domainName !== filters.domain) return false;
  if (filters.type !== "all" && item.question.type !== filters.type) return false;
  if (filters.flagged && !item.flags) return false;
  return true;
};

const updateReviewFilters = () => {
  if (!state.attempt?.scored) return;
  renderReviewList(state.attempt.scored.detail);
};

const switchView = (view) => {
  state.view = view;
  hide($("#start-screen"));
  hide($("#exam-screen"));
  hide($("#results-screen"));
  if (view === "start") show($("#start-screen"));
  if (view === "exam") show($("#exam-screen"));
  if (view === "results") show($("#results-screen"));
};

const renderStartScreen = () => {
  const modeCards = $$(".mode-card");
  modeCards.forEach((card) => {
    card.classList.toggle("active", card.dataset.mode === state.settings.mode);
  });

  const packSummary = $("#enabled-packs-summary");
  const enabled = state.settings.enabledPacks.map((id) => state.packs[id]?.name || id);
  setText(packSummary, enabled.length ? enabled.join(", ") : "None");

  $("#question-count")?.setAttribute("value", state.settings.blueprint.questionCount[state.settings.mode] || 20);
  $("#time-limit")?.setAttribute("value", state.settings.blueprint.timeLimitMinutes);

  const resumeButton = $("#resume-button");
  if (storage.loadAttempt()) show(resumeButton);
  else hide(resumeButton);

  $$(".advanced-row input").forEach((input) => {
    const type = input.dataset.weightType;
    const key = input.dataset.key;
    if (type === "domain") input.value = state.settings.blueprint.domainWeights[key];
    if (type === "difficulty") input.value = state.settings.blueprint.difficultyMix[key];
    if (type === "type") input.value = state.settings.blueprint.typeMix[key];
  });
};

const renderSettingsModal = () => {
  const packList = $("#pack-list");
  packList.innerHTML = "";
  state.packsIndex.forEach((pack) => {
    const row = document.createElement("label");
    row.className = "pack-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = pack.id;
    input.checked = state.settings.enabledPacks.includes(pack.id);
    input.addEventListener("change", () => {
      if (input.checked) state.settings.enabledPacks.push(pack.id);
      else state.settings.enabledPacks = state.settings.enabledPacks.filter((id) => id !== pack.id);
      persistSettings();
      renderStartScreen();
    });
    row.appendChild(input);
    row.appendChild(document.createTextNode(`${pack.name} — ${pack.description}`));
    packList.appendChild(row);
  });
  $("#fun-toggle")?.setAttribute("checked", state.settings.funMode);
  $("#partial-credit")?.setAttribute("checked", state.settings.partialCredit);
  $("#default-mode").value = state.settings.mode;
};

const resumeAttempt = () => {
  const saved = storage.loadAttempt();
  if (!saved) return;
  state.attempt = saved;
  switchView("exam");
  renderAttempt();
};

const renderAttempt = () => {
  if (!state.attempt) return;
  setText($("#mode-label"), MODE_CONFIG[state.attempt.mode]?.label || state.attempt.mode);
  if (MODE_CONFIG[state.attempt.mode].timeLimited) {
    setText($("#timer"), formatTime(state.attempt.timeLimitSeconds - state.attempt.elapsedSeconds));
  } else {
    setText($("#timer"), formatTime(state.attempt.elapsedSeconds));
  }
  renderQuestion();
  startAutosave();
};

const initEventListeners = () => {
  $$(".mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.settings.mode = card.dataset.mode;
      persistSettings();
      renderStartScreen();
    });
  });

  $("#start-button")?.addEventListener("click", () => {
    const mode = state.settings.mode;
    const attempt = buildAttempt(mode);
    state.attempt = attempt;
    switchView("exam");
    renderAttempt();
  });

  $("#resume-button")?.addEventListener("click", resumeAttempt);

  $("#settings-button")?.addEventListener("click", () => {
    renderSettingsModal();
    state.modals.settings.open();
  });
  $("#history-button")?.addEventListener("click", () => state.modals.history.open());

  $("#save-settings")?.addEventListener("click", () => {
    const modeSelect = $("#default-mode");
    if (modeSelect) state.settings.mode = modeSelect.value;
    state.settings.funMode = $("#fun-toggle")?.checked || false;
    state.settings.partialCredit = $("#partial-credit")?.checked || false;
    persistSettings();
    renderStartScreen();
    state.modals.settings.close();
  });

  $("#clear-history")?.addEventListener("click", () => {
    storage.clearAll();
    loadSettings();
    renderStartScreen();
    renderHistory();
  });

  $("#prev-button")?.addEventListener("click", prevQuestion);
  $("#next-button")?.addEventListener("click", nextQuestion);
  $("#flag-button")?.addEventListener("click", () => {
    const question = state.attempt?.questions[state.attempt.currentIndex];
    if (question) toggleFlag(question.id);
    renderQuestionMeta(question);
  });
  $("#submit-button")?.addEventListener("click", submitAttempt);

  $("#filter-status")?.addEventListener("change", updateReviewFilters);
  $("#filter-domain")?.addEventListener("change", updateReviewFilters);
  $("#filter-type")?.addEventListener("change", updateReviewFilters);
  $("#filter-flagged")?.addEventListener("change", updateReviewFilters);

  $("#retake-missed")?.addEventListener("click", () => retakeFiltered("incorrect"));
  $("#retake-flagged")?.addEventListener("click", () => retakeFlagged());
  $("#drill-from-missed")?.addEventListener("click", () => retakeFiltered("incorrect", "drills"));

  $("#download-pdf")?.addEventListener("click", () => {
    if (!state.attempt?.scored) return;
    const detail = state.attempt.scored.detail.map((item) => ({
      prompt: item.question.prompt,
      userAnswer: normalizeAnswerForDisplay(item.question, item.response),
      correctAnswer: normalizeAnswerForDisplay(item.question, item.question.answer),
      correct: item.correct,
    }));
    openPrintWindow({
      summary: [
        { label: "Score", value: `${state.attempt.scored.summary.scorePercent}%` },
        { label: "Questions", value: state.attempt.scored.summary.questionCount },
        { label: "Time Used", value: formatTime(state.attempt.scored.summary.timeUsed) },
      ],
      breakdowns: [
        { label: "Domain", value: state.attempt.scored.breakdowns.domain.map((d) => `${d.label}: ${d.percent}%`).join(" | ") },
        { label: "Type", value: state.attempt.scored.breakdowns.type.map((d) => `${d.label}: ${d.percent}%`).join(" | ") },
        { label: "Difficulty", value: state.attempt.scored.breakdowns.difficulty.map((d) => `${d.label}: ${d.percent}%`).join(" | ") },
      ],
      questions: detail,
      meta: {
        mode: MODE_CONFIG[state.attempt.mode]?.label || state.attempt.mode,
        seed: state.attempt.seed,
        attemptId: state.attempt.attemptId,
      },
    });
  });

  $("#new-attempt")?.addEventListener("click", () => {
    switchView("start");
  });

  $("#calculator-toggle")?.addEventListener("click", () => state.calculator.toggle());

  document.addEventListener("keydown", (event) => {
    if (state.view !== "exam") return;
    if (event.key === "ArrowRight") nextQuestion();
    if (event.key === "ArrowLeft") prevQuestion();
    if (event.shiftKey && event.key.toLowerCase() === "f") {
      const question = state.attempt?.questions[state.attempt.currentIndex];
      if (question) toggleFlag(question.id);
      renderQuestionMeta(question);
    }
    if (event.ctrlKey && event.key === "Enter") submitAttempt();
    if (event.key.toLowerCase() === "m") state.calculator.toggle();
    if (["1", "2", "3", "4", "5", "6"].includes(event.key)) {
      const question = state.attempt?.questions[state.attempt.currentIndex];
      if (question?.type === "mcq") {
        const idx = Number(event.key) - 1;
        if (question.choices[idx]) {
          updateAttemptResponse(question.id, idx);
          renderQuestion();
        }
      }
    }
  });

  $("#question-count")?.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    state.settings.blueprint.questionCount[state.settings.mode] = value;
    persistSettings();
  });

  $("#time-limit")?.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    state.settings.blueprint.timeLimitMinutes = value;
    persistSettings();
  });

  $$(".advanced-row input").forEach((input) => {
    input.addEventListener("change", () => {
      const type = input.dataset.weightType;
      const key = input.dataset.key;
      const value = Number(input.value);
      if (type === "domain") state.settings.blueprint.domainWeights[key] = value;
      if (type === "difficulty") state.settings.blueprint.difficultyMix[key] = value;
      if (type === "type") state.settings.blueprint.typeMix[key] = value;
      persistSettings();
    });
  });

  $("#reset-blueprint")?.addEventListener("click", () => {
    state.settings.blueprint = JSON.parse(JSON.stringify(defaultSettings.blueprint));
    persistSettings();
    renderStartScreen();
  });

  $("#open-pack-settings")?.addEventListener("click", () => state.modals.settings.open());
};

const retakeFiltered = (status, mode = null) => {
  if (!state.attempt?.scored) return;
  const detail = state.attempt.scored.detail;
  const filtered = detail.filter((item) => (status === "incorrect" ? !item.correct : item.correct));
  if (!filtered.length) return;
  const attempt = createDefaultAttemptState({
    mode: mode || state.settings.mode,
    timeLimitSeconds: state.settings.blueprint.timeLimitMinutes * 60,
    blueprint: state.settings.blueprint,
  });
  attempt.questions = filtered.map((item) => item.question);
  state.attempt = attempt;
  storage.saveAttempt(attempt);
  switchView("exam");
  renderAttempt();
};

const retakeFlagged = () => {
  if (!state.attempt?.scored) return;
  const detail = state.attempt.scored.detail;
  const filtered = detail.filter((item) => item.flags);
  if (!filtered.length) return;
  const attempt = createDefaultAttemptState({
    mode: state.settings.mode,
    timeLimitSeconds: state.settings.blueprint.timeLimitMinutes * 60,
    blueprint: state.settings.blueprint,
  });
  attempt.questions = filtered.map((item) => item.question);
  state.attempt = attempt;
  storage.saveAttempt(attempt);
  switchView("exam");
  renderAttempt();
};

const initDomainFilters = () => {
  const container = $("#domain-list");
  if (!container) return;
  container.innerHTML = Object.entries(DOMAIN_NAMES).map(([id, name]) => `
    <label class="domain-pill">
      <input type="checkbox" value="${id}" />
      <span>${name}</span>
    </label>
  `).join("");
};

const initReviewFilters = () => {
  const domainSelect = $("#filter-domain");
  const typeSelect = $("#filter-type");
  domainSelect.innerHTML = `<option value="all">All Domains</option>${Object.values(DOMAIN_NAMES).map((name) => `<option value="${name}">${name}</option>`).join("")}`;
  typeSelect.innerHTML = `<option value="all">All Types</option>${["mcq","msq","numeric","fill","order","match","multi_numeric"].map((type) => `<option value="${type}">${type}</option>`).join("")}`;
};

const init = async () => {
  loadSettings();
  await fetchPacks();
  initEventListeners();
  initDomainFilters();
  initReviewFilters();
  renderSettingsModal();
  renderStartScreen();
  renderHistory();
  state.modals.settings = createModal("settings-modal");
  state.modals.history = createModal("history-modal");
  state.calculator = initCalculator();
  switchView("start");
  if (storage.loadAttempt()) {
    show($("#resume-button"));
  }
  setInterval(updateTimer, 1000);
};

init();
