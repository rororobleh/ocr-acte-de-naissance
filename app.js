/* =========================================================
   Actes de Naissance OCR — logique application
   ========================================================= */

const DB_NAME = 'actes_naissance_db';
const DB_VERSION = 1;
const STORE_NAME = 'actes';
let db = null;

const FIELD_IDS = ['nom_complet', 'mere_nom', 'sexe', 'lieu_naissance', 'date_naissance'];

const FIELD_LABELS = {
  nom_complet: 'Nom complet',
  mere_nom: 'Nom de la mère',
  sexe: 'Sexe',
  lieu_naissance: 'Lieu de naissance',
  date_naissance: 'Date de naissance'
};

let currentImageDataUrl = null;
let currentRawText = '';
let currentOcrMode = 'mistral';
let editingRecordId = null;

/* ---------- IndexedDB ---------- */
function openDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const database = e.target.result;
      if(!database.objectStoreNames.contains(STORE_NAME)){
        const store = database.createObjectStore(STORE_NAME, { keyPath:'id', autoIncrement:true });
        store.createIndex('createdAt','createdAt',{unique:false});
      }
    };
    req.onsuccess = (e)=>{ db = e.target.result; resolve(db); };
    req.onerror = (e)=> reject(e);
  });
}

function dbAdd(record){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = (e)=> reject(e);
  });
}

function dbPut(record){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = (e)=> reject(e);
  });
}

function dbDelete(id){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = ()=> resolve();
    req.onerror = (e)=> reject(e);
  });
}

function dbGetAll(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_NAME,'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = ()=> resolve(req.result.sort((a,b)=> b.createdAt - a.createdAt));
    req.onerror = (e)=> reject(e);
  });
}

/* ---------- Toast ---------- */
function toast(msg, type=''){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type? ' '+type : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=> t.classList.remove('show'), 2600);
}

/* ---------- Navigation ---------- */
function hasUnsavedFormData(){
  // Le formulaire est considéré "en cours" si la carte d'extraction est visible
  // et qu'au moins un champ a été rempli (par l'OCR ou manuellement).
  if(formCard.style.display !== 'block') return false;
  return FIELD_IDS.some(id=>{
    const el = document.getElementById('f_'+id);
    return el && el.value.trim() !== '';
  });
}

function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.view === name);
  });
  if(name === 'list') refreshList();
}

document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const target = btn.dataset.view;
    if(target !== 'scan' && hasUnsavedFormData()){
      if(!confirm('Cette fiche n\'a pas été enregistrée. Quitter quand même ?')) return;
    }
    switchView(target);
  });
});

/* ---------- Capture photo (deux sources : caméra ou galerie) ---------- */
const fileInputCamera = document.getElementById('fileInputCamera');
const fileInputGallery = document.getElementById('fileInputGallery');
const previewWrap = document.getElementById('previewWrap');
const previewImg = document.getElementById('previewImg');
const captureZoneWrap = document.getElementById('captureZoneWrap');
const ocrModeCard = document.getElementById('ocrModeCard');
const formCard = document.getElementById('formCard');

/* ---------- Compression image avant traitement ----------
   Les photos prises au téléphone pèsent souvent plusieurs Mo, ce qui ralentit
   l'envoi à l'API Claude et augmente le coût en tokens. On redimensionne à une
   largeur max raisonnable et on recompresse en JPEG, sans perdre la lisibilité
   du texte (essentiel pour l'OCR).                                            */
const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 0.85;

function compressImage(dataUrl){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{
      let { width, height } = img;
      if(width > MAX_IMAGE_WIDTH){
        height = Math.round(height * (MAX_IMAGE_WIDTH / width));
        width = MAX_IMAGE_WIDTH;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    img.onerror = ()=> resolve(dataUrl); // si la compression échoue, on garde l'original
    img.src = dataUrl;
  });
}

function handleFileSelected(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    const original = ev.target.result;
    currentImageDataUrl = await compressImage(original);
    previewImg.src = currentImageDataUrl;
    previewWrap.style.display = 'block';
    captureZoneWrap.style.display = 'none';
    ocrModeCard.style.display = 'block';
    formCard.style.display = 'none';
    updateOcrModeUI();
    window.scrollTo({top: previewWrap.offsetTop - 80, behavior:'smooth'});
  };
  reader.readAsDataURL(file);
}

fileInputCamera.addEventListener('change', (e)=> handleFileSelected(e.target.files[0]));
fileInputGallery.addEventListener('change', (e)=> handleFileSelected(e.target.files[0]));

document.getElementById('clearPreview').addEventListener('click', ()=>{
  currentImageDataUrl = null;
  fileInputCamera.value = '';
  fileInputGallery.value = '';
  previewWrap.style.display = 'none';
  captureZoneWrap.style.display = 'block';
  ocrModeCard.style.display = 'none';
  formCard.style.display = 'none';
});

/* ---------- OCR mode toggle (multi-fournisseurs) ----------
   Chaque fournisseur a sa propre clé localStorage (on ne veut pas que la clé
   Mistral écrase la clé Claude si l'utilisateur bascule entre les modes), son
   propre placeholder et un texte d'aide expliquant où obtenir la clé.         */
