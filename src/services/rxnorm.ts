// src/services/rxnorm.ts
// Drug name normalization via NIH RxNorm API — deterministic, no LLM

export async function normalizeDrugName(rawName: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(rawName.trim());
    const r = await fetch(
      `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encoded}&maxEntries=1`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data.approximateGroup?.candidate?.[0]?.rxcui || null;
  } catch (err) {
    console.error('[RxNorm] Normalization failed for:', rawName, err);
    return null;
  }
}

export async function getDrugDisplayName(rxcui: string): Promise<string> {
  try {
    const r = await fetch(
      `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/property.json?propName=RxNorm%20Name`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return rxcui;
    const data = await r.json();
    return data.propConceptGroup?.propConcept?.[0]?.propValue || rxcui;
  } catch {
    return rxcui;
  }
}
