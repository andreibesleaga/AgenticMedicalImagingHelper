# Disclaimer

**Applies to:** everything in this repository and every artefact it produces:
the software, its outputs (reports, JSON files, run manifests), the documentation,
the architecture and design documents, the experiment packs, benchmarks and
results, and the plans for future versions.

## 1. Research and education only. Not a medical device.

AgenticMedicalImagingHelper is research and educational software. It is **not a
medical device**, it has **no regulatory clearance or approval** anywhere (no CE
marking under the EU Medical Device Regulation 2017/745, no FDA clearance, no
approval by any other authority), and it is **not intended** for the diagnosis,
prevention, monitoring, prediction, prognosis, treatment or alleviation of any
disease or condition in any person.

- **Do not use it on patients or to make or support any clinical decision.**
- Nothing it produces is a diagnosis, a medical opinion, or a treatment
  recommendation. "Treatment ideas" in its output are experimental model text,
  labelled as such, and must never be acted on.
- Every output **requires review by a qualified clinician** before any use, and
  even then may only be used for research or teaching.
- Using this software does not create a doctor–patient or any other
  professional relationship with the author.
- If you have a medical problem, consult a qualified healthcare professional.
  In an emergency, call your local emergency number.

## 2. Known limitations

The outputs come from general-purpose and medical AI models. They can be wrong,
incomplete, biased, inconsistent between runs or between models, and can contain
invented findings stated with high confidence. The published evaluations of this
software (see `experiments/`) were run on small numbers of patients, on public
datasets whose labels are partly machine-derived, and in most cases without any
clinician review. The governance controls (probes, guards, manifests) are
heuristics and engineering controls: a clean result means "nothing obvious was
found", never "correct", "safe", "fair" or "compliant". See `README.md`,
`docs/COMPLIANCE.md` and each `RESULTS.md` for the stated limits.

## 3. No warranty. Limitation of liability.

The software is licensed under the GNU General Public License v3.0 (see
`LICENSE`). As stated in sections 15 and 16 of that licence, **it is provided
"as is", without warranty of any kind**, express or implied, including the
implied warranties of merchantability and fitness for a particular purpose, and
**in no event will the author or any copyright holder be liable** for any
damages, including any general, special, incidental or consequential damages,
arising out of the use or inability to use it, to the extent permitted by
applicable law. The same applies to the documentation, designs, data files and
results in this repository.

## 4. Regulatory status and the user's responsibility

- **EU AI Act (Regulation (EU) 2024/1689, as amended by Regulation (EU)
  2026/1744).** The software is developed for scientific research. Anyone who
  places it on the market, puts it into service, or uses it for a medical
  purpose becomes responsible for the obligations that follow, including, for a
  diagnostic purpose, the medical-device conformity assessment that also covers
  the high-risk AI requirements.
- **Data protection (GDPR, HIPAA and equivalents).** The software does not
  make any processing lawful. The person or organisation running it is the
  controller (or covered entity / business associate) for any personal or
  health data they give it, and is responsible for a legal basis, contracts with
  model providers, data-protection impact assessments, de-identification and
  security. Do not give it identifiable patient data.
- **Mappings are not certifications.** The EU AI Act, NIST AI RMF, HIPAA, OWASP
  and other mappings in `docs/` show where a requirement is addressed in the
  code. They are not a conformity assessment, an audit, a certification or legal
  advice.

## 5. Third-party data, models and services

- **Datasets** keep their own licences and terms, which the user must accept and
  follow (for example the NIH ChestX-ray14 terms, the PhysioNet Credentialed
  Health Data Use Agreement, TCIA licences, and the others named in each
  experiment folder). Nothing here grants any right to third-party data.
- **Models and services** (Google Gemini and Vertex AI, OpenRouter and the
  providers it routes to, Anthropic, OpenAI, Google MedGemma under the Health AI
  Developer Foundations terms, Gemma, Qwen, Jev (TypeSafe AI), Ollama, vLLM,
  llama.cpp and others) are governed by their own terms, which may restrict
  medical, clinical or high-risk uses. The user is responsible for complying
  with them. Their names are used only to identify them; this project is not
  affiliated with or endorsed by any of them. All trademarks belong to their
  owners.

## 6. Forward-looking material

Roadmaps, plans, target architectures and descriptions of future versions
describe intentions, not commitments. They may change or never be implemented,
and nothing in them is a claim about what the software does today.

## 7. This notice

This notice is not legal advice and does not replace advice from a lawyer in
your jurisdiction. If any part of it is unenforceable where you are, the rest
still applies. Copyright, licensing and prior-art notices are in `NOTICE` and
`docs/PRIOR-ART.md`.
