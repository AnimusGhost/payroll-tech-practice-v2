export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

export const show = (el) => {
  if (el) el.classList.remove("hidden");
};

export const hide = (el) => {
  if (el) el.classList.add("hidden");
};

export const setText = (el, value) => {
  if (el) el.textContent = value;
};

export const toggleActive = (el, state) => {
  if (!el) return;
  el.classList.toggle("active", state);
};

export const formatTime = (seconds) => {
  const clamped = Math.max(seconds, 0);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export const sanitizeHtml = (value) => {
  const allowed = ["STRONG", "EM", "BR", "UL", "OL", "LI", "P"];
  const container = document.createElement("div");
  container.innerHTML = value;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, null);
  const nodesToRemove = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!allowed.includes(node.tagName)) {
      nodesToRemove.push(node);
    }
  }
  nodesToRemove.forEach((node) => {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node);
    }
    parent.removeChild(node);
  });
  return container.innerHTML;
};

export const createModal = (id) => {
  const modal = document.getElementById(id);
  const overlay = modal?.querySelector(".modal-overlay");
  const closeButtons = modal?.querySelectorAll("[data-close]") || [];
  const open = () => modal?.classList.add("open");
  const close = () => modal?.classList.remove("open");
  overlay?.addEventListener("click", close);
  closeButtons.forEach((btn) => btn.addEventListener("click", close));
  return { open, close, modal };
};

export const initCalculator = () => {
  const calc = document.getElementById("calculator");
  const display = calc?.querySelector("input");
  const buttons = calc?.querySelectorAll("button");
  let current = "";
  let memory = 0;

  const updateDisplay = (value) => {
    if (!display) return;
    display.value = value;
  };

  const evaluate = () => {
    try {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${current || 0})`)();
      const rounded = Number(result.toFixed(6));
      current = String(rounded);
      updateDisplay(current);
    } catch (error) {
      updateDisplay("Err");
    }
  };

  buttons?.forEach((btn) => {
    btn.addEventListener("click", () => {
      const { action, value } = btn.dataset;
      if (action === "clear") {
        current = "";
        updateDisplay("");
        return;
      }
      if (action === "back") {
        current = current.slice(0, -1);
        updateDisplay(current);
        return;
      }
      if (action === "equals") {
        evaluate();
        return;
      }
      if (action === "copy") {
        navigator.clipboard?.writeText(display?.value || "");
        return;
      }
      if (action === "memory") {
        memory = Number(current || 0);
        return;
      }
      if (action === "recall") {
        current = String(memory);
        updateDisplay(current);
        return;
      }
      current += value;
      updateDisplay(current);
    });
  });

  const header = calc?.querySelector(".calc-header");
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  header?.addEventListener("mousedown", (event) => {
    dragging = true;
    offsetX = event.clientX - calc.offsetLeft;
    offsetY = event.clientY - calc.offsetTop;
  });
  document.addEventListener("mouseup", () => {
    dragging = false;
  });
  document.addEventListener("mousemove", (event) => {
    if (!dragging || !calc) return;
    calc.style.left = `${event.clientX - offsetX}px`;
    calc.style.top = `${event.clientY - offsetY}px`;
  });

  return {
    toggle: () => {
      calc?.classList.toggle("hidden");
    },
  };
};
