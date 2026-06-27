# Actes de Naissance OCR

## 🇫🇷 Français

Application web progressive (PWA) qui permet de photographier un acte de naissance, d'en extraire automatiquement les données par OCR, puis de les exporter dans un fichier Excel.

### Fonctionnalités
- 📷 Capture photo via l'appareil (caméra mobile ou import de fichier)
- 🔍 Deux moteurs OCR au choix :
  - **Local (gratuit, offline)** : Tesseract.js, fonctionne sans connexion internet
  - **IA Claude (précis, en ligne)** : nécessite une clé API Anthropic personnelle (jamais stockée ailleurs que sur l'appareil)
- ✏️ Formulaire de vérification/correction des champs extraits (nom, prénom, sexe, dates, parents, n° d'acte, etc.)
- 💾 Stockage local (IndexedDB) — les fiches s'accumulent sur l'appareil, aucune limite de capacité raisonnable
- 📊 Export Excel (.xlsx) à la demande, avec toutes les fiches enregistrées
- 📦 Export de sauvegarde JSON
- 📱 Installable comme une app native (PWA), fonctionne hors-ligne après le premier chargement

### Installation / déploiement
1. Héberger les fichiers (`index.html`, `app.js`, `manifest.json`, `sw.js`, `icons/`) sur GitHub Pages, Netlify, Cloudflare Pages ou tout hébergement statique HTTPS (le HTTPS est obligatoire pour l'accès caméra et le service worker).
2. Ouvrir l'URL sur un mobile, puis "Ajouter à l'écran d'accueil" pour l'installer comme une app.

### Clé API Anthropic (optionnel)
Pour utiliser le mode OCR par IA Claude, obtenir une clé sur [console.anthropic.com](https://console.anthropic.com). La clé est stockée uniquement en local (localStorage) sur l'appareil et n'est envoyée qu'à l'API Anthropic directement depuis le navigateur.

---

## 🇸🇴 Soomaali

Barnaamij koox-jooga ah (PWA) oo kuu ogolaanaya inaad sawir qaadid dukumentiga dhalashada, xogta ka soo qaado si toos ah (OCR), kadibna aad u dhoofiso fayl Excel ah.

### Sifooyinka
- 📷 Sawir-qaadis toos ah (camera-ga mobile-ka ama soo geli sawir hore u keydsan)
- 🔍 Laba qaab OCR oo aad ka dooran karto:
  - **Maxalli ah (lacag la'aan, offline)**: Tesseract.js, waxay shaqaysaa iyada oo aan internet loo baahnayn
  - **AI Claude (sax ah, online)**: waxay u baahan tahay key API gaar ah oo Anthropic (kuma kaydsanto meel kale oo aan ahayn qalabkaaga)
- ✏️ Foom lagu hubinayo/sax karo xogta la soo qaaday (magaca, magaca hooyo, jinsiga, taariikhda, waalidiinta, lambarka dukumentiga, iwm.)
- 💾 Keydis maxalli ah (IndexedDB) — diiwaannada way isu kordhayaan qalabka, xad kasta lama xirin
- 📊 Dhoofinta Excel (.xlsx) marka la rabo, oo ay ku jiraan dhammaan diiwaannada
- 📦 Dhoofinta kaydis JSON ah
- 📱 La rakibi karo sida app dabiici ah, waxay shaqaysaa offline ka dib markii la fureeyo markii hore

---

## 🇬🇧 English

A Progressive Web App (PWA) that lets you photograph a birth certificate, automatically extract the data via OCR, and export it to an Excel file.

### Features
- 📷 Photo capture via device camera or file import
- 🔍 Two OCR engines to choose from:
  - **Local (free, offline)**: Tesseract.js, works without an internet connection
  - **Claude AI (more accurate, online)**: requires a personal Anthropic API key (never stored anywhere except on your device)
- ✏️ Review/correction form for extracted fields (name, surname, sex, dates, parents, certificate number, etc.)
- 💾 Local storage (IndexedDB) — records accumulate on the device, no practical limit
- 📊 On-demand Excel (.xlsx) export with all saved records
- 📦 JSON backup export
- 📱 Installable as a native-like app (PWA), works offline after first load

### Deployment
1. Host the files (`index.html`, `app.js`, `manifest.json`, `sw.js`, `icons/`) on GitHub Pages, Netlify, Cloudflare Pages, or any static HTTPS host (HTTPS is required for camera access and the service worker).
2. Open the URL on mobile, then "Add to Home Screen" to install it as an app.

### Anthropic API Key (optional)
To use the Claude AI OCR mode, get a key at [console.anthropic.com](https://console.anthropic.com). The key is stored only locally (localStorage) on the device and is sent only directly to the Anthropic API from the browser.
