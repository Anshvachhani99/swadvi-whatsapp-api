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

// Route to serve HTML form to send message
app.get('/send', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Send WhatsApp Message</title>
        <style>
          body { font-family: Arial; padding: 20px; }
          input, textarea { width: 300px; padding: 10px; margin: 10px 0; }
          button { padding: 10px 20px; }
        </style>
      </head>
      <body>
        <h2>📤 Send WhatsApp Message</h2>
        <form method="POST" action="/send" onsubmit="return sendMessage(event)">
          <label>Mobile Number (with country code):</label><br />
          <input type="text" id="number" placeholder="91XXXXXXXXXX" required /><br />
          <label>Message:</label><br />
          <textarea id="message" rows="4" placeholder="Type your message..." required></textarea><br />
          <button type="submit">Send</button>
        </form>
        <div id="response" style="margin-top: 20px;"></div>

        <script>
          async function sendMessage(event) {
            event.preventDefault();
            const number = document.getElementById('number').value;
            const message = document.getElementById('message').value;

            const responseDiv = document.getElementById('response');

            try {
              const res = await fetch('/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number, message })
              });

              const data = await res.json();

              if (res.ok) {
                responseDiv.innerHTML = '<span style="color: green;">✅ Message sent! ID: ' + data.id + '</span>';
              } else {
                responseDiv.innerHTML = '<span style="color: red;">❌ Error: ' + (data.error || 'Failed') + '</span>';
              }
            } catch (err) {
              responseDiv.innerHTML = '<span style="color: red;">❌ Request failed</span>';
            }
          }
        </script>
      </body>
    </html>
  `);
});


// Start the app
app.listen(PORT, () => {
  console.log(`🟢 Server running at http://localhost:${PORT}`);
  connectToWhatsApp();
});