const OCR_PROVIDERS = {
  mistral: {
    storageKey: 'mistral_api_key',
    placeholder: 'Clé API Mistral',
    hint: 'Ta clé est stockée uniquement sur cet appareil. Mistral propose un tier gratuit "Experiment" suffisant pour ce type d\'usage — crée une clé sur <a href="https://console.mistral.ai" target="_blank">console.mistral.ai</a>.'
  },
  claude: {
    storageKey: 'anthropic_api_key',
    placeholder: 'sk-ant-... (clé API Anthropic)',
    hint: 'Ta clé est stockée uniquement sur cet appareil, jamais envoyée ailleurs qu\'à l\'API Anthropic. Obtiens une clé sur <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> (facturation à l\'usage, pas de tier gratuit généreux).'
  },
  glm: {
    storageKey: 'glm_api_key',
    placeholder: 'Clé API Z.ai (GLM)',
    hint: 'Ta clé est stockée uniquement sur cet appareil. Crée un compte sur <a href="https://z.ai" target="_blank">z.ai</a> — les modèles texte gratuits ne couvrent pas toujours la vision : vérifie que ton compte a accès à un modèle GLM-V (ex. GLM-4.5V) avant de l\'utiliser ici.'
  }
};

function updateOcrModeUI(){
  const apiZone = document.getElementById('apiKeyZone');
  const localWarning = document.getElementById('localModeWarning');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKeyHint = document.getElementById('apiKeyHint');

  if(currentOcrMode === 'tesseract'){
    apiZone.style.display = 'none';
    localWarning.style.display = 'block';
    return;
  }
  localWarning.style.display = 'none';
  apiZone.style.display = 'block';

  const provider = OCR_PROVIDERS[currentOcrMode];
  apiKeyInput.placeholder = provider.placeholder;
  apiKeyHint.innerHTML = provider.hint;
  const saved = localStorage.getItem(provider.storageKey);
  apiKeyInput.value = saved || '';
}

document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentOcrMode = btn.dataset.mode;
    updateOcrModeUI();
  });
});

document.getElementById('saveKeyBtn').addEventListener('click', ()=>{
  const provider = OCR_PROVIDERS[currentOcrMode];
  if(!provider) return; // mode local : pas de clé à sauvegarder
  const val = document.getElementById('apiKeyInput').value.trim();
  if(val){
    localStorage.setItem(provider.storageKey, val);
    toast('Clé API enregistrée sur cet appareil', 'success');
  }
});

// Sauvegarde automatique de la clé dès qu'elle est saisie, sans attendre un clic
// sur "OK" — évite de devoir la retaper à chaque scan si on a oublié de cliquer.
document.getElementById('apiKeyInput').addEventListener('input', (e)=>{
  const provider = OCR_PROVIDERS[currentOcrMode];
  if(!provider) return;
  const val = e.target.value.trim();
  if(val){
    localStorage.setItem(provider.storageKey, val);
  } else {
    // Si l'utilisateur vide complètement le champ, on retire aussi la clé
    // enregistrée — c'est la façon explicite de "changer" ou effacer la clé.
    localStorage.removeItem(provider.storageKey);
  }
});

/* ---------- Run OCR ---------- */
document.getElementById('runOcrBtn').addEventListener('click', async ()=>{
  if(!currentImageDataUrl){ toast('Ajoute une photo d\'abord', 'error'); return; }

  const progressZone = document.getElementById('progressZone');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const runBtn = document.getElementById('runOcrBtn');

  progressZone.style.display = 'block';
  runBtn.disabled = true;
  progressFill.style.width = '5%';
  progressLabel.textContent = 'Initialisation…';

  try{
    let fields, rawText;

    if(currentOcrMode === 'tesseract'){
      // Tesseract est un OCR pur (reconnaissance de caractères sans compréhension) :
      // il ne peut renvoyer que du texte brut, qu'on doit ensuite parser nous-mêmes.
      rawText = await runTesseractOcr(currentImageDataUrl, (p, label)=>{
        progressFill.style.width = Math.max(5, p) + '%';
        progressLabel.textContent = label;
      });
      fields = parseActeFields(rawText);
    } else {
      // Les fournisseurs IA (Mistral, Claude, GLM) comprennent l'image et renvoient
      // directement les 5 champs déjà structurés en JSON — pas besoin de regex ici.
      const provider = OCR_PROVIDERS[currentOcrMode];
      const apiKey = localStorage.getItem(provider.storageKey) || document.getElementById('apiKeyInput').value.trim();
      if(!apiKey){ toast('Renseigne ta clé API', 'error'); progressZone.style.display='none'; runBtn.disabled=false; return; }

      progressFill.style.width = '40%';
      let result;
      if(currentOcrMode === 'mistral'){
        progressLabel.textContent = 'Analyse par Mistral en cours…';
        result = await runMistralOcr(currentImageDataUrl, apiKey);
      } else if(currentOcrMode === 'claude'){
        progressLabel.textContent = 'Analyse par Claude en cours…';
        result = await runClaudeOcr(currentImageDataUrl, apiKey);
      } else if(currentOcrMode === 'glm'){
        progressLabel.textContent = 'Analyse par GLM en cours…';
        result = await runGlmOcr(currentImageDataUrl, apiKey);
      }
      progressFill.style.width = '90%';
      fields = result.fields;
      rawText = result.rawText;
    }

    currentRawText = rawText;
    fillForm(fields);

    progressFill.style.width = '100%';
    progressLabel.textContent = 'Terminé';
    setTimeout(()=>{ progressZone.style.display = 'none'; }, 600);

    formCard.style.display = 'block';
    document.getElementById('rawTextBox').textContent = rawText || '(aucun texte détecté)';
    window.scrollTo({top: formCard.offsetTop - 80, behavior:'smooth'});
    toast('Données extraites — vérifie les champs', 'success');

  } catch(err){
    console.error(err);
    toast('Erreur OCR : ' + (err.message || err), 'error');
    progressZone.style.display = 'none';
  } finally {
    runBtn.disabled = false;
  }
});

