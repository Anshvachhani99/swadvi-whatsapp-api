const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode'); // <-- For image QR
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

const app = express();
const PORT = process.env.PORT || 3000;

let sock = null;
let isConnected = false;
let currentQR = null; // 🆕 Store the latest QR for web UI

app.use(bodyParser.json());

// Serve simple HTML QR UI
app.get('/qr', async (req, res) => {
  if (!currentQR) {
    return res.send('<h2>🤖 No QR Code available. Please wait or refresh.</h2>');
  }

  try {
    const qrImage = await qrcode.toDataURL(currentQR);
    res.send(`
      <div style="text-align:center;">
        <h2>📲 Scan this QR Code to login WhatsApp</h2>
        <img src="${qrImage}" />
      </div>
    `);
  } catch (err) {
    res.status(500).send('Failed to generate QR');
  }
});

// WhatsApp connect function
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys-auth');

  sock = makeWASocket({
    auth: state,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      currentQR = qr; // 🆕 Save for web route
      console.log('📲 Scan QR shown at: http://localhost:' + PORT + '/qr');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
      isConnected = false;
      console.log('❌ Disconnected. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      } else {
        console.log('🔒 Session expired. Please restart.');
      }
    }

    if (connection === 'open') {
      currentQR = null; // 🧹 Clear QR once connected
      isConnected = true;
      console.log('✅ WhatsApp connected!');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// API to check status
app.get('/whatsapp-status', (req, res) => {
  res.json({ status: isConnected ? 'connected' : 'disconnected' });
});

// Send WhatsApp message
app.post('/send-message', async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ status: 'disconnected', error: 'WhatsApp is not connected' });
  }

  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).json({ error: 'Missing number or message' });
  }

  const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

  try {
    const sent = await sock.sendMessage(jid, { text: message });
    res.json({ status: 'sent', id: sent.key.id });
  } catch (err) {
    console.error('❌ Failed to send message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Start the app
app.listen(PORT, () => {
  console.log(`🟢 Server running at http://localhost:${PORT}`);
  connectToWhatsApp();
});
