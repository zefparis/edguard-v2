# EDGUARD v2 — Academic Identity Shield

> **Mission** : protéger l'identité d'un apprenant pendant un examen en ligne
> de bout en bout — de l'inscription jusqu'à la délivrance du certificat — avec
> une preuve continue que **l'élève qui passe l'examen est bien celui qui s'est
> enrôlé**, sans recourir à un proctor humain ni à un fournisseur d'identité
> tiers.

EDGUARD est un module client-only (PWA, déployable sur Vercel) qui combine
**reconnaissance faciale**, **biométrie vocale**, **baselines cognitifs**,
**télémétrie comportementale**, et **signature post-quantique** pour sceller
chaque profil d'enrôlement. Pendant l'examen, une boucle de checkpoints
selfie + détection comportementale maintient le lien identité ↔ session.

Backend cible : **Hybrid Vector API** (`/edguard/*` endpoints). Stockage final :
Supabase (table `edguard_enrollments` + `edguard_checkpoints`).

---

## Sommaire

1. [Architecture](#architecture)
2. [Pipeline d'enrôlement](#pipeline-denrôlement-6-étapes)
3. [Pipeline d'examen](#pipeline-dexamen-supervision-continue)
4. [Stack technique](#stack-technique)
5. [Démarrage rapide](#démarrage-rapide)
6. [Variables d'environnement](#variables-denvironnement)
7. [Schéma Supabase requis](#schéma-supabase-requis)
8. [Routes API consommées](#routes-api-consommées)
9. [Structure du repo](#structure-du-repo)
10. [Sécurité & vie privée](#sécurité--vie-privée)
11. [Roadmap & extensions](#roadmap--extensions)
12. [Auteur & licence](#auteur--licence)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                       EDGUARD v2 (PWA, Vite, React 18)               │
│                                                                      │
│   ┌────────────┐   ┌────────────┐   ┌────────────┐                  │
│   │  Home      │ → │  Enroll    │ → │  Verify    │ → ExamSession   │
│   │  /         │   │  /enroll   │   │  /verify   │   /session       │
│   └────────────┘   └────────────┘   └────────────┘                  │
│                                                                      │
│   ┌────────────────────────── signal-engine ────────────────────────┐│
│   │  SignalBus  ─►  BehavioralCollector                             ││
│   │             ─►  CognitiveCollector                              ││
│   │             ─►  VoiceCollector                                  ││
│   │             ─►  FaceCollector                                   ││
│   └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│   ┌── services ────────────────────────────────────────────────────┐ │
│   │  api.ts          → POST /edguard/enroll, /edguard/verify       │ │
│   │  sessionApi.ts   → POST /edguard/session/checkpoint            │ │
│   │  postQuantum.ts  → ML-KEM-768 keygen + signProfile             │ │
│   │  reportGenerator → printable PDF (HTML window.print)           │ │
│   └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                              │  HTTPS + X-API-Key (per-tenant)
                              ▼
              ┌───────────────────────────────────┐
              │   Hybrid Vector API (Render)      │
              │   /edguard/{enroll,verify,...}    │
              │   AWS Rekognition CompareFaces    │
              │   Supabase (edguard_* tables)     │
              └───────────────────────────────────┘
```

EDGUARD est intentionnellement **stateless côté serveur applicatif** — toute la
logique d'orchestration (état du flux, captures intermédiaires) vit dans le
store Zustand persisté côté navigateur. Le backend Hybrid Vector ne reçoit que
les payloads finalisés et signés.

---

## Pipeline d'enrôlement (6 étapes)

L'enrôlement construit la **baseline biométrique + cognitive + comportementale**
sceaulée par une signature post-quantique. Toutes les étapes sont gérées par
`src/pages/Enroll.tsx`.

| # | Étape          | Capture                                        | Composant / Hook                          |
|---|----------------|------------------------------------------------|-------------------------------------------|
| 1 | **Identity**   | Prénom, nom, ID étudiant, institution, programme, email | `IdentityForm` (inline)             |
| 2 | **Selfie**     | Photo de référence du visage                   | `SelfieCapture` + `useCamera`             |
| 3 | **Stroop**     | Score d'inhibition cognitive (couleur ↔ mot)   | `StroopTest`                              |
| 4 | **Reflex**     | Vélocité réflexe (ms)                          | `NeuralReflex`                            |
| 5 | **Vocal**      | Empreinte vocale 192-dim + score qualité       | `VocalImprint` + `useVoiceBiometrics`     |
| 6 | **Reaction**   | Temps de réaction simple (ms)                  | `ReactionTime`                            |

**En parallèle des 6 étapes** :

- `BehavioralCapture` (wrapper du hook `useBehavioral`) collecte en arrière-plan :
  - `DeviceMotion` (accélération + gyroscope) — moyenne, écart-type, magnitude
  - `DeviceOrientation` (alpha/beta/gamma)
  - Pointer events (down / move / up / tap, durée et vitesse)
  - Métadonnées device (UA, langue, timezone, écran, cores)
- `signalBus` bufferise tous les signaux comportementaux et les `flush` toutes
  les secondes vers `/api/signals` (channel `behavioral`).

**À la fin de l'étape 6**, `Enroll.tsx` :

1. Stoppe `BehavioralCapture` → `BehavioralProfile` finalisé.
2. Construit `cognitive_baseline` (scores normalisés [0..1] + embedding vocal).
3. Génère une paire ML-KEM-768 (`generateSessionKeypair()`).
4. Signe le profil canonique (SHA3-256 → KEM encapsulate déterministe) →
   `pq_signature`.
5. POST `/edguard/enroll` avec :
   - `selfie_b64`
   - `first_name`, `last_name`, `email`, `tenant_id`
   - `cognitive_baseline` enrichi de `behavioral`, `pq_public_key`,
     `pq_signature`, `pq_algorithm: 'ML-KEM-768'`

Réponse attendue : `{ success, student_id, confidence }`.

---

## Pipeline d'examen (supervision continue)

Géré par `src/pages/ExamSession.tsx`. Trois états : `active`, `modal-check`,
`suspended`.

### Boucle principale

```
                        ┌───────────────┐
            ┌──────────▶│   active      │◀────────────┐
            │           └───────┬───────┘             │
            │                   │                     │
            │ next check (5min) │                     │
            │                   ▼                     │
            │           ┌───────────────┐             │
            │           │  modal-check  │             │
            │           └───────┬───────┘             │
            │                   │                     │
            │     verify ok     │   verify fail       │
            │  ─────────────────┼───────────────────  │
            │                   │                     │
            └────── success ────┘     fail × 3        │
                                       │              │
                                       ▼              │
                              ┌───────────────┐       │
                              │  suspended    │ ──────┘
                              └───────────────┘
                                  (terminal)
```

- **Checkpoint selfie** toutes les `CHECK_INTERVAL_MS = 5 min` →
  `POST /edguard/session/checkpoint` avec `event_type ∈ {VERIFIED, WARNING}` et
  `behavioral_score`.
- **3 échecs consécutifs** → session `suspended` (lock UI, rapport téléchargeable).
- **Bouton "I'm here"** : confirmation manuelle de présence (event `PRESENT`).

### Détection comportementale temps réel

Pendant la session, plusieurs heuristiques alimentent un compteur d'événements
suspicieux qui pondère le `behavioral_score` (1.0 par défaut, −0.15 par event,
plancher 0.2) :

| Événement                     | Détection                                                |
|-------------------------------|----------------------------------------------------------|
| Onglet caché / fenêtre minimisée | `document.visibilityState !== 'visible'`             |
| Perte de focus                | `window.blur`                                            |
| Tentative de raccourci copier/coller/print/save | `Ctrl+C/V/X/P/S/U`, `F12`              |

Chaque événement est journalisé dans la log session (`events`, max 5 dernières)
et envoyé en checkpoint à 5 min.

### Rapport final

`endSession()` ouvre une fenêtre imprimable (`reportGenerator.openPrintableReport`)
qui agrège :

- Identité étudiant + institution + programme
- `started_at`, `ended_at`, `duration_ms`
- `checks_total`, `checks_passed`, `warnings`, `suspended`
- `behavioral.score` + `level ∈ {normal, suspicious}`
- `post_quantum.algorithm`

L'utilisateur "Save as PDF" → preuve archivable.

---

## Stack technique

| Couche               | Choix                                                                  |
|----------------------|------------------------------------------------------------------------|
| **Framework**        | React 18 + TypeScript (Vite 5)                                         |
| **Routing**          | `react-router-dom` v6 (4 routes : `/`, `/enroll`, `/verify`, `/session`) |
| **State**            | `zustand` v4 + `persist` middleware (clé `edguard-store` dans `localStorage`) |
| **Cryptographie**    | `@noble/post-quantum` (ML-KEM-768) + `@noble/hashes` (SHA3-256)         |
| **ML inference**     | `onnxruntime-web` (importé pour future plug ECAPA-TDNN, MFCC actuel)   |
| **Audio**            | `MediaRecorder` + Web Audio API + MFCC 40 coefs → embedding 192-dim    |
| **Caméra**           | `getUserMedia` (hook custom `useCamera`)                                |
| **Capteurs**         | `DeviceMotion`, `DeviceOrientation`, Pointer Events                    |
| **Identifiants**     | `ulid` pour les IDs locaux                                              |
| **Style**            | CSS custom (dark theme, palette cyan/amber/red, ~7 KB)                 |
| **Build / hosting**  | Vite → Vercel (configuration `vercel.json` SPA + cache assets immutable) |

### Pourquoi ces choix

- **PWA pure** : pas de runtime serveur côté EDGUARD, déploiement Vercel
  trivial, latence minimale pour la caméra et les capteurs.
- **ML-KEM-768** : standard NIST PQ, encapsulation déterministe utilisée comme
  primitive de signature légère (SHA3-256 du profil canonique → KEM ciphertext).
  Vérifiable par n'importe qui détenant la clé publique.
- **Embedding vocal local** : pas d'audio brut envoyé au backend (RGPD-friendly).
  Code structuré pour swap futur vers ECAPA-TDNN ONNX sans toucher aux call sites.
- **Zustand persistant** : reprise de session si l'élève rafraîchit l'onglet
  pendant l'enrôlement.

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 18
- npm ≥ 8
- HTTPS local (le navigateur exige TLS pour `getUserMedia` + capteurs sur mobile)

> 💡 En dev, Vite sert en HTTP sur `localhost` ce qui est OK pour la caméra
> desktop. Pour tester `DeviceMotionEvent.requestPermission()` (iOS) il faut un
> tunnel TLS — par exemple `cloudflared tunnel` ou `ngrok http 3001`.

### Installation

```bash
npm install
```

### Variables d'environnement (cf. section dédiée)

Créer un fichier `.env` (ou `.env.local`) :

```env
VITE_API_URL=https://hybrid-vector-api.onrender.com
VITE_TENANT_ID=edguard-demo
VITE_HV_API_KEY=edguard-key-2026
```

### Lancer en dev

```bash
npm run dev
```

App disponible sur **http://localhost:3001** (port défini par `vite.config.ts`).

### Build de production

```bash
npm run build
npm run preview      # smoke test du build
```

Sortie : `dist/` (uploadable à n'importe quel CDN statique, Vercel par défaut).

---

## Variables d'environnement

| Clé                   | Obligatoire | Description                                                      |
|-----------------------|-------------|------------------------------------------------------------------|
| `VITE_API_URL`        | non *       | Base URL de Hybrid Vector API. Fallback : `https://hybrid-vector-api.fly.dev`. |
| `VITE_TENANT_ID`      | **oui**     | ID tenant tel que défini dans `edguard_tenants`. `services/api.ts` lève une erreur s'il est absent. |
| `VITE_HV_API_KEY`     | **oui**     | Clé d'API associée au tenant. Validée par le backend EDGUARD.    |

> *Le fallback `VITE_API_URL` existe pour le dev rapide. **En production le
> définir explicitement** pour éviter toute ambiguïté entre Render / Fly.

### Tenants d'exemple (à créer côté backend)

| `tenant_id`      | `api_key`             | Usage                       |
|------------------|------------------------|-----------------------------|
| `edguard-demo`   | `edguard-key-2026`     | Démo publique EDGUARD       |
| `payguard-demo`  | `payguard-key-2026`    | Réutilisation pour PayGuard |

Header envoyé : `X-API-Key: <VITE_HV_API_KEY>`.

---

## Schéma Supabase requis

EDGUARD attend que les colonnes additionnelles suivantes existent côté backend
(les migrations sont rappelées en commentaires SQL dans le code) :

```sql
-- Profil d'enrôlement
ALTER TABLE edguard_enrollments
  ADD COLUMN IF NOT EXISTS behavioral_profile         JSONB,
  ADD COLUMN IF NOT EXISTS pq_public_key              TEXT,
  ADD COLUMN IF NOT EXISTS pq_signature               TEXT,
  ADD COLUMN IF NOT EXISTS vocal_embedding            JSONB,
  ADD COLUMN IF NOT EXISTS vocal_quality              FLOAT,
  ADD COLUMN IF NOT EXISTS vocal_similarity_threshold FLOAT;

-- Checkpoints durant la session
ALTER TABLE edguard_checkpoints
  ADD COLUMN IF NOT EXISTS session_id        TEXT,
  ADD COLUMN IF NOT EXISTS event_type        TEXT,
  ADD COLUMN IF NOT EXISTS behavioral_score  FLOAT;
```

Aucune autre migration n'est nécessaire côté EDGUARD.

---

## Routes API consommées

Toutes les routes sont sur `${VITE_API_URL}` avec header `X-API-Key`.

### `POST /edguard/enroll`

```jsonc
// Request
{
  "selfie_b64": "data:image/jpeg;base64,...",
  "first_name": "Ada",
  "last_name": "Lovelace",
  "email": "ada@uni.local",
  "tenant_id": "edguard-demo",
  "cognitive_baseline": {
    "stroop_score":      0.92,
    "reflex_velocity_ms": 320,
    "vocal_accuracy":    0.88,
    "reaction_time_ms":  410,
    "vocal_embedding":   [/* 192 floats */],
    "vocal_quality":     0.91,
    "vocal_similarity_threshold": 0.75,
    "behavioral":        { /* BehavioralProfile complet */ },
    "pq_public_key":     "deadbeef…",
    "pq_signature":      "cafef00d…",
    "pq_algorithm":      "ML-KEM-768"
  }
}

// Response
{ "success": true, "student_id": "stu_…", "confidence": 96 }
```

### `POST /edguard/verify`

```jsonc
// Request
{
  "selfie_b64": "data:image/jpeg;base64,...",
  "first_name": "Ada",
  "last_name":  "Lovelace",
  "tenant_id":  "edguard-demo"
}

// Response
{ "verified": true, "similarity": 94, "student_id": "stu_…", "first_name": "Ada" }
```

### `POST /edguard/session/checkpoint`

```jsonc
// Request
{
  "student_id":         "stu_…",
  "session_id":         "sess_<rand>_<ts>",
  "checkpoint_number":  1,
  "face_b64":           "data:image/jpeg;base64,...",
  "tenant_id":          "edguard-demo",
  "event_type":         "VERIFIED",   // | "WARNING" | "PRESENT" | "SUSPICIOUS"
  "behavioral_score":   0.85,
  "cognitive_score":    94             // optionnel
}

// Response
unknown — best-effort, l'UI ne dépend pas du retour.
```

### `POST /api/signals` (signal bus)

Émis par `SignalBus.flushAll()` toutes les secondes :

```jsonc
{
  "channel": "behavioral",
  "batch":   [/* events bufferisés */],
  "source":  "edguard"
}
```

> 💡 Cet endpoint vit habituellement à côté du Hybrid Vector API. Si non
> implémenté, `signalBus` ignore silencieusement les erreurs réseau (catch noop).

---

## Structure du repo

```
edguard-v2/
├── public/                       icônes PWA, manifeste
├── index.html
├── vite.config.ts                port 3001 + alias
├── vercel.json                   SPA rewrites + cache assets
├── tsconfig.json
├── .env.example                  template (commit-safe)
├── .env.production               valeurs prod par défaut
├── do_commit.bat                 helper Windows
└── src/
    ├── App.tsx                   BrowserRouter (4 routes)
    ├── main.tsx
    ├── index.css                 dark theme
    │
    ├── pages/
    │   ├── Home.tsx              landing, choix Enroll vs Verify
    │   ├── Enroll.tsx            6-step state machine + PQ signing
    │   ├── Verify.tsx            2-step quick check (identity + selfie)
    │   └── ExamSession.tsx       supervision continue 5min/checkpoint
    │
    ├── components/
    │   ├── SelfieCapture.tsx     useCamera + canvas → base64 JPEG
    │   ├── StroopTest.tsx        cognitif — couleur vs mot
    │   ├── NeuralReflex.tsx      cognitif — réflexe
    │   ├── VocalImprint.tsx      enregistrement audio + MFCC
    │   ├── ReactionTime.tsx      cognitif — temps de réaction
    │   ├── BehavioralCapture.tsx wrapper du hook useBehavioral
    │   ├── CameraInitLoader.tsx  splash chargement caméra
    │   └── InstallAppCard.tsx    incitation PWA install
    │
    ├── hooks/
    │   ├── useCamera.ts          getUserMedia + cleanup
    │   ├── useBehavioral.ts      capture motion/orient/touch (BehavioralProfile)
    │   └── useVoiceBiometrics.ts MFCC, recordAudio, embedding, similarity
    │
    ├── services/
    │   ├── api.ts                enrollWorker, verifyWorker
    │   ├── sessionApi.ts         sendSessionCheckpoint
    │   ├── postQuantum.ts        ML-KEM-768 sign / verify
    │   └── reportGenerator.ts    HTML printable report (window.print)
    │
    ├── signal-engine/
    │   ├── SignalBus.ts          buffer 1s + flush vers /api/signals
    │   ├── BehavioralCollector.ts mousemove / keydown / touchmove
    │   ├── CognitiveCollector.ts records cognitive scores
    │   ├── VoiceCollector.ts     events vocaux
    │   ├── FaceCollector.ts      events facial captures
    │   └── index.ts              barrel export
    │
    ├── store/
    │   └── edguardStore.ts       zustand + persist (worker, selfie, baseline)
    │
    ├── types/
    │   └── index.ts              WorkerProfile, CognitiveBaseline
    │
    ├── models/                   futurs ONNX (ECAPA-TDNN, etc.)
    └── vite-env.d.ts
```

---

## Sécurité & vie privée

EDGUARD est conçu pour être **GDPR-friendly par défaut** :

1. **Pas d'audio brut transmis** — seul l'embedding 192-dim quitte le navigateur.
2. **Selfies en base64 inline** — transit TLS, persistance contrôlée par le
   backend Hybrid Vector + politique de rétention Supabase (à documenter côté
   tenant).
3. **Signature post-quantique** — chaque profil cognitif inclut une preuve
   `ML-KEM-768` qui empêche la modification silencieuse côté backend.
4. **API key tenant-scoped** — pas d'exposition d'identifiants AWS / Supabase
   au client. Le backend valide `X-API-Key` contre `edguard_tenants`.
5. **Permissions caméra/motion explicitement demandées** — iOS 13+ requiert un
   geste utilisateur ; le code dégrade gracieusement (`'unsupported'` /
   `'denied'`) sans bloquer le flux.
6. **Aucune donnée biométrique en `localStorage`** — seul un identifiant
   étudiant + métadonnées sont persistés (`edguard-store`). Les bases64 sont
   gardés en mémoire pour la durée du flux uniquement.
7. **Détection visibility / focus / shortcuts** — anti-fraude pendant la
   session, mais ne bloque pas l'utilisateur (il peut se réauthentifier après
   2 échecs).

> ⚠️ **À valider côté tenant** : politique de rétention des selfies
> backend, RLS Supabase sur `edguard_enrollments` / `edguard_checkpoints`,
> consentement RGPD explicite avant le démarrage de l'enrôlement.

---

## Roadmap & extensions

### Court terme

- [ ] Plug ECAPA-TDNN ONNX (192-dim) en remplacement de l'embedding MFCC
      maison — déjà câblé via `onnxruntime-web` dans `useVoiceBiometrics`.
- [ ] Support `requireFaceMatch: false` pour les institutions qui ne souhaitent
      pas de reconnaissance faciale.
- [ ] Intégration optionnelle de **`@hcs/id-scanner-react`**
      (`hcs-id-scanner` monorepo) pour ajouter un scan MRZ de pièce d'identité
      à l'étape 1 de l'enrôlement.

### Moyen terme

- [ ] Mode offline-first : queue les checkpoints en IndexedDB et flush dès que
      la connectivité revient (déjà partiellement géré côté `signalBus`).
- [ ] WebAuthn (passkey) en parallèle du selfie pour les sessions
      "high-stakes" (concours d'entrée, certifications).
- [ ] Live proctor remote (WebRTC) pour les institutions qui demandent un
      humain dans la boucle.

### Long terme

- [ ] **Modèle de risque adaptatif** côté backend — les `behavioral_score` +
      `cognitive_baseline` alimentent un modèle qui ajuste l'intervalle de
      checkpoint (5 min par défaut) selon le profil de l'apprenant.
- [ ] Export du rapport au format **C2PA** pour traçabilité forensique.

---

## Auteur & licence

- **Auteur** : Hybrid Vector / CoreHuman (ia-solution)
- **Origine cognitive** : moteur HCS-U7 (FR2514274 + FR2514546)
- **Licence** : MIT

> EDGUARD v2 est un module de la suite **HV-GUARD** (WorkGuard, PayGuard,
> AccessGuard, SignGuard, EdGuard, DriveGuard, SiteGuard, PalmGuard,
> PlayGuard). Tous partagent la même API tenant-scoped et la même architecture
> "PWA front-only + backend stateless". Le pipeline biométrique
> (`@hcs/id-scanner-core`) peut être greffé à l'étape d'enrôlement pour ajouter
> une vérification de pièce d'identité ICAO 9303.
