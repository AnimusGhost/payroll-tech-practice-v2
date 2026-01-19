const normalizeText = (value) => value.toString().trim().toLowerCase().replace(/\s+/g, " ");

const compareNumeric = (userValue, answer, tolerance = 0, relativeTolerance = null) => {
  const num = Number(userValue);
  if (Number.isNaN(num)) return false;
  if (relativeTolerance !== null) {
    const diff = Math.abs(num - answer);
    return diff <= Math.abs(answer) * relativeTolerance;
  }
  return Math.abs(num - answer) <= tolerance;
};

const compareArray = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
};

const scoreMsq = (selected, answer, partialCredit) => {
  const selectedSet = new Set(selected || []);
  const answerSet = new Set(answer || []);
  const isCorrect = selectedSet.size === answerSet.size && [...answerSet].every((v) => selectedSet.has(v));
  if (!partialCredit) return { correct: isCorrect, earned: isCorrect ? 1 : 0 };
  const correctCount = [...selectedSet].filter((v) => answerSet.has(v)).length;
  const incorrectCount = [...selectedSet].filter((v) => !answerSet.has(v)).length;
  const raw = Math.max(correctCount - incorrectCount, 0);
  const earned = answerSet.size ? raw / answerSet.size : 0;
  return { correct: isCorrect, earned: Math.min(earned, 1) };
};

const scoreOrder = (selected, answer, partialCredit) => {
  const isCorrect = compareArray(selected, answer);
  if (!partialCredit) return { correct: isCorrect, earned: isCorrect ? 1 : 0 };
  if (!Array.isArray(selected) || !Array.isArray(answer)) return { correct: false, earned: 0 };
  const matches = selected.filter((value, index) => value === answer[index]).length;
  return { correct: isCorrect, earned: matches / answer.length };
};

export const scoreQuestion = (question, response, options = {}) => {
  const { partialCredit = false } = options;
  if (!question) return { correct: false, earned: 0 };
  switch (question.type) {
    case "mcq": {
      const correct = response === question.answer;
      return { correct, earned: correct ? 1 : 0 };
    }
    case "msq":
      return scoreMsq(response, question.answer, partialCredit);
    case "numeric": {
      const correct = compareNumeric(response, question.answer, question.tolerance || 0, question.relativeTolerance ?? null);
      return { correct, earned: correct ? 1 : 0 };
    }
    case "fill": {
      const normalized = normalizeText(response || "");
      const acceptable = question.acceptable || [[question.answer]];
      const correct = acceptable.some((group) => group.map(normalizeText).includes(normalized));
      return { correct, earned: correct ? 1 : 0 };
    }
    case "order":
      return scoreOrder(response, question.correctOrder, partialCredit);
    case "match": {
      const correct = compareArray(response, question.answer);
      return { correct, earned: correct ? 1 : 0 };
    }
    case "multi_numeric": {
      if (!Array.isArray(response) || !Array.isArray(question.answer)) {
        return { correct: false, earned: 0 };
      }
      const checks = response.map((value, index) => compareNumeric(value, question.answer[index], question.tolerance || 0));
      const correct = checks.every(Boolean);
      if (!partialCredit) return { correct, earned: correct ? 1 : 0 };
      const earned = checks.filter(Boolean).length / question.answer.length;
      return { correct, earned };
    }
    default:
      return { correct: false, earned: 0 };
  }
};

export const normalizeAnswerForDisplay = (question, answer) => {
  if (answer === null || answer === undefined) return "-";
  switch (question.type) {
    case "mcq":
      return question.choices?.[answer] ?? "-";
    case "msq":
      return (answer || []).map((idx) => question.choices?.[idx]).join(", ");
    case "numeric":
      return `${question.unitHint || ""}${Number(answer).toFixed(2)}`;
    case "fill":
      return answer;
    case "order":
      return (answer || []).map((idx) => question.items?.[idx]).join(" → ");
    case "match":
      return (answer || []).map((idx, i) => `${question.left?.[i]} → ${question.right?.[idx]}`).join("; ");
    case "multi_numeric":
      return (answer || []).map((val) => Number(val).toFixed(2)).join(", ");
    default:
      return answer;
  }
};
