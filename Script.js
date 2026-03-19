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
    state,
  };

  window.geStart = run;
  window.geStop = stop;
  window.geStatus = showStatus;
  window.geHelp = help;
  window.geDelay = setDelaySeconds;

  window.gs = run;
  window.gx = stop;
  window.gi = showStatus;
  window.gh = help;
  window.gd = setDelaySeconds;

  help();
  run();
})();
