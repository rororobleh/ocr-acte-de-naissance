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
let currentOcrMode = 'claude';
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
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.view === name);
  });
  if(name === 'list') refreshList();
}

document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> switchView(btn.dataset.view));
});

/* ---------- Capture photo ---------- */
const fileInput = document.getElementById('fileInput');
const previewWrap = document.getElementById('previewWrap');
const previewImg = document.getElementById('previewImg');
const captureZoneWrap = document.getElementById('captureZoneWrap');
const ocrModeCard = document.getElementById('ocrModeCard');
const formCard = document.getElementById('formCard');

fileInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    currentImageDataUrl = ev.target.result;
    previewImg.src = currentImageDataUrl;
    previewWrap.style.display = 'block';
    captureZoneWrap.style.display = 'none';
    ocrModeCard.style.display = 'block';
    formCard.style.display = 'none';
    const savedKey = localStorage.getItem('anthropic_api_key');
    if(savedKey) document.getElementById('apiKeyInput').value = savedKey;
    window.scrollTo({top: previewWrap.offsetTop - 80, behavior:'smooth'});
  };
  reader.readAsDataURL(file);
});

document.getElementById('clearPreview').addEventListener('click', ()=>{
  currentImageDataUrl = null;
  fileInput.value = '';
  previewWrap.style.display = 'none';
  captureZoneWrap.style.display = 'block';
  ocrModeCard.style.display = 'none';
  formCard.style.display = 'none';
});

/* ---------- OCR mode toggle ---------- */
document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentOcrMode = btn.dataset.mode;
    const apiZone = document.getElementById('apiKeyZone');
    const localWarning = document.getElementById('localModeWarning');
    apiZone.style.display = currentOcrMode === 'claude' ? 'block' : 'none';
    localWarning.style.display = currentOcrMode === 'tesseract' ? 'block' : 'none';
    if(currentOcrMode === 'claude'){
      const saved = localStorage.getItem('anthropic_api_key');
      if(saved) document.getElementById('apiKeyInput').value = saved;
    }
  });
});