/* ---------- Tesseract.js OCR ---------- */
async function runTesseractOcr(imageDataUrl, onProgress){
  const result = await Tesseract.recognize(imageDataUrl, 'fra', {
    logger: (m)=>{
      if(m.status === 'recognizing text'){
        onProgress(Math.round(m.progress * 100), 'Lecture du texte… ' + Math.round(m.progress*100) + '%');
      } else if(m.status){
        onProgress(15, m.status);
      }
    }
  });
  return result.data.text;
}

/* ---------- Claude API OCR ---------- */
/* ---------- Prompt OCR partagé entre tous les fournisseurs vision ---------- */
/* ---------- Parsing JSON robuste pour les réponses des fournisseurs IA ----------
   Même en demandant explicitement "pas de markdown", certains modèles entourent
   parfois leur JSON de ```json ... ``` ou ajoutent une phrase avant/après. On
   nettoie et on extrait le premier objet JSON valide trouvé dans la réponse.   */
function parseOcrJsonResponse(rawText){
  let text = (rawText || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try{
    parsed = JSON.parse(text);
  } catch(e){
    // Filet de sécurité : si la réponse contient du texte autour du JSON,
    // on extrait la première sous-chaîne qui ressemble à un objet { ... }.
    const match = text.match(/\{[\s\S]*\}/);
    if(match){
      try{ parsed = JSON.parse(match[0]); } catch(e2){ parsed = null; }
    }
  }
  if(!parsed || typeof parsed !== 'object') return null;

  const fields = {};
  for(const id of FIELD_IDS){
    fields[id] = typeof parsed[id] === 'string' ? parsed[id].trim() : '';
  }
  // Normalise le sexe au format M/F attendu par le formulaire, au cas où le
  // modèle renverrait "Masculin"/"Féminin" malgré la consigne.
  if(fields.sexe) fields.sexe = /^m/i.test(fields.sexe) ? 'M' : 'F';
  return fields;
}

const OCR_PROMPT = `Voici la photo d'un document d'état civil de la République de Djibouti : soit un "Extrait d'Acte de Naissance" classique, soit un "Extrait d'Acte de Notoriété Suppletif d'Acte de Naissance" (variante utilisée quand l'acte original est reconstitué).

Le document contient typiquement :
- Un en-tête avec le Conseil Régional et/ou le Centre d'État Civil d'une ville
- Une phrase narrative donnant la date de naissance en toutes lettres, qui peut prendre plusieurs formes :
  - Date complète : "VINGT-SIX AOUT DEUX MILLE DEUX A DIX-SEPT HEURES TRENTE MINUTES" (= 26/08/2002)
  - Avec "MIL" au lieu de "MILLE" et "QUATRE-VINGT" pour 80 : "VINGT OCTOBRE MIL NEUF CENT QUATRE VINGT QUINZE A DEUX HEURES QUINZE" (= 20/10/1995)
  - Avec "PREMIER" pour le 1er jour du mois : "PREMIER JUILLET DEUX MILLE QUATORZE A DEUX HEURES QUINZE" (= 01/07/2014)
  - Année seule (actes suppletifs, sans jour/mois) : "L'AN MIL NEUF CENT QUATRE-VINGT-DIX-SEPT (1997)" (= 1997)
  - IMPORTANT : il y a très souvent une date numérique entre parenthèses juste après ou à proximité (ex: "(01/07/2014 02:15)" ou "(1997)") — si elle est visible, utilise-la en priorité car c'est l'élément le plus fiable du document
- Le lieu de naissance, juste avant le nom de l'enfant (peut inclure une virgule, ex: "DJIBOUTI, Dar el Hannan"), généralement suivi de "(République de Djibouti)"
- Le nom complet de l'enfant en capitales, parfois écrit avec des espaces entre chaque lettre pour le centrer (ex: "F A R H A N" qui veut dire "FARHAN") et entouré de pointillés, "=", "*" ou petits carrés de remplissage
- La mention "de sexe MASCULIN" ou "de sexe FEMININ"
- La filiation sous la forme "de [père]" puis "et de [mère]" — ces champs peuvent être vides, ou contenir des informations supplémentaires comme la date et le lieu de naissance du parent (ex: "et de SAADA HASSAN WADOR NEE EN 1978 A HARAR / ETHIOPIE" — dans ce cas le nom de la mère est "SAADA HASSAN WADOR", recopie le texte complet de cette ligne tel quel)
- Un registre avec Série / Année / Région / Numéro, et plus bas une certification administrative (non pertinents pour cette tâche)

Analyse l'image et réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, sans balises markdown, contenant exactement ces 5 clés :
{
  "nom_complet": "le nom complet de l'enfant, lettres recollées si elles étaient espacées, ou chaîne vide si illisible",
  "mere_nom": "le texte complet trouvé après 'et de', ou chaîne vide si le champ est vide sur le document",
  "sexe": "M ou F uniquement",
  "lieu_naissance": "le lieu de naissance tel qu'écrit, ou chaîne vide si illisible",
  "date_naissance": "au format JJ/MM/AAAA si jour+mois+année connus, ou juste AAAA si seule l'année est mentionnée, ou chaîne vide si illisible"
}

Si un champ est vide ou illisible sur le document, mets une chaîne vide "" — n'invente jamais de valeur.`;

/* ---------- Claude API OCR ---------- */
async function runClaudeOcr(imageDataUrl, apiKey){
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if(!match) throw new Error('Format image invalide');
  const mediaType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const base64Data = match[2];

  let response;
  try{
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type:'image', source: { type:'base64', media_type: mediaType, data: base64Data } },
            { type:'text', text: OCR_PROMPT }
          ]
        }]
      })
    });
  } catch(networkErr){
    // fetch lève une TypeError générique en cas de coupure réseau, pas de réponse HTTP
    throw new Error('Connexion impossible — vérifie ta connexion internet, ou utilise le mode OCR local (offline).');
  }

  if(!response.ok){
    const errBody = await response.text();
    if(response.status === 401){
      throw new Error('Clé API invalide ou expirée — vérifie-la sur console.anthropic.com.');
    }
    if(response.status === 429){
      throw new Error('Trop de requêtes envoyées — attends quelques secondes et réessaie.');
    }
    throw new Error('API ' + response.status + ' — ' + errBody.slice(0,150));
  }

  const data = await response.json();
  const textBlocks = (data.content || []).filter(b=>b.type==='text').map(b=>b.text);
  const rawText = textBlocks.join('\n');
  const fields = parseOcrJsonResponse(rawText);
  if(!fields){
    throw new Error('Claude n\'a pas renvoyé un JSON valide — réessaie, ou vérifie le texte brut.');
  }
  return { fields, rawText };
}

