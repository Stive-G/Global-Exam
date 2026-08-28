(() => {
  const ASSISTANT_VERSION = "6.3";
  const existing = window.__globalExamPager;
  if (existing) {
    const loadedVersion = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "ancienne/inconnue";
    console.warn(`Global Exam Assistant ${loadedVersion} est déjà chargé. Recharge la page (Ctrl+R) avant de charger la v${ASSISTANT_VERSION}.`);
    return;
  }
  window.__GLOBAL_EXAM_ASSISTANT_VERSION = ASSISTANT_VERSION;

  const state = {
    running: false,
    stopRequested: false,
    cycle: 0,
    clicks: 0,
    startedAt: null,
    lastAction: "idle",
    config: {
      nextTexts: ["suivant", "next", "continuer", "continue", "terminer", "finish"],
      validateTexts: ["valider", "validate", "confirmer", "confirm", "soumettre", "submit"],
      passTexts: ["passer a la suite", "passer", "skip"],
      pageDelayMs: 60000,
      actionDelayMs: 900,
      settleDelayMs: 1200,
      domTimeoutMs: 8000,
      activityPacing: {
        enabled: true,
        minMinutes: 30,
        maxMinutes: 30,
      },
      agent: {
        enabled: true,
        endpoint: "http://localhost:3000/api/chat",
        provider: "auto",
        model: "auto",
        timeoutMs: 20000,
        autoAnswer: true,
        autoConfidenceThreshold: 0.55,
        maxCompletionTokens: 260,
        maxRetries: 2,
        retryDelayMs: 1200,
        errorRetryMs: 3000,
        passiveNavigationWaitMs: 6000,
        contentStabilityMs: 1600,
        pageSettleMaxMs: 3500,
        validationConfirmMs: 5000,
        maxApplyAttempts: 5,
        doubleCheckComplex: true,
        adjudicateOnDisagreement: true,
        adjudicationMinConfidence: 0.80,
        adjudicationRepairAttempts: 2,
        adjudicationFallbackMinConfidence: 0.82,
        consensusConfidenceFloor: 0.82,
        lowConfidenceMaxRéanalyses: 2,
        dragStrategyRounds: 2,
        dragRoundDelayMs: 420,
      },
    },
    agent: {
      analyzing: false,
      processing: false,
      lastResult: null,
      lastQuestionKey: null,
      lastProcessedKey: null,
      panel: null,
      highlights: [],
      observer: null,
      wakeResolver: null,
      lastApplyVerified: false,
      blockedKey: null,
      blockReason: null,
      applyAttempts: new Map(),
      lowConfidenceRetries: new Map(),
      appliedPages: new Map(),
      partialMutation: false,
      internalClick: false,
      manualNavigationTimer: null,
      manualNavigationListenerInstalled: false,
      manualResumeToken: 0,
      manualResumePending: false,
      manualResumeLabel: null,
      manualResumeAt: null,
      panelCollapsed: false,
      lastProvider: null,
      lastModel: null,
      providerHistory: [],
    },
    activity: {
      targetDurationMs: null,
      inferredStartedAt: null,
      totalQuestions: null,
      lastCurrent: null,
      id: null,
    },
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (s) => String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  // Version plus permissive pour les textes d'interface : apostrophes droites/
  // typographiques, ponctuation et accents ne doivent pas casser la détection.
  const normLoose = (s) => norm(s)
    .replace(/[’'`´]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };

  const isEnabled = (el) => !!el && !el.disabled && el.getAttribute?.("aria-disabled") !== "true" && getComputedStyle(el).pointerEvents !== "none";
  const isAssistantElement = (el) => !!el?.closest?.("#global-exam-assistant, .global-exam-assistant-badge");

  const textOf = (el) => {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.("#global-exam-assistant, .global-exam-assistant-badge").forEach((n) => n.remove());
    return String(clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
  };

  const controlText = (el) => String(
    el?.innerText ||
    el?.textContent ||
    el?.value ||
    el?.getAttribute?.("aria-label") ||
    el?.getAttribute?.("title") ||
    ""
  ).replace(/\s+/g, " ").trim();

  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);

  const cssEscape = (value) => window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");

  const log = (message) => {
    state.lastAction = message;
    console.log(`[Global Exam Pager] ${message}`);
  };

  const agentLog = (message) => {
    state.lastAction = `agent: ${message}`;
    console.log(`[Global Exam Assistant] ${message}`);
  };

  const pageFingerprint = () => {
    const body = normLoose(textOf(document.body)).slice(0, 8000);
    const controls = [
      document.querySelectorAll("input,textarea,select,button,[role='button'],[role='radio'],[role='checkbox'],[draggable='true']").length,
      document.querySelectorAll("[class*='drop'],[class*='slot'],[class*='blank'],[class*='target']").length,
    ].join(":");
    return `${controls}::${body}`;
  };

  const waitForStablePage = async (stableMs = 500, maxMs = state.config.agent.pageSettleMaxMs) => {
    const started = Date.now();
    let last = pageFingerprint();
    let stableSince = Date.now();
    while (Date.now() - started < maxMs && !state.stopRequested) {
      await wait(150);
      const now = pageFingerprint();
      if (now === last) {
        if (Date.now() - stableSince >= stableMs) return true;
      } else {
        last = now;
        stableSince = Date.now();
      }
    }
    return false;
  };

  const hardBlock = (key, reason) => {
    state.agent.blockedKey = key || "unknown";
    state.agent.blockReason = reason || "Verification impossible";
    state.agent.lastApplyVerified = false;
    log(`BLOCAGE SECURITE: ${state.agent.blockReason}`);
  };

  const clearHardBlock = (silent = false) => {
    state.agent.blockedKey = null;
    state.agent.blockReason = null;
    state.agent.applyAttempts.clear();
    state.agent.lowConfidenceRetries.clear();
    if (!silent) log("Blocage de sécurité levé.");
    return true;
  };

  const getCandidateRoots = () => {
    const selectors = [
      "[class*='question']", "[class*='exercise']", "[class*='quiz']", "[class*='assessment']",
      "[class*='activity']", "[class*='content']", "form", "main", "[role='main']"
    ];
    const roots = [...new Set(selectors.flatMap((s) => [...document.querySelectorAll(s)]))]
      .filter((el) => isVisible(el) && !isAssistantElement(el));
    roots.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    return roots.length ? roots : [document.body];
  };

  const findQuestionRoot = () => {
    const roots = getCandidateRoots();
    const interesting = roots.find((root) => root.querySelector(
      "input[type='radio'],input[type='checkbox'],input[type='text'],textarea,select,[role='combobox'],[role='radio'],[role='checkbox'],[draggable='true'],[class*='drop'],[class*='slot'],[class*='blank'],[class*='match'],[class*='order']"
    ));
    return interesting || roots[0] || document.body;
  };

  const inferPrompt = (root, excludedTexts = []) => {
    const excludes = new Set(excludedTexts.map(norm));
    const candidates = [...root.querySelectorAll(
      "h1,h2,h3,h4,legend,[role='heading'],[class*='title'],[class*='prompt'],[class*='question'],p,[class*='statement'],[class*='instruction'],[class*='text']"
    )]
      .filter((el) => isVisible(el) && !isAssistantElement(el))
      .map(textOf)
      .filter((t) => {
        const n = norm(t);
        return n.length >= 5 && n.length <= 1400 && !excludes.has(n);
      });

    const unique = [...new Set(candidates)];
    if (unique.length) return unique.slice(0, 8).join("\n").slice(0, 3000);

    let txt = textOf(root);
    for (const ex of excludedTexts) txt = txt.replace(ex, " ");
    return txt.replace(/\s+/g, " ").trim().slice(0, 3000);
  };

  const getLabelForInput = (input) => {
    if (input.id) {
      const l = document.querySelector(`label[for="${cssEscape(input.id)}"]`);
      if (l) return textOf(l);
    }
    const closest = input.closest("label,[class*='answer'],[class*='choice'],[class*='option'],li");
    return textOf(closest) || input.getAttribute("aria-label") || input.value || "";
  };

  const visibleControls = (selector, root = document) => [...root.querySelectorAll(selector)]
    .filter((el) => isVisible(el) && isEnabled(el) && !isAssistantElement(el));

  // Global Exam masque parfois le vrai <input radio/checkbox> et n'affiche que
  // son label/wrapper. Un détecteur basé uniquement sur isVisible(input) rate alors
  // une vraie question. On cherche donc la surface visible associee au controle.
  const associatedChoiceSurface = (input) => {
    if (!input || isAssistantElement(input)) return null;

    if (input.id) {
      const label = document.querySelector(`label[for="${cssEscape(input.id)}"]`);
      if (label && isVisible(label) && !isAssistantElement(label)) return label;
    }

    const direct = input.closest("label,[role='radio'],[role='checkbox'],[class*='answer'],[class*='choice'],[class*='option'],[class*='response'],li");
    if (direct && isVisible(direct) && !isAssistantElement(direct)) return direct;

    let node = input.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      if (isAssistantElement(node) || !isVisible(node)) continue;
      const t = norm(textOf(node));
      if (t.length >= 2 && t.length <= 600) return node;
    }

    return isVisible(input) ? input : null;
  };

  const nativeChoiceControls = (selector, root) => [...root.querySelectorAll(selector)]
    .filter((el) => !el.disabled && el.getAttribute?.("aria-disabled") !== "true" && !isAssistantElement(el))
    .map((input) => ({ input, surface: associatedChoiceSurface(input) }))
    .filter((x) => x.surface && isVisible(x.surface));

  const detectSingleChoice = (root) => {
    const native = nativeChoiceControls("input[type='radio']", root)
      .map(({ input, surface }, index) => ({
        index,
        text: getLabelForInput(input) || textOf(surface),
        element: surface,
        input,
      }))
      .filter((c) => norm(c.text));

    if (native.length >= 2) {
      return { type: "single-choice", root, choices: native, prompt: inferPrompt(root, native.map((c) => c.text)) };
    }

    const roleRadios = visibleControls("[role='radio']", root);
    if (roleRadios.length < 2) return null;
    const choices = roleRadios.map((el, index) => ({ index, text: textOf(el) || el.getAttribute("aria-label") || "", element: el, input: el }))
      .filter((c) => norm(c.text));
    if (choices.length < 2) return null;
    return { type: "single-choice", root, choices, prompt: inferPrompt(root, choices.map((c) => c.text)) };
  };

  const detectMultiChoice = (root) => {
    const native = nativeChoiceControls("input[type='checkbox']", root)
      .map(({ input, surface }, index) => ({
        index,
        text: getLabelForInput(input) || textOf(surface),
        element: surface,
        input,
      }))
      .filter((c) => norm(c.text));

    if (native.length >= 2) {
      return { type: "multi-choice", root, choices: native, prompt: inferPrompt(root, native.map((c) => c.text)) };
    }

    const roleBoxes = visibleControls("[role='checkbox']", root);
    if (roleBoxes.length < 2) return null;
    const choices = roleBoxes.map((el, index) => ({ index, text: textOf(el) || el.getAttribute("aria-label") || "", element: el, input: el }))
      .filter((c) => norm(c.text));
    if (choices.length < 2) return null;
    return { type: "multi-choice", root, choices, prompt: inferPrompt(root, choices.map((c) => c.text)) };
  };

  const detectMatrix = (root) => {
    const radios = visibleControls("input[type='radio']", root);
    if (radios.length < 4) return null;
    const groups = new Map();
    radios.forEach((r) => {
      const name = r.name || r.getAttribute("data-group") || "";
      if (!name) return;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    });
    if (groups.size < 2) return null;

    const rows = [...groups.entries()].map(([name, inputs], rowIndex) => ({
      rowIndex,
      name,
      rowText: textOf(inputs[0].closest("tr,[class*='row'],li,[class*='question']")) || `Ligne ${rowIndex + 1}`,
      choices: inputs.map((el, index) => ({ index, text: getLabelForInput(el), input: el, element: el.closest("label") || el })),
    }));
    return { type: "matrix", root, rows, prompt: inferPrompt(root, rows.flatMap((r) => r.choices.map((c) => c.text))) };
  };

  const detectText = (root) => {
    const fields = visibleControls("input[type='text'], input:not([type]), textarea", root).filter((el) => !el.readOnly);
    if (!fields.length) return null;
    const infos = fields.map((el, index) => ({
      index,
      element: el,
      label: textOf(el.closest("label,[class*='field'],[class*='blank'],[class*='question']")) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || `Champ ${index + 1}`,
    }));
    return {
      type: fields.length === 1 ? "text" : "multi-text",
      root,
      fields: infos,
      prompt: inferPrompt(root, infos.map((f) => f.label)),
    };
  };

  const detectSelect = (root) => {
    const selects = visibleControls("select", root);
    const comboboxes = visibleControls("[role='combobox']", root).filter((el) => !el.matches("select"));
    if (!selects.length && !comboboxes.length) return null;

    const fields = [
      ...selects.map((el, index) => ({
        index,
        kind: "select",
        element: el,
        label: textOf(el.closest("label,[class*='field'],[class*='question']")) || el.getAttribute("aria-label") || `Liste ${index + 1}`,
        options: [...el.options].map((o, i) => ({ index: i, value: o.value, text: o.textContent.trim(), disabled: o.disabled })),
      })),
      ...comboboxes.map((el, index) => ({
        index: selects.length + index,
        kind: "combobox",
        element: el,
        label: textOf(el.closest("label,[class*='field'],[class*='question']")) || el.getAttribute("aria-label") || `Liste ${selects.length + index + 1}`,
        options: [],
      })),
    ];

    return { type: fields.length === 1 ? "select" : "multi-select", root, fields, prompt: inferPrompt(root, fields.map((f) => f.label)) };
  };

  const deepestUniqueElements = (elements) => {
    const uniq = [...new Set(elements)];
    return uniq.filter((el) => !uniq.some((other) => other !== el && el.contains(other)));
  };

  const dedupeByText = (entries) => {
    const seen = new Set();
    return entries.filter((entry) => {
      const key = norm(entry.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const dropZoneSelector = [
    "[data-dropzone]", "[role='listbox'][class*='drop']", "[class*='drop-zone']",
    "[class*='dropzone']", "[class*='droppable']", "[class*='slot']",
    "[class*='target']", "[class*='blank']"
  ].join(",");

  const getLiveZoneElements = (root = document) => {
    let els = visibleControls(dropZoneSelector, root);
    if (!els.length) els = visibleControls("[class*='drop']", root);
    return deepestUniqueElements(els);
  };

  const zoneContext = (el, index) => {
    const container = el.closest("p,li,[class*='sentence'],[class*='row'],[class*='line'],[class*='statement']") || el.parentElement;
    if (!container) return `Zone ${index + 1}`;

    // Conserver la position exacte du trou dans la phrase. Deux zones presentes
    // dans le meme bloc ne doivent pas envoyer le meme contexte a l'IA.
    try {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(container);
      beforeRange.setEndBefore(el);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(container);
      afterRange.setStartAfter(el);

      const before = String(beforeRange.toString() || "").replace(/\s+/g, " ").trim().slice(-220);
      const after = String(afterRange.toString() || "").replace(/\s+/g, " ").trim().slice(0, 220);
      const positioned = `${before} [[ZONE_${index}]] ${after}`.replace(/\s+/g, " ").trim();
      if (positioned.replace(`[[ZONE_${index}]]`, "").trim()) {
        return `Zone ${index + 1} — ${positioned}`;
      }
    } catch {}

    const context = textOf(container).replace(/\s+/g, " ").trim().slice(0, 420);
    return context ? `Zone ${index + 1} — contexte: ${context}` : `Zone ${index + 1}`;
  };

  const isNavLikeText = (text) => {
    const raw = String(text || "").trim();
    if (/^[?!.,;:]+$/.test(raw)) return false;
    const t = normLoose(raw);
    const nav = [...state.config.nextTexts, ...state.config.validateTexts, ...state.config.passTexts].map(normLoose);
    return !t || nav.some((x) => t === x || t.startsWith(`${x} `));
  };

  const looksInteractiveChip = (el) => {
    if (!el || isAssistantElement(el) || !isVisible(el) || !isEnabled(el)) return false;
    const text = textOf(el);
    if (!text || text.length > 180 || isNavLikeText(text)) return false;
    const role = el.getAttribute?.("role") || "";
    const cls = String(el.className || "").toLowerCase();
    const cursor = getComputedStyle(el).cursor;
    return el.matches("button,[draggable='true'],[aria-grabbed],[data-rbd-draggable-id],[data-draggable='true']") ||
      role === "button" || role === "option" || el.tabIndex >= 0 || cursor === "pointer" ||
      /drag|word|chip|token|item|option/.test(cls);
  };

  const bodyInstruction = () => normLoose(textOf(document.body));
  const hasAnyInstruction = (markers) => {
    const b = bodyInstruction();
    return markers.some((m) => b.includes(normLoose(m)));
  };


  // v5.2 — Identité stable de la page, indépendante du type détecté après mutation DOM.
  // Exemple: un fill-in-the-blanks peut commencer en drag-drop puis, une fois rempli,
  // les mots poses ressemblent a des boutons. On ne doit pas le prendre pour une nouvelle question.
  const currentProgressMarker = () => {
    const body = String(document.body?.innerText || '');
    const matches = [...body.matchAll(/(?:^|\s)(\d{1,3})\s*\/\s*(\d{1,3})(?=\s|$)/gm)]
      .map((m) => ({ current: Number(m[1]), total: Number(m[2]) }))
      .filter((x) => x.current >= 0 && x.total > 0 && x.current <= x.total && x.total <= 500);
    return matches.length ? `${matches[0].current}/${matches[0].total}` : '';
  };

  const stableInstructionText = () => {
    const selectors = 'h1,h2,h3,h4,h5,h6,[class*=instruction],[class*=title],[class*=question]';
    const candidates = [...document.querySelectorAll(selectors)]
      .filter((el) => isVisible(el) && !isAssistantElement(el))
      .map((el) => textOf(el).trim())
      .filter((t) => t.length >= 8 && t.length <= 260)
      .filter((t) => !/^\d+\s*\/\s*\d+$/.test(t));
    const explicit = candidates.find((t) => {
      const n = normLoose(t);
      return [...dragInstructionMarkers, ...orderingInstructionMarkers].some((m) => n.includes(normLoose(m)));
    });
    return explicit || candidates[0] || '';
  };

  const pageIdentity = () => {
    const progress = currentProgressMarker();
    const instruction = normLoose(stableInstructionText()).slice(0, 180);
    return `${progress || 'no-progress'}::${instruction || 'no-instruction'}`;
  };

  const rememberAppliedPage = (q, source = 'script') => {
    const id = pageIdentity();
    state.agent.appliedPages.set(id, {
      at: Date.now(), source, type: q?.type || '', key: q?.key || '',
    });
    return id;
  };

  const wasPageApplied = () => state.agent.appliedPages.has(pageIdentity());


  // v5.3 - Un changement de TYPE ou de DOM n'est pas un changement de page.
  // Drag/drop et ordering modifient fortement React (drag-drop -> button-choice/answered).
  // La progression N/Total est la preuve prioritaire d'une vraie navigation.
  const pageTransitionSnapshot = () => ({
    progress: currentProgressMarker(),
    identity: pageIdentity(),
  });

  const hasReallyNavigated = (beforeSnap, beforeQ = null, afterQ = null) => {
    const afterSnap = pageTransitionSnapshot();
    if (beforeSnap?.progress && afterSnap.progress) {
      return beforeSnap.progress !== afterSnap.progress;
    }
    // Fallback si la progression n'est pas disponible: changement d'identité stable ET
    // question non similaire. Un simple changement de type après mutation ne suffit jamais.
    if (beforeSnap?.identity && afterSnap.identity && beforeSnap.identity !== afterSnap.identity) {
      if (beforeQ && afterQ && sameQuestion(beforeQ, afterQ)) return false;
      return true;
    }
    return false;
  };

  const zoneDirectText = (el) => textOf(el).replace(/\s+/g, ' ').trim();
  const emptyZoneMarkers = ['drop here','drop','deposer ici','deposez ici','placer ici','place here','glisser ici','drag here'];
  const isZoneFilled = (el) => {
    const t = normLoose(zoneDirectText(el));
    if (!t) return false;
    if (emptyZoneMarkers.some((m) => t === normLoose(m))) return false;
    return true;
  };

  const isFillWordsInstruction = () => {
    const body = bodyInstruction();
    return body.includes(normLoose('fill in the blanks with the following words')) ||
      body.includes(normLoose('fill in the blank with the following words'));
  };

  // Détecte les exercices dont la réponse est DÉJÀ presente dans le DOM.
  // Cette détection passe avant les fallbacks button-choice afin d'éviter de "re-repondre".
  const detectCompletedStructuredExercise = () => {
    const id = pageIdentity();

    if (isFillWordsInstruction()) {
      const zones = getLiveZoneElements(document.body);
      if (zones.length) {
        const filled = zones.filter(isZoneFilled);
        if (filled.length === zones.length) {
          return {
            type: 'answered', answeredKind: 'drag-drop', root: findQuestionRoot(),
            prompt: stableInstructionText(), key: `answered::${id}`,
            answerState: 'complete', detail: `${filled.length}/${zones.length} zones remplies`,
          };
        }
      }
    }

    if (hasAnyInstruction(orderingInstructionMarkers)) {
      const root = document.body;
      const instruction = findOrderingInstructionElement(root);
      const target = findOrderingTarget(root, instruction);
      if (target) {
        const targetText = norm(zoneDirectText(target));
        const remaining = collectOrderingCandidates(root, instruction, target);
        if (targetText && remaining.length === 0) {
          return {
            type: 'answered', answeredKind: 'ordering', root: findQuestionRoot(),
            prompt: stableInstructionText(), key: `answered::${id}`,
            answerState: 'complete', detail: 'ordre deja construit',
          };
        }
      }
    }

    return null;
  };

  const dragInstructionMarkers = [
    "fill in the blanks with the following words",
    "fill in the blank with the following words",
    "match the beginnings of the sentences with the endings",
    "match the beginnings with the endings",
    "match the words with their meanings",
    "match the words to their meanings",
    "match words with their meanings",
    "match words to their meanings",
    "match the following",
    "drag and drop"
  ];

  const orderingInstructionMarkers = [
    "place the words in the correct order",
    "put the words in the correct order",
    "correct order to form a question",
    "correct order to form a sentence",
    "reorder the words"
  ];


  // v5.5 - Les contrôles du lecteur audio/video ne sont jamais des réponses.
  const isExerciseUiNoiseText = (text) => {
    const t = normLoose(text);
    if (!t) return true;
    if (/^\d{1,3}\s*\/\s*\d{1,3}$/.test(String(text).trim())) return true;
    if (/^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}$/.test(String(text).trim())) return true;
    const exact = [
      'play','pause','volume','mute','unmute','audio','sound','video',
      'lire la video','lire la vidéo','ecouter','écouter','ecouter audio','écouter audio',
      'listen','listen audio','play video','play audio','replay','restart','back','previous'
    ].map(normLoose);
    if (exact.includes(t)) return true;
    if (/^(play|pause|listen|lire|ecouter|volume|mute|audio|video)\b/.test(t)) return true;
    return false;
  };

  const collectDragItems = (root) => {
    let els = visibleControls(
      "[draggable='true'],[aria-grabbed],[data-rbd-draggable-id],[data-draggable='true'],[class*='draggable'],[class*='drag-item'],[class*='dragItem']",
      root
    );
    if (!els.length && hasAnyInstruction(dragInstructionMarkers)) {
      els = [...root.querySelectorAll("button,[role='button'],[role='option'],[tabindex],li,[class*='word'],[class*='chip'],[class*='token'],[class*='item']")]
        .filter(looksInteractiveChip);
    }
    els = deepestUniqueElements(els).filter((el) => !el.closest(dropZoneSelector));
    return dedupeByText(
      els.map((el) => ({ text: textOf(el), element: el }))
        .filter((x) => norm(x.text) && !isExerciseUiNoiseText(x.text))
    ).map((x, index) => ({ index, ...x }));
  };

  const collectStructuralClickDropItems = (root, zonesEls = []) => {
    const els = deepestUniqueElements(
      [...root.querySelectorAll("button,[role='button'],[role='option'],[tabindex],li,[class*='word'],[class*='chip'],[class*='token'],[class*='item'],[class*='option']")]
        .filter(looksInteractiveChip)
        .filter((el) => !el.closest(dropZoneSelector))
        .filter((el) => !zonesEls.some((z) => z === el || z.contains(el)))
        .filter((el) => !isExerciseUiNoiseText(textOf(el)))
    );
    return dedupeByText(
      els.map((el) => ({ text: textOf(el), element: el })).filter((x) => norm(x.text))
    ).map((x, index) => ({ index, ...x }));
  };

  const looksLikeClickDropByStructure = (root, zonesEls, items) => {
    if ((zonesEls?.length || 0) < 2 || (items?.length || 0) < 1) return false;
    if (root.querySelector?.("input[type='radio'],input[type='checkbox'],[role='radio'],[role='checkbox']")) return false;
    const dashedCount = zonesEls.filter((el) => {
      const st = getComputedStyle(el);
      const styles = [st.borderTopStyle, st.borderRightStyle, st.borderBottomStyle, st.borderLeftStyle, st.outlineStyle];
      return styles.some((s) => s === 'dashed' || s === 'dotted');
    }).length;
    return dashedCount >= 1 || zonesEls.length >= 3;
  };

  const detectDragDrop = (root) => {
    const allZonesEls = getLiveZoneElements(root);
    if (!allZonesEls.length) return null;

    // v5.2: dans les "Fill in the blanks with the following words", une zone qui
    // contient déjà un mot est TERMINEE. On ne la renvoie jamais a Groq et on ne
    // tente jamais d'y deposer un autre mot.
    const indexedZones = allZonesEls.map((el, originalIndex) => ({ el, originalIndex }));
    const remainingZones = isFillWordsInstruction()
      ? indexedZones.filter((z) => !isZoneFilled(z.el))
      : indexedZones;
    if (!remainingZones.length) return null;

    let items = collectDragItems(root);
    const explicit = hasAnyInstruction(dragInstructionMarkers);
    if (!items.length && allZonesEls.length >= 2) {
      items = collectStructuralClickDropItems(root, allZonesEls);
    }
    if (!items.length) return null;

    const hasTrueDrag = items.some((i) => i.element.matches?.("[draggable='true'],[aria-grabbed],[data-rbd-draggable-id],[data-draggable='true']"));
    const structuralClickDrop = looksLikeClickDropByStructure(root, allZonesEls, items);
    if (!explicit && !hasTrueDrag && !structuralClickDrop) return null;

    const zones = remainingZones.map((z, index) => ({
      index,
      originalIndex: z.originalIndex,
      text: zoneContext(z.el, z.originalIndex),
      element: z.el,
    }));
    return {
      type: "drag-drop",
      // v5.4: cliquer un mot provoque directement son placement dans la prochaine zone.
      // Aucun drag synthetique n'est necessaire pour cette famille d'exercices.
      mode: "click-auto-drop",
      root,
      items,
      zones,
      prompt: inferPrompt(root, items.map((i) => i.text))
    };
  };

  const findOrderingInstructionElement = (root = document.body) => {
    const markers = orderingInstructionMarkers.map(normLoose);
    const nodes = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,section,span")]
      .filter((el) => isVisible(el) && !isAssistantElement(el))
      .map((el) => {
        const text = textOf(el);
        const r = el.getBoundingClientRect();
        const interactiveDesc = el.querySelectorAll?.("button,[role='button'],[draggable='true'],input,select,textarea")?.length || 0;
        return { el, text, loose: normLoose(text), r, interactiveDesc };
      })
      .filter((x) => x.text && x.text.length <= 520 && markers.some((m) => x.loose.includes(m)));
    if (!nodes.length) return null;

    // v4.9: ne surtout pas choisir le grand conteneur React qui englobe aussi
    // la zone de drop et la banque de mots. C'etait la raison pour laquelle
    // instructionBottom se retrouvait SOUS la zone pointillee et la cible etait
    // ensuite consideree comme absente => click-order.
    const compact = nodes.filter((x) => x.r.height >= 18 && x.r.height <= 190 && x.interactiveDesc <= 1);
    const pool = compact.length ? compact : nodes;
    pool.sort((a, b) =>
      a.interactiveDesc - b.interactiveDesc ||
      a.r.height - b.r.height ||
      (a.r.width * a.r.height) - (b.r.width * b.r.height) ||
      a.text.length - b.text.length
    );
    return pool[0].el;
  };

  const findOrderingTarget = (root = document.body, instructionEl = null) => {
    const instruction = instructionEl?.isConnected ? instructionEl : findOrderingInstructionElement(root);
    const instructionRect = instruction?.getBoundingClientRect?.() || null;
    const instructionBottom = instructionRect?.bottom ?? -Infinity;
    const maxTop = Number.isFinite(instructionBottom)
      ? instructionBottom + Math.max(260, Math.min(520, window.innerHeight * 0.62))
      : Infinity;

    const explicit = getLiveZoneElements(root)
      .filter((el) => !isAssistantElement(el))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= instructionBottom - 20 && r.top <= maxTop;
      });

    // Certains composants Global Exam dessinent la bordure avec un pseudo-element,
    // un outline ou une classe qui ne contient ni "drop" ni "target". On inspecte
    // donc aussi la geometrie de TOUS les conteneurs raisonnables sous la consigne.
    const structural = [...root.querySelectorAll(
      "div,section,article,fieldset,ul,ol,[role='listbox'],[role='group'],[class]"
    )]
      .filter((el) => isVisible(el) && !isAssistantElement(el))
      .filter((el) => {
        if (instruction && (el === instruction || el.contains(instruction) || instruction.contains(el))) return false;
        const r = el.getBoundingClientRect();
        if (r.top < instructionBottom - 20 || r.top > maxTop) return false;
        const minWidth = Math.min(260, window.innerWidth * 0.34);
        if (r.width < minWidth || r.height < 42 || r.height > 190) return false;
        const txt = textOf(el).trim();
        // La zone est vide (ou presque vide). Les gros blocs de contenu sont exclus.
        if (txt.length > 120) return false;
        return true;
      });

    const pool = [...new Set([...explicit, ...structural])];
    if (!pool.length) return null;

    const score = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      const txt = textOf(el).trim();
      const borderStyles = [st.borderTopStyle, st.borderRightStyle, st.borderBottomStyle, st.borderLeftStyle];
      const outlineStyle = st.outlineStyle || "";
      const dashed = borderStyles.some((x) => x === "dashed" || x === "dotted") || outlineStyle === "dashed" || outlineStyle === "dotted";
      const borderWidth = [st.borderTopWidth, st.borderRightWidth, st.borderBottomWidth, st.borderLeftWidth]
        .map((x) => parseFloat(x) || 0).reduce((a,b) => Math.max(a,b), 0);
      const distance = Number.isFinite(instructionBottom) ? Math.max(0, r.top - instructionBottom) : 0;
      const widthBonus = Math.min(r.width, 1000) * 0.05;
      const idealHeightPenalty = Math.abs(r.height - 92) * 0.55;
      const textPenalty = txt.length * 2.5;
      const descendantPenalty = Math.min(80, (el.children?.length || 0) * 4);
      const dashedBonus = dashed ? 420 : 0;
      const borderBonus = borderWidth >= 2 ? 70 : 0;
      return distance * 1.9 + idealHeightPenalty + textPenalty + descendantPenalty - widthBonus - dashedBonus - borderBonus;
    };

    pool.sort((a, b) => score(a) - score(b));
    return pool[0] || null;
  };

  const isOrderingNoiseText = (text) => {
    const raw = String(text || "").trim();
    if (/^[?!.,;:]+$/.test(raw)) return false;
    const t = normLoose(raw);
    if (!t) return true;
    if (/^\d+\s*\/\s*\d+$/.test(String(text).trim())) return true;                // 3 / 13
    if (/^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}$/.test(String(text).trim())) return true; // 00:00 / 02:16
    if (/^(play|pause|volume|mute|unmute|audio|sound)$/.test(t)) return true;
    if (/^(analyser|analyze|repondre|answer|auto on|auto off)$/.test(t)) return true;
    return isNavLikeText(t);
  };

  const orderingCandidateSelector = [
    "button", "[role='button']", "[role='option']", "[draggable='true']",
    "[aria-grabbed]", "[data-rbd-draggable-id]", "[data-draggable='true']",
    "[tabindex]", "li", "[class*='word']", "[class*='chip']",
    "[class*='token']", "[class*='item']", "[class*='option']"
  ].join(",");

  const collectOrderingCandidates = (root, instructionEl, target) => {
    const instructionRect = instructionEl?.getBoundingClientRect?.() || null;
    const targetRect = target?.getBoundingClientRect?.() || null;
    // Les vrais mots se trouvent sous la consigne et, sur Global Exam, sous la zone pointillee.
    const minTop = targetRect ? targetRect.bottom - 20 : (instructionRect ? instructionRect.bottom + 4 : -Infinity);

    let candidates = deepestUniqueElements(
      [...root.querySelectorAll(orderingCandidateSelector)]
        .filter((el) => looksInteractiveChip(el))
        .filter((el) => {
          if (target && (target === el || target.contains(el) || el.contains(target))) return false;
          if (instructionEl && (instructionEl === el || instructionEl.contains(el) || el.contains(instructionEl))) return false;
          const txt = textOf(el).trim();
          if (!txt || txt.length > 180 || isOrderingNoiseText(txt)) return false;
          const aria = normLoose(el.getAttribute?.("aria-label") || "");
          if (/play|pause|audio|volume|sound|mute|progress|timer/.test(aria)) return false;
          const r = el.getBoundingClientRect();
          if (r.top < minTop) return false;
          // Les gros conteneurs de ligne ne sont pas des mots cliquables.
          if (r.width > Math.min(window.innerWidth * 0.78, 520) && r.height > 60) return false;
          return true;
        })
    );

    // Preferer les plus petits descendants cliquables lorsqu'un wrapper et son bouton sont tous deux remontes.
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left || (ar.width * ar.height) - (br.width * br.height);
    });

    return dedupeByText(
      candidates.map((el) => ({ text: textOf(el).trim(), element: el })).filter((x) => norm(x.text))
    ).map((x, index) => ({ index, ...x }));
  };


  const orderingVisualSelectedTexts = (target) => {
    if (!target?.isConnected) return [];
    const tr = target.getBoundingClientRect();
    const margin = 14;
    const inside = deepestUniqueElements(
      [...document.querySelectorAll(orderingCandidateSelector)]
        .filter((el) => isVisible(el) && !isAssistantElement(el) && looksInteractiveChip(el))
        .filter((el) => {
          const text = textOf(el).trim();
          if (!text || text.length > 180 || isOrderingNoiseText(text)) return false;
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          return cx >= tr.left - margin && cx <= tr.right + margin && cy >= tr.top - margin && cy <= tr.bottom + margin;
        })
    );
    const seen = new Set();
    return inside.map((el) => textOf(el).trim()).filter((t) => {
      const k = norm(t);
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });
  };

  // v5.3 - Etat dynamique d'un exercice d'ordering.
  // Le nombre de fragments n'est JAMAIS fixe (pas toujours 7). On compte ce qui est
  // déjà placé dans la zone résultat et uniquement les fragments encore disponibles.
  const orderingSelectionState = (root = document.body, instructionEl = null, target = null) => {
    const instruction = instructionEl?.isConnected ? instructionEl : findOrderingInstructionElement(root);
    const liveTarget = target?.isConnected ? target : findOrderingTarget(root, instruction);
    const remainingItems = collectOrderingCandidates(root, instruction, liveTarget);

    let selectedCount = 0;
    let selectedTexts = [];
    if (liveTarget) {
      // Les fragments places par Global Exam sont souvent numerotes 1,2,3... dans la zone.
      const chips = [...liveTarget.querySelectorAll("button,[role='button'],[class*='chip'],[class*='item'],[class*='token'],li,div,span")]
        .filter((el) => isVisible(el) && !isAssistantElement(el))
        .map((el) => textOf(el).trim())
        .filter((t) => t && t.length <= 180)
        .filter((t) => !/^\d+$/.test(t));
      // Dedupe en conservant l'ordre DOM.
      const seen = new Set();
      selectedTexts = chips.filter((t) => {
        const k = norm(t);
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });

      // Si le DOM ne permet pas d'isoler les chips, on compte les badges numeriques visibles.
      const numbered = [...liveTarget.querySelectorAll("span,div")]
        .filter((el) => isVisible(el))
        .map((el) => textOf(el).trim())
        .filter((t) => /^\d{1,2}$/.test(t));
      const visualSelected = orderingVisualSelectedTexts(liveTarget);
      if (visualSelected.length > selectedTexts.length) selectedTexts = visualSelected;
      selectedCount = Math.max(selectedTexts.length, new Set(numbered).size, visualSelected.length);
      if (selectedCount === 1 && selectedTexts.length === 1 && norm(selectedTexts[0]) === norm(textOf(liveTarget))) {
        selectedCount = Math.max(new Set(numbered).size, visualSelected.length);
        selectedTexts = visualSelected;
      }
    }

    return {
      target: liveTarget,
      remainingItems,
      remainingCount: remainingItems.length,
      selectedCount,
      selectedTexts,
      totalCount: selectedCount + remainingItems.length,
    };
  };

  const detectInstructionOrdering = (root) => {
    if (!hasAnyInstruction(orderingInstructionMarkers)) return null;

    const searchRoot = root || document.body;
    const instructionEl = findOrderingInstructionElement(searchRoot) || findOrderingInstructionElement(document.body);
    let target = findOrderingTarget(searchRoot, instructionEl) || (searchRoot !== document.body ? findOrderingTarget(document.body, instructionEl) : null);
    let orderState = orderingSelectionState(searchRoot, instructionEl, target);
    let items = orderState.remainingItems;

    // v5.5: la banque de mots peut deborder du "question root" choisi par React.
    // On compare TOUJOURS avec document.body et on garde la vue qui contient le plus
    // de fragments restants. Cela evite de valider 5/6 parce qu'un chip etait hors du root.
    if (searchRoot !== document.body) {
      const bodyTarget = target || findOrderingTarget(document.body, instructionEl);
      const bodyState = orderingSelectionState(document.body, instructionEl, bodyTarget);
      if (bodyState.remainingItems.length > items.length) {
        target = bodyTarget;
        orderState = bodyState;
        items = bodyState.remainingItems;
      }
    }

    // 0 fragment restant + zone déjà remplie = exercice termine; detectCompletedStructuredExercise()
    // le traitera avant ce détecteur. Ici il faut au moins un fragment restant.
    if (items.length < 1) return null;

    const basePrompt = inferPrompt(searchRoot, items.map((i) => i.text));
    const prefix = orderState.selectedTexts.length
      ? `Fragments déjà placés dans la zone (ne pas les resélectionner): ${orderState.selectedTexts.join(' | ')}`
      : `Fragments déjà placés: ${orderState.selectedCount}`;
    const dynamicPrompt = [
      basePrompt,
      prefix,
      `Nombre de fragments RESTANTS à sélectionner maintenant: ${items.length}.`,
      `Tu dois retourner une permutation contenant exactement ${items.length} index, chacun une seule fois, parmi 0..${Math.max(0, items.length - 1)}.`,
      `Il n'y a AUCUN nombre fixe de fragments: utilise seulement les ${items.length} propositions actuellement disponibles.`,
      `IMPORTANT PONCTUATION: si une proposition est exactement "?", elle fait partie de la réponse et doit être placée en DERNIÈRE position pour former la question.`
    ].join("\n");

    return {
      type: "ordering",
      // Cette variante Global Exam se fait par clic successif, pas par drag.
      mode: "click-order",
      root: searchRoot,
      items,
      requiredCount: items.length,
      alreadySelectedCount: orderState.selectedCount,
      totalDetectedCount: orderState.totalCount,
      orderTarget: target,
      orderingInstruction: instructionEl ? textOf(instructionEl) : "",
      prompt: dynamicPrompt,
    };
  };

  const detectOrdering = (root) => {
    const orderRoot = root.querySelector("[class*='order'],[class*='sort'],[aria-roledescription*='sortable']");
    if (!orderRoot) return null;
    const items = visibleControls("[draggable='true'],li,[role='option'],[class*='item']", orderRoot)
      .map((el, index) => ({ index, text: textOf(el), element: el }))
      .filter((x) => norm(x.text) && norm(x.text).length < 500);
    if (items.length < 2) return null;
    return { type: "ordering", root, items, prompt: inferPrompt(root, items.map((i) => i.text)) };
  };

  const detectMatching = (root) => {
    const hasMatchHint = !!root.querySelector("[class*='match'],[class*='pair'],[data-match]");
    if (!hasMatchHint) return null;
    const clickable = visibleControls("button,[role='button'],li,[class*='item'],[class*='option']", root)
      .map((el) => ({ text: textOf(el), element: el }))
      .filter((x) => norm(x.text) && norm(x.text).length < 300);
    const uniq = [];
    const seen = new Set();
    clickable.forEach((x) => { const k = norm(x.text); if (!seen.has(k)) { seen.add(k); uniq.push(x); } });
    if (uniq.length < 4) return null;
    const half = Math.floor(uniq.length / 2);
    return {
      type: "matching",
      root,
      left: uniq.slice(0, half).map((x, i) => ({ index: i, ...x })),
      right: uniq.slice(half).map((x, i) => ({ index: i, ...x })),
      prompt: inferPrompt(root, uniq.map((x) => x.text)),
    };
  };

  const feedbackMarkers = [
    "pas de reponse", "aucune reponse", "presque", "pas d inquietude",
    "vous n avez renseigne", "vous n avez pas renseigne",
    "bonne reponse", "bonnes reponses", "mauvaise reponse", "mauvaises reponses",
    "reponse correcte", "reponses correctes", "votre reponse", "vos reponses",
    "correction", "resultat", "resultats", "score", "solution",
    "correct answer", "incorrect answer", "your answer", "your answers",
    "no answer", "almost", "results", "score"
  ].map(normLoose);

  const strongFeedbackMarkers = [
    "pas de reponse", "presque", "pas d inquietude",
    "vous n avez renseigne", "vous n avez pas renseigne",
    "bonne reponse", "mauvaise reponse", "reponse correcte",
    "correct answer", "incorrect answer", "no answer", "almost"
  ].map(normLoose);

  const hasFeedbackVisualBlock = () => {
    const selectors = [
      "[class*='feedback']", "[class*='correction']", "[class*='result']",
      "[class*='score']", "[class*='incorrect']", "[class*='correct']",
      "[class*='success']", "[class*='error']", "[class*='warning']"
    ].join(",");
    return [...document.querySelectorAll(selectors)].some((el) => isVisible(el) && !isAssistantElement(el));
  };

  const hasWritableQuestionControl = () => {
    const hiddenNativeChoice = [...document.querySelectorAll("input[type='radio']:not(:disabled),input[type='checkbox']:not(:disabled)")]
      .some((el) => !!associatedChoiceSurface(el));
    if (hiddenNativeChoice) return true;

    const selectors = [
      "input[type='radio']:not(:disabled)",
      "input[type='checkbox']:not(:disabled)",
      "input[type='text']:not(:disabled):not([readonly])",
      "textarea:not(:disabled):not([readonly])",
      "select:not(:disabled)",
      "[role='radio']:not([aria-disabled='true'])",
      "[role='checkbox']:not([aria-disabled='true'])",
      "[role='combobox']:not([aria-disabled='true'])",
      "[draggable='true']",
      "[data-rbd-draggable-id]",
      "[data-draggable='true']"
    ];
    return selectors.some((sel) => visibleControls(sel, document).length > 0);
  };

  const isFeedbackPage = () => {
    const body = normLoose(textOf(document.body));
    if (!body) return false;
    const absoluteMarkers = [
      "pas de reponse", "presque", "pas d inquietude",
      "vous n avez renseigne aucune reponse",
      "vous n avez pas renseigne de bonnes reponses",
      "vous n avez pas renseigne toutes les bonnes reponses",
      "bonne reponse", "mauvaise reponse",
      "correct answer", "incorrect answer", "no answer"
    ].map(normLoose);
    if (absoluteMarkers.some((m) => body.includes(m))) return true;
    const markerHit = feedbackMarkers.some((m) => body.includes(m));
    if (!markerHit) return false;
    const hasNext = !!findActionButton?.(state.config.nextTexts);
    const hasPass = !!findActionButton?.(state.config.passTexts);
    const hasValidate = !!findActionButton?.(state.config.validateTexts);
    return !!(hasFeedbackVisualBlock() && (hasNext || hasPass || !hasValidate));
  };

  const pageState = () => {
    if (isFeedbackPage()) return "feedback";
    const hasValidate = !!findActionButton?.(state.config.validateTexts);
    if (hasWritableQuestionControl() || hasValidate) return "question-candidate";
    return "content";
  };

  const detectVisualChoice = (root) => {
    if (isFeedbackPage()) return null;

    const instruction = normLoose(inferPrompt(root));
    const strongQuestion = [
      "which of", "what is", "what are", "who is", "who are",
      "choose", "select", "which one", "which statement", "which question"
    ].some((m) => instruction.includes(normLoose(m)));
    if (!strongQuestion) return null;

    const excluded = [...state.config.nextTexts, ...state.config.validateTexts, ...state.config.passTexts].map(norm);
    const raw = [...root.querySelectorAll("label,[class*='answer'],[class*='choice'],[class*='option'],[class*='response']")]
      .filter((el) => isVisible(el) && !isAssistantElement(el))
      .map((el) => ({ el, text: textOf(el) || el.getAttribute?.("aria-label") || "" }))
      .filter(({ el, text }) => {
        const t = norm(text);
        if (t.length < 2 || t.length > 500) return false;
        if (isExerciseUiNoiseText(text)) return false;
        if (excluded.some((e) => t === e || t.startsWith(`${e} `))) return false;
        // Evite les grands conteneurs qui englobent plusieurs réponses.
        const childCandidates = el.querySelectorAll?.("label,[class*='answer'],[class*='choice'],[class*='option'],[class*='response']")?.length || 0;
        if (childCandidates > 2) return false;
        return true;
      });

    const byText = new Map();
    for (const c of raw) {
      const key = norm(c.text);
      const previous = byText.get(key);
      if (!previous || c.el.getBoundingClientRect().width < previous.el.getBoundingClientRect().width) byText.set(key, c);
    }

    const candidates = [...byText.values()].filter((c) => {
      // Le wrapper doit au minimum ressembler a une vraie surface de réponse.
      const cursor = getComputedStyle(c.el).cursor;
      return c.el.tagName === "LABEL" || c.el.tabIndex >= 0 || cursor === "pointer" ||
        /answer|choice|option|response|radio/i.test(String(c.el.className || ""));
    });

    const allowSingleFillChoice = candidates.length === 1 && isSingleChoiceFillContext(root);
    if ((!allowSingleFillChoice && candidates.length < 2) || candidates.length > 10) return null;
    const choices = candidates.map((c, index) => ({ index, text: c.text, element: c.el, input: c.el }));
    const prompt = inferPrompt(root, choices.map((c) => c.text));
    if (norm(prompt).length < 8) return null;
    return { type: "button-choice", root, choices, prompt };
  };

  const isSingleChoiceFillContext = (root = document.body) => {
    const instruction = bodyInstruction();
    const fillLike =
      instruction.includes(normLoose("fill in the blank")) ||
      instruction.includes(normLoose("complete the sentence")) ||
      instruction.includes(normLoose("complete the phrase"));
    if (!fillLike) return false;

    const zones = getLiveZoneElements(root === document.body ? document.body : root);
    const bodyZones = zones.length ? zones : getLiveZoneElements(document.body);
    return bodyZones.length === 1 && bodyZones.filter((z) => !isZoneFilled(z)).length === 1;
  };

  const detectButtonChoice = (root) => {
    // Fallback uniquement pour de VRAIS contrôles interactifs. Les anciennes
    // classes .choice/.option/.answer pouvaient correspondre au rendu des
    // corrections et etaient alors prises a tort pour une nouvelle question.
    const excluded = [...state.config.nextTexts, ...state.config.validateTexts, ...state.config.passTexts].map(norm);
    const candidates = visibleControls(
      "button,[role='button'],[role='option'],[tabindex='0'][class*='choice'],[tabindex='0'][class*='option'],[tabindex='0'][class*='answer']",
      root
    )
      .filter((el) => {
        if (isAssistantElement(el)) return false;
        const tag = el.tagName;
        const interactive = tag === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "option" || el.tabIndex >= 0;
        return interactive;
      })
      .map((el) => ({ text: textOf(el) || el.getAttribute("aria-label") || "", element: el }))
      .filter((x) => {
        const t = norm(x.text);
        return t.length >= 2 && t.length <= 400 &&
          !isExerciseUiNoiseText(x.text) &&
          !excluded.some((e) => t === e || t.startsWith(`${e} `));
      });

    const uniq = [];
    const seen = new Set();
    for (const c of candidates) {
      const k = norm(c.text);
      if (!seen.has(k)) { seen.add(k); uniq.push(c); }
    }
    const allowSingleFillChoice = uniq.length === 1 && isSingleChoiceFillContext(root);
    if ((!allowSingleFillChoice && uniq.length < 2) || uniq.length > 12) return null;

    // Ne jamais utiliser ce fallback sur une page de correction/résultat.
    if (isFeedbackPage()) return null;

    const choices = uniq.map((x, index) => ({ index, ...x }));
    const prompt = inferPrompt(root, choices.map((c) => c.text));
    if (norm(prompt).length < 8) return null;
    return { type: "button-choice", root, choices, prompt };
  };

  const looksLikeQuestionPage = () => {
    if (isFeedbackPage()) return false;
    const body = bodyInstruction();
    const markers = [
      "fill in the blank", "fill in the blanks", "match the",
      "place the words", "put the words", "choose", "select",
      "which of", "what is", "who are", "complete the", "answer the"
    ].map(normLoose);
    if (markers.some((m) => body.includes(m))) return true;
    if (getLiveZoneElements(document).length > 0) return true;
    return hasWritableQuestionControl();
  };

  const detectQuestion = () => {
    if (isFeedbackPage()) return { type: "feedback", root: findQuestionRoot(), prompt: "", key: "feedback" };

    const completed = detectCompletedStructuredExercise();
    if (completed) return completed;

    // Les consignes explicites doivent gagner AVANT les fallbacks "button-choice".
    // Sinon un exercice d'ordre composé de boutons est pris pour un QCM.
    if (hasAnyInstruction(orderingInstructionMarkers)) {
      try {
        const q = detectInstructionOrdering(document.body);
        if (q && norm(q.prompt).length >= 5) {
          q.key = makeQuestionKey(q);
          return q;
        }
      } catch (e) {
        console.warn("[Global Exam Assistant] Detecteur ordering explicite en erreur:", e);
      }
      const r = findQuestionRoot();
      return {
        type: "unknown-question",
        root: r,
        prompt: inferPrompt(r),
        key: `unknown-ordering::${normLoose(inferPrompt(r)).slice(0, 500)}`
      };
    }

    // Même protection pour les exercices explicitement drag/drop / matching par clic.
    // Une consigne comme "Match the words with their meanings" ne doit JAMAIS tomber
    // dans button-choice (sinon le lecteur audio peut etre pris pour une réponse).
    if (hasAnyInstruction(dragInstructionMarkers)) {
      try {
        const q = detectDragDrop(document.body);
        if (q && norm(q.prompt).length >= 5) {
          q.key = makeQuestionKey(q);
          return q;
        }
      } catch (e) {
        console.warn("[Global Exam Assistant] Detecteur drag-drop/click-auto-drop explicite en erreur:", e);
      }
      const r = findQuestionRoot();
      return {
        type: "unknown-question",
        root: r,
        prompt: inferPrompt(r),
        key: `unknown-click-drop::${normLoose(inferPrompt(r)).slice(0, 500)}`
      };
    }

    const roots = getCandidateRoots();
    const detectors = [
      detectMatrix,
      detectMultiChoice,
      detectSingleChoice,
      detectSelect,
      detectText,
      detectInstructionOrdering,
      detectDragDrop,
      detectMatching,
      detectOrdering,
      detectVisualChoice,
      detectButtonChoice,
    ];

    for (const root of roots) {
      for (const detect of detectors) {
        try {
          const q = detect(root);
          if (q && norm(q.prompt).length >= 5) {
            q.key = makeQuestionKey(q);
            return q;
          }
        } catch (e) {
          console.warn("[Global Exam Assistant] Detecteur en erreur:", detect.name, e);
        }
      }
    }
    // Dernier essai global pour les exercices dont les items et les zones sont dans des sous-arbres freres.
    for (const special of [detectInstructionOrdering, detectDragDrop]) {
      try {
        const q = special(document.body);
        if (q && norm(q.prompt).length >= 5) { q.key = makeQuestionKey(q); return q; }
      } catch {}
    }

    if (looksLikeQuestionPage()) {
      const r = findQuestionRoot();
      return { type: "unknown-question", root: r, prompt: inferPrompt(r), key: "unknown-question" };
    }
    return { type: "none", root: findQuestionRoot(), prompt: "", key: "none" };
  };

  const serializeQuestion = (q) => {
    const base = { type: q.type, prompt: q.prompt };
    if (q.choices) base.choices = q.choices.map((c) => ({ index: c.index, text: c.text }));
    if (q.fields) base.fields = q.fields.map((f) => ({ index: f.index, label: f.label, options: f.options?.map((o) => ({ index: o.index, text: o.text, value: o.value })) || [] }));
    if (q.items) base.items = q.items.map((i) => ({ index: i.index, text: i.text }));
    if (q.zones) base.zones = q.zones.map((z) => ({ index: z.index, text: z.text }));
    if (q.left) base.left = q.left.map((x) => ({ index: x.index, text: x.text }));
    if (q.right) base.right = q.right.map((x) => ({ index: x.index, text: x.text }));
    if (q.rows) base.rows = q.rows.map((r) => ({ rowIndex: r.rowIndex, rowText: r.rowText, choices: r.choices.map((c) => ({ index: c.index, text: c.text })) }));
    return base;
  };

  function makeQuestionKey(q) {
    return JSON.stringify(serializeQuestion(q));
  }

  const extractJsonObject = (text) => {
    try { return JSON.parse(text); } catch {}
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON introuvable dans la réponse du modèle.");
    return JSON.parse(match[0]);
  };

  const promptForQuestion = (q) => {
    if (q.type === "drag-drop") {
      return [
        "Resous cet exercice de drag and drop.",
        "Associe exactement une réponse à chaque zone.",
        "Une zone ne doit apparaitre qu'une fois et un item ne doit pas etre reutilise.",
        "Utilise uniquement les index fournis.",
        "Reponds uniquement selon le schema JSON impose par le serveur.",
        "",
        `Instruction: ${q.prompt}`,
        "",
        "Items disponibles:",
        ...q.items.map((item) => `${item.index}: ${item.text}`),
        "",
        "Zones:",
        ...q.zones.map((zone) => `${zone.index}: ${zone.text}`),
      ].join("\n");
    }

    const serialized = JSON.stringify(serializeQuestion(q), null, 2);
    const common = [
      "Tu analyses une question d'exercice.",
      "Reponds UNIQUEMENT avec un objet JSON valide, sans Markdown et sans texte autour.",
      "Ne donne aucune instruction de clic.",
      "Utilise exactement les index fournis.",
    ];

    const formats = {
      "single-choice": 'Format: {"choice":1,"confidence":0.92,"explanation":"courte"}',
      "button-choice": 'Format: {"choice":1,"confidence":0.92,"explanation":"courte"}',
      "multi-choice": 'Format: {"choices":[0,2],"confidence":0.92,"explanation":"courte"}. IMPORTANT: choices doit contenir TOUS les index corrects, aucun texte. Pour une question "une ou plusieurs réponses", vérifie chaque option individuellement.',
      "text": 'Format: {"answers":[{"field":0,"text":"réponse"}],"confidence":0.92,"explanation":"courte"}',
      "multi-text": 'Format: {"answers":[{"field":0,"text":"réponse 1"},{"field":1,"text":"réponse 2"}],"confidence":0.92,"explanation":"courte"}',
      "select": 'Format: {"selections":[{"field":0,"option":2}],"confidence":0.92,"explanation":"courte"}',
      "multi-select": 'Format: {"selections":[{"field":0,"option":2},{"field":1,"option":1}],"confidence":0.92,"explanation":"courte"}',
      "ordering": 'Format: {"order":[2,0,1],"confidence":0.92,"explanation":"courte"}',
      "matching": 'Format: {"pairs":[{"left":0,"right":2},{"left":1,"right":0}],"confidence":0.92,"explanation":"courte"}',
      "matrix": 'Format: {"rows":[{"row":0,"choice":1},{"row":1,"choice":0}],"confidence":0.92,"explanation":"courte"}',
    };

    return [...common, formats[q.type] || 'Format: {"confidence":0.5,"explanation":"type non géré"}', "", serialized].join("\n");
  };

  const askAiAgent = async (q, verificationNote = "", providerSlot = 0) => {
    if (!state.config.agent.enabled) throw new Error("Assistant IA désactivé.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), state.config.agent.timeoutMs);
    const prompt = verificationNote ? `${promptForQuestion(q)}

${verificationNote}` : promptForQuestion(q);
    let lastError = null;

    try {
      for (let attempt = 0; attempt <= state.config.agent.maxRetries; attempt++) {
        try {
          const requestedProvider = state.config.agent.provider || "auto";
          console.log(`[Multi-IA] Envoi ${q.type} via ${requestedProvider} (slot ${providerSlot}, tentative ${attempt + 1})...`);
          const response = await fetch(state.config.agent.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              question_type: q.type,
              provider: requestedProvider,
              provider_slot: Number(providerSlot) || 0,
              model: state.config.agent.model && state.config.agent.model !== "auto" ? state.config.agent.model : undefined,
              messages: [
                {
                  role: "system",
                  content: "Tu es un moteur de résolution d'exercices. Analyse correctement la question et respecte strictement le schéma JSON imposé par le serveur."
                },
                { role: "user", content: prompt }
              ],
              max_completion_tokens: state.config.agent.maxCompletionTokens
            }),
          });

          if (!response.ok) {
            const details = await response.text();
            const err = new Error(`HTTP ${response.status}: ${details}`);
            err.httpStatus = response.status;
            throw err;
          }

          const payload = await response.json();
          const content = payload?.choices?.[0]?.message?.content;
          if (!content) throw new Error("Réponse IA vide ou inattendue.");

          const result = extractJsonObject(content);
          result.confidence = Number.isFinite(Number(result.confidence))
            ? Math.max(0, Math.min(1, Number(result.confidence)))
            : 0.5;
          result.explanation = String(result.explanation || "").trim();
          result.provider = String(payload?.provider || "inconnu");
          result.modelUsed = String(payload?.model || "inconnu");
          result.providers = [result.provider];
          state.agent.lastProvider = result.provider;
          state.agent.lastModel = result.modelUsed;
          state.agent.providerHistory = [...state.agent.providerHistory, result.provider].slice(-8);
          return result;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          lastError = error;
          const status = Number(error?.httpStatus || 0);
          const retryable = error instanceof TypeError || status === 408 || status === 409 || status === 429 || status >= 500;
          if (!retryable || attempt >= state.config.agent.maxRetries) throw error;
          agentLog(`Fournisseur IA temporairement indisponible (${status || "réseau"}), nouvel essai...`);
          await wait(state.config.agent.retryDelayMs * (attempt + 1));
        }
      }
      throw lastError || new Error("Échec IA inconnu.");
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Timeout IA après ${state.config.agent.timeoutMs / 1000}s.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const clearHighlights = () => {
    for (const h of state.agent.highlights) {
      try {
        h.el.style.outline = h.outline;
        h.el.style.outlineOffset = h.outlineOffset;
        h.el.style.backgroundColor = h.backgroundColor;
      } catch {}
    }
    state.agent.highlights = [];
    document.querySelectorAll(".global-exam-assistant-badge").forEach((n) => n.remove());
  };

  const highlight = (el, label = "Réponse recommandée") => {
    if (!el) return;
    state.agent.highlights.push({ el, outline: el.style.outline, outlineOffset: el.style.outlineOffset, backgroundColor: el.style.backgroundColor });
    el.style.outline = "3px solid #f59e0b";
    el.style.outlineOffset = "2px";
    el.style.backgroundColor = "rgba(245,158,11,.12)";
    if (el.matches("label,li,button,[role='radio'],[role='checkbox'],[role='button']")) {
      const badge = document.createElement("span");
      badge.className = "global-exam-assistant-badge";
      badge.textContent = label;
      badge.style.cssText = "display:inline-block;margin-left:8px;padding:2px 6px;border-radius:999px;background:#f59e0b;color:#111827;font:700 11px/1.2 system-ui;";
      try { el.appendChild(badge); } catch {}
    }
  };

  const setNativeValue = async (el, value) => {
    if (!el || !el.isConnected) return false;
    const expected = String(value ?? "");
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const applyOnce = async () => {
      try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
      try { el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: expected })); } catch {}
      if (setter) setter.call(el, expected); else el.value = expected;
      try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: expected })); }
      catch { el.dispatchEvent(new Event("input", { bubbles: true })); }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      try { el.blur(); } catch {}
      await wait(280);
      return verifyTextValue(el, expected);
    };
    if (await applyOnce()) {
      await wait(350);
      if (verifyTextValue(el, expected)) return true;
    }
    return await applyOnce();
  };

  const selectOptionNative = (select, optionIndex) => {
    const option = select.options[optionIndex];
    if (!option || option.disabled) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const clickElement = async (el) => {
    if (!el || !isVisible(el) || !isEnabled(el)) return false;
    el.scrollIntoView?.({ block: "center", inline: "center" });
    await wait(120);
    state.agent.internalClick = true;
    try {
      el.click();
      state.clicks += 1;
    } finally {
      // Le click DOM est synchrone: garder le flag jusqu'au tick suivant suffit
      // à distinguer nos clics des clics manuels de l'utilisateur.
      setTimeout(() => { state.agent.internalClick = false; }, 0);
    }
    await wait(state.config.actionDelayMs);
    return true;
  };

  const isControlSelected = (control) => {
    if (!control) return false;
    if ("checked" in control) return !!control.checked;
    return control.getAttribute?.("aria-checked") === "true" ||
      control.getAttribute?.("aria-selected") === "true" ||
      control.getAttribute?.("aria-pressed") === "true";
  };

  const verifyTextValue = (el, expected) => norm(el?.value) === norm(expected);

  const getReactProps = (el) => {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return key ? el[key] : null;
  };

  const reactHandlerNames = (el) => {
    const names = new Set();
    let cur = el;
    for (let depth = 0; cur && depth < 5; depth++, cur = cur.parentElement) {
      const props = getReactProps(cur);
      if (!props) continue;
      for (const [key, value] of Object.entries(props)) {
        if (/^on[A-Z]/.test(key) && typeof value === "function") names.add(key);
      }
    }
    return [...names];
  };

  const findReactHandler = (el, names) => {
    let cur = el;
    for (let depth = 0; cur && depth < 6; depth++, cur = cur.parentElement) {
      const props = getReactProps(cur);
      if (!props) continue;
      for (const name of names) {
        if (typeof props[name] === "function") return { owner: cur, name, fn: props[name] };
      }
    }
    return null;
  };

  const dragSnapshot = (source, target, expectedText = "") => {
    const root = findQuestionRoot();
    const pool = collectDragItems(root).map((x) => norm(x.text));
    const targetParent = target?.parentElement || null;
    return {
      sourceConnected: !!source?.isConnected,
      sourceParent: source?.parentElement || null,
      targetConnected: !!target?.isConnected,
      targetText: textOf(target),
      targetHtml: target?.innerHTML || "",
      targetChildren: target?.childElementCount || 0,
      targetParent,
      targetParentText: textOf(targetParent),
      pool,
      zoneCount: getLiveZoneElements(root).length,
      expected: norm(expectedText),
    };
  };

  const targetContainsExpected = (target, expectedText) => {
    const expected = norm(expectedText);
    if (!expected || !target || !target.isConnected) return false;
    // IMPORTANT v4.9: ne jamais utiliser le texte du parent de la zone comme preuve.
    // Sur Global Exam le parent peut aussi contenir la banque de mots, ce qui produisait
    // de faux positifs et permettait parfois de valider une zone encore vide.
    const direct = norm(textOf(target));
    if (direct.includes(expected)) return true;
    return [...target.querySelectorAll?.("*") || []].some((el) => norm(textOf(el)) === expected);
  };

  const dragChangedStrong = (before, source, target, expectedText = "") => {
    if (!before) return false;
    const root = findQuestionRoot();
    const expected = norm(expectedText || before.expected);
    const poolAfter = collectDragItems(root).map((x) => norm(x.text));
    const zoneCountAfter = getLiveZoneElements(root).length;
    const targetMutated = !!target && target.isConnected &&
      (textOf(target) !== before.targetText || target.innerHTML !== before.targetHtml || target.childElementCount !== before.targetChildren);
    const sourceGoneFromPool = expected && before.pool.includes(expected) && !poolAfter.includes(expected);
    const sourceDisconnected = before.sourceConnected && source && !source.isConnected;

    // Preuves fortes: le mot est reellement dans la cible, ou il a quitte la banque
    // ET la zone a mute/disparu. Un simple changement de parent (overlay de drag) ne suffit plus.
    if (expected && targetContainsExpected(target, expectedText)) return true;
    if (sourceGoneFromPool && targetMutated) return true;
    if (sourceGoneFromPool && zoneCountAfter < before.zoneCount) return true;
    if (sourceDisconnected && targetMutated) return true;

    if (before.targetConnected && target && !target.isConnected) {
      if (sourceGoneFromPool || zoneCountAfter < before.zoneCount) return true;
    }
    return false;
  };

  const verifyPersistentDragChange = async (before, source, target, expectedText = "") => {
    if (!dragChangedStrong(before, source, target, expectedText)) return false;
    await wait(420);
    return dragChangedStrong(before, source, target, expectedText);
  };

  const makeDataTransfer = (text = "") => {
    const dt = new DataTransfer();
    try { dt.effectAllowed = "all"; } catch {}
    try { dt.dropEffect = "move"; } catch {}
    try { dt.setData("text/plain", text || "drag"); } catch {}
    try { dt.setData("text", text || "drag"); } catch {}
    return dt;
  };

  const dispatchMouse = (el, type, x, y, buttons = 1) => {
    if (!el?.dispatchEvent) return;
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      buttons, button: 0,
    }));
  };

  const dispatchPointer = (el, type, x, y, buttons = 1) => {
    if (!el?.dispatchEvent) return;
    const Ctor = window.PointerEvent || window.MouseEvent;
    el.dispatchEvent(new Ctor(type, {
      bubbles: true, cancelable: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      pointerId: 17, pointerType: "mouse", isPrimary: true,
      buttons, button: 0,
    }));
  };

  const dispatchPointerTyped = (el, type, x, y, { buttons = 1, pointerId = 17, pointerType = "mouse", pressure = null } = {}) => {
    if (!el?.dispatchEvent) return;
    const Ctor = window.PointerEvent || window.MouseEvent;
    const init = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      pointerId, pointerType, isPrimary: true,
      buttons, button: 0,
    };
    if (Ctor === window.PointerEvent) {
      init.width = 1; init.height = 1; init.tiltX = 0; init.tiltY = 0;
      init.pressure = pressure == null ? (buttons ? 0.5 : 0) : pressure;
    }
    el.dispatchEvent(new Ctor(type, init));
  };

  const dispatchKey = (el, key, code = key) => {
    if (!el?.dispatchEvent) return;
    const opts = { key, code, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  };

  const cancelSyntheticDrag = async () => {
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })); } catch {}
    try { window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, buttons: 0 })); } catch {}
    try { document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, buttons: 0 })); } catch {}
    try {
      const Ctor = window.PointerEvent || window.MouseEvent;
      document.dispatchEvent(new Ctor("pointerup", { bubbles: true, cancelable: true, pointerId: 17, pointerType: "mouse", buttons: 0, button: 0 }));
    } catch {}
    await wait(100);
  };

  const html5DragStrategy = async (source, target, expectedText = "") => {
    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect();
    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
    const dt = makeDataTransfer(expectedText || textOf(source));
    const drag = (el, type, x, y) => {
      if (!el?.dispatchEvent) return;
      el.dispatchEvent(new DragEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        screenX: x, screenY: y, dataTransfer: dt,
      }));
    };

    dispatchMouse(source, "mousedown", sx, sy, 1);
    drag(source, "dragstart", sx, sy);
    await wait(90);

    for (let i = 1; i <= 18; i++) {
      const x = sx + (tx - sx) * i / 18, y = sy + (ty - sy) * i / 18;
      const under = document.elementFromPoint(x, y) || target;
      drag(source, "drag", x, y);
      drag(under, "dragenter", x, y);
      drag(under, "dragover", x, y);
      await wait(28);
    }

    drag(target, "dragenter", tx, ty);
    drag(target, "dragover", tx, ty);
    await wait(80);
    drag(target, "drop", tx, ty);
    drag(source, "dragend", tx, ty);
    dispatchMouse(target, "mouseup", tx, ty, 0);
  };

  const pointerDragStrategy = async (source, target) => {
    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect();
    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;

    dispatchPointer(source, "pointerdown", sx, sy, 1);
    dispatchMouse(source, "mousedown", sx, sy, 1);
    await wait(100);

    // Beaucoup de librairies DnD ecoutent document/window, pas l'element sous le curseur.
    for (let i = 1; i <= 24; i++) {
      const x = sx + (tx - sx) * i / 24, y = sy + (ty - sy) * i / 24;
      const under = document.elementFromPoint(x, y) || target;
      for (const receiver of [under, document, window]) {
        dispatchPointer(receiver, "pointermove", x, y, 1);
        dispatchMouse(receiver, "mousemove", x, y, 1);
      }
      await wait(25);
    }

    for (const receiver of [target, document, window]) {
      dispatchPointer(receiver, "pointerup", tx, ty, 0);
      dispatchMouse(receiver, "mouseup", tx, ty, 0);
    }
  };

  const mouseDragStrategy = async (source, target) => {
    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect();
    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
    dispatchMouse(source, "mousedown", sx, sy, 1);
    await wait(120);
    for (let i = 1; i <= 24; i++) {
      const x = sx + (tx - sx) * i / 24, y = sy + (ty - sy) * i / 24;
      const under = document.elementFromPoint(x, y) || target;
      dispatchMouse(under, "mousemove", x, y, 1);
      dispatchMouse(document, "mousemove", x, y, 1);
      dispatchMouse(window, "mousemove", x, y, 1);
      await wait(28);
    }
    dispatchMouse(target, "mouseup", tx, ty, 0);
    dispatchMouse(document, "mouseup", tx, ty, 0);
    dispatchMouse(window, "mouseup", tx, ty, 0);
  };

  const makeDirectHandlerEvent = (currentTarget, expectedText = "") => {
    const r = currentTarget?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const dt = makeDataTransfer(expectedText);
    return {
      target: currentTarget, currentTarget,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: 1, pointerId: 17, pointerType: "mouse", isPrimary: true,
      dataTransfer: dt,
      nativeEvent: { target: currentTarget, currentTarget, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 17, pointerType: "mouse", dataTransfer: dt },
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      persist() {},
    };
  };

  const reactDirectDragStrategy = async (source, target, expectedText = "") => {
    const srcDrag = findReactHandler(source, ["onDragStart"]);
    const tgtDrop = findReactHandler(target, ["onDrop"]);
    if (srcDrag && tgtDrop) {
      const sourceEvent = makeDirectHandlerEvent(srcDrag.owner, expectedText || textOf(source));
      const targetEvent = makeDirectHandlerEvent(tgtDrop.owner, expectedText || textOf(source));
      targetEvent.dataTransfer = sourceEvent.dataTransfer;
      targetEvent.nativeEvent.dataTransfer = sourceEvent.dataTransfer;
      srcDrag.fn(sourceEvent);
      const over = findReactHandler(target, ["onDragEnter", "onDragOver"]);
      if (over) over.fn(targetEvent);
      await wait(80);
      tgtDrop.fn(targetEvent);
      return;
    }

    // Fallback pour dnd-kit / composants bases sur les pointeurs.
    const down = findReactHandler(source, ["onPointerDown", "onMouseDown"]);
    const up = findReactHandler(target, ["onPointerUp", "onMouseUp", "onClick"]);
    if (!down || !up) throw new Error("Aucun handler React DnD exploitable");
    down.fn(makeDirectHandlerEvent(down.owner, expectedText || textOf(source)));
    await wait(100);
    up.fn(makeDirectHandlerEvent(up.owner, expectedText || textOf(source)));
  };

  const clickPlacementStrategy = async (source, target) => {
    await clickElement(source); await wait(180); await clickElement(target);
  };

  const reverseClickPlacementStrategy = async (source, target) => {
    await clickElement(target); await wait(180); await clickElement(source);
  };

  const sourceVariants = (source, expectedText = "") => {
    const out = [];
    const wanted = norm(expectedText || textOf(source));
    const add = (el) => {
      if (!el || !el.isConnected || isAssistantElement(el) || !isVisible(el) || out.includes(el)) return;
      // Eviter de remonter jusqu'a un enorme conteneur de question.
      const r = el.getBoundingClientRect?.();
      if (r && (r.width > Math.max(700, window.innerWidth * 0.9) || r.height > 220)) return;
      out.push(el);
    };

    add(source);
    try {
      const r = source.getBoundingClientRect();
      add(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    } catch {}

    const handleSelector = [
      "[data-rbd-drag-handle-draggable-id]", "[data-rbd-draggable-id]",
      "[draggable='true']", "[data-draggable='true']", "[aria-grabbed]",
      "button", "[role='button']", "[role='option']", "[tabindex]"
    ].join(",");
    try { [...source.querySelectorAll(handleSelector)].forEach(add); } catch {}

    let cur = source.parentElement;
    for (let depth = 0; cur && depth < 6; depth++, cur = cur.parentElement) {
      const t = norm(textOf(cur));
      const props = reactHandlerNames(cur);
      const explicit = cur.matches?.(handleSelector);
      const hasActivator = props.some((n) => ["onPointerDown","onMouseDown","onTouchStart","onDragStart","onKeyDown"].includes(n));
      if ((explicit || hasActivator) && (!wanted || !t || t === wanted || t.includes(wanted))) add(cur);
    }

    const score = (el) => {
      let s = 0;
      if (el.matches?.("[data-rbd-drag-handle-draggable-id]")) s += 120;
      if (el.matches?.("[data-rbd-draggable-id]")) s += 100;
      if (el.matches?.("[draggable='true'],[data-draggable='true'],[aria-grabbed]")) s += 90;
      const handlers = reactHandlerNames(el);
      if (handlers.some((n) => ["onPointerDown","onMouseDown","onTouchStart"].includes(n))) s += 80;
      if (handlers.includes("onDragStart")) s += 70;
      if (el.matches?.("button,[role='button'],[role='option'],[tabindex]")) s += 35;
      const r = el.getBoundingClientRect?.();
      if (r) s -= Math.min(20, (r.width * r.height) / 5000);
      return s;
    };
    out.sort((a,b) => score(b) - score(a));
    return out;
  };

  const reactActivatorDragStrategy = async (source, target, expectedText = "") => {
    const down = findReactHandler(source, ["onPointerDown", "onMouseDown", "onTouchStart"]);
    if (!down) throw new Error("Aucun activator React sur la source");

    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect();
    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
    const ev = makeDirectHandlerEvent(down.owner, expectedText || textOf(source));
    ev.clientX = sx; ev.clientY = sy; ev.nativeEvent.clientX = sx; ev.nativeEvent.clientY = sy;
    down.fn(ev);
    await wait(140);

    for (let i = 1; i <= 30; i++) {
      const x = sx + (tx - sx) * i / 30, y = sy + (ty - sy) * i / 30;
      const under = document.elementFromPoint(x, y) || target;
      for (const receiver of [under, document, window]) {
        dispatchPointerTyped(receiver, "pointermove", x, y, {buttons:1, pointerId:17, pointerType:"mouse", pressure:0.5});
        dispatchMouse(receiver, "mousemove", x, y, 1);
      }
      await wait(24);
    }
    for (const receiver of [target, document, window]) {
      dispatchPointerTyped(receiver, "pointerup", tx, ty, {buttons:0, pointerId:17, pointerType:"mouse", pressure:0});
      dispatchMouse(receiver, "mouseup", tx, ty, 0);
    }
  };

  const touchPointerDragStrategy = async (source, target) => {
    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect();
    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
    dispatchPointerTyped(source, "pointerdown", sx, sy, {buttons:1, pointerId:31, pointerType:"touch", pressure:0.5});
    await wait(180);
    for (let i = 1; i <= 28; i++) {
      const x = sx + (tx - sx) * i / 28, y = sy + (ty - sy) * i / 28;
      const under = document.elementFromPoint(x, y) || target;
      for (const receiver of [under, document, window])
        dispatchPointerTyped(receiver, "pointermove", x, y, {buttons:1, pointerId:31, pointerType:"touch", pressure:0.5});
      await wait(28);
    }
    for (const receiver of [target, document, window])
      dispatchPointerTyped(receiver, "pointerup", tx, ty, {buttons:0, pointerId:31, pointerType:"touch", pressure:0});
  };

  const keyboardDnDStrategy = async (source, target) => {
    const focusable = source.matches?.("button,[role='button'],[tabindex]") ? source :
      source.querySelector?.("button,[role='button'],[tabindex]") || source;
    focusable.focus?.({preventScroll:true});
    await wait(80);
    dispatchKey(focusable, " ", "Space");
    await wait(180);
    // Dans les implementations accessibles de dnd-kit / beautiful-dnd, les fleches
    // permettent de deplacer l'element leve. La cible est au-dessus de la banque.
    for (let i = 0; i < 12; i++) { dispatchKey(focusable, "ArrowUp", "ArrowUp"); await wait(45); }
    dispatchKey(focusable, " ", "Space");
    await wait(120);
  };

  const dragPointVariants = (label = "") => {
    const m = String(label || "").match(/ordre\s+(\d+)/i);
    if (m) {
      const position = Number(m[1]);
      // Pour un classement, le premier fragment doit plutot entrer au debut de la zone,
      // les suivants plutot vers la fin. Le centre reste toujours un fallback.
      return position <= 1
        ? [{fx:0.18,fy:0.5,name:"debut"},{fx:0.5,fy:0.5,name:"centre"},{fx:0.82,fy:0.5,name:"fin"}]
        : [{fx:0.82,fy:0.5,name:"fin"},{fx:0.5,fy:0.5,name:"centre"},{fx:0.18,fy:0.5,name:"debut"}];
    }
    return [{fx:0.5,fy:0.5,name:"centre"},{fx:0.35,fy:0.5,name:"gauche"},{fx:0.65,fy:0.5,name:"droite"}];
  };

  const pointInTarget = (target, point = {fx:0.5,fy:0.5}) => {
    const r = target.getBoundingClientRect();
    return {
      x: r.left + Math.max(0.08, Math.min(0.92, Number(point.fx ?? 0.5))) * r.width,
      y: r.top + Math.max(0.12, Math.min(0.88, Number(point.fy ?? 0.5))) * r.height,
    };
  };

  const precisePointerDragStrategy = async (source, target, point = {fx:0.5,fy:0.5}, pointerType = "mouse") => {
    const sr = source.getBoundingClientRect();
    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const {x:tx,y:ty} = pointInTarget(target, point);
    const pid = pointerType === "touch" ? 41 : 37;

    dispatchPointerTyped(source, "pointerdown", sx, sy, {buttons:1,pointerId:pid,pointerType,pressure:0.5});
    if (pointerType === "mouse") dispatchMouse(source, "mousedown", sx, sy, 1);
    // Petit mouvement initial pour franchir les activationConstraint de dnd-kit.
    for (const [dx,dy] of [[3,1],[7,2],[11,4]]) {
      for (const receiver of [source, document, window]) {
        dispatchPointerTyped(receiver, "pointermove", sx+dx, sy+dy, {buttons:1,pointerId:pid,pointerType,pressure:0.5});
        if (pointerType === "mouse") dispatchMouse(receiver, "mousemove", sx+dx, sy+dy, 1);
      }
      await wait(45);
    }
    await wait(130);

    for (let i=1;i<=34;i++) {
      const x=sx+(tx-sx)*i/34, y=sy+(ty-sy)*i/34;
      const under=document.elementFromPoint(x,y) || target;
      for (const receiver of [under, document, window]) {
        dispatchPointerTyped(receiver,"pointermove",x,y,{buttons:1,pointerId:pid,pointerType,pressure:0.5});
        if (pointerType === "mouse") dispatchMouse(receiver,"mousemove",x,y,1);
      }
      await wait(22);
    }
    // Rester un court instant dans la zone avant de relâcher: certaines libs ne marquent
    // la droppable active qu'après un move/hover dans la cible.
    for (let i=0;i<4;i++) {
      for (const receiver of [target, document, window]) {
        dispatchPointerTyped(receiver,"pointermove",tx,ty,{buttons:1,pointerId:pid,pointerType,pressure:0.5});
        if (pointerType === "mouse") dispatchMouse(receiver,"mousemove",tx,ty,1);
      }
      await wait(55);
    }
    for (const receiver of [target, document, window]) {
      dispatchPointerTyped(receiver,"pointerup",tx,ty,{buttons:0,pointerId:pid,pointerType,pressure:0});
      if (pointerType === "mouse") dispatchMouse(receiver,"mouseup",tx,ty,0);
    }
  };

  const preciseHtml5DragStrategy = async (source, target, expectedText = "", point = {fx:0.5,fy:0.5}) => {
    const sr=source.getBoundingClientRect();
    const sx=sr.left+sr.width/2, sy=sr.top+sr.height/2;
    const {x:tx,y:ty}=pointInTarget(target,point);
    const dt=makeDataTransfer(expectedText || textOf(source));
    const drag=(el,type,x,y)=>{
      if (!el?.dispatchEvent) return;
      el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,screenX:x,screenY:y,dataTransfer:dt}));
    };
    dispatchMouse(source,"mousedown",sx,sy,1);
    drag(source,"dragstart",sx,sy);
    await wait(120);
    for(let i=1;i<=28;i++){
      const x=sx+(tx-sx)*i/28,y=sy+(ty-sy)*i/28;
      const under=document.elementFromPoint(x,y)||target;
      drag(source,"drag",x,y); drag(under,"dragenter",x,y); drag(under,"dragover",x,y);
      await wait(24);
    }
    for(let i=0;i<3;i++){ drag(target,"dragenter",tx,ty); drag(target,"dragover",tx,ty); await wait(65); }
    drag(target,"drop",tx,ty); await wait(45); drag(source,"dragend",tx,ty); dispatchMouse(target,"mouseup",tx,ty,0);
  };

  const reacquireDragSource = (original, expectedText = "") => {
    if (original?.isConnected && isVisible(original) && isEnabled(original)) return original;
    const wanted=norm(expectedText);
    if (!wanted) return null;
    const root=findQuestionRoot();
    const pool=[...collectDragItems(root).map((x)=>x.element), ...root.querySelectorAll?.(orderingCandidateSelector) || []]
      .filter((el)=>el?.isConnected && isVisible(el) && isEnabled(el) && norm(textOf(el))===wanted);
    return deepestUniqueElements(pool)[0] || null;
  };

  const reacquireDragTarget = (original, rectHint = null) => {
    if (original?.isConnected && isVisible(original)) return original;
    const zones=getLiveZoneElements(findQuestionRoot()).filter((el)=>isVisible(el));
    if (!zones.length) return findOrderingTarget(document.body, findOrderingInstructionElement(document.body)) || null;
    if (!rectHint) return zones[0];
    const cx=rectHint.left+rectHint.width/2, cy=rectHint.top+rectHint.height/2;
    zones.sort((a,b)=>{
      const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
      const ad=Math.hypot(ar.left+ar.width/2-cx, ar.top+ar.height/2-cy);
      const bd=Math.hypot(br.left+br.width/2-cx, br.top+br.height/2-cy);
      return ad-bd;
    });
    return zones[0];
  };

  const targetVariants = (target) => {
    const out = [];
    const add = (el) => { if (el && el.isConnected && !isAssistantElement(el) && !out.includes(el)) out.push(el); };
    add(target);
    try {
      const r = target.getBoundingClientRect();
      add(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    } catch {}
    add(target.firstElementChild);
    add(target.parentElement);
    if (target.parentElement) add(target.parentElement.parentElement);
    return out;
  };

  const dragAndDrop = async (source, target, label = "", expectedText = "") => {
    if (!source || !target || !source.isConnected || !target.isConnected) return false;
    const targetRectHint = target.getBoundingClientRect();
    const panel = state.agent.panel;
    const oldPointerEvents = panel?.style.pointerEvents;
    if (panel) panel.style.pointerEvents = "none";

    try {
      const rounds = Math.max(1, Number(state.config.agent.dragStrategyRounds || 1));
      for (let round = 1; round <= rounds; round++) {
        let liveSource = reacquireDragSource(source, expectedText);
        let liveTarget = reacquireDragTarget(target, targetRectHint);
        if (!liveSource || !liveTarget) return false;

        // Ne pas recentrer agressivement deux éléments déjà visibles: sur les modales scrollables,
        // deux scrollIntoView(center) consecutifs pouvaient sortir la source de l'ecran.
        liveSource.scrollIntoView?.({block:"nearest",inline:"nearest"});
        liveTarget.scrollIntoView?.({block:"nearest",inline:"nearest"});
        await wait(180);

        const sources = sourceVariants(liveSource, expectedText).slice(0, 3);
        const targets = targetVariants(liveTarget).slice(0, 3);
        const points = dragPointVariants(label);
        log(`DnD round ${round}/${rounds}: ${sources.length} source(s), ${targets.length} cible(s), ${points.length} point(s)${label ? ` (${label})` : ""}.`);

        for (const sourceEl0 of sources) {
          for (const targetEl0 of targets) {
            // Strategies de mouvement principales, avec plusieurs points de drop.
            for (const point of points) {
              for (const [name, strategy] of [
                [`pointer-${point.name}`, (s,t)=>precisePointerDragStrategy(s,t,point,"mouse")],
                [`html5-${point.name}`, (s,t)=>preciseHtml5DragStrategy(s,t,expectedText,point)],
              ]) {
                const sourceEl = reacquireDragSource(sourceEl0, expectedText);
                const targetEl = reacquireDragTarget(targetEl0, targetRectHint);
                if (!sourceEl || !targetEl) break;
                const before = dragSnapshot(sourceEl, targetEl, expectedText);
                try {
                  await strategy(sourceEl, targetEl);
                  await wait(420);
                  if (await verifyPersistentDragChange(before, sourceEl, targetEl, expectedText)) {
                    log(`Placement confirmé (${name})${label ? ` : ${label}` : ""}.`);
                    return true;
                  }
                } catch (e) {
                  console.warn(`[Global Exam Assistant] Strategie ${name} en erreur:`, e);
                }
                await cancelSyntheticDrag();
              }
            }

            // Fallbacks moins standards une seule fois par couple source/cible.
            for (const [name, strategy] of [
              ["react-activator", (s,t)=>reactActivatorDragStrategy(s,t,expectedText)],
              ["touch-pointer", touchPointerDragStrategy],
              ["mouse-global", mouseDragStrategy],
              ["react-handler", (s,t)=>reactDirectDragStrategy(s,t,expectedText)],
              ["keyboard-dnd", keyboardDnDStrategy],
              ["click-source-target", clickPlacementStrategy],
              ["click-target-source", reverseClickPlacementStrategy],
            ]) {
              const sourceEl = reacquireDragSource(sourceEl0, expectedText);
              const targetEl = reacquireDragTarget(targetEl0, targetRectHint);
              if (!sourceEl || !targetEl) break;
              const before = dragSnapshot(sourceEl, targetEl, expectedText);
              try {
                await strategy(sourceEl, targetEl);
                await wait(460);
                if (await verifyPersistentDragChange(before, sourceEl, targetEl, expectedText)) {
                  log(`Placement confirmé (${name})${label ? ` : ${label}` : ""}.`);
                  return true;
                }
              } catch (e) {
                if (!/Aucun (handler|activator) React/.test(String(e?.message || e)))
                  console.warn(`[Global Exam Assistant] Strategie ${name} en erreur:`, e);
              }
              await cancelSyntheticDrag();
            }
          }
        }
        if (round < rounds) {
          log(`DnD non confirmé au round ${round}; nouvelle tentative avec DOM rafraichi.`);
          await wait(state.config.agent.dragRoundDelayMs || 420);
        }
      }
      log(`DnD non confirmé apres tous les rounds${label ? ` (${label})` : ""}.`);
      return false;
    } finally {
      if (panel) panel.style.pointerEvents = oldPointerEvents || "";
    }
  };

  const zoneDescriptorText = (text) => normLoose(String(text || "").replace(/\[\[ZONE_\d+\]\]/gi, " ").replace(/^zone\s+\d+\s*[—:-]?/i, " "));

  const resolveLiveDragItem = (root, text) => {
    const wanted = norm(text);
    return collectDragItems(root).find((i) => norm(i.text) === wanted)?.element || null;
  };

  const resolveLiveZone = (root, index, descriptor = null) => {
    if (descriptor?.element?.isConnected && isVisible(descriptor.element)) return descriptor.element;
    const zones = getLiveZoneElements(root);
    if (!zones.length) return null;

    const wanted = zoneDescriptorText(descriptor?.text || "");
    if (wanted) {
      let best = null, bestScore = -1;
      zones.forEach((el, currentIndex) => {
        const candidate = zoneDescriptorText(zoneContext(el, currentIndex));
        const score = promptSimilarity(wanted, candidate);
        if (score > bestScore) { bestScore = score; best = el; }
      });
      if (best && bestScore >= 0.28) return best;
    }
    return zones[Number(index)] || null;
  };

  const resolveLiveOrderingItem = (q, originalText) => {
    const wanted = norm(originalText);
    const root = q.root?.isConnected ? q.root : document.body;
    const instructionEl = findOrderingInstructionElement(root) || findOrderingInstructionElement(document.body);
    const target = q.orderTarget?.isConnected ? q.orderTarget : (findOrderingTarget(root, instructionEl) || findOrderingTarget(document.body, instructionEl));
    const roots = root === document.body ? [root] : [root, document.body];

    for (const r of roots) {
      const candidates = collectOrderingCandidates(r, instructionEl, target)
        .filter((x) => norm(x.text) === wanted)
        .map((x) => x.element)
        .filter((el) => el?.isConnected && isVisible(el) && isEnabled(el));
      if (candidates.length) return candidates[0];
    }
    return null;
  };

  const orderingVisualSequence = (q, target) => {
    if (!target) return [];
    const tr = target.getBoundingClientRect();
    const inside = [];
    for (const item of q.items || []) {
      const wanted = norm(item.text);
      if (!wanted) continue;
      const matches = [...document.querySelectorAll(orderingCandidateSelector)]
        .filter((el) => isVisible(el) && !isAssistantElement(el) && norm(textOf(el)) === wanted)
        .filter((el) => {
          if (target.contains(el)) return true;
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          return cx >= tr.left - 12 && cx <= tr.right + 12 && cy >= tr.top - 12 && cy <= tr.bottom + 12;
        });
      if (!matches.length) continue;
      matches.sort((a,b) => {
        const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
        return ar.top-br.top || ar.left-br.left || (ar.width*ar.height)-(br.width*br.height);
      });
      const r = matches[0].getBoundingClientRect();
      inside.push({ index: item.index, top: r.top, left: r.left });
    }
    inside.sort((a,b) => Math.abs(a.top-b.top) > 18 ? a.top-b.top : a.left-b.left);
    return inside.map((x) => Number(x.index));
  };


  // v5.0 - Reacquisition et application robuste des choix React.
  // Global Exam peut recréer les inputs/wrappers après chaque clic. Il ne faut donc
  // pas conserver aveuglément les références DOM de q.choices pendant toute l'application.
  const resolveLiveChoice = (q, originalChoice) => {
    const current = detectQuestion();
    if (!current || !Array.isArray(current.choices)) return originalChoice || null;

    const wanted = normLoose(originalChoice?.text || "");
    if (wanted) {
      const exact = current.choices.find((c) => normLoose(c.text) === wanted);
      if (exact) return exact;
      let best = null, score = 0;
      for (const c of current.choices) {
        const s = promptSimilarity(wanted, normLoose(c.text));
        if (s > score) { score = s; best = c; }
      }
      if (best && score >= 0.65) return best;
    }

    const idx = Number(originalChoice?.index);
    if (Number.isInteger(idx) && current.choices[idx]) return current.choices[idx];
    return originalChoice || null;
  };

  const dispatchChoiceEvents = (input) => {
    if (!input?.dispatchEvent) return;
    try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
    try { input.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
  };

  const forceNativeChecked = async (input, desired) => {
    if (!input || !input.isConnected || !("checked" in input)) return false;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
      if (setter) setter.call(input, !!desired);
      else input.checked = !!desired;
      dispatchChoiceEvents(input);
      await wait(220);
      return !!input.checked === !!desired;
    } catch {
      return false;
    }
  };

  const setChoiceStateRobust = async (q, originalChoice, desired) => {
    let live = resolveLiveChoice(q, originalChoice);
    if (!live) return false;

    const selected = () => {
      live = resolveLiveChoice(q, originalChoice) || live;
      return isControlSelected(live?.input || live?.element);
    };

    if (selected() === desired) return true;

    // 1) Le vrai input HTML, même masqué, est souvent la voie la plus fiable.
    const input = live.input;
    if (input?.isConnected && isEnabled(input) && typeof input.click === "function") {
      state.agent.internalClick = true;
      try { input.click(); state.clicks += 1; } catch {}
      finally { setTimeout(() => { state.agent.internalClick = false; }, 0); }
      await wait(260);
      if (selected() === desired) return true;
    }

    // 2) Surface visuelle / label React.
    live = resolveLiveChoice(q, originalChoice) || live;
    const surfaces = [
      live.element,
      live.input?.id ? document.querySelector(`label[for="${cssEscape(live.input.id)}"]`) : null,
      associatedChoiceSurface(live.input),
      live.element?.closest?.("label,[role='checkbox'],[role='radio'],[class*='answer'],[class*='choice'],[class*='option']")
    ].filter((el, i, arr) => el && arr.indexOf(el) === i);

    for (const surface of surfaces) {
      if (!surface?.isConnected || !isVisible(surface) || !isEnabled(surface)) continue;
      await clickElement(surface);
      await wait(220);
      if (selected() === desired) return true;
    }

    // 3) Dernier recours: setter natif + input/change, puis réacquisition.
    live = resolveLiveChoice(q, originalChoice) || live;
    if (await forceNativeChecked(live.input, desired)) {
      await wait(220);
      return selected() === desired;
    }

    return false;
  };

  const selectedChoiceIndexesLive = (q) => {
    const current = detectQuestion();
    const choices = Array.isArray(current?.choices) ? current.choices : q.choices;
    return (choices || []).map((c, i) => isControlSelected(c.input || c.element) ? i : null).filter((x) => x !== null);
  };

  // v5.1 - Ordering Global Exam = selection par clic, pas drag.
  // Le vrai handler peut etre sur le texte, le bouton ou un wrapper parent. On essaie
  // plusieurs surfaces et on exige une modification persistante de la zone de résultat.
  const orderingTargetLive = (q) => {
    if (q.orderTarget?.isConnected && isVisible(q.orderTarget)) return q.orderTarget;
    const root = q.root?.isConnected ? q.root : document.body;
    const instruction = findOrderingInstructionElement(root) || findOrderingInstructionElement(document.body);
    return findOrderingTarget(root, instruction) || findOrderingTarget(document.body, instruction) || null;
  };

  const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const countFragmentOccurrences = (containerText, fragmentText) => {
    const rawFragment = String(fragmentText || "").trim();
    if (!rawFragment) return 0;
    const container = norm(containerText);
    const fragment = norm(rawFragment);
    if (!fragment) {
      // Ponctuation seule, par exemple "?".
      return (String(containerText || "").match(new RegExp(escapeRegExp(rawFragment), "g")) || []).length;
    }
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(fragment).replace(/\\ /g, "\\s+")}(?=\\s|$)`, "g");
    return (container.match(pattern) || []).length;
  };

  const findFragmentAfter = (containerText, fragmentText, startIndex = 0) => {
    const raw = String(fragmentText || "").trim();
    const text = norm(containerText);
    const fragment = norm(raw);
    if (!fragment) return String(containerText || "").indexOf(raw, startIndex);
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(fragment).replace(/\\ /g, "\\s+")}(?=\\s|$)`, "g");
    pattern.lastIndex = Math.max(0, startIndex);
    const match = pattern.exec(text);
    return match ? match.index + (match[1]?.length || 0) : -1;
  };

  const invokeReactClickDirect = async (el, label = "") => {
    const handler = findReactHandler(el, ["onClick", "onPointerUp", "onMouseUp"]);
    if (!handler) return false;
    state.agent.internalClick = true;
    try {
      handler.fn(makeDirectHandlerEvent(handler.owner, label || textOf(el)));
      state.clicks += 1;
      await wait(220);
      return true;
    } catch (error) {
      console.warn("[Global Exam Assistant] Clic React direct en erreur:", error);
      return false;
    } finally {
      setTimeout(() => { state.agent.internalClick = false; }, 0);
    }
  };

  const orderingClickSnapshot = (q, originalText) => {
    const target = orderingTargetLive(q);
    const live = resolveLiveOrderingItem(q, originalText);
    return {
      target,
      targetText: target ? textOf(target) : "",
      targetHtml: target ? target.innerHTML : "",
      fragmentCount: target ? countFragmentOccurrences(textOf(target), originalText) : 0,
      live,
      liveParent: live?.parentElement || null,
      liveConnected: !!live?.isConnected,
    };
  };

  const orderingClickConfirmed = (q, before, originalText) => {
    const target = orderingTargetLive(q);
    if (!target) return false;
    const afterText = textOf(target);
    const changedTarget = afterText !== before.targetText || target.innerHTML !== before.targetHtml;
    const occurrenceIncreased = countFragmentOccurrences(afterText, originalText) > Number(before.fragmentCount || 0);
    if (changedTarget && occurrenceIncreased) return true;

    const live = resolveLiveOrderingItem(q, originalText);
    if (before.liveConnected && (!before.live?.isConnected || !live)) return true;
    if (live && before.liveParent && live.parentElement !== before.liveParent) return true;
    return false;
  };

  const clickOrderingItemRobust = async (q, original) => {
    let live = resolveLiveOrderingItem(q, original.text);
    if (!live) return false;

    const candidates = [];
    const add = (el) => {
      if (!el || !el.isConnected || isAssistantElement(el) || candidates.includes(el)) return;
      candidates.push(el);
    };
    add(live);
    // sourceVariants connait déjà les wrappers/activators utiles des composants React.
    for (const el of sourceVariants(live, original.text)) add(el);
    add(live.closest?.("button,[role='button'],[role='option'],[tabindex],li,[class*='word'],[class*='chip'],[class*='token'],[class*='item'],[class*='option']"));
    add(live.parentElement);

    for (const el0 of candidates.slice(0, 6)) {
      const el = reacquireDragSource(el0, original.text) || el0;
      if (!el?.isConnected || !isVisible(el) || !isEnabled(el)) continue;
      const before = orderingClickSnapshot(q, original.text);

      // 1. Clic natif/React standard.
      if (await clickElement(el)) {
        await wait(300);
        if (orderingClickConfirmed(q, before, original.text)) return true;
      }

      // 2. Sequence pointeur/souris proche d'un vrai clic utilisateur.
      const fresh = reacquireDragSource(el, original.text) || resolveLiveOrderingItem(q, original.text);
      if (!fresh?.isConnected) {
        if (orderingClickConfirmed(q, before, original.text)) return true;
        continue;
      }
      const r = fresh.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      try {
        dispatchPointer(fresh, "pointerdown", x, y, 1);
        dispatchMouse(fresh, "mousedown", x, y, 1);
        await wait(70);
        dispatchPointer(fresh, "pointerup", x, y, 0);
        dispatchMouse(fresh, "mouseup", x, y, 0);
        fresh.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, view:window, clientX:x, clientY:y, button:0, buttons:0 }));
      } catch {}
      await wait(320);
      if (orderingClickConfirmed(q, before, original.text)) return true;

      // 3. Dernier recours: appeler directement le handler React du composant.
      const direct = resolveLiveOrderingItem(q, original.text) || fresh;
      if (direct?.isConnected && await invokeReactClickDirect(direct, original.text)) {
        await wait(320);
        if (orderingClickConfirmed(q, before, original.text)) return true;
      }
    }
    return false;
  };


  const orderingSelectedElements = (target) => {
    if (!target?.isConnected) return [];
    const tr = target.getBoundingClientRect();
    const items = deepestUniqueElements(
      [...document.querySelectorAll(orderingCandidateSelector)]
        .filter((el) => isVisible(el) && !isAssistantElement(el) && looksInteractiveChip(el))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          return target.contains(el) || (cx >= tr.left - 14 && cx <= tr.right + 14 && cy >= tr.top - 14 && cy <= tr.bottom + 14);
        })
        .filter((el) => {
          const t = textOf(el).trim();
          return !!t && !/^\d+$/.test(t) && !isOrderingNoiseText(t);
        })
    );
    items.sort((a,b) => {
      const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
      return ar.top-br.top || ar.left-br.left;
    });
    return items;
  };

  const localOrderingUndoCandidates = (q, target) => {
    const tr = target?.getBoundingClientRect?.();
    const root = q?.root?.isConnected ? q.root : document.body;
    const pool = [...new Set([
      ...root.querySelectorAll("button,[role='button'],[aria-label],[title]"),
      ...(root !== document.body ? document.querySelectorAll("button,[role='button'],[aria-label],[title]") : [])
    ])];
    return pool.filter((el) => {
      if (!el?.isConnected || !isVisible(el) || !isEnabled(el) || isAssistantElement(el)) return false;
      const label = normLoose(`${controlText(el)} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("title") || ""}`);
      if (matchesActionText(controlText(el), state.config.nextTexts) || matchesActionText(controlText(el), state.config.validateTexts) || matchesActionText(controlText(el), state.config.passTexts)) return false;
      const r = el.getBoundingClientRect();
      if (r.width > 90 || r.height > 90 || r.width < 12 || r.height < 12) return false;
      if (tr) {
        const dx = Math.max(tr.left-r.right, r.left-tr.right, 0);
        const dy = Math.max(tr.top-r.bottom, r.top-tr.bottom, 0);
        if (Math.hypot(dx,dy) > 360) return false;
      }
      const iconOnly = !controlText(el).trim() && !!el.querySelector?.("svg,path,i");
      const explicitUndo = /undo|annul|retour|back|remove|reset|precedent|précédent|revenir/.test(label);
      const localIcon = iconOnly && !!tr && r.top >= tr.bottom - 45 && r.top <= tr.bottom + 260;
      return explicitUndo || localIcon;
    }).sort((a,b) => {
      const score = (el) => {
        const label = normLoose(`${controlText(el)} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("title") || ""}`);
        let v = /undo|annul|remove|reset|revenir/.test(label) ? -1000 : /retour|back/.test(label) ? -500 : 0;
        if (tr) {
          const r=el.getBoundingClientRect();
          const dx=Math.max(tr.left-r.right,r.left-tr.right,0), dy=Math.max(tr.top-r.bottom,r.top-tr.bottom,0);
          v += Math.hypot(dx,dy);
        }
        return v;
      };
      return score(a)-score(b);
    });
  };

  const resetOrderingSelection = async (q) => {
    let instruction = findOrderingInstructionElement(document.body);
    let target = orderingTargetLive(q) || findOrderingTarget(document.body, instruction);
    let st = orderingSelectionState(document.body, instruction, target);
    if (st.selectedCount <= 0) return true;

    log(`Ordering partiel détecté (${st.selectedCount} fragment(s) placé(s)). Remise à zéro avant une nouvelle analyse.`);
    const maxSteps = Math.max(4, st.totalCount + 3);

    for (let step = 0; step < maxSteps; step++) {
      instruction = findOrderingInstructionElement(document.body);
      target = orderingTargetLive(q) || findOrderingTarget(document.body, instruction);
      const before = orderingSelectionState(document.body, instruction, target);
      if (before.selectedCount <= 0) return true;

      let changed = false;
      for (const undo of localOrderingUndoCandidates(q, target).slice(0, 5)) {
        const selectedBefore = before.selectedCount, remainingBefore = before.remainingCount;
        await clickElement(undo);
        await wait(260);
        const after = orderingSelectionState(document.body, instruction, orderingTargetLive(q) || target);
        if (after.selectedCount < selectedBefore || after.remainingCount > remainingBefore) {
          changed = true;
          break;
        }
      }

      if (!changed) {
        // Fallback: beaucoup de composants permettent de cliquer le dernier fragment
        // placé pour le renvoyer dans la banque.
        const selected = orderingSelectedElements(target);
        const last = selected[selected.length - 1];
        if (last) {
          const selectedBefore = before.selectedCount, remainingBefore = before.remainingCount;
          await clickElement(last);
          await wait(260);
          let after = orderingSelectionState(document.body, instruction, orderingTargetLive(q) || target);
          if (!(after.selectedCount < selectedBefore || after.remainingCount > remainingBefore)) {
            await invokeReactClickDirect(last, textOf(last));
            await wait(260);
            after = orderingSelectionState(document.body, instruction, orderingTargetLive(q) || target);
          }
          changed = after.selectedCount < selectedBefore || after.remainingCount > remainingBefore;
        }
      }

      if (!changed) {
        log("Impossible de remettre l'ordering à zéro de façon confirmée; validation bloquée.");
        return false;
      }
    }

    st = orderingSelectionState(document.body, findOrderingInstructionElement(document.body), orderingTargetLive(q));
    return st.selectedCount <= 0;
  };

  // v5.4 - Global Exam effectue lui-meme le "drop" quand on clique sur un mot.
  // On verifie donc un vrai changement du DOM après chaque clic, sans simuler de drag.
  const clickAutoDropSnapshot = (q, placement, expectedText) => {
    const root = findQuestionRoot();
    const descriptor = q.zones?.[Number(placement.zone)] || null;
    const zoneIndex = Number(descriptor?.originalIndex ?? placement.zone);
    const target = resolveLiveZone(root, zoneIndex, descriptor);
    const zones = getLiveZoneElements(root);
    const empty = zones.filter((z) => !isZoneFilled(z)).length;
    const pool = collectDragItems(root).map((x) => norm(x.text));
    return {
      root,
      descriptor,
      zoneIndex,
      target,
      targetText: target ? textOf(target) : '',
      targetHtml: target?.innerHTML || '',
      emptyCount: empty,
      poolCount: pool.length,
      sourcePresent: pool.includes(norm(expectedText)),
    };
  };

  const clickAutoDropConfirmed = async (q, placement, expectedText, before) => {
    await wait(260);
    const after = clickAutoDropSnapshot(q, placement, expectedText);

    // Preuve ideale: le bon mot est effectivement dans la zone attendue.
    if (after.target && targetContainsExpected(after.target, expectedText)) {
      return { ok: true, reason: 'mot-dans-zone', after };
    }

    // React peut conserver l'ancienne reference de zone tout en changeant son contenu.
    if (before.target?.isConnected && targetContainsExpected(before.target, expectedText)) {
      return { ok: true, reason: 'ancienne-zone-remplie', after };
    }

    // Certaines zones sont recréées/disparaissent après remplissage: dans ce cas on exige
    // deux preuves simultanees, pas seulement la disparition de la source.
    const sourceGone = before.sourcePresent && !after.sourcePresent;
    const oneLessEmpty = after.emptyCount < before.emptyCount;
    if (sourceGone && oneLessEmpty) {
      return { ok: true, reason: 'source-disparue+zone-remplie', after };
    }

    const poolReduced = after.poolCount < before.poolCount;
    const targetChanged = !!before.target && (
      !before.target.isConnected ||
      textOf(before.target) !== before.targetText ||
      (before.target.innerHTML || '') !== before.targetHtml
    );
    if (poolReduced && targetChanged) {
      return { ok: true, reason: 'banque-reduite+cible-changee', after };
    }

    return { ok: false, reason: 'aucune-preuve-dom', after };
  };

  const clickDragItemAutoDrop = async (q, placement, expectedText) => {
    let source = resolveLiveDragItem(findQuestionRoot(), expectedText);
    if (!source) return false;
    const before = clickAutoDropSnapshot(q, placement, expectedText);

    // Le vrai clic peut etre porte par la puce elle-meme, un bouton enfant ou son wrapper.
    const variants = [];
    const add = (el) => {
      if (!el || !el.isConnected || !isVisible(el) || !isEnabled(el) || isAssistantElement(el) || variants.includes(el)) return;
      const r = el.getBoundingClientRect?.();
      if (r && (r.width > Math.max(700, window.innerWidth * 0.9) || r.height > 220)) return;
      variants.push(el);
    };
    add(source);
    add(source.closest?.("button,[role='button'],[role='option'],[class*='word'],[class*='chip'],[class*='token'],[class*='item']"));
    try { [...source.querySelectorAll("button,[role='button'],[role='option'],[tabindex]")].forEach(add); } catch {}
    sourceVariants(source, expectedText).forEach(add);

    for (const candidate0 of variants.slice(0, 5)) {
      let candidate = reacquireDragSource(candidate0, expectedText) || resolveLiveDragItem(findQuestionRoot(), expectedText);
      if (!candidate) {
        const check = await clickAutoDropConfirmed(q, placement, expectedText, before);
        if (check.ok) return true;
        continue;
      }

      log(`Placement par clic: ${expectedText}`);
      await clickElement(candidate);
      let check = await clickAutoDropConfirmed(q, placement, expectedText, before);
      if (check.ok) {
        log(`Placement clique confirme (${check.reason}) : ${expectedText}.`);
        return true;
      }

      // Fallback: reproduire un clic pointer/mouse, toujours SANS drag.
      const fresh = resolveLiveDragItem(findQuestionRoot(), expectedText) || reacquireDragSource(candidate, expectedText);
      if (fresh) {
        const r = fresh.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        try {
          dispatchPointer(fresh, 'pointerdown', x, y, 1);
          dispatchMouse(fresh, 'mousedown', x, y, 1);
          await wait(60);
          dispatchPointer(fresh, 'pointerup', x, y, 0);
          dispatchMouse(fresh, 'mouseup', x, y, 0);
          fresh.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window, clientX:x, clientY:y, button:0, buttons:0 }));
        } catch {}
        check = await clickAutoDropConfirmed(q, placement, expectedText, before);
        if (check.ok) {
          log(`Placement clique confirme (${check.reason}, pointer) : ${expectedText}.`);
          return true;
        }
      }
    }

    return false;
  };


  // v6.3 — Application robuste des "button-choice", notamment les exercices
  // "Fill in the blank with a phrase..." où cliquer une puce remplit directement le trou.
  const buttonChoiceTextWithoutAssistant = (el) => {
    if (!el) return "";
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll?.(".global-exam-assistant-badge,#global-exam-assistant").forEach((n) => n.remove());
      return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
    } catch {
      return String(textOf(el) || "").replace(/\s+/g, " ").trim();
    }
  };

  const buttonChoiceExactText = (el, expectedText) => {
    const a = normLoose(buttonChoiceTextWithoutAssistant(el));
    const b = normLoose(expectedText);
    return !!a && !!b && a === b;
  };

  const buttonChoiceLiveCandidates = (q, expectedText) => {
    const root = q?.root?.isConnected ? q.root : findQuestionRoot();
    const selectors = [
      "button", "[role='button']", "[role='option']", "label",
      "[tabindex]", "[class*='answer']", "[class*='choice']",
      "[class*='option']", "[class*='response']", "[class*='word']",
      "[class*='chip']", "[class*='token']", "[class*='item']"
    ].join(",");

    const seen = new Set();
    const candidates = [];

    const add = (el) => {
      if (!el || seen.has(el) || !el.isConnected || !isVisible(el) || !isEnabled(el) || isAssistantElement(el)) return;
      if (!buttonChoiceExactText(el, expectedText)) return;
      const r = el.getBoundingClientRect?.();
      if (!r || r.width <= 0 || r.height <= 0) return;
      if (r.width > Math.max(760, window.innerWidth * 0.95) || r.height > 260) return;
      seen.add(el);
      candidates.push(el);
    };

    try { [...root.querySelectorAll(selectors)].forEach(add); } catch {}
    if (root !== document.body) {
      try { [...document.querySelectorAll(selectors)].forEach(add); } catch {}
    }

    // Si q.choices possède encore une référence utilisable, la prioriser aussi.
    for (const c of q?.choices || []) {
      if (normLoose(c?.text) !== normLoose(expectedText)) continue;
      add(c.element);

      let cur = c.element;
      for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
        add(cur);
      }

      add(c.element?.closest?.("button,[role='button'],[role='option'],label,[tabindex],[class*='choice'],[class*='option'],[class*='answer'],[class*='response'],[class*='word'],[class*='chip'],[class*='token']"));
      try { [...(c.element?.querySelectorAll?.("button,[role='button'],[role='option'],[tabindex]") || [])].forEach(add); } catch {}

      // Réutiliser la logique déjà robuste des composants React/DnD pour retrouver
      // un wrapper qui porte réellement onClick/onPointerUp.
      try { sourceVariants(c.element, expectedText).forEach(add); } catch {}
    }

    // Les plus petites surfaces interactives sont souvent les vraies puces React.
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const aPriority = a.matches("button,[role='button'],[role='option']") ? 0 : a.tabIndex >= 0 ? 1 : 2;
      const bPriority = b.matches("button,[role='button'],[role='option']") ? 0 : b.tabIndex >= 0 ? 1 : 2;
      return aPriority - bPriority || (ar.width * ar.height) - (br.width * br.height);
    });

    return candidates;
  };

  const buttonChoiceSnapshot = (q, expectedText) => {
    const zones = getLiveZoneElements(document.body);
    const emptyCount = zones.filter((z) => !isZoneFilled(z)).length;
    const expectedInZone = zones.some((z) => isZoneFilled(z) && (
      normLoose(zoneDirectText(z)) === normLoose(expectedText) ||
      normLoose(zoneDirectText(z)).includes(normLoose(expectedText))
    ));

    const live = buttonChoiceLiveCandidates(q, expectedText);
    const selected = live.some((el) => {
      if (isControlSelected(el)) return true;
      const aria = ["aria-selected", "aria-pressed", "aria-checked"].map((a) => el.getAttribute?.(a)).filter(Boolean);
      return aria.some((v) => String(v).toLowerCase() === "true");
    });

    const root = q?.root?.isConnected ? q.root : findQuestionRoot();
    return {
      zones,
      emptyCount,
      expectedInZone,
      candidateCount: live.length,
      selected,
      rootHtml: root?.innerHTML || "",
      progress: currentProgressMarker(),
    };
  };

  const buttonChoiceConfirmed = async (q, expectedText, before) => {
    await wait(260);
    const after = buttonChoiceSnapshot(q, expectedText);

    // Cas principal des "Fill in the blank": la réponse est maintenant dans le trou.
    if (after.expectedInZone) return { ok: true, reason: "réponse-dans-le-trou", after };

    // Certains composants retirent/remplacent le trou après le clic.
    if (after.emptyCount < before.emptyCount) return { ok: true, reason: "un-trou-rempli", after };

    // QCM visuel classique : état sélectionné/pressed/checked.
    if (!before.selected && after.selected) return { ok: true, reason: "état-sélectionné", after };

    // La puce peut disparaître de la banque après avoir été consommée.
    if (before.candidateCount > 0 && after.candidateCount < before.candidateCount && after.rootHtml !== before.rootHtml) {
      return { ok: true, reason: "puce-consommée+DOM-modifié", after };
    }

    // Un rendu React peut recréer tout le bloc sans conserver les classes/ARIA.
    if (after.rootHtml !== before.rootHtml && after.emptyCount <= before.emptyCount) {
      // Accepter uniquement si la page ressemble à un fill-blank à zone unique ou
      // si la réponse exacte n'est plus disponible comme choix.
      const fillInstruction = bodyInstruction().includes(normLoose("fill in the blank")) ||
        bodyInstruction().includes(normLoose("complete the"));
      if (fillInstruction && (after.emptyCount < before.emptyCount || after.candidateCount < before.candidateCount)) {
        return { ok: true, reason: "fill-blank-React-modifié", after };
      }
    }

    return { ok: false, reason: "aucune-preuve-DOM", after };
  };

  const clickButtonChoiceRobust = async (q, originalChoice) => {
    const expectedText = String(originalChoice?.text || "").trim();
    if (!expectedText) return false;

    const before = buttonChoiceSnapshot(q, expectedText);
    let candidates = buttonChoiceLiveCandidates(q, expectedText);

    // Dernier recours: ancienne référence si elle est toujours visible.
    if (!candidates.length && originalChoice?.element?.isConnected) candidates = [originalChoice.element];

    for (const candidate0 of candidates.slice(0, 6)) {
      let candidate = candidate0?.isConnected ? candidate0 : buttonChoiceLiveCandidates(q, expectedText)[0];
      if (!candidate) continue;

      log(`Button-choice : clic sur "${expectedText}".`);
      await clickElement(candidate);
      let check = await buttonChoiceConfirmed(q, expectedText, before);
      if (check.ok) {
        log(`Button-choice confirmé (${check.reason}) : "${expectedText}".`);
        return true;
      }

      // Fallback pointer/mouse sans drag.
      const fresh = buttonChoiceLiveCandidates(q, expectedText)[0];
      if (fresh) {
        const r = fresh.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        try {
          dispatchPointer(fresh, "pointerdown", x, y, 1);
          dispatchMouse(fresh, "mousedown", x, y, 1);
          await wait(55);
          dispatchPointer(fresh, "pointerup", x, y, 0);
          dispatchMouse(fresh, "mouseup", x, y, 0);
          fresh.dispatchEvent(new MouseEvent("click", {
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: x, clientY: y, button: 0, buttons: 0,
          }));
        } catch {}

        check = await buttonChoiceConfirmed(q, expectedText, before);
        if (check.ok) {
          log(`Button-choice confirmé (${check.reason}, pointer) : "${expectedText}".`);
          return true;
        }

        // Dernier recours : appeler directement le handler React du composant.
        if (await invokeReactClickDirect(fresh, expectedText)) {
          check = await buttonChoiceConfirmed(q, expectedText, before);
          if (check.ok) {
            log(`Button-choice confirmé (${check.reason}, React direct) : "${expectedText}".`);
            return true;
          }
        }
      }
    }

    return false;
  };

  const applyResult = async (q, result) => {
    clearHighlights();
    state.agent.lastApplyVerified = false;
    state.agent.partialMutation = false;

    if (result.confidence < state.config.agent.autoConfidenceThreshold) {
      log(`Confiance trop faible (${Math.round(result.confidence * 100)}%).`);
      return false;
    }

    if (q.type === "single-choice") {
      const index = Number(result.choice);
      const choice = q.choices[index];
      if (!choice) throw new Error(`Choix hors limites: ${index}`);
      highlight(choice.element);
      const clicked = await clickElement(choice.element);
      await wait(150);
      state.agent.lastApplyVerified = clicked && isControlSelected(choice.input);
      if (!state.agent.lastApplyVerified) log("La selection radio n'a pas ete confirmee par le DOM.");
      return state.agent.lastApplyVerified;
    }

    if (q.type === "button-choice") {
      const index = Number(result.choice);
      const choice = q.choices[index];
      if (!choice) throw new Error(`Choix hors limites: ${index}`);

      // Ne pas injecter le badge de recommandation DANS la puce avant le clic :
      // certains composants React utilisent le texte/target exact de la puce.
      state.agent.lastApplyVerified = await clickButtonChoiceRobust(q, choice);
      if (!state.agent.lastApplyVerified) {
        log(`Clic button-choice non confirmé pour "${choice.text}"; validation/navigation bloquée.`);
      }
      return state.agent.lastApplyVerified;
    }

    if (q.type === "multi-choice") {
      if (!Array.isArray(result.choices)) throw new Error("JSON invalide: choices attendu.");
      const requested = [...new Set(result.choices.map(Number).filter(Number.isInteger))].sort((a,b) => a-b);
      if (!requested.length || requested.some((idx) => !q.choices[idx])) return false;

      // Appliquer chaque état en réacquérant le DOM après chaque clic.
      for (let i = 0; i < q.choices.length; i++) {
        const original = q.choices[i];
        const should = requested.includes(i);
        const ok = await setChoiceStateRobust(q, original, should);
        if (!ok) {
          const liveActual = selectedChoiceIndexesLive(q);
          log(`Multi-choice: impossible de mettre "${original.text}" a ${should ? "ON" : "OFF"}. Actuel=[${liveActual.join(",")}].`);
          return false;
        }
      }

      await wait(350);
      const actual = selectedChoiceIndexesLive(q).sort((a,b) => a-b);
      state.agent.lastApplyVerified = JSON.stringify(actual) === JSON.stringify(requested);
      if (!state.agent.lastApplyVerified) log(`Cases finales incorrectes: [${actual.join(",")}] attendu [${requested.join(",")}].`);
      return state.agent.lastApplyVerified;
    }

    if (q.type === "text" || q.type === "multi-text") {
      if (!Array.isArray(result.answers)) throw new Error("JSON invalide: answers attendu.");
      const answerMap = new Map();
      for (const a of result.answers) {
        const idx = Number(a.field);
        if (Number.isInteger(idx) && q.fields[idx] && !answerMap.has(idx)) answerMap.set(idx, String(a.text ?? "").trim());
      }
      if (answerMap.size !== q.fields.length || [...answerMap.values()].some((v) => !v)) {
        log(`Fill-blank refusé : ${answerMap.size}/${q.fields.length} champ(s) fournis ou réponse vide.`);
        return false;
      }
      let applied = 0;
      for (let i = 0; i < q.fields.length; i++) {
        const field = q.fields[i], value = answerMap.get(i);
        if (await setNativeValue(field.element, value)) applied += 1;
        highlight(field.element, "Complete");
      }
      await wait(350);
      state.agent.lastApplyVerified = applied === q.fields.length && q.fields.every((f, i) => verifyTextValue(f.element, answerMap.get(i)));
      if (!state.agent.lastApplyVerified) log(`Fill-blank non stable: ${applied}/${q.fields.length} champ(s) confirmes.`);
      return state.agent.lastApplyVerified;
    }

    if (q.type === "select" || q.type === "multi-select") {
      if (!Array.isArray(result.selections)) throw new Error("JSON invalide: selections attendu.");
      let verified = 0;
      for (const s of result.selections) {
        const field = q.fields[Number(s.field)];
        if (!field) continue;
        if (field.kind === "select") {
          const idx = Number(s.option);
          if (selectOptionNative(field.element, idx) && field.element.selectedIndex === idx) verified += 1;
          highlight(field.element, "Selection");
        } else {
          await clickElement(field.element);
          await wait(200);
          const opts = visibleControls("[role='option']", document);
          const opt = opts[Number(s.option)];
          if (opt && await clickElement(opt)) verified += 1;
        }
      }
      state.agent.lastApplyVerified = verified === q.fields.length && verified > 0;
      return state.agent.lastApplyVerified;
    }

    if (q.type === "drag-drop") {
      if (!Array.isArray(result.placements)) throw new Error("JSON invalide: placements attendu.");
      const placements = result.placements
        .map((p) => ({ item: Number(p.item), zone: Number(p.zone) }))
        .filter((p) => Number.isInteger(p.item) && Number.isInteger(p.zone));

      if (placements.length !== q.zones.length) {
        log(`Placement par clic refuse: ${placements.length} placement(s) pour ${q.zones.length} zone(s) restante(s).`);
        return false;
      }
      if (new Set(placements.map((p) => p.zone)).size !== q.zones.length || new Set(placements.map((p) => p.item)).size !== placements.length) {
        log("Placement par clic refuse: mapping non bijectif.");
        return false;
      }
      if (placements.some((p) => p.zone < 0 || p.zone >= q.zones.length || p.item < 0 || p.item >= q.items.length)) {
        log("Placement par clic refuse: index hors limites.");
        return false;
      }

      const originals = q.items.map((i) => ({ index: i.index, text: i.text }));

      // Le clic remplit la prochaine zone disponible. On clique donc les mots dans
      // l'ordre PHYSIQUE des zones, jamais dans l'ordre des items.
      const orderedPlacements = [...placements].sort((a, b) => {
        const za = q.zones[a.zone];
        const zb = q.zones[b.zone];
        return Number(za?.originalIndex ?? a.zone) - Number(zb?.originalIndex ?? b.zone);
      });

      let confirmed = 0;
      for (let position = 0; position < orderedPlacements.length; position++) {
        const p = orderedPlacements[position];
        const expected = originals[p.item];
        const descriptor = q.zones[p.zone];
        const physicalZone = Number(descriptor?.originalIndex ?? p.zone);

        log(`Auto-drop par clic ${position + 1}/${orderedPlacements.length}: item ${p.item} (${expected.text}) -> zone ${physicalZone}.`);
        const ok = await clickDragItemAutoDrop(q, p, expected.text);
        if (!ok) {
          log(`Échec du placement par clic pour ${expected.text}; Valider/Suivant bloqués.`);
          return false;
        }

        confirmed += 1;
        state.agent.partialMutation = true;
        await wait(260);
      }

      // Verification finale: chaque clic a ete confirme au moment de son application et
      // les mots cliques ne doivent plus rester dans la banque. Aucun dragAndDrop() ici.
      await wait(500);
      const finalRoot = findQuestionRoot();
      const finalPool = collectDragItems(finalRoot).map((x) => norm(x.text));
      const clickedTexts = orderedPlacements.map((p) => norm(originals[p.item]?.text || ""));
      const stillAvailable = clickedTexts.filter((t) => t && finalPool.includes(t));

      const finalZones = getLiveZoneElements(finalRoot);
      const finalEmptyZones = finalZones.filter((z) => !isZoneFilled(z));
      state.agent.lastApplyVerified = confirmed === orderedPlacements.length &&
        stillAvailable.length === 0 && finalEmptyZones.length === 0;
      if (!state.agent.lastApplyVerified) {
        log(`Auto-drop final non confirmé: ${confirmed}/${orderedPlacements.length} clic(s), mots encore dans la banque=${stillAvailable.length}, zones encore vides=${finalEmptyZones.length}. Validation bloquee.`);
      } else {
        log(`Auto-drop par clic termine: ${confirmed}/${orderedPlacements.length} placement(s) confirmes, aucune zone vide.`);
      }
      return state.agent.lastApplyVerified;
    }

    if (q.type === "ordering") {
      if (!Array.isArray(result.order)) throw new Error("JSON invalide: order attendu.");
      const order = result.order.map(Number);
      const requiredNow = Number(q.requiredCount ?? q.items.length);
      if (requiredNow !== q.items.length) {
        log(`Ordering: comptage rafraichi ${q.items.length} fragment(s) disponible(s) (requiredCount=${requiredNow}).`);
      }
      // Aucun nombre fixe: il faut EXACTEMENT tous les fragments actuellement disponibles.
      if (order.length !== q.items.length || new Set(order).size !== q.items.length || order.some((i) => !Number.isInteger(i) || i < 0 || i >= q.items.length)) {
        log(`Ordering refuse: ${order.length} index recus, ${q.items.length} fragment(s) actuellement a selectionner.`);
        return false;
      }
      if (q.mode === "drag-order-target") {
        const instructionForLiveTarget = () => findOrderingInstructionElement(document.body) || findOrderingInstructionElement(q.root || document.body);
        const getTarget = () => {
          if (q.orderTarget?.isConnected && isVisible(q.orderTarget)) return q.orderTarget;
          const instruction = instructionForLiveTarget();
          return findOrderingTarget(q.root || document.body, instruction) ||
            findOrderingTarget(document.body, instruction) || null;
        };

        let target = getTarget();
        if (!target) {
          log("Ordering drag: zone cible introuvable; navigation bloquée.");
          return false;
        }

        const initialTargetSnapshot = `${textOf(target)}::${target.innerHTML}`;
        let confirmed = 0;

        // IMPORTANT: on placé les fragments dans l'ordre donne par Groq, tous vers
        // la MEME zone de phrase. Apres chaque placement React peut recreer la cible
        // et la banque de mots, donc on retrouve source + cible a chaque tour.
        for (let position = 0; position < order.length; position++) {
          const idx = order[position];
          const original = q.items[idx];
          const source = resolveLiveOrderingItem(q, original.text);
          target = getTarget();

          if (!source || !target) {
            log(`Ordering drag: source/cible introuvable pour ${idx} (${original.text}) a la position ${position + 1}.`);
            return false;
          }

          const targetBeforeText = textOf(target);
          const targetBeforeHtml = target.innerHTML;
          const sourceBeforeParent = source.parentElement;

          log(`Ordering drag ${position + 1}/${order.length}: ${idx} (${original.text}) -> zone phrase.`);
          const placed = await dragAndDrop(source, target, `ordre ${position + 1}`, original.text);
          if (!placed) {
            log(`Ordering drag : échec pour ${idx} (${original.text}); Valider/Suivant bloqués.`);
            return false;
          }

          await wait(320);
          target = getTarget();
          const targetChanged = !!target && (textOf(target) !== targetBeforeText || target.innerHTML !== targetBeforeHtml);
          const sourceMoved = !source.isConnected || source.parentElement !== sourceBeforeParent || !isVisible(source);
          const targetContainsWord = !!target && norm(textOf(target)).includes(norm(original.text));

          if (!targetChanged && !sourceMoved && !targetContainsWord) {
            log(`Ordering drag: placement ${idx} non confirmé par le DOM; navigation bloquée.`);
            return false;
          }

          confirmed += 1;
          state.agent.partialMutation = true;
          await wait(220);
        }

        await wait(500);
        target = getTarget();
        if (!target) {
          log("Ordering drag: cible disparue avant vérification finale.");
          return false;
        }

        // Verification dure: la zone finale doit contenir les fragments dans le meme ordre.
        // On tolere la ponctuation/espacement generes par le composant via norm().
        const finalText = norm(textOf(target));
        let cursor = -1;
        let sequenceOk = true;
        for (const idx of order) {
          const part = q.items[idx].text;
          const pos = findFragmentAfter(finalText, part, cursor + 1);
          if (pos < 0) { sequenceOk = false; break; }
          cursor = pos + Math.max(1, norm(part).length);
        }

        const finalSnapshot = `${textOf(target)}::${target.innerHTML}`;
        const visualOrder = orderingVisualSequence(q, target);
        const visualOk = visualOrder.length === order.length && visualOrder.every((idx, pos) => idx === order[pos]);
        const changed = finalSnapshot !== initialTargetSnapshot || confirmed === order.length;
        state.agent.lastApplyVerified = confirmed === order.length && changed && (sequenceOk || visualOk);
        if (!state.agent.lastApplyVerified) {
          log(`Ordering drag non confirmé: ${confirmed}/${order.length} placements, sequenceTexte=${sequenceOk ? "OK" : "KO"}, sequenceVisuelle=${visualOk ? "OK" : `[${visualOrder.join(",")}]`}. Navigation bloquee.`);
        }
        return state.agent.lastApplyVerified;
      }

      if (q.mode === "click-order") {
        let target = orderingTargetLive(q);
        if (!target) {
          log("Ordering clic : zone résultat introuvable; navigation bloquée.");
          return false;
        }
        const beforeTarget = `${textOf(target)}::${target.innerHTML}`;
        let confirmedClicks = 0;

        // Cliquer chaque fragment dans l'ordre. Global Exam l'ajoute automatiquement
        // dans la zone pointillee avec son numero (1, 2, 3...).
        for (let position = 0; position < order.length; position++) {
          const idx = order[position];
          const original = q.items[idx];
          log(`Ordering clic ${position + 1}/${order.length}: ${idx} (${original.text}).`);

          const ok = await clickOrderingItemRobust(q, original);
          if (!ok) {
            log(`Ordering: clic non confirmé pour ${idx} (${original.text}); Valider/Suivant bloqués.`);
            return false;
          }
          confirmedClicks += 1;
          state.agent.partialMutation = true;
          await wait(180);
        }

        await wait(450);
        target = orderingTargetLive(q);
        if (!target) {
          log("Ordering clic : zone résultat disparue avant vérification finale.");
          return false;
        }

        // Double preuve: texte dans le bon ordre OU positions visuelles des fragments.
        const targetText = norm(textOf(target));
        let lastPos = -1, sequenceOk = true;
        for (const idx of order) {
          const part = q.items[idx].text;
          const pos = findFragmentAfter(targetText, part, lastPos + 1);
          if (pos < 0) { sequenceOk = false; break; }
          lastPos = pos + Math.max(1, norm(part).length);
        }

        const visualOrder = orderingVisualSequence(q, target);
        const visualOk = visualOrder.length === order.length && visualOrder.every((idx, pos) => idx === order[pos]);
        const finalSnapshot = `${textOf(target)}::${target.innerHTML}`;

        // Verification CRITIQUE v5.5: après les clics, refaire le comptage sur TOUT le document.
        // S'il reste ne serait-ce qu'un fragment cliquable dans la banque, l'exercice n'est
        // pas termine et Valider doit rester strictement interdit.
        const finalInstruction = findOrderingInstructionElement(document.body);
        const finalTargetForCount = orderingTargetLive(q) || findOrderingTarget(document.body, finalInstruction);
        const finalState = orderingSelectionState(document.body, finalInstruction, finalTargetForCount);
        const noRemainingItems = finalState.remainingCount === 0;

        state.agent.lastApplyVerified = confirmedClicks === order.length &&
          finalSnapshot !== beforeTarget && (sequenceOk || visualOk) && noRemainingItems;
        if (!state.agent.lastApplyVerified) {
          log(`Ordering clic non confirmé: ${confirmedClicks}/${order.length}, reste=${finalState.remainingCount}, sequenceTexte=${sequenceOk ? "OK" : "KO"}, sequenceVisuelle=${visualOk ? "OK" : `[${visualOrder.join(",")}]`}. Valider bloqué.`);
          if (finalState.remainingCount > 0) {
            log(`Ordering incomplet: ${finalState.remainingCount} fragment(s) encore cliquable(s): ${finalState.remainingItems.map((x)=>x.text).join(" | ")}`);
          }
        }
        return state.agent.lastApplyVerified;
      }
      const desired = order.map((i) => q.items[i]);
      for (let i = 0; i < desired.length; i++) {
        const item = desired[i], target = q.items[i]?.element;
        if (item?.element && target && item.element !== target && !(await dragAndDrop(item.element, target, `ordre ${i}`))) return false;
      }
      state.agent.lastApplyVerified = true;
      return true;
    }

    if (q.type === "matching") {
      if (!Array.isArray(result.pairs)) throw new Error("JSON invalide: pairs attendu.");
      let applied = 0;
      for (const p of result.pairs) {
        const left = q.left[Number(p.left)];
        const right = q.right[Number(p.right)];
        if (!left || !right) continue;
        highlight(left.element, "Pair");
        highlight(right.element, "Pair");
        const a = await clickElement(left.element);
        const b = await clickElement(right.element);
        if (a && b) applied += 1;
      }
      state.agent.lastApplyVerified = applied === result.pairs.length && applied > 0;
      return state.agent.lastApplyVerified;
    }

    if (q.type === "matrix") {
      if (!Array.isArray(result.rows)) throw new Error("JSON invalide: rows attendu.");
      for (const r of result.rows) {
        const row = q.rows[Number(r.row)];
        const choice = row?.choices?.[Number(r.choice)];
        if (!choice) return false;
        highlight(choice.element, "Selection");
        if (!isControlSelected(choice.input)) await clickElement(choice.element);
      }
      await wait(150);
      state.agent.lastApplyVerified = result.rows.every((r) => {
        const row = q.rows[Number(r.row)];
        return isControlSelected(row?.choices?.[Number(r.choice)]?.input);
      });
      return state.agent.lastApplyVerified;
    }

    return false;
  };

  const resultSummary = (q, result) => {
    if (!result) return "Aucune";
    if (q?.type === "single-choice" || q?.type === "button-choice") {
      const c = q.choices?.[Number(result.choice)];
      return c ? c.text : `Choix ${result.choice}`;
    }
    if (Array.isArray(result.choices) && q?.choices) return result.choices.map((i) => q.choices[Number(i)]?.text).filter(Boolean).join(", ");
    if (Array.isArray(result.answers)) return result.answers.map((a) => a.text).join(" | ");
    if (Array.isArray(result.selections)) return result.selections.map((s) => `champ ${s.field} -> option ${s.option}`).join(" | ");
    if (Array.isArray(result.placements)) return result.placements.map((p) => `${p.item} -> ${p.zone}`).join(" | ");
    if (Array.isArray(result.order)) return result.order.join(" -> ");
    if (Array.isArray(result.pairs)) return result.pairs.map((p) => `${p.left}<->${p.right}`).join(" | ");
    if (Array.isArray(result.rows)) return result.rows.map((r) => `L${r.row}:${r.choice}`).join(" | ");
    return "Réponse reçue";
  };

  const renderPanel = (q = null) => {
    if (!state.agent.panel) {
      const p = document.createElement("div");
      p.id = "global-exam-assistant";
      p.style.cssText = [
        "position:fixed", "right:16px", "bottom:16px", "z-index:2147483647",
        "width:min(360px,calc(100vw - 32px))", "max-height:62vh", "overflow:auto",
        "box-sizing:border-box", "padding:14px", "border:1px solid #93c5fd", "border-radius:10px",
        "background:#fff", "color:#111827", "box-shadow:0 12px 32px rgba(15,23,42,.24)",
        "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
      ].join(";");
      document.body.appendChild(p);
      state.agent.panel = p;
    }

    state.agent.panel.style.width = state.agent.panelCollapsed ? "min(235px,calc(100vw - 32px))" : "min(380px,calc(100vw - 32px))";
    state.agent.panel.style.maxHeight = state.agent.panelCollapsed ? "none" : "62vh";
    state.agent.panel.style.overflow = state.agent.panelCollapsed ? "hidden" : "auto";
    state.agent.panel.style.padding = state.agent.panelCollapsed ? "8px 10px" : "14px";

    const current = q || detectQuestion();
    const storedResult = state.agent.lastResult;
    const compatibleResult = !storedResult ? null :
      (!storedResult.questionKey || storedResult.questionKey === current.key ||
        (storedResult.questionPrompt && current.prompt && promptSimilarity(storedResult.questionPrompt, current.prompt) >= 0.58))
        ? storedResult : null;
    const result = compatibleResult;
    const status = state.agent.blockReason ? `BLOQUE: ${state.agent.blockReason}` : state.agent.analyzing ? "Analyse en cours..." : result?.error ? result.error : "";
    const providerList = result?.providers?.length ? result.providers.join(" + ") : (state.agent.lastProvider || state.config.agent.provider || "auto");
    const modelLabel = state.agent.lastModel || (state.config.agent.model !== "auto" ? state.config.agent.model : "sélection automatique");
    const pace = activityPacingStatus();
    state.agent.panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:800;font-size:15px;">Global Exam Assistant v6.3 — Multi-IA</div>
        <button id="gea-collapse" type="button" title="${state.agent.panelCollapsed ? "Agrandir" : "Réduire"}" style="border:0;border-radius:7px;background:#e5e7eb;color:#111827;width:30px;height:28px;cursor:pointer;font-size:18px;line-height:1;flex:0 0 auto;">${state.agent.panelCollapsed ? "+" : "−"}</button>
      </div>
      ${state.agent.panelCollapsed ? `
        <div style="margin-top:5px;font-size:11px;color:#4b5563;">Auto ${state.config.agent.autoAnswer ? "ON" : "OFF"} · ${escapeHtml(providerList)}</div>
      ` : `
        <div style="margin-top:8px;margin-bottom:6px;"><strong>Auto :</strong> ${state.config.agent.autoAnswer ? "ON" : "OFF"}</div>
        ${pace ? `<div style="margin-bottom:6px;"><strong>Rythme :</strong> cible ${Math.round(pace.targetMinutes)} min — écoulé ~${Math.round(pace.elapsedMinutes)} min</div>` : ""}
        <div style="margin-bottom:6px;"><strong>IA :</strong> ${escapeHtml(providerList)}</div>
        <div style="margin-bottom:6px;"><strong>Type :</strong> ${escapeHtml(current.type === "feedback" ? "correction / résultat" : (current.type || "-"))}</div>
        ${current.type === "ordering" ? `<div style="margin-bottom:6px;"><strong>Interaction :</strong> ${escapeHtml(current.mode || "ordering")}</div><div style="margin-bottom:6px;"><strong>À sélectionner :</strong> ${Number(current.requiredCount ?? current.items?.length ?? 0)}${Number(current.alreadySelectedCount || 0) ? ` restant(s) — ${Number(current.alreadySelectedCount)} déjà placé(s)` : ""}</div>` : ""}
        ${current.type === "drag-drop" ? `<div style="margin-bottom:6px;"><strong>Interaction :</strong> ${escapeHtml(current.mode || "click-auto-drop")}</div>` : ""}
        <div style="margin-bottom:6px;font-size:11px;color:#666;"><strong>Modèle :</strong> ${escapeHtml(modelLabel)}</div>
        <div style="margin-bottom:8px;"><strong>Réponse :</strong><br>${escapeHtml(resultSummary(current, result))}</div>
        <div style="margin-bottom:8px;"><strong>Confiance :</strong> ${result && Number.isFinite(result.confidence) ? Math.round(result.confidence * 100) + " %" : "-"}</div>
        ${result?.consensus ? `<div style="margin-bottom:8px;"><strong>Consensus :</strong> ${escapeHtml(result.consensus)}</div>` : ""}
        <div style="margin-bottom:8px;"><strong>Explication :</strong><br>${escapeHtml(result?.explanation || "-")}</div>
        ${status ? `<div style="margin-bottom:10px;color:${result?.error ? "#b91c1c" : "#2563eb"};">${escapeHtml(status)}</div>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="gea-analyze" type="button" style="border:0;border-radius:7px;background:#2563eb;color:#fff;padding:8px 10px;cursor:pointer;">Analyser</button>
          <button id="gea-answer" type="button" style="border:0;border-radius:7px;background:#16a34a;color:#fff;padding:8px 10px;cursor:pointer;">Répondre</button>
          <button id="gea-auto" type="button" style="border:0;border-radius:7px;background:#9333ea;color:#fff;padding:8px 10px;cursor:pointer;">Auto : ${state.config.agent.autoAnswer ? "ON" : "OFF"}</button>
        </div>
      `}`;

    state.agent.panel.querySelector("#gea-collapse").onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      state.agent.panelCollapsed = !state.agent.panelCollapsed;
      renderPanel(current);
    };
    if (state.agent.panelCollapsed) return;
    state.agent.panel.querySelector("#gea-analyze").onclick = (e) => { e.preventDefault(); e.stopPropagation(); analyzeCurrentQuestion(); };
    state.agent.panel.querySelector("#gea-answer").onclick = (e) => { e.preventDefault(); e.stopPropagation(); answerCurrentQuestion(); };
    state.agent.panel.querySelector("#gea-auto").onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleAutoAnswer(); };
  };

  const stableQuestionPrompt = (q) => normLoose(q?.prompt || "");

  const promptSimilarity = (a, b) => {
    const ta = new Set(stableQuestionPrompt({ prompt: a }).split(" ").filter((x) => x.length > 2));
    const tb = new Set(stableQuestionPrompt({ prompt: b }).split(" ").filter((x) => x.length > 2));
    if (!ta.size || !tb.size) return 0;
    let common = 0;
    for (const t of ta) if (tb.has(t)) common += 1;
    return common / Math.max(ta.size, tb.size);
  };

  const sameQuestion = (before, after) => {
    if (!before || !after || before.type !== after.type) return false;
    const a = stableQuestionPrompt(before);
    const b = stableQuestionPrompt(after);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;

    const similarity = promptSimilarity(before.prompt, after.prompt);
    if (similarity >= 0.58) return true;

    // Les zones de drag/drop peuvent modifier le DOM pendant que Groq repond.
    if (before.type === "drag-drop" && before.zones?.length === after.zones?.length && similarity >= 0.35) return true;
    return false;
  };

  const mapTextToChoiceIndex = (q, value) => {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < (q.choices?.length || 0)) return numeric;
    const wanted = normLoose(value);
    if (!wanted) return null;
    let exact = q.choices?.find((c) => normLoose(c.text) === wanted);
    if (exact) return exact.index;
    let best = null, bestScore = 0;
    for (const c of q.choices || []) {
      const ct = normLoose(c.text);
      let score = promptSimilarity(wanted, ct);
      if (ct.includes(wanted) || wanted.includes(ct)) score = Math.max(score, 0.82);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best && bestScore >= 0.55 ? best.index : null;
  };

  const normalizeResultForQuestion = (q, raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const result = {...raw};
    if (q.type === "single-choice" || q.type === "button-choice") {
      const idx = mapTextToChoiceIndex(q, result.choice);
      if (idx !== null) result.choice = idx;
    }
    if (q.type === "multi-choice") {
      let values = Array.isArray(result.choices) ? result.choices : [];
      if (!values.length && typeof result.choice === "string") values = result.choice.split(/[,;|]/).map((x)=>x.trim()).filter(Boolean);
      result.choices = [...new Set(values.map((v)=>mapTextToChoiceIndex(q,v)).filter((v)=>v !== null))].sort((a,b)=>a-b);
    }
    if (q.type === "ordering" && Array.isArray(result.order)) {
      result.order = result.order.map(Number);
      const questionMarkIndexes = (q.items || [])
        .map((item, idx) => ({ idx, raw: String(item.text || "").trim() }))
        .filter((x) => /^\?+$/.test(x.raw))
        .map((x) => x.idx);
      if (questionMarkIndexes.length === 1 && hasAnyInstruction(orderingInstructionMarkers)) {
        const qm = questionMarkIndexes[0];
        if (result.order.includes(qm)) {
          result.order = result.order.filter((x) => x !== qm);
          result.order.push(qm);
        }
      }
    }
    result.confidence = Number.isFinite(Number(result.confidence)) ? Math.max(0,Math.min(1,Number(result.confidence))) : 0.5;
    result.explanation = String(result.explanation || "").trim();
    return result;
  };

  const bestValidCandidate = (q, candidates = []) => candidates
    .map((c)=>normalizeResultForQuestion(q,c))
    .filter((c)=>structurallyValidResult(q,c))
    .sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0))[0] || null;

  const mergeProviders = (...results) => [...new Set(results.flatMap((r) => Array.isArray(r?.providers) ? r.providers : (r?.provider ? [r.provider] : [])))]
    .filter(Boolean);

  const resultSignature = (q, result) => {
    if (!result) return "";
    if (q.type === "single-choice" || q.type === "button-choice") return `choice:${Number(result.choice)}`;
    if (q.type === "multi-choice") return `choices:${[...(result.choices || [])].map(Number).sort((a,b)=>a-b).join(",")}`;
    if (q.type === "text" || q.type === "multi-text") return `answers:${[...(result.answers || [])].map((a) => `${Number(a.field)}=${norm(a.text)}`).sort().join("|")}`;
    if (q.type === "select" || q.type === "multi-select") return `select:${[...(result.selections || [])].map((x) => `${Number(x.field)}=${Number(x.option)}`).sort().join("|")}`;
    if (q.type === "drag-drop") return `drag:${[...(result.placements || [])].map((x) => `${Number(x.zone)}=${Number(x.item)}`).sort().join("|")}`;
    if (q.type === "ordering") return `order:${[...(result.order || [])].map(Number).join(",")}`;
    if (q.type === "matching") return `pairs:${[...(result.pairs || [])].map((x) => `${Number(x.left)}=${Number(x.right)}`).sort().join("|")}`;
    if (q.type === "matrix") return `rows:${[...(result.rows || [])].map((x) => `${Number(x.row)}=${Number(x.choice)}`).sort().join("|")}`;
    return JSON.stringify(result);
  };

  const needsDoubleCheck = (q) => state.config.agent.doubleCheckComplex && [
    "multi-choice", "text", "multi-text", "select", "multi-select", "drag-drop", "ordering", "matching", "matrix"
  ].includes(q.type);

  const structurallyValidResult = (q, result) => {
    if (!q || !result) return false;
    if (q.type === "single-choice" || q.type === "button-choice") {
      const i = Number(result.choice);
      return Number.isInteger(i) && i >= 0 && i < (q.choices?.length || 0);
    }
    if (q.type === "multi-choice") {
      const a = (result.choices || []).map(Number);
      return Array.isArray(result.choices) && a.length > 0 && new Set(a).size === a.length && a.every((i) => Number.isInteger(i) && i >= 0 && i < q.choices.length);
    }
    if (q.type === "text" || q.type === "multi-text") {
      if (!Array.isArray(result.answers) || result.answers.length !== q.fields.length) return false;
      const m = new Map(result.answers.map((a) => [Number(a.field), String(a.text ?? "").trim()]));
      return q.fields.every((_, i) => m.has(i) && !!m.get(i));
    }
    if (q.type === "select" || q.type === "multi-select") {
      return Array.isArray(result.selections) && result.selections.length === q.fields.length;
    }
    if (q.type === "drag-drop") {
      if (!Array.isArray(result.placements) || result.placements.length !== q.zones.length) return false;
      const ps = result.placements.map((p) => ({ item: Number(p.item), zone: Number(p.zone) }));
      return new Set(ps.map((p) => p.zone)).size === q.zones.length &&
        new Set(ps.map((p) => p.item)).size === ps.length &&
        ps.every((p) => Number.isInteger(p.item) && Number.isInteger(p.zone) && p.item >= 0 && p.item < q.items.length && p.zone >= 0 && p.zone < q.zones.length);
    }
    if (q.type === "ordering") {
      const a = (result.order || []).map(Number);
      return Array.isArray(result.order) && a.length === q.items.length && new Set(a).size === q.items.length && a.every((i) => Number.isInteger(i) && i >= 0 && i < q.items.length);
    }
    if (q.type === "matching") {
      return Array.isArray(result.pairs) && result.pairs.length > 0;
    }
    if (q.type === "matrix") {
      return Array.isArray(result.rows) && result.rows.length === q.rows.length;
    }
    return true;
  };

  const adjudicationNote = (q, first, second) => {
    const a = JSON.stringify(first);
    const b = JSON.stringify(second);
    return [
      "Deux analyses indépendantes ne donnent pas la même réponse.",
      "Tu es l'arbitre final. Reprends l'exercice depuis zéro avec les ITEMS et ZONES/CHAMPS fournis dans le prompt principal.",
      "Compare les deux candidats ci-dessous, mais ne leur fais pas confiance automatiquement.",
      "La réponse finale doit être sémantiquement cohérente avec ton explication et respecter exactement le schéma strict.",
      q.type === "drag-drop" ? "Pour un drag-drop, lis la position [[ZONE_n]] dans chaque contexte et associe chaque item exactement une fois." : "",
      `Candidat A: ${a}`,
      `Candidat B: ${b}`,
      "Renvoie uniquement la réponse finale corrigée."
    ].filter(Boolean).join("\n");
  };

  const analyzeCurrentQuestion = async () => {
    if (state.agent.analyzing) { agentLog("Analyse déjà en cours."); return null; }
    const q = detectQuestion();
    if (q.type === "feedback") {
      state.agent.lastResult = { error: "Page de correction/résultat : aucune analyse nécessaire." };
      renderPanel(q); return state.agent.lastResult;
    }
    if (q.type === "none") {
      state.agent.lastResult = { error: "Aucune question interactive détectée." };
      renderPanel(q); return state.agent.lastResult;
    }
    if (q.type === "unknown-question") {
      hardBlock(q.key, "Question probable mais type non reconnu. Aucune navigation automatique.");
      state.agent.lastResult = { error: state.agent.blockReason };
      renderPanel(q); return state.agent.lastResult;
    }

    // Cas déterministe : un seul choix visible pour un seul trou.
    // Il n'y a rien à arbitrer avec une IA : la seule action possible est ce choix.
    if (q.type === "button-choice" && q.choices?.length === 1 && isSingleChoiceFillContext(q.root)) {
      const result = {
        choice: 0,
        confidence: 1,
        explanation: `Un seul choix est disponible pour le seul trou : "${q.choices[0].text}".`,
        consensus: "déterministe",
        providers: ["règle-locale"],
      };
      state.agent.lastQuestionKey = q.key;
      state.agent.lastResult = result;
      agentLog(`Choix unique détecté ("${q.choices[0].text}") : aucune requête IA nécessaire.`);
      renderPanel(q);
      return result;
    }

    state.agent.analyzing = true;
    state.agent.lastQuestionKey = q.key;
    state.agent.lastResult = null;
    renderPanel(q);
    try {
      agentLog(`Analyse du type ${q.type}.`);
      let result = normalizeResultForQuestion(q, await askAiAgent(q, "", 0));
      if (needsDoubleCheck(q)) {
        agentLog(`Double vérification multi-IA pour ${q.type}...`);
        const review = normalizeResultForQuestion(q, await askAiAgent(q, "Refais le raisonnement indépendamment. Vérifie tous les index et renvoie la réponse finale selon le même schéma strict.", 1));
        const sigA = resultSignature(q, result);
        const sigB = resultSignature(q, review);
        const validA = structurallyValidResult(q, result);
        const validB = structurallyValidResult(q, review);

        if (sigA === sigB && validA && validB) {
          // v5.0: deux analyses indépendantes qui donnent exactement la meme structure
          // constituent un signal plus utile que le "confidence" auto-déclaré du modèle.
          // On ne laisse donc plus une seule valeur aberrante (ex: 25%) faire tomber
          // une réponse 2/2 sous le seuil d'application.
          const aConf = Number(result.confidence || 0.5);
          const bConf = Number(review.confidence || 0.5);
          result.confidence = Math.max(aConf, bConf, state.config.agent.consensusConfidenceFloor);
          result.consensus = "2/2";
          result.providers = mergeProviders(result, review);
          agentLog(`Double vérification cohérente pour ${q.type} (consensus 2/2, ${result.providers.join(" + ") || "IA"}).`);
        } else if (state.config.agent.adjudicateOnDisagreement) {
          agentLog(`Désaccord multi-IA pour ${q.type}; arbitrage avec un troisième slot fournisseur...`);
          let finalReview = normalizeResultForQuestion(q, await askAiAgent(q, adjudicationNote(q, result, review), 2));
          let finalValid = structurallyValidResult(q, finalReview);

          // v4.9: un arbitre peut exceptionnellement renvoyer [] ou un format inutilisable
          // meme avec le schema. On lui donne jusqu'a N chances de REPARER la structure au lieu
          // de bloquer toute l'automatisation immediatement.
          for (let repair = 0; !finalValid && repair < state.config.agent.adjudicationRepairAttempts; repair++) {
            agentLog(`Arbitrage ${q.type} invalide; reparation ${repair + 1}/${state.config.agent.adjudicationRepairAttempts}...`);
            finalReview = normalizeResultForQuestion(q, await askAiAgent(q, [
              "La réponse d'arbitrage précédente était structurellement invalide.",
              `Réponse invalide : ${JSON.stringify(finalReview)}`,
              q.type === "multi-choice" ? `Tu DOIS retourner au moins un index dans choices, uniquement parmi 0..${Math.max(0,(q.choices?.length||1)-1)}.` : "Corrige uniquement la structure et les index en résolvant à nouveau l'exercice.",
              "Respecte exactement le schéma JSON strict."
            ].join("\n"), 2));
            finalValid = structurallyValidResult(q, finalReview);
          }

          if (!finalValid) {
            // Dernier filet de sécurité: si A ou B etait déjà une réponse parfaitement valide
            // avec une confiance suffisante, on garde la meilleure au lieu d'un hard-block cause
            // uniquement par un arbitre mal formé. On ne navigue toujours qu'après vérification DOM.
            const fallback = bestValidCandidate(q, [result, review]);
            if (fallback && Number(fallback.confidence || 0) >= state.config.agent.adjudicationFallbackMinConfidence) {
              result = fallback;
              result.confidence = Math.min(Number(result.confidence || 0.5), 0.88);
              agentLog(`Arbitrage invalide; fallback sur le meilleur candidat valide pour ${q.type}.`);
            } else {
              hardBlock(q.key, `Arbitrage IA invalide pour ${q.type} apres reparations. Aucune réponse appliquée.`);
              state.agent.lastResult = { error: state.agent.blockReason };
              return state.agent.lastResult;
            }
          } else {
            const sigFinal = resultSignature(q, finalReview);
            const finalConfidence = Number(finalReview.confidence || 0.5);

            // Si l'arbitre confirme l'un des deux candidats, on a un consensus 2 contre 1.
            // S'il propose une troisieme solution, on ne l'accepte qu'avec une confiance elevee.
            if (sigFinal === sigA || sigFinal === sigB) {
              const matched = sigFinal === sigA ? result : review;
              const consensusProviders = mergeProviders(result, review, finalReview);
              result = finalReview;
              result.providers = consensusProviders;
              // v5.0: l'arbitre + un candidat = consensus 2/3. Le score de confiance
              // auto-déclaré de l'arbitre ne doit pas annuler ce consensus structurel.
              result.confidence = Math.max(
                finalConfidence,
                Number(matched?.confidence || 0.5),
                state.config.agent.consensusConfidenceFloor
              );
              result.consensus = "2/3";
              agentLog(`Arbitrage confirme un candidat pour ${q.type} (consensus 2/3).`);
            } else if (finalConfidence >= state.config.agent.adjudicationMinConfidence) {
              const correctionProviders = mergeProviders(result, review, finalReview);
              result = finalReview;
              result.providers = correctionProviders;
              result.confidence = Math.min(finalConfidence, 0.90);
              agentLog(`Arbitrage fournit une solution corrigee pour ${q.type}.`);
            } else {
              const fallback = bestValidCandidate(q, [result, review]);
              if (fallback && Number(fallback.confidence || 0) >= state.config.agent.adjudicationFallbackMinConfidence) {
                result = fallback;
                result.confidence = Math.min(Number(result.confidence || 0.5), 0.86);
                agentLog(`Arbitrage peu confiant; fallback candidat valide pour ${q.type}.`);
              } else {
                hardBlock(q.key, `Desaccord IA persistant pour ${q.type} (arbitrage ${Math.round(finalConfidence * 100)}%). Aucune réponse appliquée.`);
                state.agent.lastResult = { error: state.agent.blockReason };
                return state.agent.lastResult;
              }
            }
          }
        } else {
          hardBlock(q.key, `Double vérification IA incohérente pour ${q.type}. Aucune réponse appliquée.`);
          state.agent.lastResult = { error: state.agent.blockReason };
          return state.agent.lastResult;
        }
      }
      const now = detectQuestion();
      if (now.type !== "feedback" && now.type !== "none" && !sameQuestion(q, now)) {
        agentLog("Une vraie nouvelle question a été détectée pendant l'analyse ; résultat ignoré.");
        return null;
      }
      state.agent.lastResult = { ...result, questionType: q.type, questionKey: q.key, questionPrompt: q.prompt };
      renderPanel(q);
      return state.agent.lastResult;
    } catch (e) {
      state.agent.lastResult = { error: e?.message || String(e) };
      console.warn("[Global Exam Assistant]", e);
      renderPanel(q);
      return state.agent.lastResult;
    } finally {
      state.agent.analyzing = false;
      renderPanel(q);
    }
  };


  const existingResponseState = (q) => {
    if (!q) return { state: 'empty', detail: '' };

    if (q.type === 'text' || q.type === 'multi-text') {
      const vals = (q.fields || []).map((f) => String(f.element?.value || '').trim());
      const n = vals.filter(Boolean).length;
      return { state: n === vals.length && n > 0 ? 'complete' : n > 0 ? 'partial' : 'empty', detail: `${n}/${vals.length} champ(s)` };
    }

    if (q.type === 'select' || q.type === 'multi-select') {
      const done = (q.fields || []).filter((f) => {
        if (f.kind === 'select') return Number(f.element?.selectedIndex) > 0 || (!!f.element?.value && f.element?.value !== '');
        return !!normLoose(f.element?.getAttribute?.('aria-valuetext') || f.element?.textContent || '');
      }).length;
      const total = (q.fields || []).length;
      return { state: done === total && total > 0 ? 'complete' : done > 0 ? 'partial' : 'empty', detail: `${done}/${total} selection(s)` };
    }

    if (q.type === 'single-choice') {
      const selected = (q.choices || []).filter((c) => isControlSelected(c.input || c.element));
      return { state: selected.length === 1 ? 'complete' : selected.length > 1 ? 'partial' : 'empty', detail: `${selected.length} choix selectionne(s)` };
    }

    if (q.type === 'multi-choice') {
      const actual = selectedChoiceIndexesLive(q).sort((a,b) => a-b);
      // Pour un multi-choice, une selection existante n'est declaree "complete" que
      // si elle correspond a la dernière réponse IA connue ou si cette page a déjà ete
      // verifiee par applyResult(). Sinon on ne devine pas le nombre de bonnes cases.
      const last = state.agent.lastResult;
      const expected = Array.isArray(last?.choices) ? [...new Set(last.choices.map(Number).filter(Number.isInteger))].sort((a,b)=>a-b) : [];
      const matchesLast = expected.length > 0 && JSON.stringify(actual) === JSON.stringify(expected);
      const complete = actual.length > 0 && (matchesLast || wasPageApplied());
      return { state: complete ? 'complete' : actual.length > 0 ? 'partial' : 'empty', detail: `[${actual.join(',')}]` };
    }

    if (q.type === 'matrix') {
      const rows = q.rows || [];
      const done = rows.filter((r) => (r.choices || []).some((c) => isControlSelected(c.input || c.element))).length;
      return { state: done === rows.length && rows.length > 0 ? 'complete' : done > 0 ? 'partial' : 'empty', detail: `${done}/${rows.length} ligne(s)` };
    }

    if (q.type === 'drag-drop' && isFillWordsInstruction()) {
      const all = getLiveZoneElements(document.body);
      const filled = all.filter(isZoneFilled).length;
      return { state: filled === all.length && all.length > 0 ? 'complete' : filled > 0 ? 'partial' : 'empty', detail: `${filled}/${all.length} zone(s)` };
    }

    if (q.type === 'ordering') {
      const instruction = findOrderingInstructionElement(document.body);
      const target = findOrderingTarget(document.body, instruction);
      const st = orderingSelectionState(document.body, instruction, target);
      const has = !!st.target && (!!norm(zoneDirectText(st.target)) || st.selectedCount > 0);
      return {
        state: has && st.remainingCount === 0 ? 'complete' : has ? 'partial' : 'empty',
        detail: `${st.remainingCount} restant(s), ${st.selectedCount} déjà placé(s), total détecté ${st.totalCount}`
      };
    }

    return { state: wasPageApplied() ? 'complete' : 'empty', detail: '' };
  };

  const answerCurrentQuestion = async () => {
    const q = detectQuestion();
    if (["feedback", "none", "unknown-question"].includes(q.type)) return false;
    if (state.agent.blockedKey && state.agent.blockedKey === q.key) return false;

    let result = state.agent.lastResult;
    const reusable = result && !result.error && result.questionType === q.type &&
      (result.questionKey === q.key || promptSimilarity(result.questionPrompt || "", q.prompt || "") >= 0.58);
    if (!reusable) result = await analyzeCurrentQuestion();
    if (!result || result.error) return false;

    // v5.0: une confiance basse signifie qu'aucune application n'a encore ete tentee.
    // Ne jamais compter cela comme un "échec d'application" et répéter cinq fois le
    // même résultat à 25 %. On force une nouvelle analyse, avec une limite séparée.
    if (Number(result.confidence || 0) < state.config.agent.autoConfidenceThreshold) {
      const low = (state.agent.lowConfidenceRetries.get(q.key) || 0) + 1;
      state.agent.lowConfidenceRetries.set(q.key, low);
      log(`Confiance trop faible (${Math.round(Number(result.confidence || 0) * 100)}%). Réanalyse ${low}/${state.config.agent.lowConfidenceMaxRéanalyses}.`);
      state.agent.lastResult = null;
      if (low >= state.config.agent.lowConfidenceMaxRéanalyses) {
        hardBlock(q.key, `${q.type}: confiance IA insuffisante apres ${low} analyses indépendantes. Aucune réponse appliquée.`);
      }
      return false;
    }
    state.agent.lowConfidenceRetries.delete(q.key);

    const attempts = (state.agent.applyAttempts.get(q.key) || 0) + 1;
    state.agent.applyAttempts.set(q.key, attempts);
    const ok = await applyResult(q, result);
    if (ok) {
      state.agent.applyAttempts.delete(q.key);
      state.agent.lowConfidenceRetries.delete(q.key);
      rememberAppliedPage(q, 'applyResult');
      return true;
    }

    if (state.agent.partialMutation && q.type === "ordering") {
      agentLog("Ordering: progression partielle détectée; remise à zéro complète avant de recalculer l'ordre.");
      const resetOk = await resetOrderingSelection(q);
      state.agent.lastResult = null;
      state.agent.applyAttempts.delete(q.key);
      state.agent.lowConfidenceRetries.delete(q.key);
      state.agent.partialMutation = false;
      if (!resetOk) hardBlock(q.key, "Ordering partiel impossible à réinitialiser automatiquement. Intervention manuelle requise.");
      return false;
    }
    if (state.agent.partialMutation && q.type === "drag-drop") {
      // Pour les trous indépendants, conserver les placements déjà confirmés est sûr.
      agentLog("drag-drop: progression partielle confirmée; nouvelle analyse uniquement sur l'état restant.");
      state.agent.lastResult = null;
      state.agent.applyAttempts.delete(q.key);
      state.agent.lowConfidenceRetries.delete(q.key);
      state.agent.partialMutation = false;
      return false;
    }
    if (state.agent.partialMutation && q.type === "matching") {
      hardBlock(q.key, `${q.type}: modification partielle détectée puis échec. Intervention manuelle requise.`);
      return false;
    }
    if (["drag-drop", "ordering"].includes(q.type) && attempts < state.config.agent.maxApplyAttempts) {
      log(`${q.type}: tentative ${attempts}/${state.config.agent.maxApplyAttempts} non confirmée; la page reste en place et sera retentee.`);
    }
    if (attempts >= state.config.agent.maxApplyAttempts) {
      hardBlock(q.key, `${q.type}: ${attempts} tentatives d'application non confirmées.`);
    }
    return false;
  };

  const parseProgressMarker = (marker = currentProgressMarker()) => {
    const m = String(marker || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return null;
    const current = Number(m[1]), total = Number(m[2]);
    if (!Number.isInteger(current) || !Number.isInteger(total) || total <= 0 || current < 0 || current > total) return null;
    return { current, total };
  };

  const resetActivityPacing = (progress = parseProgressMarker()) => {
    const min = Number(state.config.activityPacing.minMinutes || 30);
    const max = Math.max(min, Number(state.config.activityPacing.maxMinutes || 40));
    const targetMinutes = min + Math.random() * (max - min);
    const targetMs = Math.round(targetMinutes * 60000);
    const now = Date.now();
    state.activity.targetDurationMs = targetMs;
    state.activity.totalQuestions = progress?.total || null;
    state.activity.lastCurrent = progress?.current || null;
    const completedBefore = progress && progress.total ? Math.max(0, progress.current - 1) / progress.total : 0;
    state.activity.inferredStartedAt = now - Math.round(targetMs * completedBefore);
    state.activity.id = `${progress?.total || '?'}::${now}`;
    log(`Rythme activité initialisé: cible ${Math.round(targetMs / 60000)} min (${progress ? `${progress.current}/${progress.total}` : 'progression inconnue'}).`);
  };

  const ensureActivityPacing = () => {
    if (!state.config.activityPacing.enabled) return null;
    const progress = parseProgressMarker();
    if (!state.activity.targetDurationMs) {
      resetActivityPacing(progress);
      return progress;
    }
    if (progress) {
      if ((state.activity.lastCurrent != null && progress.current < state.activity.lastCurrent) ||
          (state.activity.totalQuestions != null && progress.total !== state.activity.totalQuestions)) resetActivityPacing(progress);
      state.activity.lastCurrent = progress.current;
      state.activity.totalQuestions = progress.total;
    }
    return progress;
  };

  const activityPacingStatus = () => {
    const progress = ensureActivityPacing();
    if (!state.activity.targetDurationMs || !state.activity.inferredStartedAt) return null;
    return { progress, targetMinutes: state.activity.targetDurationMs / 60000, elapsedMinutes: Math.max(0, (Date.now() - state.activity.inferredStartedAt) / 60000) };
  };

  const waitForActivityPaceBeforeSubmit = async (label = 'validation') => {
    if (!state.config.activityPacing.enabled) return true;
    const progress = ensureActivityPacing();
    if (!progress || !state.activity.targetDurationMs || !state.activity.inferredStartedAt) return true;
    const desiredElapsed = state.activity.targetDurationMs * (progress.current / progress.total);
    const dueAt = state.activity.inferredStartedAt + desiredElapsed;
    const remaining = dueAt - Date.now();
    if (remaining <= 0) return true;

    // v6.2 : une action manuelle doit interrompre IMMÉDIATEMENT une attente de rythme.
    // Avant, la boucle pouvait rester coincée plusieurs minutes ici avec state.running=true,
    // ce qui empêchait la reprise Auto malgré le clic manuel sur Valider/Suivant/Passer.
    const resumeTokenAtStart = state.agent.manualResumeToken;
    const fingerprintAtStart = pageFingerprint();
    log(`Rythme activité : attente ${Math.ceil(remaining / 1000)}s avant ${label} pour viser ${Math.round(state.activity.targetDurationMs / 60000)} min au total.`);
    const end = Date.now() + remaining;
    while (!state.stopRequested && Date.now() < end) {
      if (state.agent.manualResumeToken !== resumeTokenAtStart ||
          state.agent.manualResumePending ||
          pageFingerprint() !== fingerprintAtStart) {
        log(`Attente de rythme interrompue par une action/navigation manuelle; reprise Auto prioritaire.`);
        return false;
      }
      await wait(Math.min(250, end - Date.now()));
    }
    return !state.stopRequested;
  };

  const preValidationAudit = async (q) => {
    await wait(260);
    const result = state.agent.lastResult;
    const reasons = [];

    if (!state.agent.lastApplyVerified && q?.type !== 'answered') reasons.push('application DOM non confirmée');
    if (result?.error) reasons.push(`erreur IA: ${result.error}`);
    if (result && Number(result.confidence || 0) < state.config.agent.autoConfidenceThreshold && !result.consensus) reasons.push(`confiance IA trop faible (${Math.round(Number(result.confidence || 0) * 100)}%)`);

    if (q?.type === 'single-choice') {
      const selected = (q.choices || []).map((c,i)=>isControlSelected(c.input || c.element) ? i : null).filter((x)=>x!==null);
      if (selected.length !== 1) reasons.push(`single-choice: ${selected.length} selection(s)`);
      if (result && Number.isInteger(Number(result.choice)) && selected[0] !== Number(result.choice)) reasons.push('single-choice différent de la réponse IA');
    }
    if (q?.type === 'multi-choice') {
      const actual = selectedChoiceIndexesLive(q).sort((a,b)=>a-b);
      const expected = [...new Set((result?.choices || []).map(Number).filter(Number.isInteger))].sort((a,b)=>a-b);
      if (!expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) reasons.push(`multi-choice DOM=[${actual.join(',')}] attendu=[${expected.join(',')}]`);
    }
    if (q?.type === 'text' || q?.type === 'multi-text') {
      const values = (q.fields || []).map((f)=>String(f.element?.value || '').trim());
      if (values.some((v)=>!v)) reasons.push('champ texte encore vide');
      const expected = new Map((result?.answers || []).map((a)=>[Number(a.field), norm(String(a.text || ''))]));
      values.forEach((v,i)=>{ if (expected.has(i) && norm(v) !== expected.get(i)) reasons.push(`champ ${i} différent de la réponse IA`); });
    }
    if (q?.type === 'select' || q?.type === 'multi-select') {
      const incomplete = (q.fields || []).filter((f)=>f.kind === 'select' && (!f.element?.value || Number(f.element?.selectedIndex) <= 0));
      if (incomplete.length) reasons.push(`${incomplete.length} select(s) non renseigne(s)`);
    }
    if (q?.type === 'drag-drop' || q?.answeredKind === 'drag-drop') {
      const zones = getLiveZoneElements(document.body);
      const empty = zones.filter((z)=>!isZoneFilled(z));
      if (empty.length) reasons.push(`${empty.length} zone(s) de placement encore vide(s)`);
      if (q?.type === 'drag-drop' && Array.isArray(result?.placements)) {
        const usedTexts = result.placements.map((p)=>norm(q.items?.[Number(p.item)]?.text || '')).filter(Boolean);
        const pool = collectDragItems(findQuestionRoot()).map((x)=>norm(x.text));
        const remainingUsed = usedTexts.filter((t)=>pool.includes(t));
        if (remainingUsed.length) reasons.push(`${remainingUsed.length} mot(s) censé(s) être placé(s) encore dans la banque`);
      }
    }
    if (q?.type === 'ordering' || q?.answeredKind === 'ordering') {
      const instruction = findOrderingInstructionElement(document.body);
      const target = orderingTargetLive(q) || findOrderingTarget(document.body, instruction);
      const st = orderingSelectionState(document.body, instruction, target);
      if (st.remainingCount > 0) reasons.push(`ordering incomplet: ${st.remainingCount} fragment(s) encore disponible(s)`);
      if (!target) reasons.push('zone résultat ordering introuvable');
      if (q?.type === 'ordering' && Array.isArray(result?.order)) {
        const qm = (q.items || []).findIndex((item)=>/^\?+$/.test(String(item.text || '').trim()));
        if (qm >= 0 && Number(result.order[result.order.length - 1]) !== qm) reasons.push('le fragment ? doit etre le dernier');
        if (qm >= 0 && target && !textOf(target).includes('?')) reasons.push("le ? final n'est pas present dans la phrase construite");
      }
    }
    if (q?.type === 'matrix') {
      const incomplete = (q.rows || []).filter((r)=>(r.choices || []).filter((c)=>isControlSelected(c.input || c.element)).length !== 1);
      if (incomplete.length) reasons.push(`${incomplete.length} ligne(s) matrix incomplete(s)`);
    }

    const visibleZones = getLiveZoneElements(document.body);
    const fillLikeInstruction =
      bodyInstruction().includes(normLoose("fill in the blank")) ||
      bodyInstruction().includes(normLoose("fill in the blanks")) ||
      bodyInstruction().includes(normLoose("complete the"));
    if (visibleZones.length >= 2 || (fillLikeInstruction && visibleZones.length >= 1)) {
      const empty = visibleZones.filter((z)=>!isZoneFilled(z));
      if (empty.length) reasons.push(`contrôle global: ${empty.length}/${visibleZones.length} zone(s) vide(s)`);
    }

    const uniqueReasons = [...new Set(reasons)];
    const ok = uniqueReasons.length === 0;
    if (ok) log(`AUDIT PRE-VALIDATION OK (${q?.type || 'inconnu'}).`);
    else log(`AUDIT PRE-VALIDATION BLOQUE: ${uniqueReasons.join(' | ')}`);
    return { ok, reasons: uniqueReasons };
  };

  const auditAndPaceBeforeSubmit = async (q, label = 'validation') => {
    const audit = await preValidationAudit(q);
    if (!audit.ok) {
      hardBlock(q?.key || pageIdentity(), `Audit avant ${label} echoue: ${audit.reasons.join(' | ')}`);
      return false;
    }
    return await waitForActivityPaceBeforeSubmit(label);
  };

  const findActionButton = (texts) => {
    const wanted = texts.map(normLoose);
    const candidates = visibleControls("button,a,[role='button'],input[type='button'],input[type='submit']", document)
      .filter((el) => !isAssistantElement(el));
    return candidates.find((el) => wanted.includes(normLoose(controlText(el)))) ||
      candidates.find((el) => wanted.some((w) => normLoose(controlText(el)).startsWith(`${w} `))) || null;
  };

  const waitForActionButton = async (texts, timeoutMs = state.config.agent.passiveNavigationWaitMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs && !state.stopRequested) {
      const btn = findActionButton(texts);
      if (btn) return btn;
      await wait(200);
    }
    return null;
  };

  const navigatePassivePage = async (label) => {
    let btn = findActionButton(state.config.nextTexts) || findActionButton(state.config.passTexts);
    if (!btn) {
      btn = await waitForActionButton([...state.config.nextTexts, ...state.config.passTexts]);
    }
    if (!btn) {
      log(`${label}: aucun bouton de navigation disponible.`);
      return false;
    }
    log(`${label}: navigation via "${controlText(btn)}"`);
    await clickElement(btn);
    await wait(state.config.settleDelayMs);
    return true;
  };

  const validateIfPresent = async () => {
    const btn = findActionButton(state.config.validateTexts);
    if (!btn) return false;
    log(`Validation: "${controlText(btn)}"`);
    await clickElement(btn);
    await wait(state.config.settleDelayMs);
    return true;
  };


  const waitForValidationOutcome = async (beforeQ) => {
    const started = Date.now();
    const beforeSnap = pageTransitionSnapshot();
    while (Date.now() - started < state.config.agent.validationConfirmMs && !state.stopRequested) {
      await wait(250);
      if (isFeedbackPage()) return "feedback";
      const current = detectQuestion();
      if (current.type === "feedback") return "feedback";

      // IMPORTANT: un drag termine peut transformer le DOM/type sans quitter la question.
      // On ne renvoie "changed" que si la progression de la modal a vraiment change.
      if (hasReallyNavigated(beforeSnap, beforeQ, current)) return "changed";

      const validate = findActionButton(state.config.validateTexts);
      const next = findActionButton(state.config.nextTexts);
      if (!validate && next && state.agent.lastApplyVerified) return "ready-next";
    }
    return "timeout";
  };

  const nextIfPresent = async () => {
    const btn = findActionButton(state.config.nextTexts);
    if (!btn) return false;
    log(`Click navigation: "${controlText(btn)}"`);
    await clickElement(btn);
    await wait(state.config.settleDelayMs);
    return true;
  };

  const passIfPresent = async () => {
    const btn = findActionButton(state.config.passTexts);
    if (!btn) return false;
    log(`Click passage: "${controlText(btn)}"`);
    await clickElement(btn);
    await wait(state.config.settleDelayMs);
    return true;
  };

  const processCurrentPage = async () => {
    if (state.agent.processing) return false;
    state.agent.processing = true;
    try {
      await waitForStablePage(450);
      let q = detectQuestion();
      renderPanel(q);

      if (state.agent.blockedKey && state.agent.blockedKey === q.key) {
        log(`Page bloquée par sécurité: ${state.agent.blockReason}`);
        return false;
      }

      if (q.type === "answered") {
        log(`Réponse déjà présente dans le DOM (${q.answeredKind || "exercice"}, ${q.detail || "complete"}). Aucune nouvelle analyse IA.`);
        state.agent.lastApplyVerified = true;
        rememberAppliedPage(q, 'dom-existing');
        clearHighlights();
        renderPanel(q);

        const validate = findActionButton(state.config.validateTexts);
        if (validate) {
          if (!(await auditAndPaceBeforeSubmit(q, `validation "${controlText(validate)}"`))) return false;
          log(`Réponse déjà remplie: validation via "${controlText(validate)}".`);
          if (!(await clickElement(validate))) return false;
          const outcome = await waitForValidationOutcome(q);
          if (outcome === 'feedback') return await navigatePassivePage('Après validation réponse existante');
          if (outcome === 'changed') return true;
          if (outcome === 'ready-next') return await nextIfPresent();
          hardBlock(q.key, 'Réponse déjà présente mais validation non confirmée; aucune navigation forcee.');
          return false;
        }

        const next = findActionButton(state.config.nextTexts);
        if (next) {
          if (!(await auditAndPaceBeforeSubmit(q, `soumission "${controlText(next)}"`))) return false;
          log(`Réponse déjà présente et aucun Valider: navigation via "${controlText(next)}".`);
          await clickElement(next);
          return true;
        }
        return false;
      }

      if (q.type === "feedback") {
        log("Page de correction/résultat détectée: aucune analyse IA.");
        state.agent.lastResult = null;
        state.agent.lastApplyVerified = false;
        clearHighlights();
        renderPanel(q);
        await waitForStablePage(500);
        return await navigatePassivePage("Correction/résultat");
      }

      if (q.type === "unknown-question") {
        hardBlock(q.key, "Question probable mais type non reconnu: aucune navigation pour eviter de la sauter.");
        state.agent.lastResult = { error: state.agent.blockReason, questionKey: q.key, questionPrompt: q.prompt };
        renderPanel(q);
        return false;
      }

      if (q.type === "none") {
        log("Page sans question détectée ; vérification de stabilité avant navigation.");
        await waitForStablePage(state.config.agent.contentStabilityMs, state.config.agent.pageSettleMaxMs);
        q = detectQuestion();
        if (q.type !== "none") {
          log(`Une interaction est apparue (${q.type}); navigation de contenu annulee.`);
          return false;
        }
        return await navigatePassivePage("Page sans question stable");
      }

      agentLog(`Question détectée: ${q.type}.`);

      const existing = existingResponseState(q);
      if (existing.state === 'complete') {
        log(`Réponse déjà renseignée (${existing.detail || q.type}); aucune nouvelle application IA.`);
        state.agent.lastApplyVerified = true;
        rememberAppliedPage(q, 'preflight-existing');

        const validateExisting = findActionButton(state.config.validateTexts);
        if (validateExisting) {
          if (!(await auditAndPaceBeforeSubmit(q, `validation "${controlText(validateExisting)}"`))) return false;
          log(`Réponse existante: validation via "${controlText(validateExisting)}".`);
          if (!(await clickElement(validateExisting))) return false;
          const outcome = await waitForValidationOutcome(q);
          if (outcome === 'feedback') return await navigatePassivePage('Après validation réponse existante');
          if (outcome === 'changed') return true;
          if (outcome === 'ready-next') return await nextIfPresent();
          hardBlock(q.key, 'Réponse existante détectée mais validation non confirmée; Suivant bloque.');
          return false;
        }

        const nextExisting = findActionButton(state.config.nextTexts);
        if (nextExisting) {
          if (!(await auditAndPaceBeforeSubmit(q, `soumission "${controlText(nextExisting)}"`))) return false;
          log(`Réponse existante sans bouton Valider: navigation via "${controlText(nextExisting)}".`);
          await clickElement(nextExisting);
          return true;
        }
        return false;
      }

      if (existing.state === 'partial' && q.type === 'ordering') {
        const resetOk = await resetOrderingSelection(q);
        if (!resetOk) {
          hardBlock(q.key, "Ordering partiel: remise à zéro non confirmée. Aucune validation automatique.");
          return false;
        }
        state.agent.lastResult = null;
        state.agent.lastApplyVerified = false;
        q = detectQuestion();
        renderPanel(q);
        log("Ordering remis à zéro; nouvelle analyse complète de tous les fragments.");
      } else if (existing.state === 'partial') {
        log(`Réponse partielle déjà présente (${existing.detail}). Le script conserve uniquement les éléments déjà confirmés.`);
      }

      if (!state.config.agent.autoAnswer) {
        log("Auto-réponse OFF: aucune validation/navigation automatique sur une question.");
        return false;
      }

      const pageBeforeAnswer = pageTransitionSnapshot();
      const ok = await answerCurrentQuestion();
      if (!ok || !state.agent.lastApplyVerified) {
        log("Réponse non appliquée ou non vérifiée: Valider/Suivant strictement bloques.");
        return false;
      }

      await wait(450);
      const afterApply = detectQuestion();
      if (afterApply.type === "feedback" || isFeedbackPage()) {
        log("La réponse a déclenché directement une page de correction.");
        return await navigatePassivePage("Correction après réponse");
      }

      // v5.3: NE PAS confondre mutation du DOM avec navigation.
      // Apres le dernier drop/clic, le détecteur peut passer drag-drop -> answered/button-choice.
      // Tant que N/Total n'a pas change, on est toujours sur la meme question et il faut Valider.
      if (!["none", "unknown-question"].includes(afterApply.type) && !sameQuestion(q, afterApply)) {
        if (hasReallyNavigated(pageBeforeAnswer, q, afterApply)) {
          log("Vraie navigation détectée après application (progression changee); aucun clic supplementaire.");
          return true;
        }
        log(`DOM/type modifié après application (${q.type} -> ${afterApply.type}) mais meme progression ${currentProgressMarker() || "?"}; validation maintenue.`);
      }

      const validateBtn = findActionButton(state.config.validateTexts);
      if (validateBtn) {
        if (!(await auditAndPaceBeforeSubmit(q, `validation "${controlText(validateBtn)}"`))) return false;
        log(`Validation: "${controlText(validateBtn)}"`);
        if (!(await clickElement(validateBtn))) {
          hardBlock(q.key, "Impossible de cliquer sur Valider après une réponse pourtant vérifiée.");
          return false;
        }
        const outcome = await waitForValidationOutcome(q);
        if (outcome === "feedback") {
          state.agent.lastResult = null;
          clearHighlights();
          renderPanel({ type: "feedback", prompt: "", key: "feedback" });
          return await navigatePassivePage("Apres validation");
        }
        if (outcome === "changed") {
          log("Validation confirmée: nouvelle page/question deja chargee; aucun clic Suivant additionnel.");
          return true;
        }
        if (outcome === "ready-next") {
          const next = findActionButton(state.config.nextTexts);
          if (next) {
            log(`Validation confirmée, navigation via "${controlText(next)}".`);
            await clickElement(next);
            return true;
          }
        }
        hardBlock(q.key, "Validation non confirmée dans le DOM; Suivant/Passer bloques.");
        return false;
      }

      // Certains exercices n'ont pas de bouton Valider: Suivant peut faire office de soumission.
      // On ne l'autorisé qu'après vérification dure de la réponse, jamais Passer.
      const next = await waitForActionButton(state.config.nextTexts, 2500);
      if (next && state.agent.lastApplyVerified) {
        if (!(await auditAndPaceBeforeSubmit(q, `soumission "${controlText(next)}"`))) return false;
        log(`Pas de Valider; réponse vérifiée + audit OK, navigation controlee via "${controlText(next)}".`);
        await clickElement(next);
        return true;
      }

      hardBlock(q.key, "Réponse appliquée mais aucun mécanisme de validation/navigation fiable détecté.");
      return false;
    } finally {
      state.agent.processing = false;
    }
  };

  const waitForWakeOrTimeout = (ms) => {
    if (state.agent.manualResumePending) return Promise.resolve("manual");
    return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      state.agent.wakeResolver = null;
      resolve("timeout");
    }, ms);
    state.agent.wakeResolver = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.agent.wakeResolver = null;
      resolve("mutation");
    };
    });
  };

  const matchesActionText = (value, texts) => {
    const t = normLoose(value);
    if (!t) return false;
    return texts.map(normLoose).some((wanted) => t === wanted || t.startsWith(`${wanted} `));
  };

  const resetForNewManualPage = () => {
    clearHardBlock(true);
    state.stopRequested = false;
    state.agent.lastResult = null;
    state.agent.lastQuestionKey = null;
    state.agent.lastProcessedKey = null;
    state.agent.lastApplyVerified = false;
    state.agent.partialMutation = false;
    state.agent.applyAttempts.clear();
    clearHighlights();
  };

  const waitForPageFingerprintChange = async (beforeFingerprint, maxMs = 6500) => {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      await wait(150);
      if (pageFingerprint() !== beforeFingerprint) return true;
    }
    return false;
  };

  const resumeAutoAfterManualNavigation = (
    label = "action manuelle",
    beforeFingerprint = pageFingerprint(),
    actionKind = "navigation"
  ) => {
    if (!state.config.agent.autoAnswer) return;

    // v6.2 : armer la reprise SYNCHRONEMENT, dès le clic (listener en capture).
    // Ce jeton sert aussi à casser les longues attentes de rythme en cours.
    state.agent.manualResumeToken += 1;
    state.agent.manualResumePending = true;
    state.agent.manualResumeLabel = label || "action manuelle";
    state.agent.manualResumeAt = Date.now();
    state.agent.wakeResolver?.();

    if (state.agent.manualNavigationTimer) clearTimeout(state.agent.manualNavigationTimer);
    state.agent.manualNavigationTimer = setTimeout(async () => {
      state.agent.manualNavigationTimer = null;

      // Lever immédiatement les anciens blocages/résultats devenus obsolètes.
      resetForNewManualPage();

      if (actionKind === "validate") {
        const started = Date.now();
        let changed = false;
        while (Date.now() - started < 6500) {
          await wait(150);
          if (pageFingerprint() !== beforeFingerprint || isFeedbackPage() || detectQuestion().type === "feedback") {
            changed = true;
            break;
          }
        }
        if (changed) {
          log(`Validation manuelle détectée (${label}); nouvel état DOM/correction détecté, reprise Auto armée.`);
          await waitForStablePage(350, state.config.agent.pageSettleMaxMs);
        } else {
          log(`Validation manuelle "${label}" détectée; reprise Auto forcée sur l'état courant.`);
        }
      } else {
        const changed = await waitForPageFingerprintChange(beforeFingerprint, 6500);
        if (changed) {
          log(`Navigation manuelle détectée (${label}); nouvelle page chargée, reprise Auto armée.`);
          await waitForStablePage(350, state.config.agent.pageSettleMaxMs);
        } else {
          log(`Action manuelle "${label}" détectée sans changement confirmé; reprise Auto sur la page courante.`);
        }
      }

      // Mettre aussi le panneau à jour immédiatement sur la nouvelle question.
      try { renderPanel(detectQuestion()); } catch {}
      state.agent.wakeResolver?.();

      // Si l'ancienne boucle est déjà terminée, redémarrer tout de suite. Sinon elle
      // verra manualResumePending au prochain point de contrôle et continuera sans délai.
      if (!state.running) {
        run();
      } else {
        setTimeout(() => {
          if (state.config.agent.autoAnswer && !state.running) run();
        }, 300);
      }
    }, 120);
  };

  const watchManualNavigation = () => {
    if (state.agent.manualNavigationListenerInstalled) return;
    state.agent.manualNavigationListenerInstalled = true;

    document.addEventListener("click", (event) => {
      if (state.agent.internalClick) return;
      const rawTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
      const el = rawTarget?.closest?.("button,a,[role='button'],input[type='button'],input[type='submit']");
      if (!el || isAssistantElement(el)) return;

      const label = controlText(el);
      const isValidate = matchesActionText(label, state.config.validateTexts);
      const isNext = matchesActionText(label, state.config.nextTexts);
      const isPass = matchesActionText(label, state.config.passTexts);
      if (!isValidate && !isNext && !isPass) return;

      // En capture, prendre l'empreinte AVANT que le clic change la route/DOM.
      const beforeFingerprint = pageFingerprint();
      const kind = isValidate ? "validate" : "navigation";
      const fallbackLabel = isValidate ? "Valider" : isNext ? "Suivant/Terminer" : "Passer";

      // Ne jamais empêcher le clic manuel. Le script observe seulement son résultat
      // puis reprend automatiquement tant que Auto = ON.
      resumeAutoAfterManualNavigation(label || fallbackLabel, beforeFingerprint, kind);
    }, true);
  };

  const watchDom = () => {
    if (state.agent.observer) return;
    state.agent.observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => {
        const target = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
        return target && !isAssistantElement(target);
      });
      if (relevant) state.agent.wakeResolver?.();
    });
    state.agent.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  };

  const run = async () => {
    if (state.running) { log("Le script tourne déjà."); return; }
    state.running = true;
    state.stopRequested = false;
    state.startedAt = Date.now();
    state.cycle = 0;
    ensureActivityPacing();
    log("Démarrage v6.3 sécurisé.");

    try {
      while (!state.stopRequested) {
        // v6.2 : une action manuelle est une priorité absolue. Elle annule l'ancien
        // contexte, lève un blocage éventuel et force une nouvelle détection immédiatement.
        if (state.agent.manualResumePending) {
          const label = state.agent.manualResumeLabel || "action manuelle";
          state.agent.manualResumePending = false;
          resetForNewManualPage();
          await waitForStablePage(250, Math.min(2200, state.config.agent.pageSettleMaxMs));
          try { renderPanel(detectQuestion()); } catch {}
          log(`Reprise Auto exécutée après ${label}.`);
        }

        state.cycle += 1;
        const before = detectQuestion().key;
        const processed = await processCurrentPage();
        if (state.stopRequested) break;

        // L'action manuelle peut avoir eu lieu pendant processCurrentPage(), notamment
        // pendant une attente de rythme : ne jamais laisser un ancien blocage gagner.
        if (state.agent.manualResumePending) {
          clearHardBlock(true);
          continue;
        }

        if (state.agent.blockReason) {
          log("Automatisation arrêtée par sécurité. Corrige/manipule la question puis tape geUnblock(); gs().");
          break;
        }

        if (!processed) {
          if (state.agent.manualResumePending) continue;
          const retryMs = state.agent.lastResult?.error ? state.config.agent.errorRetryMs : Math.min(5000, state.config.pageDelayMs);
          log(`Traitement non terminé. Nouvelle vérification dans ${Math.round(retryMs / 1000)}s maximum.`);
          await waitForWakeOrTimeout(retryMs);
          continue;
        }

        log(`Attente jusqu'à ${Math.round(state.config.pageDelayMs / 1000)}s avant le prochain traitement.`);
        await waitForWakeOrTimeout(state.config.pageDelayMs);
        if (state.agent.manualResumePending) continue;
        const after = detectQuestion().key;
        if (after === before) await wait(500);
      }
    } finally {
      state.running = false;
      log("Script arrêté.");
    }
  };

  const stop = () => { state.stopRequested = true; state.agent.wakeResolver?.(); log("Arrêt demandé."); };
  const toggleAutoAnswer = () => { state.config.agent.autoAnswer = !state.config.agent.autoAnswer; renderPanel(); return state.config.agent.autoAnswer; };
  const setDelaySeconds = (seconds) => {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) throw new Error("geDelay(seconds) attend un nombre >= 0.");
    state.config.pageDelayMs = Math.round(n * 1000);
    log(`Délai défini a ${n}s.`);
    return state.config.pageDelayMs;
  };
  const setActivityPacing = (minMinutes = 30, maxMinutes = 30) => {
    const min = Number(minMinutes), max = Number(maxMinutes);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) throw new Error("geActivityPace(min,max) attend par exemple 30,30.");
    state.config.activityPacing.enabled = true;
    state.config.activityPacing.minMinutes = min;
    state.config.activityPacing.maxMinutes = max;
    state.activity.targetDurationMs = null;
    ensureActivityPacing();
    renderPanel();
    return { minMinutes:min, maxMinutes:max };
  };
  const disableActivityPacing = () => { state.config.activityPacing.enabled = false; renderPanel(); return false; };
  const setProvider = (provider = "auto") => {
    const allowed = ["auto", "groq", "openai", "gemini", "anthropic", "mistral", "openrouter"];
    const value = String(provider || "auto").toLowerCase();
    if (!allowed.includes(value)) throw new Error(`Fournisseur inconnu: ${value}. Valeurs: ${allowed.join(", ")}`);
    state.config.agent.provider = value;
    if (value === "auto") state.config.agent.model = "auto";
    state.agent.lastProvider = null; state.agent.lastModel = null; state.agent.providerHistory = [];
    renderPanel();
    return value;
  };
  const listProviders = async () => {
    const healthUrl = state.config.agent.endpoint.replace(/\/api\/chat.*$/i, "/health");
    const response = await fetch(healthUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Health multi-IA HTTP ${response.status}`);
    const data = await response.json();
    console.table((data.providers || []).map((p) => ({ fournisseur:p.name, "modèle":p.model, actif:p.configured })));
    return data;
  };
  const togglePanel = () => { state.agent.panelCollapsed = !state.agent.panelCollapsed; renderPanel(); return state.agent.panelCollapsed; };
  const setModel = (model) => { state.config.agent.model = String(model); renderPanel(); return state.config.agent.model; };
  const setEndpoint = (url) => { state.config.agent.endpoint = String(url); renderPanel(); return state.config.agent.endpoint; };

  const debugPageState = () => {
    const info = {
      state: pageState(),
      feedback: isFeedbackPage(),
      feedbackVisual: hasFeedbackVisualBlock(),
      hasWritableControl: hasWritableQuestionControl(),
      hasValidate: !!findActionButton(state.config.validateTexts),
      hasNext: !!findActionButton(state.config.nextTexts),
      detectedType: detectQuestion().type,
      blocked: !!state.agent.blockReason,
      blockReason: state.agent.blockReason || "",
    };
    console.table(info);
    return info;
  };

  const debugQuestion = () => {
    const q = detectQuestion();
    const safe = serializeQuestion(q);
    console.log("[Global Exam Assistant] Detection:", safe);
    if (safe.choices) console.table(safe.choices);
    if (safe.fields) console.table(safe.fields.map((f) => ({ index: f.index, label: f.label, options: f.options?.map((o) => o.text).join(" | ") || "" })));
    if (safe.items) console.table(safe.items);
    if (safe.zones) console.table(safe.zones);
    if (safe.rows) console.log("Rows:", safe.rows);
    return safe;
  };

  const debugDrag = () => {
    const q = detectQuestion();
    if (q.type !== "drag-drop") {
      console.warn(`[Global Exam Assistant] geDebugDrag(): type courant = ${q.type}, pas drag-drop.`);
      return { type: q.type };
    }
    const items = q.items.map((item) => ({
      index: item.index,
      text: item.text,
      tag: item.element?.tagName || "",
      role: item.element?.getAttribute?.("role") || "",
      draggable: item.element?.getAttribute?.("draggable") || "",
      className: String(item.element?.className || "").slice(0, 180),
      reactHandlers: reactHandlerNames(item.element).join(", "),
    }));
    const zones = q.zones.map((zone) => ({
      index: zone.index,
      context: zone.text,
      tag: zone.element?.tagName || "",
      role: zone.element?.getAttribute?.("role") || "",
      className: String(zone.element?.className || "").slice(0, 180),
      reactHandlers: reactHandlerNames(zone.element).join(", "),
    }));
    console.log("[Global Exam Assistant] Drag items:");
    console.table(items);
    console.log("[Global Exam Assistant] Drop zones:");
    console.table(zones);
    return { items, zones };
  };

  const debugOrdering = () => {
    const instruction = findOrderingInstructionElement(document.body);
    const target = findOrderingTarget(document.body, instruction);
    const q = detectQuestion();
    const rect = (el) => el ? (() => { const r=el.getBoundingClientRect(); return {tag:el.tagName, className:String(el.className||""), text:textOf(el).slice(0,140), top:Math.round(r.top), left:Math.round(r.left), width:Math.round(r.width), height:Math.round(r.height), border:getComputedStyle(el).borderStyle, outline:getComputedStyle(el).outlineStyle}; })() : null;
    const data = { type:q?.type, mode:q?.mode, instruction:rect(instruction), target:rect(target), items:(q?.items||[]).map((i)=>({index:i.index,text:i.text,rect:rect(i.element),reactHandlers:reactHandlerNames(i.element),sourceVariants:sourceVariants(i.element,i.text).map((el)=>({tag:el.tagName,role:el.getAttribute?.("role")||"",draggable:el.getAttribute?.("draggable")||"",className:String(el.className||"").slice(0,100),handlers:reactHandlerNames(el)}))})) };
    console.log("[Global Exam Assistant] Ordering debug:", data);
    console.table(data.items.map((i)=>({index:i.index,text:i.text,top:i.rect?.top,left:i.rect?.left,width:i.rect?.width,height:i.rect?.height,variants:i.sourceVariants?.length||0,handlers:(i.reactHandlers||[]).join(",")})));
    return data;
  };

  const help = () => console.log(`
Global Exam Assistant v6.3 — Multi-IA

Commandes :
- geStart() / gs()          : démarrer / reprendre
- geStop() / gx()           : arrêter
- geProcessPage()           : traiter uniquement la page courante
- geAnalyze() / ga()        : analyser la question courante
- geAnswer() / gans()       : appliquer la réponse courante
- gePanel()                 : réduire / agrandir la fenêtre de l'assistant
- geSetProvider("auto")     : fournisseur automatique multi-IA
- geSetProvider("groq")     : forcer Groq (idem openai/gemini/anthropic/mistral/openrouter)
- geProviders()             : afficher les fournisseurs configurés dans le proxy
- geSetModel("...")         : forcer un modèle pour le fournisseur choisi
- geDebugQuestion()         : afficher le type et les données détectées
- geDebugOrdering()         : diagnostiquer l'ordering
- geDebugPageState()        : afficher question/correction/contenu
- geDebugDrag()             : diagnostiquer les placements
- geUnblock()               : lever un blocage de sécurité après vérification manuelle
- geAuto()                  : ON/OFF auto-réponse
- geDelay(secondes)         : délai maximum entre traitements
- geActivityPace(30,30)     : viser 30 minutes pour toute l'activité
- geActivityPaceOff()       : désactiver le rythme d'activité
- geSetEndpoint("...")      : changer l'endpoint local

Comportement :
- les exercices complexes sont vérifiés par plusieurs fournisseurs si plusieurs clés sont configurées ;
- toute validation automatique passe par l'audit de sécurité DOM ;
- un ordering partiellement rempli est remis à zéro avant d'être recalculé ;
- un clic manuel sur Valider / Suivant / Passer / Terminer réveille automatiquement le script ;
- l'objectif de durée est fixé à 30 minutes par activité par défaut.

Types gérés :
- single-choice / button-choice
- multi-choice
- matrix
- text / multi-text
- select / multi-select / combobox
- drag-drop par clic
- ordering
- matching
- pages de correction/résultat (aucune IA, navigation seulement)
- pages sans question (aucune IA, navigation seulement)
  `.trim());

  const startOrResume = () => {
    // Un appel explicite de geStart()/gs() est une demande de reprise utilisateur.
    if (state.agent.blockReason) {
      clearHardBlock(true);
      state.agent.lastResult = null;
      log("Reprise explicite : ancien blocage effacé, nouvelle analyse autorisée.");
    }
    return run();
  };

  const debugExistingAnswer = () => {
    const q = detectQuestion();
    const existing = q.type === 'answered' ? { state: 'complete', detail: q.detail, type: q.type } : existingResponseState(q);
    console.table({ pageIdentity: pageIdentity(), questionType: q.type, existingState: existing.state, detail: existing.detail || '', appliedRemembered: wasPageApplied() });
    return { q, existing, pageIdentity: pageIdentity(), appliedRemembered: wasPageApplied() };
  };

  window.__globalExamPager = { state, detectQuestion, analyzeCurrentQuestion, answerCurrentQuestion, processCurrentPage, run, startOrResume, stop, debugQuestion, debugPageState, debugDrag, debugExistingAnswer, clearHardBlock, resumeAutoAfterManualNavigation };
  window.geStart = startOrResume;
  window.geStop = stop;
  window.geProcessPage = processCurrentPage;
  window.geAnalyze = analyzeCurrentQuestion;
  window.geAnswer = answerCurrentQuestion;
  window.geDebugQuestion = debugQuestion;
  window.geDebugOrdering = debugOrdering;
  window.geDebugPageState = debugPageState;
  window.geDebugDrag = debugDrag;
  window.geDebugExistingAnswer = debugExistingAnswer;
  window.geDebugButtonChoice = () => {
    const q = detectQuestion();
    const expected = q?.choices?.[0]?.text || "";
    const candidates = expected ? buttonChoiceLiveCandidates(q, expected) : [];
    console.table(candidates.map((el, i) => ({
      i,
      tag: el.tagName,
      role: el.getAttribute?.("role") || "",
      text: buttonChoiceTextWithoutAssistant(el),
      className: String(el.className || "").slice(0, 100),
      reactHandlers: reactHandlerNames(el).join(", "),
    })));
    return { q, expected, singleFill: isSingleChoiceFillContext(q?.root), candidates };
  };
  window.geDebugOrderingCount = () => {
    const instruction = findOrderingInstructionElement(document.body);
    const target = findOrderingTarget(document.body, instruction);
    const st = orderingSelectionState(document.body, instruction, target);
    console.table({ selected: st.selectedCount, remaining: st.remainingCount, totalDetected: st.totalCount, selectedTexts: st.selectedTexts.join(' | ') });
    console.log('Remaining items:', st.remainingItems.map((x,i)=>`${i}: ${x.text}`));
    return st;
  };
  window.geUnblock = clearHardBlock;
  window.geVersion = () => ASSISTANT_VERSION;
  window.geAuto = toggleAutoAnswer;
  window.geDelay = setDelaySeconds;
  window.geActivityPace = setActivityPacing;
  window.geActivityPaceOff = disableActivityPacing;
  window.geSetProvider = setProvider;
  window.geProviders = listProviders;
  window.gePanel = togglePanel;
  window.geSetModel = setModel;
  window.geSetEndpoint = setEndpoint;
  window.geHelp = help;
  window.gs = startOrResume;
  window.gx = stop;
  window.ga = analyzeCurrentQuestion;
  window.gans = answerCurrentQuestion;

  watchDom();
  watchManualNavigation();
  renderPanel();
  help();
})();