document.getElementById('saveKeyBtn').addEventListener('click', ()=>{
  const val = document.getElementById('apiKeyInput').value.trim();
  if(val){
    localStorage.setItem('anthropic_api_key', val);
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
      const apiKey = localStorage.getItem('anthropic_api_key') || document.getElementById('apiKeyInput').value.trim();
      if(!apiKey){ toast('Renseigne ta clé API Anthropic', 'error'); progressZone.style.display='none'; runBtn.disabled=false; return; }
      progressLabel.textContent = 'Analyse par Claude en cours…';
      progressFill.style.width = '40%';
      text = await runClaudeOcr(currentImageDataUrl, apiKey);
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
async function runClaudeOcr(imageDataUrl, apiKey){
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if(!match) throw new Error('Format image invalide');
  const mediaType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const base64Data = match[2];

  const prompt = `Voici la photo d'un "Extrait d'Acte de Naissance" délivré par un Conseil Régional de la République de Djibouti. Le document contient typiquement : un en-tête (Conseil Régional, Centre d'État Civil d'une ville) ; une phrase narrative donnant la date et l'heure de naissance écrites en toutes lettres (ex: "VINGT-SIX AOUT DEUX MILLE DEUX A DIX-SEPT HEURES TRENTE MINUTES") ; le lieu de naissance ; le nom complet de l'enfant en capitales ; la mention "de sexe MASCULIN/FEMININ" ; la filiation sous la forme "de [nom complet du père]" puis "et de [nom complet de la mère]" ; un registre avec Série / Année / Région / Numéro ; les mentions marginales ; et en bas la certification avec le nom de l'officier d'état civil, le lieu et la date de délivrance.

Extrait TOUT le texte visible tel qu'il apparaît, ligne par ligne, sans interpréter ni reformuler, en gardant la structure d'origine. Réponds UNIQUEMENT avec le texte brut extrait, rien d'autre, pas de commentaire, pas de markdown.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
          { type:'text', text: prompt }
        ]
      }]
    })
  });

  if(!response.ok){
    const errBody = await response.text();
    throw new Error('API ' + response.status + ' — vérifie ta clé. ' + errBody.slice(0,150));
  }

  const data = await response.json();
  const textBlocks = (data.content || []).filter(b=>b.type==='text').map(b=>b.text);
  return textBlocks.join('\n');
}

/* ---------- Conversion nombres écrits en lettres (français) -> chiffres ----------
   Nécessaire car les actes djiboutiens écrivent la date en toutes lettres :
   "VINGT-SIX AOUT DEUX MILLE DEUX" -> 26/08/2002                                  */
const FR_UNITS = {
  'zero':0,'un':1,'une':1,'deux':2,'trois':3,'quatre':4,'cinq':5,'six':6,'sept':7,'huit':8,'neuf':9,
  'dix':10,'onze':11,'douze':12,'treize':13,'quatorze':14,'quinze':15,'seize':16,
  'dix-sept':17,'dix-huit':18,'dix-neuf':19,
  'vingt':20,'trente':30,'quarante':40,'cinquante':50,'soixante':60
};
const FR_MONTHS = {
  'janvier':1,'février':2,'fevrier':2,'mars':3,'avril':4,'mai':5,'juin':6,
  'juillet':7,'aout':8,'août':8,'septembre':9,'octobre':10,'novembre':11,'décembre':12,'decembre':12
};

function frWordsToNumber(phrase){
  if(!phrase) return null;
  let p = phrase.toLowerCase().trim()
    .replace(/[’']/g,'-').replace(/\s+et\s+/g,'-').replace(/\s+/g,'-')
    .replace(/-+/g,'-');
  if(/^\d+$/.test(p)) return parseInt(p,10);

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
    // try two-token combos first (dix-sept, dix-huit, dix-neuf already in map as single via join)
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
  // Cherche un motif "LE <jour en lettres> <mois> DEUX MILLE ... " ou variations.
  // Le groupe année doit pouvoir capturer plusieurs mots ("DEUX MILLE DEUX"),
  // donc l'espace fait partie de l'alternance répétée, et on s'arrête avant
  // "A"/"À" (qui introduit l'heure) ou la fin de ligne.
  const re = /\b((?:[a-zéû]+-?){1,4})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+((?:(?:deux|mille|cent|et|vingt|trente|quarante|cinquante|soixante|un|une|une|neuf|huit|sept|six|cinq|quatre|trois|dix|onze|douze|treize|quatorze|quinze|seize)[\s-]*){1,8})(?=\bA\b|\bÀ\b|\.|,|\|)/i;
  const m = text.match(re);
  if(!m) return '';
  const day = frWordsToNumber(m[1]);
  const monthKey = m[2].toLowerCase().replace('û','u').replace('é','e');
  const month = FR_MONTHS[monthKey] || FR_MONTHS[m[2].toLowerCase()];
  const year = frWordsToNumber(m[3].trim());
  if(!day || !month || !year) return '';
  return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
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

  // Date et heure de naissance (écrites en toutes lettres)
  fields.date_naissance = parseWrittenDate(flatNoLines);
  fields.heure_naissance = parseWrittenTime(flatNoLines);

  // Lieu de naissance : "est né(e) à XXXX (République de Djibouti)"
  fields.lieu_naissance = grab(/est\s+n[ée]\(?e?\)?\s+[àa]\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ\/'\- ]{2,60}?)\s*(?:\(|\|)/i);

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
  fields.pere_nom = grab(/(?:^|\|)\s*de\s+(?!sexe\b)([A-ZÀ-Ü][A-ZÀ-Ü\- ]{4,50}?)\s*(?:\||={2,}|$)/im);
  fields.mere_nom = grab(/et\s+de\s+(?!sexe\b)([A-ZÀ-Ü][A-ZÀ-Ü\- ]{4,50}?)\s*(?:\||={2,}|$)/i);

  // Registre : Série / Année / Région / Numéro
  fields.serie = grab(/s[ée]rie\s*[:\-]?\s*([A-Z0-9]{1,5})/i);
  fields.annee_registre = grab(/ann[ée]e\s*[:\-]?\s*(\d{4})/i) || (flatNoLines.match(/\b(19|20)\d{2}\b/) || [''])[0];
  fields.region_registre = grab(/r[ée]g\.?\s*[:\-]?\s*(\d{1,3})/i);
  fields.numero_registre = grab(/num[ée]ro\s*[:\-]?\s*(\d{1,10})/i);

  // En-tête administratif
  fields.conseil_regional = grab(/conseil\s+r[ée]gional\s+d['’]?\s*(?:e\s+)?([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,30})/i);
  fields.centre_etat_civil = grab(/centre\s+d['’]?\s*[ée]tat\s+civil\s+de\s*\|?\s*([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,30})/i);
  fields.officier_etat_civil = grab(/l['’]officier\s+de\s+l['’]?[ée]tat\s+civil[^|]*?,\s*([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,40})/i)
    || grab(/par\s+nous\s*,?\s*([A-ZÀ-Ü][A-ZÀ-Ü\- ]{4,50})/i);

  // Délivrance
  fields.lieu_delivrance = grab(/\bA\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ\- ]{2,30})\s*,?\s*le\s+\d/i);
  fields.date_delivrance = grab(/,\s*le\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);

  // Mentions marginales
  fields.remarques = grab(/mentions?\s+marginales?\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9\- ]{2,40})/i);

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
  fileInput.value = '';
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
async function refreshList(){
  const records = await dbGetAll();
  const listEl = document.getElementById('recordsList');
  const emptyEl = document.getElementById('emptyState');
  const headerCount = document.getElementById('headerCount');

  headerCount.textContent = records.length + ' fiche' + (records.length===1?'':'s');
  document.getElementById('statTotal').textContent = records.length;

  const now = new Date();
  const thisMonth = records.filter(r=>{
    const d = new Date(r.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  document.getElementById('statMonth').textContent = thisMonth;

  if(records.length === 0){
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

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
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      const records = await dbGetAll();
      const record = records.find(r=>r.id === id);
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

/* ---------- Init ---------- */
openDb().then(()=> refreshList()).catch(err=> console.error('DB init error', err));