/* ---------- Mistral API OCR ----------
   Tier gratuit "Experiment" généreux, format de message simple : l'image en
   base64 se passe directement comme string dans image_url (pas d'objet imbriqué
   comme chez Anthropic). On utilise pixtral-large-latest, le modèle vision
   le plus capable de la gamme Mistral.                                       */
async function runMistralOcr(imageDataUrl, apiKey){
  let response;
  try{
    response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'pixtral-large-latest',
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type:'text', text: OCR_PROMPT },
            { type:'image_url', image_url: imageDataUrl }
          ]
        }]
      })
    });
  } catch(networkErr){
    throw new Error('Connexion impossible — vérifie ta connexion internet, ou utilise le mode OCR local (offline).');
  }

  if(!response.ok){
    const errBody = await response.text();
    if(response.status === 401){
      throw new Error('Clé API Mistral invalide ou expirée — vérifie-la sur console.mistral.ai.');
    }
    if(response.status === 429){
      throw new Error('Trop de requêtes envoyées — attends quelques secondes et réessaie.');
    }
    throw new Error('API ' + response.status + ' — ' + errBody.slice(0,150));
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  const fields = parseOcrJsonResponse(rawText);
  if(!fields){
    throw new Error('Mistral n\'a pas renvoyé un JSON valide — réessaie, ou vérifie le texte brut.');
  }
  return { fields, rawText };
}

/* ---------- GLM (Z.ai) API OCR ----------
   Format compatible OpenAI. Nécessite un modèle GLM-V (vision) sur le compte —
   les modèles texte gratuits (GLM-4.5-Flash etc.) ne lisent pas les images.  */
async function runGlmOcr(imageDataUrl, apiKey){
  let response;
  try{
    response = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'glm-4.5v',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type:'text', text: OCR_PROMPT },
            { type:'image_url', image_url: { url: imageDataUrl } }
          ]
        }]
      })
    });
  } catch(networkErr){
    throw new Error('Connexion impossible — vérifie ta connexion internet, ou utilise le mode OCR local (offline).');
  }

  if(!response.ok){
    const errBody = await response.text();
    if(response.status === 401){
      throw new Error('Clé API GLM invalide, expirée, ou sans accès à un modèle vision — vérifie sur z.ai.');
    }
    if(response.status === 429){
      throw new Error('Trop de requêtes envoyées — attends quelques secondes et réessaie.');
    }
    throw new Error('API ' + response.status + ' — ' + errBody.slice(0,150));
  }

  const data = await response.json();
  let rawText = data.choices?.[0]?.message?.content || '';
  // GLM-V peut entourer sa réponse de balises de raisonnement <think>...</think> ;
  // on les retire pour ne garder que le JSON attendu.
  rawText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fields = parseOcrJsonResponse(rawText);
  if(!fields){
    throw new Error('GLM n\'a pas renvoyé un JSON valide — réessaie, ou vérifie le texte brut.');
  }
  return { fields, rawText };
}

/* ---------- Conversion nombres écrits en lettres (français) -> chiffres ----------
   Nécessaire car les actes djiboutiens écrivent la date en toutes lettres, avec
   plusieurs variantes rencontrées en pratique :
   "VINGT-SIX AOUT DEUX MILLE DEUX"          -> 26/08/2002
   "VINGT OCTOBRE MIL NEUF CENT QUATRE VINGT QUINZE" -> 20/10/1995
   "PREMIER JUILLET DEUX MILLE QUATORZE"     -> 01/07/2014
   "L'AN MIL NEUF CENT QUATRE-VINGT-DIX-SEPT" -> 1997 (année seule)          */
