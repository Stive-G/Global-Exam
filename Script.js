(() => {
  // ========= CONFIG =========
  const NEXT_TEXTS  = ["suivant", "terminer", "next", "continuer"];
  const PASS_TEXTS  = ["passer à la suite", "passer a la suite", "passer", "skip"];
  const ACTION_DELAY_MS = 800;       // pause courte entre actions internes
  const ONE_MINUTE_MS   = 60000;     // délai principal entre clics
  const DOM_TIMEOUT_MS  = 8000;      // max d'attente mutation

  // ========= HELPERS =========
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
  const isEnabled = (el) => el && !el.disabled && getComputedStyle(el).pointerEvents !== 'none';

  const norm = (s) => (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

  const findByTexts = (texts, root=document, selectors="button, a") => {
    const cands = [...root.querySelectorAll(selectors)].filter(isVisible);
    for (const el of cands) {
      const t = norm(el.textContent);
      if (texts.some(txt => t.includes(norm(txt)))) return el;
    }
    return null;
  };

  const waitForDomChange = (excludeEl) => new Promise(resolve => {
    let timer;
    const obs = new MutationObserver(muts => {
      const relevant = muts.some(m => !excludeEl || !excludeEl.contains(m.target));
      if (relevant) {
        clearTimeout(timer);
        timer = setTimeout(() => { obs.disconnect(); resolve(); }, 300);
      }
    });
    obs.observe(document.body, { childList:true, subtree:true, attributes:true, characterData:true });
    setTimeout(() => { try{obs.disconnect();}catch{} resolve(); }, DOM_TIMEOUT_MS);
  });

  const clickIfPossible = async (el, label) => {
    if (el && isEnabled(el)) {
      el.click();
      console.log(`${label}`);
      await waitForDomChange(el);
      await wait(ACTION_DELAY_MS);
      return true;
    }
    return false;
  };

  // ========= MAIN LOOP =========
  let stop = false;
  window.stopPager = () => { stop = true; console.log("Arrêt demandé."); };

  (async function run() {
    let cycle = 1;
    console.log("Lancement… (stopPager() pour arrêter)");
    while (!stop) {
      console.log(`Cycle ${cycle} — clics sur "Suivant/Suivant/Next/Continuer" jusqu’à voir "Passer…"`);
      
      // Boucler sur NEXT tant que PASS n'est pas là
      while (!stop) {
        const passBtn = findByTexts(PASS_TEXTS);
        if (passBtn) break; // trouvé : on passera à l'étape suivante

        const nextBtn = findByTexts(NEXT_TEXTS);
        if (await clickIfPossible(nextBtn, `Click: "${nextBtn ? norm(nextBtn.textContent) : 'next'}"`)) {
          console.log("Attente 1 minute avant le prochain clic...");
          await wait(ONE_MINUTE_MS);
          continue;
        }

        // rien de cliquable attendre mutation puis retenter
        await waitForDomChange();
        await wait(ACTION_DELAY_MS);
      }
      if (stop) break;

      // Cliquer PASS une fois
      const passNow = findByTexts(PASS_TEXTS);
      if (await clickIfPossible(passNow, `Click: "${passNow ? norm(passNow.textContent) : 'passer'}"`)) {
        cycle++;
        continue; // relancer un nouveau cycle complet
      } else {
        console.warn('Bouton "Passer…" introuvable/inactif, on réessaie…');
        await waitForDomChange();
      }
    }
    console.log("Script terminé.");
  })();
})();