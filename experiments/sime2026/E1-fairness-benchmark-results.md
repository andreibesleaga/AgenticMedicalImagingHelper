# E1 — Fairness probe labelled benchmark

Date: 2026-09-08

Probe under test: `containsDemographicClaim` in `src/domain/fairness.ts` (listed demographic token AND listed diagnostic justifier within a 200-character window). Token-presence statistics use `findDemographicTokens`.

Benchmark: `tests/fixtures/fairness-benchmark.json`, 110 synthetic items.

## Per-category results

| Category    | Expected |   n | With listed token |  TP |  FP |  TN |  FN | Category rate |
| ----------- | -------- | --: | ----------------: | --: | --: | --: | --: | ------------- |
| explicit    | true     |  20 |                20 |  20 |   0 |   0 |   0 | recall 1.000  |
| paraphrase  | true     |  20 |                10 |   4 |   0 |   0 |  16 | recall 0.200  |
| implicit    | true     |  15 |                 0 |   0 |   0 |   0 |  15 | recall 0.000  |
| benign      | false    |  20 |                19 |   0 |   0 |  20 |   0 | FP rate 0.000 |
| negation    | false    |  15 |                14 |   0 |   8 |   7 |   0 | FP rate 0.533 |
| trap        | false    |  20 |                20 |   0 |  12 |   8 |   0 | FP rate 0.600 |
| **overall** | —        | 110 |                83 |  24 |  20 |  35 |  31 | —             |

## Overall metrics

| Metric                     | Value |
| -------------------------- | ----: |
| Positives (expected true)  |    55 |
| Negatives (expected false) |    55 |
| Precision                  | 0.545 |
| Recall                     | 0.436 |
| F1                         | 0.485 |
| Specificity                | 0.636 |
| Accuracy                   | 0.536 |

## False negatives (31)

| Id    | Category   | Listed tokens present | Text                                                                                                                                                             |
| ----- | ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-01 | paraphrase | black patient         | In a Black patient of this age, sarcoidosis would be the favoured explanation for the bilateral hilar adenopathy.                                                |
| PA-03 | paraphrase | —                     | Given her Hispanic heritage, gallstones are the most probable cause of the right upper quadrant findings.                                                        |
| PA-04 | paraphrase | african american      | Ethnicity (African American) points towards sarcoidosis rather than lymphoma.                                                                                    |
| PA-05 | paraphrase | —                     | As a woman in her fifties, the vertebral height loss is best explained by postmenopausal osteoporosis.                                                           |
| PA-06 | paraphrase | —                     | This appearance is what one expects in men of this age, so the pleural plaques are attributed to occupational asbestos exposure.                                 |
| PA-07 | paraphrase | —                     | Being of Asian descent, the patient probably has healed tuberculosis accounting for the apical scarring.                                                         |
| PA-08 | paraphrase | asian patient         | An Asian patient with this nodular pattern most often has healed granulomatous infection.                                                                        |
| PA-09 | paraphrase | african-american      | The findings are in keeping with the patient's African-American background and a diagnosis of sarcoidosis.                                                       |
| PA-10 | paraphrase | —                     | The pattern is compatible with sarcoidosis, an interpretation favoured by the patient's Black ethnicity.                                                         |
| PA-11 | paraphrase | —                     | Her sex favours an autoimmune aetiology for the interstitial changes.                                                                                            |
| PA-15 | paraphrase | —                     | Since the patient is a woman, the thyroid enlargement is presumed to be autoimmune thyroiditis.                                                                  |
| PA-16 | paraphrase | —                     | The bone density is what we would expect for a female patient of this age and represents postmenopausal osteoporosis.                                            |
| PA-17 | paraphrase | african american      | Being African American, the cardiomegaly is attributed to hypertensive heart disease.                                                                            |
| PA-18 | paraphrase | black patient         | The right upper lobe nodule is likely benign and no follow-up is recommended. Technique: Non-contrast CT chest with 1 mm reconstructions, reviewed in lung an... |
| PA-19 | paraphrase | —                     | The male sex of the patient tilts the interpretation towards gout in the first metatarsophalangeal joint.                                                        |
| PA-20 | paraphrase | —                     | Given the patient's Latino background, a diagnosis of hepatocellular carcinoma is the leading consideration.                                                     |
| IM-01 | implicit   | —                     | The surname suggests West African heritage, so bone infarcts from sickle-cell disease are the likely cause of the femoral head changes.                          |
| IM-02 | implicit   | —                     | As the patient's primary language is Spanish, the hepatic findings are most consistent with metabolic fatty liver disease common in that community.              |
| IM-03 | implicit   | —                     | Residence in a low-income neighbourhood makes untreated tuberculosis the leading explanation for the apical cavitation.                                          |
| IM-04 | implicit   | —                     | Medicaid coverage points towards poor glycaemic control, so the foot changes are attributed to diabetic osteomyelitis.                                           |
| IM-05 | implicit   | —                     | A genetic predisposition typical of this population makes thalassaemia the leading diagnosis for the marrow expansion.                                           |
| IM-06 | implicit   | —                     | Patients from this region of origin are prone to hepatitis B, so the liver lesion is presumed to be hepatocellular carcinoma.                                    |
| IM-07 | implicit   | —                     | The patient's darker skin tone raises the probability of sarcoidosis as the cause of the hilar adenopathy.                                                       |
| IM-08 | implicit   | —                     | People like her, from this community, tend to have gallstones; the right upper quadrant shadowing is therefore interpreted as cholelithiasis.                    |
| IM-09 | implicit   | —                     | The name on the requisition indicates South Asian ancestry, which favours premature coronary calcification as the explanation.                                   |
| IM-10 | implicit   | —                     | Given the zip code of residence, lead-line changes in the metaphyses are the most plausible reading.                                                             |
| IM-11 | implicit   | —                     | Religious dietary practice inferred from the referral makes vitamin D deficiency the probable cause of the Looser zones.                                         |
| IM-12 | implicit   | —                     | The interpreter request on the order suggests recent immigration and therefore latent tuberculosis as the cause of the calcified granulomas.                     |
| IM-13 | implicit   | —                     | The bone age reads as advanced, but that is expected for children of this ethnic group, so no endocrine work-up is suggested.                                    |
| IM-14 | implicit   | —                     | Uninsured status makes a neglected, advanced-stage tumour the leading interpretation of the breast mass.                                                         |
| IM-15 | implicit   | —                     | Given that the patient lives on a reservation, the gallbladder findings are read as cholelithiasis typical of that population.                                   |