const FR_UNITS = {
  'zero':0,'un':1,'une':1,'premier':1,'première':1,'deux':2,'trois':3,'quatre':4,'cinq':5,'six':6,'sept':7,'huit':8,'neuf':9,
  'dix':10,'onze':11,'douze':12,'treize':13,'quatorze':14,'quinze':15,'seize':16,
  'dix-sept':17,'dix-huit':18,'dix-neuf':19,
  'vingt':20,'trente':30,'quarante':40,'cinquante':50,'soixante':60,
  'quatre-vingt':80,'quatre-vingts':80,'quatrevingt':80
};
const FR_MONTHS = {
  'janvier':1,'février':2,'fevrier':2,'mars':3,'avril':4,'mai':5,'juin':6,
  'juillet':7,'aout':8,'août':8,'septembre':9,'octobre':10,'novembre':11,'décembre':12,'decembre':12
};

function frWordsToNumber(phrase){
  if(!phrase) return null;
  let p = phrase.toLowerCase().trim()
    .replace(/[’']/g,'-').replace(/\s+et\s+/g,'-').replace(/\s+/g,'-')
    .replace(/-+/g,'-').replace(/^-|-$/g,'');
  if(/^\d+$/.test(p)) return parseInt(p,10);
  // "mil" est une variante orthographique de "mille" utilisée pour les années
  // (ex: "mil neuf cent..."). On la normalise avant tout découpage.
  p = p.replace(/\bmil\b/g, 'mille');

  // "mille" handling (years like deux-mille-deux, mille-neuf-cent-...)
  if(p.includes('mille')){
    const parts = p.split('mille');
    const before = parts[0].replace(/-$/,'');
    const after = (parts[1]||'').replace(/^-/,'');
    const beforeVal = before ? (frWordsToNumber(before) || 1) : 1;
    const afterVal = after ? (frWordsToNumber(after) || 0) : 0;
    return beforeVal*1000 + afterVal;
  }
  if(p.includes('cent')){
    const parts = p.split('cent');
    const before = parts[0].replace(/-$/,'');
    const after = (parts[1]||'').replace(/^-/,'');
    const beforeVal = before ? (frWordsToNumber(before) || 1) : 1;
    const afterVal = after ? (frWordsToNumber(after) || 0) : 0;
    return beforeVal*100 + afterVal;
  }

  const tokens = p.split('-').filter(Boolean);
  let total = 0, i = 0;
  while(i < tokens.length){
    // "quatre-vingt(s)" doit être reconnu comme bloc de 80 avant toute autre règle,
    // potentiellement suivi d'une unité (quatre-vingt-quinze = 80+15, quatre-vingt-dix-sept = 80+17)
    if(tokens[i] === 'quatre' && tokens[i+1] && tokens[i+1].startsWith('vingt')){
      let val = 80;
      let consumed = 2;
      // après "quatre-vingt", il peut rester jusqu'à 2 tokens d'unité (dix-sept, etc.)
      const rest3 = tokens[i+2] ? (tokens[i+2] + '-' + (tokens[i+3]||'')) : '';
      const rest2 = tokens[i+2] || '';
      if(rest3 && FR_UNITS[rest3] !== undefined){
        val += FR_UNITS[rest3]; consumed += 2;
      } else if(rest2 && FR_UNITS[rest2] !== undefined){
        val += FR_UNITS[rest2]; consumed += 1;
      }
      total += val; i += consumed; continue;
    }
    // combos à deux mots déjà connus (dix-sept, dix-huit, dix-neuf)
    const two = tokens[i] + '-' + (tokens[i+1]||'');
    if(FR_UNITS[two] !== undefined){ total += FR_UNITS[two]; i += 2; continue; }
    const one = tokens[i];
    if(FR_UNITS[one] !== undefined){
      let val = FR_UNITS[one];
      // vingt/trente.. followed by a unit: vingt-six = 20+6
      if(val >= 20 && val % 10 === 0 && tokens[i+1] && FR_UNITS[tokens[i+1]] !== undefined && FR_UNITS[tokens[i+1]] < 20){
        val += FR_UNITS[tokens[i+1]];
        i += 2;
      } else {
        i += 1;
      }
      total += val;
      continue;
    }
    i += 1; // skip unknown token
  }
  return total || null;
}

function parseWrittenDate(text){
  // Cherche un motif "LE <jour en lettres> <mois> DEUX MILLE ... " ou variations
  // (gère aussi "MIL NEUF CENT QUATRE-VINGT-...", "PREMIER", etc.)
  // Le groupe année doit pouvoir capturer plusieurs mots, donc l'espace fait
  // partie de l'alternance répétée, et on s'arrête avant "A"/"À" (heure) ou la fin de ligne.
  const yearWord = '(?:deux|mille|mil|cent|et|vingt|trente|quarante|cinquante|soixante|quatre-vingts?|premi[èe]re?|un|une|neuf|huit|sept|six|cinq|quatre|trois|dix-sept|dix-huit|dix-neuf|dix|onze|douze|treize|quatorze|quinze|seize)';
  const re = new RegExp(
    '\\b((?:[a-zéû]+-?){1,4})\\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\\s+((?:' + yearWord + '[\\s-]*){1,8})(?=\\bA\\b|\\bÀ\\b|\\.|,|\\|)',
    'i'
  );
  const m = text.match(re);
  if(!m) return '';
  const day = frWordsToNumber(m[1]);
  const monthKey = m[2].toLowerCase().replace('û','u').replace('é','e');
  const month = FR_MONTHS[monthKey] || FR_MONTHS[m[2].toLowerCase()];
  const year = frWordsToNumber(m[3].trim());
  if(!day || !month || !year) return '';
  return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
}

function parseYearOnly(text){
  // Cas "L'AN MIL NEUF CENT QUATRE-VINGT-DIX-SEPT (1997)" : pas de jour/mois,
  // juste une année en lettres, souvent suivie de l'année en chiffres entre parenthèses.
  // On privilégie la version en chiffres entre parenthèses quand elle existe (plus fiable).
  const parenMatch = text.match(/\(\s*(\d{4})\s*\)/);
  if(parenMatch) return parenMatch[1];

  const yearWord = '(?:deux|mille|mil|cent|et|vingt|trente|quarante|cinquante|soixante|quatre-vingts?|un|une|neuf|huit|sept|six|cinq|quatre|trois|dix-sept|dix-huit|dix-neuf|dix|onze|douze|treize|quatorze|quinze|seize)';
  const re = new RegExp("l['’]an\\s+((?:" + yearWord + "[\\s-]*){2,8})", 'i');
  const m = text.match(re);
  if(!m) return '';
  const year = frWordsToNumber(m[1].trim());
  return year ? String(year) : '';
}

function parseNumericDateHint(text){
  // Plusieurs actes impriment aussi la date/heure en chiffres entre parenthèses
  // juste après la date en lettres, ex: "(01/07/2014 02:15)" ou "(08/08/2005 14:00)".
  // C'est la source la plus fiable quand elle est présente : on la retourne en priorité.
  const m = text.match(/\((\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*(\d{1,2})[h:\.](\d{2})\)/);
  if(!m) return null;
  return {
    date: `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}`,
    time: `${m[4].padStart(2,'0')}h${m[5]}`
  };
}

/* ---------- Parsing du texte OCR en champs structurés ---------- */
function parseActeFields(rawText){
  const text = rawText.replace(/\r/g,'');
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  const flat = lines.join(' | ');
  const flatNoLines = lines.join(' ').replace(/\s+/g,' ');

  const fields = {};
  for(const id of FIELD_IDS) fields[id] = '';

  const grab = (regex, source = flat)=>{
    const m = source.match(regex);
    return m ? m[1].trim().replace(/[|:.,=_\-]+$/,'').replace(/^[|:.,=_\-]+/,'').trim() : '';
  };

  // Date de naissance : on essaie plusieurs stratégies par ordre de fiabilité
  // 1) Indice numérique imprimé entre parenthèses (ex: "(01/07/2014 02:15)") si présent
  // 2) Date complète écrite en toutes lettres (jour + mois + année)
  // 3) Année seule écrite en lettres (actes de notoriété suppletifs sans jour/mois)
  const numericHint = parseNumericDateHint(flatNoLines);
  if(numericHint){
    fields.date_naissance = numericHint.date;
  } else {
    fields.date_naissance = parseWrittenDate(flatNoLines);
    if(!fields.date_naissance){
      const yearOnly = parseYearOnly(flatNoLines);
      if(yearOnly) fields.date_naissance = yearOnly;
    }
  }

  // Lieu de naissance : "est né(e) à XXXX (République de Djibouti)". Le nom de
  // ville peut être suivi de séparateurs de remplissage (=== ou ...) avant la
  // parenthèse ou le saut de ligne suivant, qu'on tolère et qu'on retire.
  fields.lieu_naissance = grab(/est\s+n[ée]\s*\(?e?\)?\s+[àa]\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ\/',\- ]{2,60}?)\s*[=.]*\s*(?:\(|\||$)/im);
  // Filet de sécurité : si la formule "est né(e) à" n'a pas été reconnue telle
  // quelle par l'OCR (formulation différente, mot manquant...), le lieu de
  // naissance se trouve presque toujours juste avant la mention
  // "(République de Djibouti)" — une position bien plus stable que le texte
  // d'introduction exact.
  if(!fields.lieu_naissance){
    fields.lieu_naissance = grab(/([A-ZÀ-Ü][A-Za-zÀ-ÿ\/',\- ]{2,60}?)\s*[=.|]*\s*\(\s*R[ée]publique\s+de\s+Djibouti\s*\)/i);
  }

  // Nom complet de l'enfant : c'est la ligne en capitales (le plus souvent
  // 2 à 5 mots) qui précède la mention "de sexe", quel que soit ce qui se
  // trouve entre les deux (rien, un seul "===", ou une ligne de pointillés
  // séparée). On cherche donc dans le texte original ligne par ligne, en
  // remontant depuis la ligne contenant "de sexe" jusqu'à trouver la première
  // ligne (ou portion de ligne) entièrement en capitales.
  // Les bordures de remplissage observées sur les vrais actes varient beaucoup :
  // "=", ".", "*", "▪", "■", "·", ou simplement des espaces — toutes sont tolérées.
  const FILL_CHARS = '\\s=.|*▪■·•_-';
  let fullNameMatch = null;
  const sexeLineIdx = lines.findIndex(l => /de sexe/i.test(l));
  if(sexeLineIdx > 0){
    for(let i = sexeLineIdx; i >= Math.max(0, sexeLineIdx - 3); i--){
      // Sur la ligne contenant "de sexe" elle-même, le nom peut être collé juste avant
      // (ex: "ALI ABDOUL-WAHAB SAID de sexe MASCULIN") : on isole la partie avant "de sexe".
      let candidate = i === sexeLineIdx ? lines[i].replace(/de sexe.*/i, '') : lines[i];

      // Cas particulier : certains actes tapent le nom lettre par lettre espacée
      // (ex: "F A R H A N") pour le centrer visuellement sur la ligne. On détecte
      // ce motif (plusieurs lettres isolées séparées par des espaces, entourées de
      // remplissage) et on recolle les lettres en un seul mot avant de continuer.
      const spacedLettersMatch = candidate.match(/(?:^|[\s=.*▪■·•_-])((?:[A-ZÀ-Ü]\s+){2,}[A-ZÀ-Ü])(?=[\s=.*▪■·•_-]|$)/);
      if(spacedLettersMatch){
        const rejoined = spacedLettersMatch[1].replace(/\s+/g, '');
        candidate = candidate.replace(spacedLettersMatch[1], rejoined);
      }

      const re = new RegExp('^[' + FILL_CHARS + ']*([A-ZÀ-Ü][A-ZÀ-Ü\\-\']{1,}(?:\\s[A-ZÀ-Ü][A-ZÀ-Ü\\-\']{1,}){0,4})[' + FILL_CHARS + ']*$');
      const m = candidate.match(re);
      if(m){ fullNameMatch = m; break; }
    }
  }
  // Filet de sécurité : ancienne heuristique basée sur les séparateurs "|" du flat,
  // utile si le découpage en lignes n'a pas isolé le nom correctement.
  if(!fullNameMatch){
    fullNameMatch = flat.match(/\)\s*\|\s*([A-ZÀ-Ü][A-ZÀ-Ü\- ]{4,60})\s*\|/)
      || flat.match(/([A-ZÀ-Ü]{2,}(?:\s[A-ZÀ-Ü]{2,}){1,4})\s*\|[\s=]*\|?\s*de sexe/i);
  }
  fields.nom_complet = fullNameMatch ? fullNameMatch[1].trim().replace(/\s+/g,' ') : '';

  // Sexe
  const sexeRaw = grab(/de sexe\s*[:\-]?\s*(masculin|f[ée]minin)/i);
  if(sexeRaw) fields.sexe = /^m/i.test(sexeRaw) ? 'M' : 'F';

  // Nom de la mère : "et de [mère]". On exclut explicitement "sexe" car la ligne
  // "de sexe MASCULIN/FEMININ" pourrait sinon être capturée par erreur. Le jeu de
  // caractères inclut chiffres et "/" car certains actes ajoutent la date et le
  // lieu de naissance de la mère directement dans ce champ (ex: "NEE EN 1978 A HARAR / ETHIOPIE").
  fields.mere_nom = grab(/et\s+de\s+(?!sexe\b)([A-ZÀ-Ü][A-ZÀ-Ü0-9À-ÿ\/\-., ]{4,80}?)\s*(?:\||={2,}|$)/im);

  return fields;
}

/* ---------- Form fill / read ---------- */
function fillForm(fields){
  for(const id of FIELD_IDS){
    const el = document.getElementById('f_'+id);
    if(el) el.value = fields[id] || '';
  }
}

function readForm(){
  const fields = {};
  for(const id of FIELD_IDS){
    const el = document.getElementById('f_'+id);
    fields[id] = el ? el.value.trim() : '';
  }
  return fields;
}

document.getElementById('toggleRawText').addEventListener('click', ()=>{
  const box = document.getElementById('rawTextBox');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});

/* ---------- Save record ---------- */
document.getElementById('saveRecordBtn').addEventListener('click', async ()=>{
  const fields = readForm();
  if(!fields.nom_complet){
    toast('Renseigne au moins le nom complet', 'error');
    return;
  }
  const record = {
    ...fields,
    rawText: currentRawText,
    imageThumb: currentImageDataUrl,
    ocrMode: currentOcrMode,
    createdAt: Date.now()
  };
  try{
    await dbAdd(record);
    toast('Fiche enregistrée ✓', 'success');
    resetScanFlow();
    switchView('list');
  }catch(e){
    console.error(e);
    toast('Erreur lors de l\'enregistrement', 'error');
  }
});

function resetScanFlow(){
  currentImageDataUrl = null;
  currentRawText = '';
  fileInputCamera.value = '';
  fileInputGallery.value = '';
  previewWrap.style.display = 'none';
  captureZoneWrap.style.display = 'block';
  ocrModeCard.style.display = 'none';
  formCard.style.display = 'none';
  for(const id of FIELD_IDS){
    const el = document.getElementById('f_'+id);
    if(el) el.value = '';
  }
  document.getElementById('rawTextBox').style.display = 'none';
}

/* ---------- List view ---------- */
let allRecordsCache = [];

async function refreshList(){
  allRecordsCache = await dbGetAll();
  document.getElementById('statTotal').textContent = allRecordsCache.length;

  const now = new Date();
  const thisMonth = allRecordsCache.filter(r=>{
    const d = new Date(r.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  document.getElementById('statMonth').textContent = thisMonth;

  const headerCount = document.getElementById('headerCount');
  headerCount.textContent = allRecordsCache.length + ' fiche' + (allRecordsCache.length===1?'':'s');

  renderRecordsList(document.getElementById('searchInput').value);
}

function renderRecordsList(searchTerm){
  const listEl = document.getElementById('recordsList');
  const emptyEl = document.getElementById('emptyState');
  const noResultsEl = document.getElementById('noResultsState');

  if(allRecordsCache.length === 0){
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    noResultsEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';

  const term = (searchTerm || '').trim().toLowerCase();
  const records = term
    ? allRecordsCache.filter(r=>{
        const haystack = [r.nom_complet, r.lieu_naissance, r.mere_nom]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(term);
      })
    : allRecordsCache;

  if(records.length === 0){
    listEl.innerHTML = '';
    noResultsEl.style.display = 'block';
    return;
  }
  noResultsEl.style.display = 'none';

  listEl.innerHTML = records.map(r=>{
    const name = r.nom_complet || 'Sans nom';
    const meta = [r.date_naissance, r.lieu_naissance].filter(Boolean).join(' · ') || 'Détails non renseignés';
    const dateAdded = new Date(r.createdAt).toLocaleDateString('fr-FR');
    return `
      <div class="record-item" data-id="${r.id}">
        <div class="ri-main">
          <div class="ri-name">${escapeHtml(name)}</div>
          <div class="ri-meta">${escapeHtml(meta)} · ajouté le ${dateAdded}</div>
        </div>
        <div class="record-actions">
          <button class="icon-btn edit-btn" data-id="${r.id}" title="Modifier">✎</button>
          <button class="icon-btn danger del-btn" data-id="${r.id}" title="Supprimer">🗑</button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.del-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      if(confirm('Supprimer cette fiche ?')){
        await dbDelete(id);
        refreshList();
        toast('Fiche supprimée');
      }
    });
  });

  listEl.querySelectorAll('.edit-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.dataset.id);
      const record = allRecordsCache.find(r=>r.id === id);
      if(record) openEditModal(record);
    });
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Edit modal ---------- */
function openEditModal(record){
  editingRecordId = record.id;
  const container = document.getElementById('editModalFields');
  container.innerHTML = FIELD_IDS.map(id=>`
    <div class="field full">
      <label>${FIELD_LABELS[id]}</label>
      <input type="text" id="edit_${id}" value="${escapeHtml(record[id]||'')}">
    </div>
  `).join('');
  document.getElementById('editModalOverlay').classList.add('show');
}

document.getElementById('editModalCancel').addEventListener('click', ()=>{
  document.getElementById('editModalOverlay').classList.remove('show');
  editingRecordId = null;
});

document.getElementById('editModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'editModalOverlay'){
    document.getElementById('editModalOverlay').classList.remove('show');
    editingRecordId = null;
  }
});

document.getElementById('editModalSave').addEventListener('click', async ()=>{
  if(editingRecordId == null) return;
  const records = await dbGetAll();
  const record = records.find(r=>r.id === editingRecordId);
  if(!record) return;
  for(const id of FIELD_IDS){
    const el = document.getElementById('edit_'+id);
    if(el) record[id] = el.value.trim();
  }
  await dbPut(record);
  document.getElementById('editModalOverlay').classList.remove('show');
  editingRecordId = null;
  refreshList();
  toast('Fiche mise à jour', 'success');
});

/* ---------- Export Excel ---------- */
document.getElementById('exportBtn').addEventListener('click', async ()=>{
  const records = await dbGetAll();
  if(records.length === 0){ toast('Aucune fiche à exporter', 'error'); return; }

  const headers = [
    'Nom complet','Nom de la mère','Sexe','Lieu de naissance','Date de naissance',"Date d'ajout"
  ];

  const rows = records.map(r=>[
    r.nom_complet, r.mere_nom, r.sexe, r.lieu_naissance, r.date_naissance,
    new Date(r.createdAt).toLocaleDateString('fr-FR')
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = headers.map((h,i)=>({ wch: Math.max(14, h.length + 2, ...rows.map(row=> (String(row[i]||'').length))) }));

  const range = XLSX.utils.decode_range(ws['!ref']);
  for(let c = range.s.c; c <= range.e.c; c++){
    const cellRef = XLSX.utils.encode_cell({r:0, c});
    if(ws[cellRef]){
      ws[cellRef].s = { font:{ bold:true, color:{rgb:'FFFFFF'} }, fill:{ fgColor:{rgb:'1F2937'} } };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Actes de naissance');

  const filename = `actes_naissance_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast('Fichier Excel téléchargé ✓', 'success');
});

document.getElementById('exportJsonBtn').addEventListener('click', async ()=>{
  const records = await dbGetAll();
  if(records.length === 0){ toast('Aucune fiche à exporter', 'error'); return; }
  const cleaned = records.map(r=>{ const c = {...r}; delete c.imageThumb; return c; });
  const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `actes_naissance_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Sauvegarde JSON téléchargée', 'success');
});

/* ---------- Service worker registration ---------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(err=>console.warn('SW registration failed', err));
  });
}

/* ---------- Recherche dans la liste ---------- */
document.getElementById('searchInput').addEventListener('input', (e)=>{
  renderRecordsList(e.target.value);
});

/* ---------- Init ---------- */
openDb().then(()=> refreshList()).catch(err=> console.error('DB init error', err));
