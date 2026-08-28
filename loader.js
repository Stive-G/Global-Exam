// Petit chargeur à conserver dans un Snippet DevTools.
(async () => {
  const expectedVersion = "6.4";
  const baseVersion = "6.3";

  if (window.__globalExamPager) {
    const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "ancienne/inconnue";
    console.warn(
      `[Loader Global Exam] Une version ${loaded} est déjà chargée. ` +
      `Fais Ctrl+R puis relance ce Snippet pour charger la v${expectedVersion}.`
    );
    return;
  }

  const cacheBust = `${expectedVersion}-${Date.now()}`;
  const [assistantResponse, patchResponse] = await Promise.all([
    fetch(`http://localhost:3000/assistant.js?v=${cacheBust}`, { cache: "no-store" }),
    fetch(`http://localhost:3000/runtime-patch-v6.4.js?v=${cacheBust}`, { cache: "no-store" }),
  ]);

  if (!assistantResponse.ok) throw new Error(`Assistant HTTP ${assistantResponse.status}`);
  if (!patchResponse.ok) throw new Error(`Patch v6.4 HTTP ${patchResponse.status}`);

  const [baseCode, patchCode] = await Promise.all([
    assistantResponse.text(),
    patchResponse.text(),
  ]);

  if (!baseCode.includes(`ASSISTANT_VERSION = "${baseVersion}"`)) {
    throw new Error(
      `[Loader Global Exam] La base servie n'est pas la v${baseVersion}. ` +
      `Redémarre Docker depuis le dépôt à jour.`
    );
  }

  (0, eval)(patchCode);
  if (typeof window.__applyGlobalExamV64Patch !== "function") {
    throw new Error("[Loader Global Exam] Le patch v6.4 n'a pas été initialisé.");
  }

  const code = window.__applyGlobalExamV64Patch(baseCode);
  (0, eval)(code);

  const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "inconnue";
  if (loaded !== expectedVersion) {
    throw new Error(`[Loader Global Exam] Version chargée ${loaded}, v${expectedVersion} attendue.`);
  }

  console.log(`[Loader Global Exam] Version chargée : ${loaded}`);
})();
