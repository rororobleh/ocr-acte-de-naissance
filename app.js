/* =========================================================
   Actes de Naissance OCR — logique application
   ========================================================= */

const DB_NAME = 'actes_naissance_db';
const DB_VERSION = 1;
const STORE_NAME = 'actes';
let db = null;

const FIELD_IDS = [
  'nom','prenom','sexe','date_naissance','heure_naissance','lieu_naissance',
  'pere_nom','mere_nom',
  'serie','annee_registre','region_registre','numero_registre',
  'conseil_regional','centre_etat_civil','officier_etat_civil',
  'lieu_delivrance','date_delivrance','remarques'
];

const FIELD_LABELS = {
  nom:'Nom de famille', prenom:'Prénom(s)', sexe:'Sexe',
  date_naissance:'Date de naissance', heure_naissance:'Heure de naissance', lieu_naissance:'Lieu de naissance',
  pere_nom:'Nom et prénom du père', mere_nom:'Nom et prénom de la mère',
  serie:'Série', annee_registre:'Année', region_registre:'Région', numero_registre:'Numéro',
  conseil_regional:'Conseil régional', centre_etat_civil:"Centre d'état civil", officier_etat_civil:"Officier d'état civil",
  lieu_delivrance:'Lieu de délivrance', date_delivrance:'Date de délivrance', remarques:'Mentions marginales'
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
    let text = '';
    if(currentOcrMode === 'tesseract'){
      text = await runTesseractOcr(currentImageDataUrl, (p, label)=>{
        progressFill.style.width = Math.max(5, p) + '%';
        progressLabel.textContent = label;
      });
    } else {
      const provider = OCR_PROVIDERS[currentOcrMode];
      const apiKey = localStorage.getItem(provider.storageKey) || document.getElementById('apiKeyInput').value.trim();
      if(!apiKey){ toast('Renseigne ta clé API', 'error'); progressZone.style.display='none'; runBtn.disabled=false; return; }

      progressFill.style.width = '40%';
      if(currentOcrMode === 'mistral'){
        progressLabel.textContent = 'Analyse par Mistral en cours…';
        text = await runMistralOcr(currentImageDataUrl, apiKey);
      } else if(currentOcrMode === 'claude'){
        progressLabel.textContent = 'Analyse par Claude en cours…';
        text = await runClaudeOcr(currentImageDataUrl, apiKey);
      } else if(currentOcrMode === 'glm'){
        progressLabel.textContent = 'Analyse par GLM en cours…';
        text = await runGlmOcr(currentImageDataUrl, apiKey);
      }
      progressFill.style.width = '90%';
    }

    currentRawText = text;
    const fields = parseActeFields(text);
    fillForm(fields);

    progressFill.style.width = '100%';
    progressLabel.textContent = 'Terminé';
    setTimeout(()=>{ progressZone.style.display = 'none'; }, 600);

    formCard.style.display = 'block';
    document.getElementById('rawTextBox').textContent = text || '(aucun texte détecté)';
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
const OCR_PROMPT = `Voici la photo d'un document d'état civil de la République de Djibouti : soit un "Extrait d'Acte de Naissance" classique, soit un "Extrait d'Acte de Notoriété Suppletif d'Acte de Naissance" (variante utilisée quand l'acte original est reconstitué).

Le document contient typiquement :
- Un en-tête avec le Conseil Régional (ex: "Conseil Régional d'Obock") et/ou le Centre d'État Civil d'une ville
- Une phrase narrative donnant la date de naissance en toutes lettres, qui peut prendre plusieurs formes :
  - Date complète : "VINGT-SIX AOUT DEUX MILLE DEUX A DIX-SEPT HEURES TRENTE MINUTES"
  - Avec "MIL" au lieu de "MILLE" et "QUATRE-VINGT" pour 80 : "VINGT OCTOBRE MIL NEUF CENT QUATRE VINGT QUINZE A DEUX HEURES QUINZE"
  - Avec "PREMIER" pour le 1er jour du mois : "PREMIER JUILLET DEUX MILLE QUATORZE A DEUX HEURES QUINZE"
  - Année seule (actes suppletifs, sans jour/mois) : "L'AN MIL NEUF CENT QUATRE-VINGT-DIX-SEPT (1997)"
  - IMPORTANT : juste après la date en lettres, il y a très souvent une date numérique entre parenthèses (ex: "(01/07/2014 02:15)" ou "(1997)") — recopie-la EXACTEMENT telle qu'elle apparaît, ne l'omets jamais si elle est visible, c'est l'élément le plus fiable du document
- Le lieu de naissance (peut inclure une virgule, ex: "DJIBOUTI, Dar el Hannan")
- Le nom complet de l'enfant en capitales (parfois un seul prénom si le nom de famille n'est pas renseigné)
- La mention "de sexe MASCULIN/FEMININ"
- La filiation sous la forme "de [père]" puis "et de [mère]" — ces champs peuvent être vides (pointillés uniquement), ou contenir des informations supplémentaires comme la date et le lieu de naissance du parent (ex: "et de SAADA HASSAN WADOR NEE EN 1978 A HARAR / ETHIOPIE")
- Un registre avec Série / Année / Région / Numéro
- Les mentions marginales (peuvent être "NEANT", vides, ou contenir un texte détaillé comme une référence à un autre acte)
- La certification en bas avec le nom de l'officier d'état civil (parfois suivi de "DELEGUE" comme titre plutôt qu'un nom), le lieu et la date de délivrance

Extrait TOUT le texte visible tel qu'il apparaît, ligne par ligne, sans interpréter ni reformuler, en gardant la structure d'origine et en n'omettant aucune date entre parenthèses. Réponds UNIQUEMENT avec le texte brut extrait, rien d'autre, pas de commentaire, pas de markdown.`;

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
  return textBlocks.join('\n');
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
  return data.choices?.[0]?.message?.content || '';
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
  let text = data.choices?.[0]?.message?.content || '';
  // GLM-V peut entourer sa réponse de balises de raisonnement <think>...</think> ;
  // on les retire pour ne garder que le texte extrait du document.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return text;
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

function parseWrittenTime(text){
  // "A DIX-SEPT HEURES TRENTE MINUTES" -> 17:30
  const re = /\b((?:[a-zéû]+-?){1,3})\s+heures?\s*((?:[a-zéû]+-?){0,3})\s*(?:minutes?)?/i;
  const m = text.match(re);
  if(!m) return '';
  const h = frWordsToNumber(m[1]);
  const min = m[2] ? frWordsToNumber(m[2]) : 0;
  if(h === null) return '';
  return `${String(h).padStart(2,'0')}h${String(min||0).padStart(2,'0')}`;
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

  // Date et heure de naissance : on essaie plusieurs stratégies par ordre de fiabilité
  // 1) Indice numérique imprimé entre parenthèses (ex: "(01/07/2014 02:15)") si présent
  // 2) Date complète écrite en toutes lettres (jour + mois + année)
  // 3) Année seule écrite en lettres (actes de notoriété suppletifs sans jour/mois)
  const numericHint = parseNumericDateHint(flatNoLines);
  if(numericHint){
    fields.date_naissance = numericHint.date;
    fields.heure_naissance = numericHint.time;
  } else {
    fields.date_naissance = parseWrittenDate(flatNoLines);
    fields.heure_naissance = parseWrittenTime(flatNoLines);
    if(!fields.date_naissance){
      const yearOnly = parseYearOnly(flatNoLines);
      if(yearOnly) fields.date_naissance = yearOnly;
    }
  }

  // Lieu de naissance : "est né(e) à XXXX (République de Djibouti)"
  fields.lieu_naissance = grab(/est\s+n[ée]\(?e?\)?\s+[àa]\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ\/',\- ]{2,60}?)\s*(?:\(|\|)/i);

  // Nom complet de l'enfant : ligne en capitales, généralement seule, après le lieu de naissance
  // et avant la mention "de sexe"
  let fullNameMatch = flat.match(/\)\s*\|\s*([A-ZÀ-Ü][A-ZÀ-Ü\- ]{4,60})\s*\|/);
  if(!fullNameMatch){
    fullNameMatch = flat.match(/([A-ZÀ-Ü]{2,}(?:\s[A-ZÀ-Ü]{2,}){1,4})\s*\|[\s=]*\|\s*de sexe/i);
  }
  if(fullNameMatch){
    const parts = fullNameMatch[1].trim().split(/\s+/);
    fields.prenom = parts[0] || '';
    fields.nom = parts.slice(1).join(' ') || '';
  }

  // Sexe
  const sexeRaw = grab(/de sexe\s*[:\-]?\s*(masculin|f[ée]minin)/i);
  if(sexeRaw) fields.sexe = /^m/i.test(sexeRaw) ? 'M' : 'F';

  // Filiation : "de XXXX" (père) "et de YYYY" (mère)
  // Filiation : "de XXXX" (père) "et de YYYY" (mère).
  // On exclut explicitement "sexe" car la ligne "de sexe MASCULIN/FEMININ" précède
  // souvent la filiation et pourrait sinon être capturée par erreur.
  fields.pere_nom = grab(/(?:^|\|)\s*de\s+(?!sexe\b)([A-ZÀ-Ü][A-ZÀ-Ü0-9À-ÿ\/\-., ]{4,80}?)\s*(?:\||={2,}|$)/im);
  fields.mere_nom = grab(/et\s+de\s+(?!sexe\b)([A-ZÀ-Ü][A-ZÀ-Ü0-9À-ÿ\/\-., ]{4,80}?)\s*(?:\||={2,}|$)/i);

  // Registre : Série / Année / Région / Numéro
  fields.serie = grab(/s[ée]rie\s*[:\-]?\s*([A-Z0-9]{1,5})/i);
  fields.annee_registre = grab(/ann[ée]e\s*[:\-]?\s*(\d{4})/i) || (flatNoLines.match(/\b(19|20)\d{2}\b/) || [''])[0];
  fields.region_registre = grab(/r[ée]g\.?\s*[:\-]?\s*(\d{1,3})/i);
  // Le numéro de registre doit apparaître après "Année .../Rég. ..." pour éviter de
  // capter par erreur un autre numéro (ex: "ACTE N° 1715" dans les mentions marginales).
  fields.numero_registre = grab(/ann[ée]e[^|]{0,40}\|?\s*num[ée]ro\s*[:\-]?\s*(\d{1,10})/i)
    || grab(/num[ée]ro\s*[:\-]?\s*(\d{1,10})/i);

  // En-tête administratif
  fields.conseil_regional = grab(/conseil\s+r[ée]gional\s+d['’]?\s*(?:e\s+)?([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,30})/i);
  fields.centre_etat_civil = grab(/centre\s+d['’]?\s*[ée]tat\s+civil\s+de\s*\|?\s*([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,30})/i);
  fields.officier_etat_civil = grab(/l['’]officier\s+de\s+l['’]?[ée]tat\s+civil[^|]*?,\s*([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,40})/i)
    || grab(/par\s+nous\s*,?\s*([A-ZÀ-Ü][A-ZÀ-Ü\- ]{4,50})/i);

  // Délivrance
  fields.lieu_delivrance = grab(/\bA\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,30})\s*,?\s*le\s+\d/i);
  fields.date_delivrance = grab(/,\s*le\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);

  // Mentions marginales
  fields.remarques = grab(/mentions?\s+marginales?\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9°\/\-,.'’ ]{2,150}?)\s*(?:\||={2,}|$)/i);

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
  if(!fields.nom && !fields.prenom){
    toast('Renseigne au moins un nom ou prénom', 'error');
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
        const haystack = [r.nom, r.prenom, r.lieu_naissance, r.pere_nom, r.mere_nom]
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
    const name = [r.prenom, r.nom].filter(Boolean).join(' ') || 'Sans nom';
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
    'Nom','Prénom','Sexe','Date de naissance','Heure de naissance','Lieu de naissance',
    'Nom du père','Nom de la mère',
    'Série','Année','Région','Numéro',
    'Conseil régional',"Centre d'état civil","Officier d'état civil",
    'Lieu de délivrance','Date de délivrance','Mentions marginales',"Date d'ajout"
  ];

  const rows = records.map(r=>[
    r.nom, r.prenom, r.sexe, r.date_naissance, r.heure_naissance, r.lieu_naissance,
    r.pere_nom, r.mere_nom,
    r.serie, r.annee_registre, r.region_registre, r.numero_registre,
    r.conseil_regional, r.centre_etat_civil, r.officier_etat_civil,
    r.lieu_delivrance, r.date_delivrance, r.remarques,
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
