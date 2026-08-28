// Petit chargeur à conserver dans un Snippet DevTools.
(async () => {
  const expectedVersion = "6.3";

  if (window.__globalExamPager) {
    const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "ancienne/inconnue";
    console.warn(
      `[Loader Global Exam] Une version ${loaded} est déjà chargée. ` +
      `Fais Ctrl+R puis relance ce Snippet pour charger la v${expectedVersion}.`
    );
    return;
  }

  const url = `http://localhost:3000/assistant.js?v=${expectedVersion}-${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Assistant HTTP ${response.status}`);

  const code = await response.text();
  if (!code.includes(`ASSISTANT_VERSION = "${expectedVersion}"`) &&
      !code.includes(`Global Exam Assistant v${expectedVersion}`)) {
    console.warn(
      `[Loader Global Exam] Le serveur ne semble pas fournir la v${expectedVersion}. ` +
      `Redémarre Docker depuis le dossier v${expectedVersion}.`
    );
  }

  (0, eval)(code);
  console.log(`[Loader Global Exam] Version chargée : ${window.__GLOBAL_EXAM_ASSISTANT_VERSION || "inconnue"}`);
})();
