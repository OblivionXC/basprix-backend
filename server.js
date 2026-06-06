/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         BAS PRIX – BACKEND SERVER  v2.0                 ║
 * ║         Marketplace du Togo 🇹🇬                         ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Stack : Node.js + Express (sans base de données externe)
 * Données stockées en mémoire (remplacer par MongoDB/PostgreSQL en prod)
 *
 * ENDPOINTS :
 *  AUTH     POST /api/auth/register   POST /api/auth/login
 *  USERS    GET  /api/users           DELETE /api/users/:id  (admin)
 *  PRODUCTS GET  /api/products        POST   /api/products
 *           PUT  /api/products/:id    DELETE /api/products/:id
 *  PAYMENT  POST /api/payment/initiate   POST /api/payment/verify
 *           POST /api/payment/webhook    GET  /api/payment/transactions
 *  INVITE   POST /api/invite/use
 *  PLANS    GET  /api/plans           POST /api/plans/subscribe
 *  DISPUTES GET  /api/disputes        POST /api/disputes
 *           PUT  /api/disputes/:id/resolve
 *  GOZEM    POST /api/gozem/estimate  POST /api/gozem/request
 *  ADMIN    GET  /api/admin/overview  (token admin requis)
 *  MESSAGES GET  /api/messages        POST /api/messages
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const morgan     = require('morgan');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── CONFIGURATION ───────────────────────────────────────────
const CONFIG = {
  JWT_SECRET     : process.env.JWT_SECRET      || 'basprix_secret_togo_2024_CHANGE_IN_PROD',
  JWT_EXPIRES    : '7d',
  ADMIN_EMAIL    : process.env.ADMIN_EMAIL     || 'admin@basprix.tg',
  ADMIN_PASS     : process.env.ADMIN_PASS      || 'Admin@BasPrix2024!',
  ADMIN_ID       : 'admin-001',

  // Clés API paiement (à remplacer par les vraies clés en production)
  FLOOZ_API_URL  : process.env.FLOOZ_API_URL   || 'https://api.flooz.me/v1',
  FLOOZ_API_KEY  : process.env.FLOOZ_API_KEY   || 'FLOOZ_TEST_KEY',
  TMONEY_API_URL : process.env.TMONEY_API_URL  || 'https://api.togocel.tg/tmoney/v1',
  TMONEY_API_KEY : process.env.TMONEY_API_KEY  || 'TMONEY_TEST_KEY',
  WAVE_API_URL   : process.env.WAVE_API_URL    || 'https://api.wave.com/v1',
  WAVE_API_KEY   : process.env.WAVE_API_KEY    || 'WAVE_TEST_KEY',

  // Gozem API
  GOZEM_API_URL  : process.env.GOZEM_API_URL   || 'https://api.gozem.co/v2',
  GOZEM_API_KEY  : process.env.GOZEM_API_KEY   || 'GOZEM_TEST_KEY',

  // App URL (pour redirections paiement)
  APP_URL        : process.env.APP_URL         || 'http://localhost:3001',

  PLANS: {
    free:     { name: 'Gratuit',  prix: 0,    maxArticles: 3,   features: ['3 articles', 'Chat basique'] },
    standard: { name: 'Standard', prix: 2000, maxArticles: 20,  features: ['20 articles', 'Badge vérifié', 'Stats'] },
    premium:  { name: 'Premium',  prix: 5000, maxArticles: 9999, features: ['Illimité', 'Vedette', 'Badge ⭐', 'Priorité'] }
  }
};

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Rate limiting global
app.use(rateLimit({ windowMs: 15*60*1000, max: 200, message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' } }));

// Rate limiting strict pour paiement
const payLimiter = rateLimit({ windowMs: 10*60*1000, max: 10, message: { error: 'Trop de tentatives de paiement.' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Trop de tentatives de connexion.' } });

// ─── BASE DE DONNÉES EN MÉMOIRE ───────────────────────────────
// En production : remplacer par MongoDB/PostgreSQL avec Prisma
const DB = {
  users: [
    {
      id: CONFIG.ADMIN_ID,
      name: 'Administrateur BAS PRIX',
      email: CONFIG.ADMIN_EMAIL,
      password: bcrypt.hashSync(CONFIG.ADMIN_PASS, 10),
      tel: '+228 00 00 00 00',
      ville: 'Lomé',
      plan: 'admin',
      planExpiry: null,
      inviteCode: 'ADMIN',
      invitedBy: null,
      isAdmin: true,
      joinDate: new Date().toISOString(),
      active: true
    }
  ],
  products: [
    { id: 'p1', titre: 'Samsung Galaxy S22', prix: 280000, cat: 'Électronique', etat: 'Occasion', ville: 'Lomé, Adidogomé', desc: 'Très bon état, batterie 87%, chargeur original.', nom: 'Adjoa Koffi', tel: '+228 91 23 45 67', whatsapp: '+228 91 23 45 67', adresse: 'Rue des Cocotiers', userId: null, views: 12, gozem: 'none', createdAt: new Date().toISOString() },
    { id: 'p2', titre: 'Table basse en bois', prix: 45000, cat: 'Mobilier', etat: 'Occasion', ville: 'Lomé, Bè', desc: 'Table 120x60cm bois acajou.', nom: 'Kwame Adzoa', tel: '+228 98 76 54 32', whatsapp: '', adresse: 'Bè Klikamé', userId: null, views: 5, gozem: 'moto', createdAt: new Date().toISOString() },
    { id: 'p3', titre: 'Robe kente traditionnelle', prix: 25000, cat: 'Vêtements', etat: 'Neuf', ville: 'Lomé, Tokoin', desc: 'Robe kente neuve taille M.', nom: 'Ama Sodzi', tel: '+228 70 11 22 33', whatsapp: '+228 70 11 22 33', adresse: 'Marché Tokoin', userId: null, views: 8, gozem: 'none', createdAt: new Date().toISOString() }
  ],
  transactions: [],
  disputes: [
    { id: 'DP001', acheteurId: null, vendeurId: null, acheteurNom: 'Kofi Mensah', vendeurNom: 'Adjoa Koffi', articleTitre: 'Samsung Galaxy S22', montant: 280000, description: "L'acheteur dit que la batterie est à 60% et non 87%.", statut: 'ouvert', decision: null, messages: [{ from: 'Kofi Mensah', txt: "L'article ne correspond pas !", ts: new Date().toISOString() }, { from: 'Adjoa Koffi', txt: "C'était bien 87% à la vente.", ts: new Date().toISOString() }], createdAt: new Date().toISOString() }
  ],
  conversations: [],
  notifications: [],
  pendingPayments: [], // Paiements en attente de confirmation
};

// ─── HELPERS ─────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, isAdmin: user.isAdmin || false }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES });
}

function generateInviteCode() {
  return 'BP-' + Math.random().toString(36).substr(2,6).toUpperCase();
}

function generateTxId() {
  return 'TX' + Date.now().toString().slice(-8) + Math.random().toString(36).substr(2,4).toUpperCase();
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>\"']/g, '').trim().slice(0, 500);
}

function addNotification(userId, title, body, type = 'info') {
  DB.notifications.push({ id: uuidv4(), userId, title, body, type, read: false, createdAt: new Date().toISOString() });
}

// ─── MIDDLEWARE AUTH ──────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], CONFIG.JWT_SECRET);
    req.user = DB.users.find(u => u.id === decoded.id);
    if (!req.user || !req.user.active) return res.status(401).json({ error: 'Utilisateur introuvable ou désactivé' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    next();
  });
}

// ─── PAIEMENT : LOGIQUE CENTRALE ─────────────────────────────
/**
 * Génère l'URL de redirection vers l'opérateur mobile
 * pour confirmer le paiement.
 */
function buildPaymentRedirectUrl(method, amount, phone, txId, planName) {
  const callbackUrl = encodeURIComponent(`${CONFIG.APP_URL}/api/payment/webhook?txId=${txId}`);
  const successUrl  = encodeURIComponent(`${CONFIG.APP_URL}/api/payment/success?txId=${txId}`);
  const failUrl     = encodeURIComponent(`${CONFIG.APP_URL}/api/payment/fail?txId=${txId}`);
  const description = encodeURIComponent(`BAS PRIX - Abonnement ${planName}`);

  switch (method) {
    case 'flooz':
      // Flooz / Moov Money Togo — URL de paiement profond
      return {
        redirectUrl: `https://www.flooz.me/pay?merchant=${CONFIG.FLOOZ_API_KEY}&amount=${amount}&phone=${encodeURIComponent(phone)}&ref=${txId}&description=${description}&callback=${callbackUrl}&success=${successUrl}&fail=${failUrl}`,
        ussd: `*155*1*${amount}*BAS PRIX*${txId}#`,
        instructions: `1. Composez *155*1*${amount}*BAS PRIX*${txId}# \n2. Ou ouvrez l'appli Flooz et payez ${amount} FCFA à BAS PRIX \n3. Référence : ${txId}`
      };

    case 'tmoney':
      // T-Money / Togocel
      return {
        redirectUrl: `https://www.togocel.tg/tmoney/pay?apikey=${CONFIG.TMONEY_API_KEY}&montant=${amount}&telephone=${encodeURIComponent(phone)}&reference=${txId}&motif=${description}&urlretour=${successUrl}`,
        ussd: `*145*2*${amount}*${txId}#`,
        instructions: `1. Composez *145*2*${amount}*${txId}# \n2. Ou ouvrez l'appli T-Money et payez ${amount} FCFA \n3. Référence : ${txId}`
      };

    case 'wave':
      // Wave CI/SN/TG
      return {
        redirectUrl: `https://pay.wave.com/m/basprix_tg?amount=${amount}&currency=XOF&reference=${txId}&phone=${encodeURIComponent(phone)}&success_url=${successUrl}&error_url=${failUrl}`,
        ussd: null,
        instructions: `1. Ouvrez l'appli Wave \n2. Scannez le QR ou payez ${amount} FCFA à "BAS PRIX" \n3. Référence : ${txId}`
      };

    default:
      return { redirectUrl: null, ussd: null, instructions: 'Méthode inconnue' };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES AUTH
// ═══════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, password, tel, ville, inviteCode } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !password || !tel || !ville)
      return res.status(400).json({ error: 'Tous les champs obligatoires sont requis.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe minimum 6 caractères.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Format email invalide.' });
    if (DB.users.find(u => u.email === email.toLowerCase()))
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });

    // Vérifier le code d'invitation
    let plan = 'free';
    let planExpiry = null;
    let inviter = null;

    if (inviteCode && inviteCode.trim() !== '') {
      inviter = DB.users.find(u => u.inviteCode === inviteCode.toUpperCase().trim());
      if (!inviter) return res.status(400).json({ error: 'Code d\'invitation invalide.' });

      // L'invité reçoit 3 mois Premium GRATUITS
      plan = 'premium';
      planExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

      // L'inviteur reçoit 1 mois Standard GRATUIT
      const inviterExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      if (inviter.plan === 'free') { inviter.plan = 'standard'; inviter.planExpiry = inviterExpiry; }
      else {
        // Prolonge son abonnement existant de 30 jours
        const current = inviter.planExpiry ? new Date(inviter.planExpiry) : new Date();
        inviter.planExpiry = new Date(current.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      // Enregistrer la transaction bonus
      DB.transactions.push({
        id: generateTxId(), userId: inviter.id, plan: 'standard_bonus',
        montant: 0, methode: 'invitation', statut: 'success',
        description: `1 mois Standard offert (invitation de ${firstName} ${lastName})`,
        createdAt: new Date().toISOString()
      });

      addNotification(inviter.id, '🎁 Cadeau inviteur !', `${firstName} ${lastName} a rejoint BAS PRIX grâce à votre code ! Vous avez reçu 1 mois Standard offert.`, 'success');
    } else if (!inviteCode || inviteCode.trim() === '') {
      // Essai Premium 3 mois GRATUIT pour tout nouvel inscrit
      plan = 'premium';
      planExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = {
      id: uuidv4(),
      name: `${sanitize(firstName)} ${sanitize(lastName)}`,
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      tel: sanitize(tel),
      ville: sanitize(ville),
      plan,
      planExpiry,
      inviteCode: generateInviteCode(),
      invitedBy: inviter ? inviter.id : null,
      isAdmin: false,
      joinDate: new Date().toISOString(),
      active: true,
      invitesCount: 0
    };

    DB.users.push(newUser);

    // Notif de bienvenue
    addNotification(newUser.id, '🇹🇬 Bienvenue sur BAS PRIX !',
      plan === 'premium' ? '3 mois Premium GRATUITS activés ! Publiez vos articles dès maintenant.' : 'Votre compte a été créé avec succès.',
      'welcome');

    const token = generateToken(newUser);
    const { password: _, ...safeUser } = newUser;
    res.status(201).json({ message: 'Compte créé avec succès', token, user: safeUser, trialInfo: plan === 'premium' ? '3 mois Premium offerts !' : null });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Erreur serveur lors de la création du compte.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

    const user = DB.users.find(u => u.email === email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    if (!user.active) return res.status(403).json({ error: 'Compte désactivé. Contactez l\'administrateur.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    // Vérifier expiration du plan
    if (user.planExpiry && new Date(user.planExpiry) < new Date() && user.plan !== 'admin') {
      user.plan = 'free';
      user.planExpiry = null;
    }

    const token = generateToken(user);
    const { password: _, ...safeUser } = user;
    res.json({ message: 'Connexion réussie', token, user: safeUser });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const { password: _, ...safeUser } = req.user;
  res.json(safeUser);
});

// ═══════════════════════════════════════════════════════════════
// ROUTES PAIEMENT — SYSTÈME COMPLET
// ═══════════════════════════════════════════════════════════════

// POST /api/payment/initiate — Initier un paiement
app.post('/api/payment/initiate', payLimiter, authMiddleware, async (req, res) => {
  try {
    const { plan, method, phone } = req.body;

    // Validation
    if (!plan || !method || !phone)
      return res.status(400).json({ error: 'Plan, méthode et numéro de téléphone requis.' });
    if (!['flooz','tmoney','wave'].includes(method))
      return res.status(400).json({ error: 'Méthode de paiement invalide. Utilisez: flooz, tmoney, wave' });
    if (!['standard','premium'].includes(plan))
      return res.status(400).json({ error: 'Plan invalide. Choisissez: standard ou premium' });

    // Validation numéro de téléphone Togo
    const cleanPhone = phone.replace(/\s+/g, '').replace(/^\+228/, '228');
    if (!/^(228)?[0-9]{8}$/.test(cleanPhone))
      return res.status(400).json({ error: 'Numéro de téléphone invalide. Format : +228 XX XX XX XX' });

    const planInfo = CONFIG.PLANS[plan];
    const txId = generateTxId();
    const amount = planInfo.prix;

    // Construire les URLs de redirection opérateur
    const paymentInfo = buildPaymentRedirectUrl(method, amount, phone, txId, planInfo.name);

    // Créer la transaction en attente
    const pendingTx = {
      id: txId,
      userId: req.user.id,
      userEmail: req.user.email,
      userName: req.user.name,
      plan,
      montant: amount,
      methode: method,
      phone: cleanPhone,
      statut: 'pending',
      description: `Abonnement ${planInfo.name} - BAS PRIX`,
      redirectUrl: paymentInfo.redirectUrl,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // expire dans 30 min
    };

    DB.pendingPayments.push(pendingTx);
    DB.transactions.push({ ...pendingTx });

    // Notification
    addNotification(req.user.id, '💳 Paiement initié', `Transaction ${txId} créée pour ${amount.toLocaleString()} FCFA via ${method.toUpperCase()}. Confirmez sur votre téléphone.`, 'payment');

    res.json({
      success: true,
      txId,
      montant: amount,
      plan: planInfo.name,
      methode: method,
      redirectUrl: paymentInfo.redirectUrl,
      ussd: paymentInfo.ussd,
      instructions: paymentInfo.instructions,
      message: `Paiement initié ! Suivez les instructions pour confirmer sur ${method.toUpperCase()}.`,
      expiresAt: pendingTx.expiresAt
    });
  } catch (e) {
    console.error('Payment initiate error:', e);
    res.status(500).json({ error: 'Erreur lors de l\'initiation du paiement.' });
  }
});

// POST /api/payment/webhook — Callback opérateur (appelé par Flooz/T-Money/Wave)
app.post('/api/payment/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const txId = req.query.txId;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    console.log(`[WEBHOOK] txId=${txId}`, body);

    const txIdx = DB.transactions.findIndex(t => t.id === txId);
    const pendingIdx = DB.pendingPayments.findIndex(t => t.id === txId);

    if (txIdx === -1) return res.status(404).json({ error: 'Transaction introuvable' });

    const tx = DB.transactions[txIdx];

    // Vérifier la signature (en prod : valider HMAC avec la clé secrète opérateur)
    // const signature = req.headers['x-signature'] || req.headers['x-flooz-signature'];
    // if (!verifySignature(body, signature, CONFIG.FLOOZ_WEBHOOK_SECRET)) return res.status(401).json({ error: 'Signature invalide' });

    // Statut reçu de l'opérateur
    const status = body.status || body.transaction_status || body.state || 'success'; // 'success' | 'failed' | 'cancelled'
    const operatorRef = body.reference || body.operator_ref || body.wave_ref || txId;

    if (status === 'success' || status === 'SUCCESS' || status === 'SUCCESSFUL') {
      // ✅ Paiement confirmé
      tx.statut = 'success';
      tx.operatorRef = operatorRef;
      tx.confirmedAt = new Date().toISOString();

      // Activer le plan
      const user = DB.users.find(u => u.id === tx.userId);
      if (user) {
        const duration = tx.plan === 'premium' ? 30 : 30; // 30 jours par paiement
        const currentExpiry = user.planExpiry && new Date(user.planExpiry) > new Date() ? new Date(user.planExpiry) : new Date();
        user.plan = tx.plan;
        user.planExpiry = new Date(currentExpiry.getTime() + duration * 24 * 60 * 60 * 1000).toISOString();

        addNotification(user.id, '✅ Paiement confirmé !', `Abonnement ${tx.plan} activé jusqu'au ${new Date(user.planExpiry).toLocaleDateString('fr-FR')}. Réf: ${txId}`, 'success');
      }
    } else {
      // ❌ Paiement échoué
      tx.statut = 'failed';
      tx.failedAt = new Date().toISOString();
      tx.failReason = body.reason || body.message || 'Paiement refusé par l\'opérateur';
      const user = DB.users.find(u => u.id === tx.userId);
      if (user) addNotification(user.id, '❌ Paiement échoué', `Transaction ${txId} refusée. ${tx.failReason}`, 'error');
    }

    // Nettoyer les paiements en attente
    if (pendingIdx !== -1) DB.pendingPayments.splice(pendingIdx, 1);

    res.json({ received: true, txId, status: tx.statut });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ error: 'Erreur webhook.' });
  }
});

// GET /api/payment/success — Redirection succès
app.get('/api/payment/success', (req, res) => {
  const txId = req.query.txId;
  const tx = DB.transactions.find(t => t.id === txId);
  if (!tx) return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:3rem;background:#f0f7f3"><h1 style="color:#006B3F">✅ Paiement Confirmé !</h1><p>Votre abonnement BAS PRIX a été activé.</p><a href="/" style="background:#006B3F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Retour à l'application</a></body></html>`);
  res.send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paiement Confirmé – BAS PRIX</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#006B3F,#00883F);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.card{background:#fff;border-radius:20px;padding:2.5rem;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.2)}.icon{font-size:64px;margin-bottom:1rem}.title{font-size:22px;font-weight:800;color:#006B3F;margin-bottom:.5rem}.sub{font-size:13px;color:#666;margin-bottom:1.5rem}.txbox{background:#f0f7f3;border-radius:10px;padding:12px;margin-bottom:1.5rem;border:2px solid #d4f0e3}.txbox .lbl{font-size:11px;color:#7a9a85;text-transform:uppercase;letter-spacing:.05em}.txbox .val{font-size:16px;font-weight:800;color:#006B3F}.btn{display:block;background:linear-gradient(135deg,#006B3F,#00883F);color:#fff;padding:13px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;transition:opacity .15s}.btn:hover{opacity:.9}.flag{display:flex;justify-content:center;gap:3px;margin-bottom:1.5rem}.fs{width:8px;height:26px;border-radius:3px}.fs1{background:#006B3F}.fs2{background:#FFCE00}.fs3{background:#D62828}</style>
</head><body>
<div class="card">
  <div class="flag"><div class="fs fs1"></div><div class="fs fs2"></div><div class="fs fs3"></div></div>
  <div class="icon">✅</div>
  <div class="title">Paiement Confirmé !</div>
  <div class="sub">Votre abonnement <strong>${tx.plan.toUpperCase()}</strong> a été activé avec succès sur BAS PRIX 🇹🇬</div>
  <div class="txbox">
    <div class="lbl">Référence de transaction</div>
    <div class="val">${tx.id}</div>
  </div>
  <div class="txbox">
    <div class="lbl">Montant payé</div>
    <div class="val">${Number(tx.montant).toLocaleString('fr-FR')} FCFA via ${tx.methode.toUpperCase()}</div>
  </div>
  <a href="/" class="btn">🏠 Retour à BAS PRIX</a>
</div>
</body></html>`);
});

// GET /api/payment/fail — Redirection échec
app.get('/api/payment/fail', (req, res) => {
  const txId = req.query.txId;
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement Échoué – BAS PRIX</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#D62828,#b52020);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.card{background:#fff;border-radius:20px;padding:2.5rem;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.2)}.icon{font-size:64px;margin-bottom:1rem}.title{font-size:22px;font-weight:800;color:#D62828;margin-bottom:.5rem}.sub{font-size:13px;color:#666;margin-bottom:1.5rem}.btn{display:block;background:#006B3F;color:#fff;padding:13px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:10px}.btn2{display:block;background:#f0f0f0;color:#333;padding:13px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px}</style>
</head><body><div class="card">
  <div class="icon">❌</div>
  <div class="title">Paiement Échoué</div>
  <div class="sub">Votre paiement n'a pas pu être traité. Référence : <strong>${txId || '—'}</strong></div>
  <a href="/api/payment/retry?txId=${txId}" class="btn">🔄 Réessayer le paiement</a>
  <a href="/" class="btn2">🏠 Retour à BAS PRIX</a>
</div></body></html>`);
});

// POST /api/payment/verify — Vérifier manuellement une transaction
app.post('/api/payment/verify', authMiddleware, (req, res) => {
  const { txId } = req.body;
  if (!txId) return res.status(400).json({ error: 'txId requis' });

  const tx = DB.transactions.find(t => t.id === txId && t.userId === req.user.id);
  if (!tx) return res.status(404).json({ error: 'Transaction introuvable' });

  res.json({ txId: tx.id, statut: tx.statut, plan: tx.plan, montant: tx.montant, methode: tx.methode, createdAt: tx.createdAt, confirmedAt: tx.confirmedAt || null });
});

// GET /api/payment/transactions — Historique paiements de l'utilisateur
app.get('/api/payment/transactions', authMiddleware, (req, res) => {
  const userTxs = DB.transactions.filter(t => t.userId === req.user.id).map(t => {
    const { phone, ...safe } = t; // cacher le numéro de téléphone
    return safe;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(userTxs);
});

// ═══════════════════════════════════════════════════════════════
// ROUTES PLANS
// ═══════════════════════════════════════════════════════════════

app.get('/api/plans', (req, res) => {
  res.json(Object.entries(CONFIG.PLANS).map(([key, val]) => ({ id: key, ...val })));
});

// ═══════════════════════════════════════════════════════════════
// ROUTES PRODUITS
// ═══════════════════════════════════════════════════════════════

app.get('/api/products', (req, res) => {
  const { q, cat, page = 1, limit = 20 } = req.query;
  let results = [...DB.products];
  if (q) results = results.filter(p => p.titre.toLowerCase().includes(q.toLowerCase()) || p.ville.toLowerCase().includes(q.toLowerCase()));
  if (cat) results = results.filter(p => p.cat === cat);
  results = results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = results.length;
  const paginated = results.slice((page - 1) * limit, page * limit);
  res.json({ products: paginated, total, page: Number(page), pages: Math.ceil(total / limit) });
});

app.post('/api/products', authMiddleware, (req, res) => {
  if (req.user.isAdmin) return res.status(403).json({ error: 'Admin ne peut pas publier d\'articles.' });
  const { titre, prix, cat, etat, ville, desc, adresse, whatsapp, gozem } = req.body;
  if (!titre || !prix || !cat || !ville || !desc) return res.status(400).json({ error: 'Champs obligatoires manquants.' });

  // Vérifier limite d'articles selon le plan
  const plan = CONFIG.PLANS[req.user.plan] || CONFIG.PLANS.free;
  const userProds = DB.products.filter(p => p.userId === req.user.id);
  if (userProds.length >= plan.maxArticles) return res.status(403).json({ error: `Limite atteinte (${plan.maxArticles} articles) pour le plan ${req.user.plan}. Passez au plan supérieur.` });

  const newProd = { id: 'p'+uuidv4().split('-')[0], titre: sanitize(titre), prix: Number(prix), cat: sanitize(cat), etat: sanitize(etat||'Occasion'), ville: sanitize(ville), desc: sanitize(desc), nom: req.user.name, tel: req.user.tel, whatsapp: sanitize(whatsapp||''), adresse: sanitize(adresse||ville), userId: req.user.id, views: 0, gozem: sanitize(gozem||'none'), createdAt: new Date().toISOString() };
  DB.products.push(newProd);
  res.status(201).json(newProd);
});

app.put('/api/products/:id', authMiddleware, (req, res) => {
  const idx = DB.products.findIndex(p => p.id === req.params.id && (p.userId === req.user.id || req.user.isAdmin));
  if (idx === -1) return res.status(404).json({ error: 'Article introuvable ou non autorisé.' });
  const allowed = ['titre','prix','cat','etat','ville','desc','adresse','whatsapp','gozem'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = typeof req.body[k] === 'number' ? req.body[k] : sanitize(req.body[k]); });
  DB.products[idx] = { ...DB.products[idx], ...updates, updatedAt: new Date().toISOString() };
  res.json(DB.products[idx]);
});

app.delete('/api/products/:id', authMiddleware, (req, res) => {
  const idx = DB.products.findIndex(p => p.id === req.params.id && (p.userId === req.user.id || req.user.isAdmin));
  if (idx === -1) return res.status(404).json({ error: 'Article introuvable ou non autorisé.' });
  DB.products.splice(idx, 1);
  res.json({ message: 'Article supprimé.' });
});

// ═══════════════════════════════════════════════════════════════
// ROUTES GOZEM LIVRAISON
// ═══════════════════════════════════════════════════════════════

// POST /api/gozem/estimate — Estimer le prix de livraison
app.post('/api/gozem/estimate', authMiddleware, (req, res) => {
  const { from, to, vehicleType } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'Adresses de départ et d\'arrivée requises.' });

  // Simulation de calcul (en prod : appel à l'API Gozem)
  const basePrice = vehicleType === 'car' ? 2000 : 500;
  const distanceKm = 3 + Math.random() * 10; // simulé
  const price = Math.round(basePrice + distanceKm * 100);
  const estimateId = 'GZ' + Date.now();

  res.json({
    estimateId,
    vehicleType: vehicleType || 'moto',
    from,
    to,
    distanceKm: distanceKm.toFixed(1),
    price,
    currency: 'FCFA',
    duration: `${Math.round(distanceKm * 3)} min`,
    message: `Livraison Gozem estimée à ${price.toLocaleString()} FCFA`
  });
});

// POST /api/gozem/request — Commander une livraison
app.post('/api/gozem/request', authMiddleware, (req, res) => {
  const { productId, from, to, vehicleType, buyerPhone } = req.body;
  if (!from || !to || !buyerPhone) return res.status(400).json({ error: 'Adresses et téléphone acheteur requis.' });

  const deliveryId = 'GZD' + Date.now();
  const estimatedPrice = vehicleType === 'car' ? 3500 : 1200;

  // En prod : appel à l'API Gozem pour créer la course
  // const gozemResponse = await fetch(`${CONFIG.GOZEM_API_URL}/deliveries`, { method:'POST', headers:{'Authorization':'Bearer '+CONFIG.GOZEM_API_KEY,'Content-Type':'application/json'}, body: JSON.stringify({pickup:from,dropoff:to,vehicle:vehicleType,contact:buyerPhone}) });

  addNotification(req.user.id, '🛵 Livraison Gozem commandée', `Livraison ${deliveryId} créée. Un livreur sera bientôt assigné.`, 'delivery');

  res.json({
    success: true,
    deliveryId,
    statut: 'en_attente',
    vehicleType: vehicleType || 'moto',
    from,
    to,
    buyerPhone,
    estimatedPrice,
    estimatedDuration: '20-35 min',
    gozemTrackingUrl: `https://gozem.co/track/${deliveryId}`,
    message: `Livraison Gozem créée ! ID: ${deliveryId}`
  });
});

// ═══════════════════════════════════════════════════════════════
// ROUTES DISPUTES / LITIGES
// ═══════════════════════════════════════════════════════════════

app.get('/api/disputes', authMiddleware, (req, res) => {
  const myDisputes = req.user.isAdmin
    ? DB.disputes
    : DB.disputes.filter(d => d.acheteurId === req.user.id || d.vendeurId === req.user.id);
  res.json(myDisputes);
});

app.post('/api/disputes', authMiddleware, (req, res) => {
  const { vendeurId, articleId, articleTitre, montant, description } = req.body;
  if (!description) return res.status(400).json({ error: 'Description du litige requise.' });
  const vendeur = DB.users.find(u => u.id === vendeurId);
  const newDispute = {
    id: 'DP' + Date.now(), acheteurId: req.user.id, vendeurId: vendeurId || null,
    acheteurNom: req.user.name, vendeurNom: vendeur ? vendeur.name : 'Vendeur inconnu',
    articleId, articleTitre, montant: Number(montant) || 0,
    description: sanitize(description), statut: 'ouvert', decision: null,
    messages: [{ from: req.user.name, txt: sanitize(description), ts: new Date().toISOString() }],
    createdAt: new Date().toISOString()
  };
  DB.disputes.push(newDispute);
  if (vendeurId) addNotification(vendeurId, '⚠️ Litige ouvert', `${req.user.name} a ouvert un litige concernant "${articleTitre}".`, 'dispute');
  addNotification(CONFIG.ADMIN_ID, '🚨 Nouveau litige', `Litige ${newDispute.id} : ${req.user.name} vs ${vendeur?.name||'?'} · "${articleTitre}"`, 'dispute');
  res.status(201).json(newDispute);
});

// PUT /api/disputes/:id/message — Ajouter un message au litige
app.put('/api/disputes/:id/message', authMiddleware, (req, res) => {
  const dispute = DB.disputes.find(d => d.id === req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Litige introuvable.' });
  if (dispute.statut === 'résolu') return res.status(400).json({ error: 'Litige déjà résolu.' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis.' });
  dispute.messages.push({ from: req.user.name, txt: sanitize(message), ts: new Date().toISOString() });
  res.json(dispute);
});

// PUT /api/disputes/:id/resolve — Résoudre un litige (admin seulement)
app.put('/api/disputes/:id/resolve', adminMiddleware, (req, res) => {
  const dispute = DB.disputes.find(d => d.id === req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Litige introuvable.' });
  const { decision, motif } = req.body;
  if (!['acheteur','vendeur','aucun'].includes(decision)) return res.status(400).json({ error: 'Décision invalide: acheteur | vendeur | aucun' });
  dispute.statut = 'résolu';
  dispute.decision = decision;
  dispute.resolvedAt = new Date().toISOString();
  dispute.resolvedBy = req.user.name;
  dispute.messages.push({ from: 'Administrateur BAS PRIX', txt: `✅ Litige résolu en faveur de l'${decision}. ${motif || ''}`, ts: new Date().toISOString() });
  if (dispute.acheteurId) addNotification(dispute.acheteurId, '⚖️ Litige résolu', `Le litige ${dispute.id} a été résolu en faveur de l'${decision}.`, 'info');
  if (dispute.vendeurId) addNotification(dispute.vendeurId, '⚖️ Litige résolu', `Le litige ${dispute.id} a été résolu en faveur de l'${decision}.`, 'info');
  res.json(dispute);
});

// ═══════════════════════════════════════════════════════════════
// ROUTES MESSAGES / CHAT
// ═══════════════════════════════════════════════════════════════

app.get('/api/conversations', authMiddleware, (req, res) => {
  const myConvs = DB.conversations.filter(c => c.participants.includes(req.user.id));
  res.json(myConvs);
});

app.post('/api/conversations', authMiddleware, (req, res) => {
  const { otherUserId, productId, productTitle, sellerName } = req.body;
  let conv = DB.conversations.find(c => c.participants.includes(req.user.id) && c.productId === productId);
  if (!conv) {
    conv = { id: 'cv'+uuidv4().split('-')[0], participants: [req.user.id, otherUserId||'guest'], productId, productTitle, sellerName, messages: [], createdAt: new Date().toISOString() };
    DB.conversations.push(conv);
  }
  res.json(conv);
});

app.post('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const conv = DB.conversations.find(c => c.id === req.params.id && c.participants.includes(req.user.id));
  if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
  const { type, content, lat, lng } = req.body;
  const msg = { id: 'm'+Date.now(), sender: req.user.id, senderName: req.user.name, type: type||'text', content: sanitize(content||''), lat, lng, ts: Date.now() };
  conv.messages.push(msg);
  res.json(msg);
});

// ═══════════════════════════════════════════════════════════════
// ROUTES NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

app.get('/api/notifications', authMiddleware, (req, res) => {
  const myNotifs = DB.notifications.filter(n => n.userId === req.user.id || n.userId === 'all').sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,30);
  res.json(myNotifs);
});

app.put('/api/notifications/read-all', authMiddleware, (req, res) => {
  DB.notifications.filter(n => n.userId === req.user.id).forEach(n => n.read = true);
  res.json({ message: 'Toutes les notifications marquées comme lues.' });
});

// ═══════════════════════════════════════════════════════════════
// ROUTES ADMIN — ACCÈS RESTREINT
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/overview — Vue d'ensemble complète
app.get('/api/admin/overview', adminMiddleware, (req, res) => {
  const totalRevenue = DB.transactions.filter(t => t.statut === 'success').reduce((s,t) => s + t.montant, 0);
  const revenueByMethod = { flooz: 0, tmoney: 0, wave: 0, invitation: 0 };
  DB.transactions.filter(t => t.statut === 'success').forEach(t => { if (revenueByMethod[t.methode] !== undefined) revenueByMethod[t.methode] += t.montant; });

  res.json({
    users: { total: DB.users.filter(u => !u.isAdmin).length, premium: DB.users.filter(u => u.plan === 'premium').length, standard: DB.users.filter(u => u.plan === 'standard').length, free: DB.users.filter(u => u.plan === 'free' || !u.plan).length },
    products: { total: DB.products.length, withGozem: DB.products.filter(p => p.gozem && p.gozem !== 'none').length },
    transactions: { total: DB.transactions.length, success: DB.transactions.filter(t => t.statut === 'success').length, pending: DB.pendingPayments.length, failed: DB.transactions.filter(t => t.statut === 'failed').length, totalRevenue, revenueByMethod },
    disputes: { total: DB.disputes.length, open: DB.disputes.filter(d => d.statut === 'ouvert').length, resolved: DB.disputes.filter(d => d.statut === 'résolu').length },
    conversations: { total: DB.conversations.length, messages: DB.conversations.reduce((s,c) => s + c.messages.length, 0) }
  });
});

// GET /api/admin/users — Tous les utilisateurs avec leurs infos complètes
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const safeUsers = DB.users.map(u => { const { password, ...safe } = u; return safe; });
  res.json(safeUsers);
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', adminMiddleware, (req, res) => {
  const idx = DB.users.findIndex(u => u.id === req.params.id && !u.isAdmin);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  DB.users[idx].active = false; // Désactivation douce (soft delete)
  res.json({ message: 'Utilisateur désactivé.' });
});

// GET /api/admin/transactions — Toutes les transactions
app.get('/api/admin/transactions', adminMiddleware, (req, res) => {
  res.json(DB.transactions.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// GET /api/admin/disputes — Tous les litiges
app.get('/api/admin/disputes', adminMiddleware, (req, res) => {
  res.json(DB.disputes.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// ═══════════════════════════════════════════════════════════════
// PAGE D'ACCUEIL DU SERVEUR
// ═══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BAS PRIX API</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0a1a0f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
.card{max-width:700px;width:100%}.flag{display:flex;gap:4px;margin-bottom:1.5rem}.fs{width:8px;height:30px;border-radius:3px}
.fs1{background:#006B3F}.fs2{background:#FFCE00}.fs3{background:#D62828}
h1{font-size:32px;font-weight:900;margin-bottom:.5rem}h1 em{color:#FFCE00;font-style:normal}
.sub{color:rgba(255,255,255,.5);margin-bottom:2rem;font-size:15px}
.endpoints{background:rgba(255,255,255,.05);border-radius:12px;padding:1.5rem;border:1px solid rgba(255,255,255,.1)}
.ep-group{margin-bottom:1.25rem}.ep-group h3{color:#FFCE00;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.6rem}
.ep{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.ep:last-child{border-bottom:none}
.method{font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px;min-width:52px;text-align:center}
.get{background:#0369a1;color:#fff}.post{background:#006B3F;color:#fff}.put{background:#92400e;color:#fff}.del{background:#991b1b;color:#fff}
.path{font-family:monospace;font-size:13px;color:rgba(255,255,255,.8)}.desc{font-size:11px;color:rgba(255,255,255,.4);margin-left:auto}
.status{margin-top:1.5rem;background:#006B3F;border-radius:10px;padding:12px 16px;font-size:13px;display:flex;align-items:center;gap:8px}
</style></head><body><div class="card">
<div class="flag"><div class="fs fs1"></div><div class="fs fs2"></div><div class="fs fs3"></div></div>
<h1>BAS <em>PRIX</em> API</h1>
<div class="sub">Backend Marketplace Togo — v2.0 · Port ${PORT}</div>
<div class="endpoints">
  <div class="ep-group"><h3>🔐 Authentification</h3>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/auth/register</span><span class="desc">Inscription + essai 3 mois Premium</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/auth/login</span><span class="desc">Connexion</span></div>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/auth/me</span><span class="desc">Profil utilisateur</span></div>
  </div>
  <div class="ep-group"><h3>💳 Paiement (Flooz · T-Money · Wave)</h3>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/payment/initiate</span><span class="desc">Initier + URL redirection opérateur</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/payment/webhook</span><span class="desc">Callback confirmation opérateur</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/payment/verify</span><span class="desc">Vérifier une transaction</span></div>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/payment/success</span><span class="desc">Page de succès</span></div>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/payment/fail</span><span class="desc">Page d'échec</span></div>
  </div>
  <div class="ep-group"><h3>📦 Articles</h3>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/products</span><span class="desc">Lister (pagination, filtres)</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/products</span><span class="desc">Créer</span></div>
    <div class="ep"><span class="method put">PUT</span><span class="path">/api/products/:id</span><span class="desc">Modifier</span></div>
    <div class="ep"><span class="method del">DEL</span><span class="path">/api/products/:id</span><span class="desc">Supprimer</span></div>
  </div>
  <div class="ep-group"><h3>🛵 Gozem Livraison</h3>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/gozem/estimate</span><span class="desc">Estimer le prix</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/gozem/request</span><span class="desc">Commander une livraison</span></div>
  </div>
  <div class="ep-group"><h3>⚖️ Litiges</h3>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/disputes</span><span class="desc">Mes litiges</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/api/disputes</span><span class="desc">Ouvrir un litige</span></div>
    <div class="ep"><span class="method put">PUT</span><span class="path">/api/disputes/:id/resolve</span><span class="desc">Résoudre (admin)</span></div>
  </div>
  <div class="ep-group"><h3>🛡️ Admin (token admin requis)</h3>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/admin/overview</span><span class="desc">Vue globale + revenus</span></div>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/admin/users</span><span class="desc">Tous les utilisateurs</span></div>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/admin/transactions</span><span class="desc">Toutes les transactions</span></div>
    <div class="ep"><span class="method get">GET</span><span class="path">/api/admin/disputes</span><span class="desc">Tous les litiges</span></div>
  </div>
</div>
<div class="status">✅ Serveur opérationnel · ${new Date().toLocaleString('fr-FR')} · 🇹🇬 BAS PRIX</div>
</div></body></html>`);
});

// ─── 404 ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route introuvable. Consultez la documentation à GET /' }));

// ─── ERROR HANDLER ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur serveur interne.' });
});

// ─── DÉMARRAGE ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   🇹🇬  BAS PRIX API — Démarré !        ║`);
  console.log(`╠════════════════════════════════════════╣`);
  console.log(`║  URL   : http://localhost:${PORT}          ║`);
  console.log(`║  Admin : ${CONFIG.ADMIN_EMAIL}    ║`);
  console.log(`║  Mode  : ${process.env.NODE_ENV || 'development'}                  ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});

module.exports = app;
