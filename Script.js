(() => {
  const existing = window.__globalExamPager;
  if (existing) {
    console.warn("Global Exam Pager est deja charge. Tape geHelp() pour voir les commandes.");
    return;
  }

  const state = {
    running: false,
    stopRequested: false,
    cycle: 0,
    clicks: 0,
    startedAt: null,
    lastAction: "idle",
    currentDelayMs: 60000,
    config: {
      nextTexts: ["suivant", "terminer", "next", "continuer"],
      passTexts: ["passer a la suite", "passer a la suite", "passer", "skip"],
      actionDelayMs: 800,
      oneMinuteMs: 60000,
      domTimeoutMs: 8000,
      agent: {
        enabled: true,
        endpoint: "http://localhost:11434/api/chat",
        model: "qwen3:4b",
        timeoutMs: 30000,
      },
    },
    agent: {
      lastQuestionKey: null,
      lastResult: null,
      highlighted: null,
      originalStyles: new WeakMap(),
      badge: null,
      panel: null,
      analyzing: false,
      observer: null,
    },
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitInterruptible = async (ms, chunkMs = 250) => {
    const startedAt = Date.now();
    while (!state.stopRequested) {
      const elapsed = Date.now() - startedAt;
      const remaining = ms - elapsed;
      if (remaining <= 0) return true;
      await wait(Math.min(chunkMs, remaining));
    }
    return false;
  };
  const isVisible = (el) =>
    !!(el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden");
  const isEnabled = (el) => el && !el.disabled && getComputedStyle(el).pointerEvents !== "none";

  const norm = (s) =>
    (s || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const findByTexts = (texts, root = document, selectors = "button, a") => {
    const candidates = [...root.querySelectorAll(selectors)].filter(isVisible);
    for (const el of candidates) {
      const text = norm(el.textContent);
      if (texts.some((target) => text.includes(norm(target)))) return el;
    }
    return null;
  };

  const waitForDomChange = (excludeEl) =>
    new Promise((resolve) => {
      let timer;
      const obs = new MutationObserver((mutations) => {
        const relevant = mutations.some((m) => !excludeEl || !excludeEl.contains(m.target));
        if (relevant) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            obs.disconnect();
            resolve();
          }, 300);
        }
      });

      obs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      setTimeout(() => {
        try {
          obs.disconnect();
        } catch {}
        resolve();
      }, state.config.domTimeoutMs);
    });

  const log = (message) => {
    state.lastAction = message;
    console.log(`[Global Exam Pager] ${message}`);
  };

  const agentLog = (message) => {
    state.lastAction = `agent: ${message}`;
    console.log(`[Global Exam Assistant] ${message}`);
  };

  const textOf = (el) => {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("#global-exam-assistant, .global-exam-assistant-badge").forEach((node) => node.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  };

  const escapeHtml = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);

  const cssEscape = (value) =>
    window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(value)
      : String(value).replace(/["\\]/g, "\\$&");

  const getChoiceLabel = (index) => {
    let value = index;
    let label = "";
    do {
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return label;
  };

  const getInteractiveChoiceElement = (el) => {
    if (!el) return null;
    return el.closest("label, li, [role='radio'], [role='checkbox'], button, .answer, .choice, .option") || el;
  };

  const getQuestionContainers = () => {
    const selectors = [
      "[role='main']",
      "main",
      "form",
      "[class*='question']",
      "[class*='quiz']",
      "[class*='exam']",
      "[class*='assessment']",
      "body",
    ];
    return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))].filter(isVisible);
  };

  const collectChoicesFromInputs = (root) => {
    const inputs = [...root.querySelectorAll("input[type='radio'], input[type='checkbox']")];
    return inputs
      .map((input) => {
        const element = getInteractiveChoiceElement(input);
        const label = input.id ? document.querySelector(`label[for="${cssEscape(input.id)}"]`) : null;
        const text =
          textOf(element) ||
          textOf(label) ||
          input.getAttribute("aria-label") ||
          input.value ||
          "";
        return { text, element };
      })
      .filter((choice) => choice.element && isVisible(choice.element) && norm(choice.text));
  };

  const collectChoicesFromRoles = (root) =>
    [...root.querySelectorAll("[role='radio'], [role='checkbox'], [role='option']")]
      .filter(isVisible)
      .map((el) => ({ text: textOf(el) || el.getAttribute("aria-label") || "", element: getInteractiveChoiceElement(el) }))
      .filter((choice) => norm(choice.text));

  const collectChoicesFromButtons = (root) =>
    [...root.querySelectorAll("button, [role='button'], li")]
      .filter((el) => isVisible(el) && isEnabled(el))
      .map((el) => ({ text: textOf(el) || el.getAttribute("aria-label") || "", element: getInteractiveChoiceElement(el) }))
      .filter((choice) => {
        const text = norm(choice.text);
        if (!text) return false;
        if (state.config.nextTexts.concat(state.config.passTexts).some((target) => text.includes(norm(target)))) return false;
        return text.length > 1;
      });

  const uniqueChoices = (choices) => {
    const seen = new Set();
    return choices.filter((choice) => {
      const key = `${norm(choice.text)}::${choice.element.tagName}::${choice.element.className}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const inferQuestionText = (root, choices) => {
    const choiceTexts = new Set(choices.map((choice) => norm(choice.text)));
    const heading = [...root.querySelectorAll("h1, h2, h3, [class*='question'], legend, [role='heading']")]
      .filter(isVisible)
      .map(textOf)
      .find((text) => {
        const normalized = norm(text);
        return normalized && !choiceTexts.has(normalized) && normalized.length > 8;
      });
    if (heading) return heading;

    const bodyText = textOf(root);
    let question = bodyText;
    for (const choice of choices) {
      question = question.replace(choice.text, " ");
    }
    return question.replace(/\s+/g, " ").trim();
  };

  const extractJsonObject = (text) => {
    try {
      return JSON.parse(text);
    } catch {}

    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON introuvable dans la reponse du modele.");
    return JSON.parse(match[0]);
  };

  const renderAssistantPanel = () => {
    if (!state.agent.panel) {
      const panel = document.createElement("div");
      panel.id = "global-exam-assistant";
      panel.style.cssText = [
        "position:fixed",
        "right:16px",
        "bottom:16px",
        "z-index:2147483647",
        "width:min(340px,calc(100vw - 32px))",
        "max-height:60vh",
        "overflow:auto",
        "box-sizing:border-box",
        "padding:14px",
        "border:1px solid #93c5fd",
        "border-radius:8px",
        "background:#ffffff",
        "color:#111827",
        "box-shadow:0 12px 32px rgba(15,23,42,.24)",
        "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      ].join(";");
      document.body.appendChild(panel);
      state.agent.panel = panel;
    }

    const result = state.agent.lastResult;
    const choice = result && result.choiceText ? `${getChoiceLabel(result.choice)} — ${result.choiceText}` : "Aucune";
    const confidence = result && Number.isFinite(result.confidence) ? `${Math.round(result.confidence * 100)} %` : "-";
    const explanation = result && result.explanation ? result.explanation : "";
    const status = state.agent.analyzing ? "Analyse en cours..." : result && result.error ? result.error : "";

    state.agent.panel.innerHTML = `
      <div style="font-weight:700;font-size:15px;margin-bottom:10px;">Global Exam Assistant</div>
      <div style="margin-bottom:8px;"><strong>Réponse recommandée :</strong><br>${escapeHtml(choice)}</div>
      <div style="margin-bottom:8px;"><strong>Confiance :</strong> ${escapeHtml(confidence)}</div>
      <div style="margin-bottom:10px;"><strong>Explication :</strong><br>${escapeHtml(explanation || "-")}</div>
      ${status ? `<div style="margin-bottom:10px;color:${result && result.error ? "#b91c1c" : "#2563eb"};">${escapeHtml(status)}</div>` : ""}
      <button type="button" id="global-exam-assistant-analyze" style="border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;padding:7px 10px;cursor:pointer;font:inherit;">Analyser</button>
    `;

    const button = state.agent.panel.querySelector("#global-exam-assistant-analyze");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      analyzeCurrentQuestion();
    });
  };

  const clearSuggestedAnswerHighlight = () => {
    const highlighted = state.agent.highlighted;
    if (highlighted) {
      const original = state.agent.originalStyles.get(highlighted) || {};
      highlighted.style.outline = original.outline || "";
      highlighted.style.outlineOffset = original.outlineOffset || "";
      highlighted.style.backgroundColor = original.backgroundColor || "";
      highlighted.style.boxShadow = original.boxShadow || "";
      highlighted.style.position = original.position || "";
      highlighted.style.transition = original.transition || "";
    }

    if (state.agent.badge) {
      state.agent.badge.remove();
      state.agent.badge = null;
    }

    state.agent.highlighted = null;
  };

  const highlightSuggestedAnswer = (choiceIndex) => {
    const data = extractCurrentQuestion();
    const choice = data.choices[choiceIndex];
    if (!choice) throw new Error(`Index de choix hors limites: ${choiceIndex}.`);

    clearSuggestedAnswerHighlight();

    const el = choice.element;
    state.agent.originalStyles.set(el, {
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      backgroundColor: el.style.backgroundColor,
      boxShadow: el.style.boxShadow,
      position: el.style.position,
      transition: el.style.transition,
    });

    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.outline = "4px solid #f59e0b";
    el.style.outlineOffset = "3px";
    el.style.backgroundColor = "rgba(245,158,11,.14)";
    el.style.boxShadow = "0 0 0 6px rgba(245,158,11,.16)";
    el.style.transition = "background-color .15s ease, box-shadow .15s ease, outline-color .15s ease";

    const badge = document.createElement("span");
    badge.className = "global-exam-assistant-badge";
    badge.setAttribute("aria-hidden", "true");
    const confidence = state.agent.lastResult && Number.isFinite(state.agent.lastResult.confidence)
      ? ` — ${Math.round(state.agent.lastResult.confidence * 100)} %`
      : "";
    badge.textContent = `Réponse recommandée${confidence}`;
    badge.style.cssText = [
      "display:inline-block",
      "margin-left:8px",
      "padding:3px 7px",
      "border-radius:999px",
      "background:#f59e0b",
      "color:#111827",
      "font:700 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "vertical-align:middle",
      "box-shadow:0 2px 6px rgba(0,0,0,.18)",
    ].join(";");
    el.appendChild(badge);

    state.agent.highlighted = el;
    state.agent.badge = badge;
    return choice;
  };

  const extractCurrentQuestion = () => {
    for (const root of getQuestionContainers()) {
      const choices = uniqueChoices([
        ...collectChoicesFromInputs(root),
        ...collectChoicesFromRoles(root),
        ...collectChoicesFromButtons(root),
      ]).slice(0, 12);

      if (choices.length < 2) continue;

      const question = inferQuestionText(root, choices);
      if (!norm(question)) continue;

      return {
        question,
        choices: choices.map((choice, index) => ({
          index,
          text: choice.text,
          element: choice.element,
        })),
      };
    }

    return { question: "", choices: [] };
  };

  const askLocalAgent = async (question, choices) => {
    if (!state.config.agent.enabled) throw new Error("Assistant IA desactive dans state.config.agent.enabled.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), state.config.agent.timeoutMs);
    const prompt = [
      "Tu es un assistant local pour recommander une reponse a une question d'examen.",
      "Reponds uniquement avec un objet JSON valide, sans Markdown, sans texte autour.",
      'Format exact: {"choice":1,"confidence":0.92,"explanation":"Explication courte"}',
      "choice est l'index zero-based du tableau choices.",
      "Ne donne aucune instruction pour cliquer ou soumettre.",
      "",
      `Question: ${question}`,
      "Choices:",
      ...choices.map((choice) => `${choice.index}: ${choice.text}`),
    ].join("\n");

    try {
      const response = await fetch(state.config.agent.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: state.config.agent.model,
          stream: false,
          messages: [{ role: "user", content: prompt }],
          options: { temperature: 0 },
        }),
      });

      if (!response.ok) throw new Error(`Ollama a retourne HTTP ${response.status}.`);

      const payload = await response.json();
      const content = payload && payload.message && payload.message.content ? payload.message.content : payload.response;
      if (!content) throw new Error("Reponse Ollama vide ou inattendue.");

      const result = extractJsonObject(content);
      const choice = Number(result.choice);
      const confidence = Number(result.confidence);

      if (!Number.isInteger(choice)) throw new Error("JSON invalide: choice doit etre un entier.");
      if (choice < 0 || choice >= choices.length) throw new Error(`Index retourne hors limites: ${choice}.`);
      if (!Number.isFinite(confidence)) throw new Error("JSON invalide: confidence doit etre un nombre.");

      return {
        choice,
        confidence: Math.max(0, Math.min(1, confidence)),
        explanation: String(result.explanation || "").trim(),
      };
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("Timeout Ollama: aucune reponse recue dans le delai imparti.");
      if (error instanceof TypeError) throw new Error("Impossible de joindre Ollama. Verifie qu'Ollama tourne et que CORS autorise cette page.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const analyzeCurrentQuestion = async () => {
    renderAssistantPanel();
    clearSuggestedAnswerHighlight();

    const data = extractCurrentQuestion();
    const key = `${norm(data.question)}::${data.choices.map((choice) => norm(choice.text)).join("|")}`;
    state.agent.lastQuestionKey = key;

    if (!norm(data.question)) {
      state.agent.lastResult = { error: "Question introuvable." };
      renderAssistantPanel();
      return state.agent.lastResult;
    }

    if (data.choices.length < 2) {
      state.agent.lastResult = { error: "Choix introuvables ou insuffisants." };
      renderAssistantPanel();
      return state.agent.lastResult;
    }

    state.agent.analyzing = true;
    state.agent.lastResult = null;
    renderAssistantPanel();

    try {
      agentLog(`Analyse de la question avec ${data.choices.length} choix.`);
      const result = await askLocalAgent(data.question, data.choices);
      if (state.agent.lastQuestionKey !== key) {
        agentLog("La question a change pendant l'analyse. Relance geAnalyze().");
        return null;
      }

      state.agent.lastResult = {
        ...result,
        question: data.question,
        choiceText: data.choices[result.choice].text,
      };
      highlightSuggestedAnswer(result.choice);
      renderAssistantPanel();
      return state.agent.lastResult;
    } catch (error) {
      state.agent.lastResult = { error: error && error.message ? error.message : String(error) };
      renderAssistantPanel();
      console.warn("[Global Exam Assistant]", error);
      return state.agent.lastResult;
    } finally {
      state.agent.analyzing = false;
      renderAssistantPanel();
    }
  };

  const watchQuestionChanges = () => {
    if (state.agent.observer) return;

    state.agent.observer = new MutationObserver((mutations) => {
      if (
        mutations.every((mutation) => {
          const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
          return target && (target.closest("#global-exam-assistant") || target.closest(".global-exam-assistant-badge"));
        })
      ) {
        return;
      }

      const data = extractCurrentQuestion();
      const key = `${norm(data.question)}::${data.choices.map((choice) => norm(choice.text)).join("|")}`;
      if (state.agent.lastQuestionKey && key && key !== state.agent.lastQuestionKey) {
        clearSuggestedAnswerHighlight();
        state.agent.lastQuestionKey = key;
        state.agent.lastResult = null;
        renderAssistantPanel();
      }
    });

    state.agent.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };

  const clickIfPossible = async (el, label) => {
    if (el && isEnabled(el)) {
      el.click();
      state.clicks += 1;
      log(label);
      await waitForDomChange(el);
      await wait(state.config.actionDelayMs);
      return true;
    }
    return false;
  };

  const statusSnapshot = () => ({
    running: state.running,
    stopRequested: state.stopRequested,
    cycle: state.cycle,
    clicks: state.clicks,
    startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : null,
    currentDelayMs: state.currentDelayMs,
    lastAction: state.lastAction,
  });

  const showStatus = () => {
    const snapshot = statusSnapshot();
    console.table(snapshot);
    return snapshot;
  };

  const stop = () => {
    state.stopRequested = true;
    log("Arret demande. Le script va s'interrompre des que possible.");
  };

  const setDelaySeconds = (seconds) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) {
      console.warn("[Global Exam Pager] geDelay(seconds) attend un nombre > 0.");
      return state.config.oneMinuteMs;
    }

    state.config.oneMinuteMs = Math.round(value * 1000);
    state.currentDelayMs = state.config.oneMinuteMs;
    log(`Delai principal defini a ${value} seconde(s).`);
    return state.config.oneMinuteMs;
  };

  const help = () => {
    console.log(`
Global Exam Pager

Commandes disponibles :
- geStart() : demarre la boucle
- geStop()  : demande l'arret
- geStatus(): affiche l'etat courant
- geHelp()  : reaffiche cette aide
- geDelay(s): change le delai entre deux clics Next
- geAnalyze() / ga() : analyse la question courante avec Ollama
- geClearSuggestion() : retire le surlignage recommande

Alias courts :
- gs() : start
- gx() : stop
- gi() : infos
- gh() : help
- gd(s) : delai
    `.trim());
  };

  const run = async () => {
    if (state.running) {
      log("Le script tourne deja. Tape geStatus() pour voir l'etat.");
      return;
    }

    state.running = true;
    state.stopRequested = false;
    state.startedAt = Date.now();
    state.cycle = 1;
    log("Lancement... Tape geStop() ou gx() pour arreter.");

    try {
      while (!state.stopRequested) {
        log(`Cycle ${state.cycle}: recherche des boutons Next/Suivant jusqu'a voir Passer.`);

        while (!state.stopRequested) {
          const passBtn = findByTexts(state.config.passTexts);
          if (passBtn) break;

          const nextBtn = findByTexts(state.config.nextTexts);
          if (await clickIfPossible(nextBtn, `Click: "${nextBtn ? norm(nextBtn.textContent) : "next"}"`)) {
            state.currentDelayMs = state.config.oneMinuteMs;
            log(`Attente de ${Math.round(state.currentDelayMs / 1000)} secondes avant le prochain clic.`);
            await waitInterruptible(state.currentDelayMs);
            continue;
          }

          log("Aucun bouton cliquable detecte. Attente d'un changement DOM...");
          await waitForDomChange();
          await wait(state.config.actionDelayMs);
        }

        if (state.stopRequested) break;

        const passBtn = findByTexts(state.config.passTexts);
        if (await clickIfPossible(passBtn, `Click: "${passBtn ? norm(passBtn.textContent) : "passer"}"`)) {
          state.cycle += 1;
          continue;
        }

        log('Bouton "Passer" introuvable ou inactif. Nouvelle attente DOM...');
        await waitForDomChange();
      }
    } finally {
      state.running = false;
      state.currentDelayMs = state.config.oneMinuteMs;
      log("Script termine.");
    }
  };

  window.__globalExamPager = {
    start: run,
    stop,
    status: showStatus,
    help,
    delay: setDelaySeconds,
    extractCurrentQuestion,
    askLocalAgent,
    analyzeCurrentQuestion,
    highlightSuggestedAnswer,
    clearSuggestedAnswerHighlight,
    state,
  };

  window.geStart = run;
  window.geStop = stop;
  window.geStatus = showStatus;
  window.geHelp = help;
  window.geDelay = setDelaySeconds;
  window.geAnalyze = analyzeCurrentQuestion;
  window.geClearSuggestion = clearSuggestedAnswerHighlight;

  window.gs = run;
  window.gx = stop;
  window.gi = showStatus;
  window.gh = help;
  window.gd = setDelaySeconds;
  window.ga = analyzeCurrentQuestion;

  window.extractCurrentQuestion = extractCurrentQuestion;
  window.askLocalAgent = askLocalAgent;
  window.analyzeCurrentQuestion = analyzeCurrentQuestion;
  window.highlightSuggestedAnswer = highlightSuggestedAnswer;
  window.clearSuggestedAnswerHighlight = clearSuggestedAnswerHighlight;

  renderAssistantPanel();
  watchQuestionChanges();
  help();
  run();
})();
