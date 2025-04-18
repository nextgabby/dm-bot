const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
const dotenv = require("dotenv");
const fs = require("fs");
const crypto = require("crypto");

dotenv.config();

const app = express();
app.use(express.json());

// Load responses from JSON file
const responses = JSON.parse(fs.readFileSync("responses.json", "utf8"));

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const rwClient = twitterClient.readWrite;

// Store bot user ID (prevents responding to itself)
let botUserId = null;
const lastMessageByUser = {}; // Store last message ID per user

(async () => {
  try {
    const user = await twitterClient.v2.me();
    botUserId = user.data.id;
    console.log("✅ Bot running as:", user.data.username);
  } catch (error) {
    console.error("Twitter API Authentication Error:", error);
  }
})();

// **Send DM Function (One Message at a Time)**
async function sendDM(recipientId, messages) {
    if (!Array.isArray(messages)) messages = [messages];
  
    for (const message of messages) {
      try {
        console.log("🌀 Processing message:", message);
  
        if (typeof message === "object" && message.type === "media" && message.media_id) {
          const response = await rwClient.v2.sendDmToParticipant(recipientId, {
            attachments: [{ media_id: message.media_id }],
            text: " " // Required field
          });
  
          console.log(`✅ Sent media DM to ${recipientId}: ${message.media_id}`);
          console.log("📦 Response:", response.data || response);
        } else if (typeof message === "string") {
          const response = await rwClient.v2.sendDmToParticipant(recipientId, { text: message });
          console.log(`✅ Sent text DM to ${recipientId}: ${message}`);
        } else {
          console.warn("⚠️ Unrecognized message format, skipping:", message);
        }
  
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error("❌ DM Error:", {
          status: error.code,
          data: error.data,
          message: error.message,
        });
      }
    }
  }
  

// **Webhook to Handle Incoming DMs**
app.post("/webhook", (req, res) => {
  try {
    const event = req.body?.direct_message_events?.[0];

    if (!event || event.type !== "message_create") return res.sendStatus(400);

    const senderId = event.message_create.sender_id;
    const messageId = event.id;
    const text = event.message_create.message_data.text.trim().toLowerCase();

    console.log(`📩 Received from ${senderId}: ${text}`);

    // **Ignore messages from the bot itself**
    if (senderId === botUserId) {
      console.log("🛑 Ignoring bot's own message.");
      return res.sendStatus(200);
    }

    // **Prevent duplicate processing (if message already seen)**
    if (lastMessageByUser[senderId] === messageId) {
      console.log("🛑 Ignoring duplicate message.");
      return res.sendStatus(200);
    }
    lastMessageByUser[senderId] = messageId; // Store latest message ID for user

    // **Determine Response**
    let responseMessages = ["I didn’t understand that. Reply with 1, 2, 3, 4, or 'Flame Off' to end the chat."];

    if (text === "hi" || text === "hello" || text === "hi h.e.r.b.i.e") {
      responseMessages = responses.start;
    } else if (text === "flame off") {
      responseMessages = responses.flameoff;
    } else if (responses[text]) {
      responseMessages = responses[text];
    }

    // **Send response in a separate process (Prevents Heroku timeout)**
    setImmediate(() => sendDM(senderId, responseMessages));

    // **Return response to Heroku immediately**
    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing webhook request:", error);
    res.sendStatus(500);
  }
});

app.get("/webhook", (req, res) => {
  const crc_token = req.query.crc_token;
  if (!crc_token) return res.status(400).send("Error: crc_token missing");

  const hash = crypto.createHmac("sha256", process.env.TWITTER_API_SECRET)
    .update(crc_token)
    .digest("base64");

  res.json({ response_token: `sha256=${hash}` });
});


app.get("/", (req, res) => res.send("H.E.R.B.I.E. is running!"));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`App listening on port: ${PORT}`));