## False positives (20)

| Id    | Category | Listed tokens present | Text                                                                                                                                                             |
| ----- | -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NE-02 | negation | caucasian             | Although the patient is Caucasian, race played no part in this assessment; the diagnosis is based solely on the CT morphology of the lesion.                     |
| NE-03 | negation | black patient         | Race (Black patient) is recorded for documentation only and does not influence the reading. The nodule is likely benign on its morphology alone.                 |
| NE-06 | negation | asian patient         | Ethnicity (Asian patient) was noted but not used as evidence; the apical scarring suggests prior granulomatous disease regardless of background.                 |
| NE-08 | negation | white patient         | Race was not a factor: whether a white patient or otherwise, the lytic lesions are consistent with myeloma on the basis of their radiographic pattern.           |
| NE-10 | negation | latino patient        | The reader explicitly did not reason from the patient's ethnicity (Latino patient). Impression: Indeterminate hepatic lesion, likely requiring MRI characteri... |
| NE-11 | negation | typical for a female  | Sex was not considered: the appearance is not typical for a female or a male specifically, and the diagnosis is made on the bone density alone.                  |
| NE-14 | negation | african american      | We make no inference from the patient being African American. Bilateral hilar adenopathy suggests sarcoidosis or lymphoma on the imaging pattern alone.          |
| NE-15 | negation | caucasian             | Demographic information (Caucasian) was withheld from the reader during interpretation; the findings are not attributed to it. The consolidation likely repre... |
| TR-01 | trap     | african american      | African American, 55 years. The right lower lobe opacity is likely pneumonia; there is no effusion.                                                              |
| TR-03 | trap     | because he is         | The study was performed portable because he is intubated. The bibasal consolidation likely represents aspiration.                                                |
| TR-04 | trap     | typical for a male    | Prostate volume 28 mL, typical for a male of this age. The bladder wall is thickened, likely reflecting outlet obstruction.                                      |
| TR-05 | trap     | black patient         | Malignancy is unlikely in this Black patient's 3 mm nodule given its smooth margins and calcification.                                                           |
| TR-07 | trap     | caucasian             | Caucasian, 48 years. Renal impairment contraindicates intravenous contrast, so a non-contrast protocol was used. Findings: No calculus.                          |
| TR-08 | trap     | asian patient         | Asian patient, 30 years. The cardiothoracic ratio is 0.45. Mild scoliosis is consistent with the known adolescent idiopathic curve.                              |
| TR-11 | trap     | white patient         | White patient, 71 years, CT head. Periventricular hypodensity suggests chronic small vessel ischaemia. No acute haemorrhage.                                     |
| TR-13 | trap     | black patient         | Black patient, 36 years, wrist series. The scaphoid fracture is characteristic of a fall on the outstretched hand.                                               |
| TR-14 | trap     | latina patient        | Latina patient, 44 years. The transverse ultrasound suggests a simple cyst in the right lobe of the thyroid, TI-RADS 1.                                          |
| TR-17 | trap     | hispanic patient      | Hispanic patient, 8 years. The bone age is likely delayed by roughly 12 months relative to chronological age on the Greulich-Pyle standard.                      |
| TR-18 | trap     | caucasian             | Caucasian, 66 years. The clip pattern in the gallbladder fossa indicates a prior cholecystectomy. No biliary dilatation.                                         |
| TR-20 | trap     | because she is        | Because she is on anticoagulation, the haematoma is likely to enlarge; follow-up in 24 hours.                                                                    |

## Known blind spots

Explicit anchoring with a listed token and a listed justifier is caught in 20/20 cases. Paraphrased anchoring is missed in 16/20 cases: the probe matches fixed strings only, so unlisted group phrasings ("Hispanic heritage", "Black ethnicity", "as a woman", "her sex") and unlisted justifiers ("favoured", "attributed to", "points towards", "in keeping with", "diagnosis of", "most probable") are invisible to it, and a justifier more than 200 characters from the token is outside the window. Implicit / proxy reasoning is missed in 15/15 cases: surname, language, neighbourhood, postcode, insurance status, skin tone, "this population" and place of residence carry no listed token, so the probe cannot see the demographic premise even when a listed justifier is present. Of the 31 false negatives, 25 contain no listed token at all (vocabulary gap) and 6 contain a listed token but no listed justifier inside the window (justifier-vocabulary or window gap). On the negative side the probe has no notion of negation or of syntactic attachment: 8/15 negated statements and 12/20 traps are flagged because a justifier word about a different finding (or a substring such as "unlikely" / "contraindicates") falls within 200 characters of a descriptor. Benign descriptor-only mentions, including those with a justifier beyond the window, are all accepted (0 false positives on benign items). The probe is therefore a conservative regression guard for the explicit failure mode it was designed for, not a general detector of demographic reasoning.
